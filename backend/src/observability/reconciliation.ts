import type { ReconciliationCandidate, ReconciliationFinding } from '../db/index.js'

export const RECONCILIATION_LIMITS = { pageSize: 100, cadenceMs: 30_000, heartbeatStaleMs: 120_000, progressStaleMs: 15 * 60_000, queueStaleMs: 5 * 60_000 } as const

export type OwnerObservation = { state: 'running' | 'closed' | 'unavailable'; executionId?: string }

/** An age is suspicion, not proof of death. Temporal remains responsible for
 * activity retries/deadlines. A terminal description alone cannot fence a
 * same-ID restart; only validated epoch/head/lease proof permits parking.
 * Legacy and unresolved ownership remain advisory. */
export function reconcileObservation(candidate: ReconciliationCandidate, owner: OwnerObservation, now: number): ReconciliationFinding[] {
  if (owner.state === 'closed') {
    const fenced = candidate.activeEpoch && candidate.lease && candidate.currentEpoch === candidate.activeEpoch && candidate.intentState === 'bound' && candidate.activeExecutionId === candidate.intentExecutionId && candidate.activeExecutionId === owner.executionId && !candidate.unresolvedStart
    return [{ kind: 'closed-owner',response: fenced ? 'park' : 'observe',...(owner.executionId ? { ownerExecutionId: owner.executionId } : {}),reason: fenced ? 'The exact owning execution has ended and no start remains unresolved. Work is paused for owner review; saved context and pending instructions are retained.' : 'The last observed owning workflow has ended. Review its saved context and pending operations before recovery. No lease or thread state was changed because a new execution may be starting.' }]
  }
  if (owner.state === 'unavailable') return [{ kind: 'owner-unavailable', response: 'observe', reason: 'Workflow status could not be confirmed. No work or lease was changed.' }]
  const findings: ReconciliationFinding[] = []
  if (candidate.lease && now - (candidate.heartbeatAtMs ?? candidate.updatedAtMs) >= RECONCILIATION_LIMITS.heartbeatStaleMs) findings.push({ kind: 'missing-heartbeat', response: 'observe', reason: 'This workflow has no recent operation heartbeat. Temporal retry/deadline supervision remains authoritative.' })
  if (candidate.lease && now - (candidate.progressAtMs ?? candidate.updatedAtMs) >= RECONCILIATION_LIMITS.progressStaleMs) findings.push({ kind: 'stalled-progress', response: 'observe', reason: 'No durable agent reply or completed tool boundary was recorded recently. A healthy long provider call is still allowed to finish.' })
  if (!candidate.lease && candidate.queueDepth > 0 && now - candidate.updatedAtMs >= RECONCILIATION_LIMITS.queueStaleMs) findings.push({ kind: 'queue-starvation', response: 'observe', reason: 'Queued work has not acquired an active turn. Capacity and worker availability need inspection.' })
  return findings
}
