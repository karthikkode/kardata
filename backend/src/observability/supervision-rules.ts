// Supervision checks, pure core. Phase 2 consolidation seam for Phase 3
// reconciliation: the loop rule (ex temporal/guards.ts), the stall
// sweeper (ex observability/stalls.ts), and the stall response envelope
// (ex temporal/activities/stalls.ts). No Temporal or DB imports: safe to
// call from reconciliation, tests, and (types only) workflows.
import {
  HeartbeatMonitor,
  decide,
  sweep,
  type RepeatVerdict,
  type SupervisorDecision,
  type SupervisorFinding,
} from '@kardata/agents'
import { SESSION_PREFIX } from '../temporal/runs-types.js'

// Loop rule (B2.6). Shared by Phase 3 reconciliation and fast unit tests.
// Mirrors the agents StageMonitor at stage-transition granularity: a
// revisit (a stage seen before) that adds zero new evidence is fruitless;
// genuine new evidence resets the streak so productive revision never
// trips it.
export interface GuardVisit {
  stage: string
  acted: boolean
  newEvidence: number
}

export type LoopVerdict =
  | { verdict: 'ok' }
  | { verdict: 'loop'; kind: 'repeated-calls' | 'no-progress'; reason: string }

export function decideLoop(visits: GuardVisit[], maxFruitlessRevisits: number): LoopVerdict {
  const seen = new Set<string>()
  let streak = 0
  let last: GuardVisit | undefined
  for (const visit of visits) {
    const revisit = seen.has(visit.stage)
    seen.add(visit.stage)
    if (revisit && visit.newEvidence === 0) {
      streak += 1
    } else {
      streak = 0
    }
    last = visit
  }
  if (streak >= maxFruitlessRevisits && last) {
    const kind = last.acted ? 'repeated-calls' : 'no-progress'
    return {
      verdict: 'loop',
      kind,
      reason: `research loop: ${streak} consecutive revisits without new evidence (last: '${last.stage}', ${kind})`,
    }
  }
  return { verdict: 'ok' }
}

// Stall detection core (B5.3). Pure port driver over the agents
// supervision sweep: heartbeats rows replay into an agents
// HeartbeatMonitor (backfilled, so table ages drive the same thresholds),
// run observations become agents RunStats, and every finding maps through
// the agents `decide` policy. Research stage-loops (B2.6 loop evidence)
// enter as no-progress findings — a loop with zero forward motion — which
// decide suspends for checkpointed resume.
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

interface HeartbeatRow {
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

// Turn-loop rule (P3.4): same tool + same args ≥ N in the sampled window,
// or the same non-empty assistant text twice. Pure over projected
// thread_messages; the args compare is JSON-exact.
export interface TurnToolCall {
  name: string
  args: unknown
}

export function decideTurnLoop(
  toolCalls: TurnToolCall[],
  assistantTexts: string[],
  repeats = 3,
): { loop: boolean; reason?: string } {
  const counts = new Map<string, number>()
  for (const call of toolCalls) {
    const key = `${call.name}:${JSON.stringify(call.args) ?? 'null'}`
    const count = (counts.get(key) ?? 0) + 1
    counts.set(key, count)
    if (count >= repeats) {
      return { loop: true, reason: `tool '${call.name}' with identical args ${count} times in this turn` }
    }
  }
  const seen = new Set<string>()
  for (const text of assistantTexts) {
    if (!text) continue
    if (seen.has(text)) {
      return { loop: true, reason: 'identical assistant text twice in this turn' }
    }
    seen.add(text)
  }
  return { loop: false }
}

// Stall response envelope: one `t.stall.response` per finding — trigger,
// response, reason, and timestamp, so no stall is ever silent.
export const STALL_RESPONSE_EVENT = 't.stall.response'

export function stallResponseEvent(
  sweepId: string,
  finding: SupervisorFinding,
  decision: SupervisorDecision,
): {
  idempotencyKey: string
  partition: string
  type: typeof STALL_RESPONSE_EVENT
  payload: Record<string, unknown>
} {
  const runId = finding.id
  const sessionId = runId.startsWith(SESSION_PREFIX) ? runId.slice(SESSION_PREFIX.length) : undefined
  return {
    idempotencyKey: `stall:${sweepId}:${runId}:${finding.kind}`,
    partition: sessionId ? `session:${sessionId}` : `run:${runId}`,
    type: STALL_RESPONSE_EVENT,
    payload: {
      runId,
      kind: finding.kind,
      detail: finding.detail,
      response: decision.response,
      reason: decision.reason,
      at: decision.at,
    },
  }
}
