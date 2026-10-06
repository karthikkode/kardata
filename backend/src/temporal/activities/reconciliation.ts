import { Context } from '@temporalio/activity'
import { Client, Connection } from '@temporalio/client'
import { controlRecorded, controlRecordedAt, listOrphanedWorkflows, listReconciliationCandidates, parentWorkflowsForChildren, recentTurnLoopEvidence, recordOrphanWorkflow, recordReconciliation, workerPoolFromEnv, type OrphanedWorkflow, type ReconciliationCandidate, type ReconciliationFinding, type TransactableDb } from '../../db/index.js'
import { childLogger, createLogger, logOp } from '../../observability/logging.js'
import { activityLogContext, activityLogFields, temporalClientInterceptors } from '../../observability/temporal-tracing.js'
import { decideTurnLoop } from '../../observability/supervision-rules.js'
import { reconcileObservation, reconcileOrphanChild, reconcileOrphanWorkflow, RECONCILIATION_LIMITS, type OwnerObservation } from '../../observability/reconciliation.js'
import { projectNewEvents } from '../../projector.js'
import { SUPERVISION_THRESHOLDS } from '../timeouts.js'
import { temporalAddress, temporalNamespace } from '../connection.js'

export interface ReconciliationPage { cursor: string; inspected: number; findings: number; deferred?: 'projector-lag' }

/** Temporal control surface for acting findings. Signals/cancel run BEFORE
 * the record lands: a lost effect retries next page, a lost record never
 * double-acts (controlRecorded gates repeats within the lease). */
export interface ReconciliationControl {
  describe(workflowId: string): Promise<{ state: 'running' | 'closed' | 'unknown'; executionId?: string }>
  signal(workflowId: string, signalName: 'runSteer' | 'runPause' | 'runCancel' | 'runStopTurn', payload?: string): Promise<void>
  cancel(workflowId: string): Promise<void>
}

export const SUPERVISION_NUDGE = 'Supervisor: no agent progress for 15 minutes. Report your status and next step in your next message.'

export async function inspectWorkflowOwner(connection: Connection, client: Client, candidate: ReconciliationCandidate, logger = createLogger()): Promise<OwnerObservation> {
  if (!candidate.workflowId) return { state: 'unavailable' }
  const workflowId = candidate.workflowId
  try {
    const scoped = childLogger(logger, activityLogContext({ threadKey: candidate.threadKey, sessionId: candidate.sessionId }))
    return await logOp(scoped, 'execution.inspect_owner', async (): Promise<OwnerObservation> => {
      const owner = await connection.withDeadline(Date.now() + 2_000, () => client.workflow.getHandle(workflowId, candidate.activeExecutionId ?? undefined).describe())
      return { state: owner.status.name === 'RUNNING' ? 'running' : 'closed', executionId: owner.runId }
    }, { workflowId: candidate.workflowId })
  } catch (error) {
    logger.warn({ event: 'execution.owner_unavailable', ...activityLogFields({ threadKey: candidate.threadKey, sessionId: candidate.sessionId }), workflowId: candidate.workflowId, code: error instanceof Error ? error.name : 'unknown' })
    return { state: 'unavailable' }
  }
}

async function applyFinding(
  db: TransactableDb,
  candidate: ReconciliationCandidate,
  finding: ReconciliationFinding,
  now: number,
  control: ReconciliationControl | undefined,
  logger: ReturnType<typeof createLogger>,
): Promise<boolean> {
  let effective = finding
  if (finding.response === 'nudge') {
    const nudgedAt = await controlRecordedAt(db, candidate.threadKey, finding.kind, 'nudge', candidate.lease)
    if (nudgedAt !== null) {
      if (now - nudgedAt < RECONCILIATION_LIMITS.progressStaleMs) return false
      effective = { ...finding, response: 'pause', reason: `${finding.reason} A nudge already went out for this lease over a full window ago, so the turn pauses for owner review.` }
    }
  }
  if (effective.response === 'nudge' || effective.response === 'pause' || effective.response === 'stop' || effective.response === 'cancel' || (effective.response === 'fail' && effective.kind === 'turn-wall-exceeded')) {
    if (!control) throw new Error(`reconciliation control unavailable for ${effective.kind}/${effective.response}`)
    if (await controlRecorded(db, candidate.threadKey, effective.kind, effective.response, candidate.lease)) return false
    if (!candidate.workflowId) return false
    try {
      if (effective.response === 'nudge') await control.signal(candidate.workflowId, 'runSteer', SUPERVISION_NUDGE)
      else if (effective.response === 'pause') await control.signal(candidate.workflowId, 'runPause')
      else if (effective.response === 'stop') await control.signal(candidate.workflowId, 'runStopTurn')
      else await control.cancel(candidate.workflowId)
    } catch (error) {
      logger.warn({ event: 'execution.control_failed', ...activityLogFields({ threadKey: candidate.threadKey, sessionId: candidate.sessionId }), kind: effective.kind, response: effective.response, code: error instanceof Error ? error.name : 'unknown' })
      return false
    }
  }
  const bucket = effective.response === 'alert' ? Math.floor(now / RECONCILIATION_LIMITS.queueStaleMs) : effective.response === 'observe' ? Math.floor(now / RECONCILIATION_LIMITS.progressStaleMs) : 0
  return recordReconciliation(db, candidate, effective, bucket)
}

