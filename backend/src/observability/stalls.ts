// Stall detection core (B5.3). Pure port driver over the agents
// supervision sweep: heartbeats rows replay into an agents
// HeartbeatMonitor (backfilled, so table ages drive the same thresholds),
// run observations become agents RunStats, and every finding maps through
// the agents `decide` policy. Research stage-loops (B2.6 loop evidence)
// enter as no-progress findings — a loop with zero forward motion — which
// decide suspends for checkpointed resume.
import {
  HeartbeatMonitor,
  decide,
  sweep,
  type RepeatVerdict,
  type SupervisorDecision,
  type SupervisorFinding,
} from '@kardata/agents'

export interface StallThresholds {
  idleStaleMs: number
  inToolStaleMs: number
  nearRatio: number
}

/** Starting values: comfortably above the activity heartbeat timeouts
 * (5–30 s per lane) so healthy ops never trip the sweep. Tuned in B5.6. */
export const DEFAULT_STALL_THRESHOLDS: StallThresholds = {
  idleStaleMs: 60_000,
  inToolStaleMs: 120_000,
  nearRatio: 0.8,
}

export interface RunObservation {
  id: string
  busy: boolean
  budgetUsedRatio: number
  contextUsedRatio: number
  maxStalledTurns: number
  lastRepeatVerdict?: RepeatVerdict
  messageCount: number
  prevMessageCount: number
  prevStalledTurns: number
}

export interface HeartbeatRow {
  runId: string
  atMs: number
  busy: boolean
}

export interface LoopEvidence {
  runId: string
  reason: string
}

export interface StallSweepInput {
  sweepId: string
  now: number
  runs: RunObservation[]
  beats: HeartbeatRow[]
  loops: LoopEvidence[]
  thresholds?: Partial<StallThresholds>
}

export interface StallOutcome {
  finding: SupervisorFinding
  decision: SupervisorDecision
}

/** Consecutive turns without a new message. A brand-new run with no
 * messages yet counts zero, not one — silence before the first turn is
 * startup, not a stall. */
export function stalledTurnsFor(observation: Pick<RunObservation, 'messageCount' | 'prevMessageCount' | 'prevStalledTurns'>): number {
  if (observation.messageCount > observation.prevMessageCount) return 0
  if (observation.messageCount === 0 && observation.prevStalledTurns === 0) return 0
  return observation.prevStalledTurns + 1
}

export function sweepStalls(input: StallSweepInput): StallOutcome[] {
  const thresholds: StallThresholds = { ...DEFAULT_STALL_THRESHOLDS, ...input.thresholds }
  const clock = { now: () => input.now }
  const monitor = new HeartbeatMonitor(clock)
  for (const beat of input.beats) {
    monitor.beatAt(beat.runId, beat.atMs, beat.busy)
  }
  const stats = input.runs.map((run) => ({
    id: run.id,
    busy: run.busy,
    stalledTurns: stalledTurnsFor(run),
    maxStalledTurns: run.maxStalledTurns,
    ...(run.lastRepeatVerdict !== undefined ? { lastRepeatVerdict: run.lastRepeatVerdict } : {}),
    budgetUsedRatio: run.budgetUsedRatio,
    contextUsedRatio: run.contextUsedRatio,
  }))
  const findings = sweep(monitor, stats, thresholds)
  // Stage-loops are no-progress with the loop reason attached; decide
  // suspends them like every other stall.
  for (const loop of input.loops) {
    findings.push({ id: loop.runId, kind: 'no-progress', detail: `stage loop: ${loop.reason}` })
  }
  return findings.map((finding) => ({ finding, decision: decide(finding, clock) }))
}
