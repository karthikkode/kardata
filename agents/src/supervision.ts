// Heartbeats, supervisor sweep with recorded responses, audit log. T9.1.
// A stall is routine resume material, not an incident: every detection maps
// to a recorded response (retry, fallback, suspend, alert).
import type { Clock } from './clock.js'
import type { RepeatVerdict } from './budgets.js'

export interface HeartbeatThresholds {
  idleStaleMs: number
  inToolStaleMs: number
}

export class HeartbeatMonitor {
  private readonly beats = new Map<string, { at: number; busy: boolean }>()

  constructor(private readonly clock: Clock) {}

  beat(id: string, busy = false): void {
    this.beats.set(id, { at: this.clock.now(), busy })
  }

  /** Backfill a beat observed elsewhere (e.g. a database row): the age
   * counts from `atMs`, not from now. The backend sweeper replays stored
   * heartbeats through this so table rows drive the same thresholds. */
  beatAt(id: string, atMs: number, busy = false): void {
    this.beats.set(id, { at: atMs, busy })
  }

  ageMs(id: string): number | undefined {
    const beat = this.beats.get(id)
    return beat ? this.clock.now() - beat.at : undefined
  }

  staleIds(thresholds: HeartbeatThresholds): string[] {
    const out: string[] = []
    for (const [id, beat] of this.beats) {
      const limit = beat.busy ? thresholds.inToolStaleMs : thresholds.idleStaleMs
      if (this.clock.now() - beat.at >= limit) out.push(id)
    }
    return out
  }
}

export type FindingKind =
  | 'missing-heartbeat'
  | 'repeated-calls'
  | 'no-progress'
  | 'budget-near'
  | 'context-near'

export interface RunStats {
  id: string
  busy: boolean
  stalledTurns: number
  maxStalledTurns: number
  lastRepeatVerdict?: RepeatVerdict
  budgetUsedRatio: number
  contextUsedRatio: number
}

export interface SupervisorFinding {
  id: string
  kind: FindingKind
  detail: string
}

export interface SweepThresholds extends HeartbeatThresholds {
  nearRatio: number
}

export function sweep(
  monitor: HeartbeatMonitor,
  stats: RunStats[],
  thresholds: SweepThresholds,
): SupervisorFinding[] {
  const findings: SupervisorFinding[] = []
  const stale = new Set(monitor.staleIds(thresholds))
  for (const run of stats) {
    if (stale.has(run.id) || monitor.ageMs(run.id) === undefined) {
      findings.push({ id: run.id, kind: 'missing-heartbeat', detail: 'no heartbeat within threshold' })
      continue
    }
    if (run.lastRepeatVerdict === 'blocked' || run.lastRepeatVerdict === 'replan') {
      findings.push({ id: run.id, kind: 'repeated-calls', detail: `repetition verdict ${run.lastRepeatVerdict}` })
    }
    if (run.stalledTurns >= run.maxStalledTurns) {
      findings.push({ id: run.id, kind: 'no-progress', detail: `${run.stalledTurns} turns without progress` })
    }
    if (run.budgetUsedRatio >= thresholds.nearRatio) {
      findings.push({ id: run.id, kind: 'budget-near', detail: `budget ${(run.budgetUsedRatio * 100).toFixed(0)}% used` })
    }
    if (run.contextUsedRatio >= thresholds.nearRatio) {
      findings.push({ id: run.id, kind: 'context-near', detail: `context ${(run.contextUsedRatio * 100).toFixed(0)}% used` })
    }
  }
  return findings
}

export type SupervisorResponse = 'retry' | 'fallback' | 'suspend' | 'alert'

export interface SupervisorDecision {
  id: string
  kind: FindingKind
  response: SupervisorResponse
  reason: string
  at: number
}

// Default policy: stalls suspend for checkpointed resume, repeats retry once
// (callers escalate on recurrence), exhaustion alerts the operator, and
// provider-class failures fall back to the next route.
export function decide(finding: SupervisorFinding, clock: Clock): SupervisorDecision {
  const base = { id: finding.id, kind: finding.kind, at: clock.now() }
  switch (finding.kind) {
    case 'missing-heartbeat':
      return { ...base, response: 'suspend', reason: 'stalled run parks for checkpointed resume' }
    case 'no-progress':
      return { ...base, response: 'suspend', reason: 'no measurable progress within bound' }
    case 'repeated-calls':
      return { ...base, response: 'retry', reason: 'single retry after forced replan' }
    case 'budget-near':
    case 'context-near':
      return { ...base, response: 'alert', reason: finding.detail }
  }
}

export class AuditLog {
  private readonly decisions: SupervisorDecision[] = []

  record(decision: SupervisorDecision): void {
    this.decisions.push(decision)
  }

  list(): SupervisorDecision[] {
    return [...this.decisions]
  }
}