/** Exported production core accepts only adapters, never model-supplied
 * authority. Temporal unavailable is an observation, not permission to kill. */
export async function reconcilePage(db: TransactableDb, after: string, inspectOwner: (candidate: ReconciliationCandidate) => Promise<OwnerObservation>, now = Date.now(), heartbeat: () => void = () => undefined, control?: ReconciliationControl): Promise<ReconciliationPage> {
  const projected = await projectNewEvents(db)
  if (!projected.caughtUp) return { cursor: after, inspected: 0, findings: 0, deferred: 'projector-lag' }
  const logger = createLogger(activityLogContext())
  const candidates = await listReconciliationCandidates(db, after, RECONCILIATION_LIMITS.pageSize)
  const leased = candidates.filter((candidate) => candidate.lease)
  const [loopEvidence, parentWorkflows, orphans] = await Promise.all([
    recentTurnLoopEvidence(db, leased.map((candidate) => candidate.threadKey)),
    parentWorkflowsForChildren(db, leased.filter((candidate) => candidate.threadKey.startsWith('agent:')).map((candidate) => candidate.threadKey)),
    listOrphanedWorkflows(db),
  ])
  let findings = 0
  const cancelSessionDeleted = async (candidate: ReconciliationCandidate): Promise<void> => {
    if (!candidate.lease || !control) throw new Error('reconciliation control unavailable for orphan-workflow/cancel')
    const described = candidate.workflowId ? await control.describe(candidate.workflowId) : { state: 'closed' as const }
    if (described.state === 'unknown') return
    if (await controlRecorded(db, candidate.threadKey, 'orphan-workflow', 'cancel', candidate.lease)) return
    if (described.state === 'running' && candidate.workflowId) {
      try {
        await control.cancel(candidate.workflowId)
      } catch (error) {
        logger.warn({ event: 'execution.control_failed', ...activityLogFields({ threadKey: candidate.threadKey, sessionId: candidate.sessionId }), kind: 'orphan-workflow', code: error instanceof Error ? error.name : 'unknown' })
        return
      }
    }
    const orphan: OrphanedWorkflow = { threadKey: candidate.threadKey, sessionId: candidate.sessionId, workflowId: candidate.workflowId, lease: candidate.lease }
    for (const finding of reconcileOrphanWorkflow()) {
      if (await recordOrphanWorkflow(db, orphan, finding)) findings += 1
    }
  }
  const cancelOrphanChild = async (candidate: ReconciliationCandidate): Promise<void> => {
    if (!candidate.lease || !candidate.threadKey.startsWith('agent:')) return
    const parentWorkflowId = parentWorkflows.get(candidate.threadKey)
    if (!parentWorkflowId) return
    if (!control) throw new Error('reconciliation control unavailable for orphan-child/cancel')
    const parent = await control.describe(parentWorkflowId).catch(() => ({ state: 'unknown' as const }))
    for (const finding of reconcileOrphanChild(parent.state)) {
      if (await controlRecorded(db, candidate.threadKey, finding.kind, finding.response, candidate.lease)) continue
      if (!candidate.workflowId) continue
      try {
        await control.cancel(candidate.workflowId)
      } catch (error) {
        logger.warn({ event: 'execution.control_failed', ...activityLogFields({ threadKey: candidate.threadKey, sessionId: candidate.sessionId }), kind: finding.kind, code: error instanceof Error ? error.name : 'unknown' })
        continue
      }
      if (await recordReconciliation(db, candidate, finding, 0)) findings += 1
    }
  }
  const act = async (candidate: ReconciliationCandidate, owner: OwnerObservation): Promise<void> => {
    try {
      heartbeat()
      if (candidate.sessionDeleted && candidate.lease) {
        await cancelSessionDeleted(candidate)
        return
      }
      const evidence = loopEvidence.get(candidate.threadKey)
      const loop = candidate.lease && evidence ? decideTurnLoop(evidence.tools, evidence.texts, SUPERVISION_THRESHOLDS.loopToolRepeats) : { loop: false as const }
      for (const finding of reconcileObservation(candidate, owner, now, { loop })) {
        if (await applyFinding(db, candidate, finding, now, control, logger)) findings += 1
      }
      if (owner.state === 'running') {
        await cancelOrphanChild(candidate)
      }
    } catch (error) {
      logger.warn({ event: 'execution.candidate_failed', ...activityLogFields({ threadKey: candidate.threadKey, sessionId: candidate.sessionId }), code: error instanceof Error ? error.message : 'unknown' })
    }
  }
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = candidates.slice(index, index + 8)
    const observations = await Promise.all(batch.map(async (candidate) => ({ candidate, owner: await inspectOwner(candidate) })))
    for (const { candidate, owner } of observations) {
      await act(candidate, owner)
    }
  }
  for (const orphan of orphans) {
    try {
      heartbeat()
      if (!control) throw new Error('reconciliation control unavailable for orphan-workflow/cancel')
      const described = orphan.workflowId ? await control.describe(orphan.workflowId) : { state: 'closed' as const }
      if (described.state === 'unknown') continue
      if (described.state === 'running' && orphan.workflowId) {
        try {
          await control.cancel(orphan.workflowId)
        } catch (error) {
          logger.warn({ event: 'execution.control_failed', ...activityLogFields({ threadKey: orphan.threadKey }), kind: 'orphan-workflow', code: error instanceof Error ? error.name : 'unknown' })
          continue
        }
      }
      for (const finding of reconcileOrphanWorkflow()) {
        if (await recordOrphanWorkflow(db, orphan, finding)) findings += 1
      }
    } catch (error) {
      logger.warn({ event: 'execution.candidate_failed', ...activityLogFields({ threadKey: orphan.threadKey }), code: error instanceof Error ? error.message : 'unknown' })
    }
  }
  await projectNewEvents(db)
  return { cursor: candidates.length < RECONCILIATION_LIMITS.pageSize ? '' : candidates.at(-1)!.threadKey, inspected: candidates.length, findings }
}

