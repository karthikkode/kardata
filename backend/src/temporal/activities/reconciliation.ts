import { Context } from '@temporalio/activity'
import { Client, Connection } from '@temporalio/client'
import { listReconciliationCandidates, recordReconciliation, workerPoolFromEnv, type TransactableDb, type ReconciliationCandidate } from '../../db/index.js'
import { createLogger, logOp } from '../../observability/logging.js'
import { reconcileObservation, RECONCILIATION_LIMITS, type OwnerObservation } from '../../observability/reconciliation.js'
import { projectNewEvents } from '../../projector.js'
import { temporalAddress, temporalNamespace } from '../connection.js'

export interface ReconciliationPage { cursor: string; inspected: number; findings: number; deferred?: 'projector-lag' }

export async function inspectWorkflowOwner(connection: Connection, client: Client, candidate: ReconciliationCandidate, logger = createLogger()): Promise<OwnerObservation> {
  if (!candidate.workflowId) return { state: 'unavailable' }
  const workflowId = candidate.workflowId
  try {
    return await logOp(logger, 'execution.inspect_owner', async (): Promise<OwnerObservation> => {
      const owner = await connection.withDeadline(Date.now() + 2_000, () => client.workflow.getHandle(workflowId,candidate.activeExecutionId ?? undefined).describe())
      return { state: owner.status.name === 'RUNNING' ? 'running' : 'closed',executionId: owner.runId }
    }, { workflowId: candidate.workflowId, threadKey: candidate.threadKey })
  } catch (error) {
    logger.warn({ event: 'execution.owner_unavailable', workflowId: candidate.workflowId, code: error instanceof Error ? error.name : 'unknown' })
    return { state: 'unavailable' }
  }
}

/** Exported production core accepts only adapters, never model-supplied
 * authority. Temporal unavailable is an observation, not permission to kill. */
export async function reconcilePage(db: TransactableDb, after: string, inspectOwner: (candidate: ReconciliationCandidate) => Promise<OwnerObservation>, now = Date.now(), heartbeat: () => void = () => undefined): Promise<ReconciliationPage> {
  const projected = await projectNewEvents(db)
  if (!projected.caughtUp) return { cursor: after, inspected: 0, findings: 0,deferred: 'projector-lag' }
  const candidates = await listReconciliationCandidates(db, after, RECONCILIATION_LIMITS.pageSize)
  let findings = 0
  for (let index = 0; index < candidates.length; index += 4) {
    const batch = candidates.slice(index,index + 4)
    const observations = await Promise.all(batch.map(async (candidate) => ({ candidate, owner: await inspectOwner(candidate) })))
    for (const { candidate, owner } of observations) {
      heartbeat()
      for (const finding of reconcileObservation(candidate, owner, now)) {
        if (await recordReconciliation(db, candidate, finding, Math.floor(now / RECONCILIATION_LIMITS.progressStaleMs))) {
          findings += 1
        }
      }
    }
  }
  await projectNewEvents(db)
  return { cursor: candidates.length < RECONCILIATION_LIMITS.pageSize ? '' : candidates.at(-1)!.threadKey, inspected: candidates.length, findings }
}

export async function reconciliationPageActivity(after: string): Promise<ReconciliationPage> {
  const context = Context.current()
  const logger = createLogger({ runId: context.info.workflowExecution?.workflowId, attempt: context.info.attempt })
  return logOp(logger, 'execution.reconcile', async () => {
    context.heartbeat({ phase: 'connect' })
    const connection = await Connection.connect({ address: temporalAddress(), connectTimeout: '5s' })
    try {
      const client = new Client({ connection, namespace: temporalNamespace() })
      return await reconcilePage(workerPoolFromEnv(), after, (candidate) => inspectWorkflowOwner(connection,client,candidate,logger), Date.now(), () => context.heartbeat({ phase: 'reconcile' }))
    } finally { await connection.close() }
  })
}
