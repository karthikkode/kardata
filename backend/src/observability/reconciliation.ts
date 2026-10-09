import type { ReconciliationCandidate, ReconciliationFinding } from '../db/index.js'
import { SUPERVISION_THRESHOLDS } from '../temporal/timeouts.js'

export const RECONCILIATION_LIMITS = {
  pageSize: SUPERVISION_THRESHOLDS.reconcilePageSize,
  cadenceMs: SUPERVISION_THRESHOLDS.reconcileCadenceMs,
  heartbeatStaleMs: SUPERVISION_THRESHOLDS.missingHeartbeatMs,
  progressStaleMs: SUPERVISION_THRESHOLDS.noProgressMs,
  queueStaleMs: SUPERVISION_THRESHOLDS.queueStaleMs,
} as const

export type OwnerObservation = { state: 'running' | 'closed' | 'unavailable'; executionId?: string }

export interface LoopObservation {
  loop: boolean
  reason?: string
}

/** Pure supervision decisions (P3.4). An age is suspicion, not proof of
 * death: terminal descriptions fence on exact execution match, attempts
 * exhaustion reads the intent state (never a guess), and control effects
 * (signal/cancel) run in reconcilePage before the record lands, so a
 * lost effect is retried and a lost record never double-acts. */
export function reconcileObservation(
  candidate: ReconciliationCandidate,
  owner: OwnerObservation,
  now: number,
  extra: { loop?: LoopObservation } = {},
): ReconciliationFinding[] {
  if (!candidate.lease && candidate.queueDepth > 0 && !candidate.sessionDeleted && now - candidate.updatedAtMs >= RECONCILIATION_LIMITS.queueStaleMs) {
    return [{ kind: 'queue-starvation', response: 'alert', reason: 'Queued work has not acquired an active turn. Capacity and worker availability need inspection.' }]
  }
  if (owner.state === 'closed') {
    return [closedOwnerFinding(candidate, owner)]
  }
  const findings: ReconciliationFinding[] = []
  const heartbeatAge = now - (candidate.heartbeatAtMs ?? candidate.updatedAtMs)
  const progressAge = now - (candidate.progressAtMs ?? candidate.runStartedAtMs ?? candidate.updatedAtMs)
  if (owner.state === 'unavailable') {
    if (candidate.lease && heartbeatAge >= SUPERVISION_THRESHOLDS.turnWallMs) {
      return [{ kind: 'missing-heartbeat', response: 'fail', reason: 'No operation heartbeat arrived for over the wall clock and the owner cannot be described: Temporal retries are exhausted or the worker is gone. The thread failed with this reason and the parent was notified.' }]
    }
    return [{ kind: 'owner-unavailable', response: 'observe', reason: 'Workflow status could not be confirmed. No work or lease was changed.' }]
  }
  if (candidate.lease) {
    runningFindings(candidate, findings, now, heartbeatAge, progressAge, extra.loop)
  }
  return findings
}

function runningFindings(candidate: ReconciliationCandidate, findings: ReconciliationFinding[], now: number, heartbeatAge: number, progressAge: number, loop: LoopObservation | undefined): void {
  if (candidate.intentState === 'bound' && candidate.runStartedAtMs !== null && candidate.runStartedAtMs !== undefined && now - candidate.runStartedAtMs >= SUPERVISION_THRESHOLDS.turnWallMs) {
    findings.push({ kind: 'turn-wall-exceeded', response: 'fail', reason: `This turn held its lease past the ${SUPERVISION_THRESHOLDS.turnWallMs / 60_000}-minute wall clock. The run is cancelled and the thread failed honestly.` })
  }
  if (heartbeatAge >= RECONCILIATION_LIMITS.heartbeatStaleMs) {
    findings.push({ kind: 'missing-heartbeat', response: 'observe', reason: 'This workflow has no recent operation heartbeat. Temporal retry/deadline supervision remains authoritative.' })
  }
  if (progressAge >= RECONCILIATION_LIMITS.progressStaleMs) {
    findings.push({ kind: 'stalled-progress', response: 'nudge', reason: 'No durable agent reply, provider round or completed tool boundary was recorded recently. A first steering nudge goes out; a turn still stuck a full window later pauses with an owner alert.' })
  }
  if (loop?.loop) {
    findings.push({ kind: 'loop-detected', response: 'stop', reason: loop.reason ?? 'A repeated tool loop was detected in this turn.' })
  }
}

function closedOwnerFinding(candidate: ReconciliationCandidate, owner: OwnerObservation): ReconciliationFinding {
  const fenced = candidate.activeEpoch && candidate.lease && candidate.currentEpoch === candidate.activeEpoch && candidate.intentState === 'bound' && candidate.activeExecutionId === candidate.intentExecutionId && candidate.activeExecutionId === owner.executionId && !candidate.unresolvedStart
  return { kind: 'closed-owner', response: fenced ? 'fail' : 'observe', ...(owner.executionId ? { ownerExecutionId: owner.executionId } : {}), reason: fenced ? 'The exact owning execution has ended with work still leased. The thread failed as orphaned; the alert carries the reason and a successor turn revives it.' : 'The last observed owning workflow has ended. Review its saved context and pending operations before recovery. No lease or thread state was changed because a new execution may be starting.' }
}

/** A running child whose parent workflow ended (paused parents keep
 * running workflows, so they never match): cancel the child. */
export function reconcileOrphanChild(parentState: 'running' | 'closed' | 'unknown'): ReconciliationFinding[] {
  if (parentState !== 'closed') return []
  return [{ kind: 'orphan-child', response: 'cancel', reason: 'The parent workflow ended while this child still ran. The child run is cancelled.' }]
}

/** A lease whose thread or session is gone but whose workflow still runs:
 * cancel the workflow and clear the lease. */
export function reconcileOrphanWorkflow(): ReconciliationFinding[] {
  return [{ kind: 'orphan-workflow', response: 'cancel', reason: 'The thread or session is gone but the workflow still runs. The workflow is cancelled and the lease cleared.' }]
}