export async function reconciliationPageActivity(after: string): Promise<ReconciliationPage> {
  const context = Context.current()
  const logger = createLogger(activityLogContext())
  return logOp(logger, 'execution.reconcile', async () => {
    context.heartbeat({ phase: 'connect' })
    const connection = await Connection.connect({ address: temporalAddress(), connectTimeout: '5s' })
    try {
      const client = new Client({ connection, namespace: temporalNamespace(), interceptors: { workflow: temporalClientInterceptors() } })
      const control: ReconciliationControl = {
        describe: async (workflowId) => {
          try {
            const described = await connection.withDeadline(Date.now() + 2_000, () => client.workflow.getHandle(workflowId).describe())
            return { state: described.status.name === 'RUNNING' ? 'running' as const : 'closed' as const, executionId: described.runId }
          } catch {
            return { state: 'unknown' as const }
          }
        },
        signal: async (workflowId, signalName, payload) => {
          await client.workflow.getHandle(workflowId).signal(signalName, ...(payload === undefined ? [] : [payload]))
        },
        cancel: async (workflowId) => {
          await client.workflow.getHandle(workflowId).cancel()
        },
      }
      return await reconcilePage(workerPoolFromEnv(), after, (candidate) => inspectWorkflowOwner(connection, client, candidate, logger), Date.now(), () => context.heartbeat({ phase: 'reconcile' }), control)
    } finally { await connection.close() }
  })
}
