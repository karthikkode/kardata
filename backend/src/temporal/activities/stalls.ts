// Stall sweep activity (B5.3). Reads the heartbeat table, runs the pure
// sweeper core, and records one `t.stall.response` per finding — trigger,
// response, reason, and timestamp, so no stall is ever silent. The future
// sweeper schedule calls this with per-run cursors (message counts) and
// loop evidence; until the fleet lands, tests drive it directly.
import { Context } from '@temporalio/activity'
import type { SupervisorDecision, SupervisorFinding } from '@kardata/agents'
import { appendEvent } from '../../db/index.js'
import { listHeartbeats } from '../../db/index.js'
import {
  sweepStalls,
  type LoopEvidence,
  type RunObservation,
  type StallThresholds,
} from '../../observability/stalls.js'
import { SESSION_PREFIX } from '../gateway.js'
import { workerPoolFromEnv } from '../../db/index.js'

export const STALL_RESPONSE_EVENT = 't.stall.response'

export interface StallSweepInput {
  sweepId: string
  runs: RunObservation[]
  loops?: LoopEvidence[]
  thresholds?: Partial<StallThresholds>
}

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

export async function stallSweepActivity(input: StallSweepInput): Promise<SupervisorDecision[]> {
  const context = Context.current()
  const pool = workerPoolFromEnv()
  const beats = await listHeartbeats(pool)
  const outcomes = sweepStalls({
    sweepId: input.sweepId,
    now: Date.now(),
    runs: input.runs,
    beats,
    loops: input.loops ?? [],
    thresholds: input.thresholds,
  })
  for (const outcome of outcomes) {
    await appendEvent(pool, stallResponseEvent(input.sweepId, outcome.finding, outcome.decision))
  }
  context.log.info('stall.sweep', {
    sweepId: input.sweepId,
    runs: input.runs.length,
    findings: outcomes.length,
  })
  return outcomes.map((outcome) => outcome.decision)
}
