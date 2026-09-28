// Loop/time-guard activities. B2.6. The guarded stage reuses the scripted
// retrieval window and findings from the B2.5 activity, but records every
// execution as a stage_attempt row carrying the Temporal attempt number, so
// per-run stage-attempt counters live in the event log. The detector runs
// the shared pure decideLoop rule and logs loop findings; ok verdicts stay
// in workflow history only.
import { Context } from '@temporalio/activity'
import type { Finding } from '@kardata/agents'
import { appendEvent, recordHeartbeat, workerPoolFromEnv } from '../../db/index.js'
import { decideLoop, type GuardVisit, type LoopVerdict } from '../guards.js'
import { scriptedFindings, STAGE_MS, workWithHeartbeats } from './research.js'

export interface GuardedStageInput {
  runId: string
  partition: string
  visitIndex: number
  stage: string
  question: string
}

export interface GuardedStageResult {
  findings: Finding[]
  attempt: number
}

export async function runGuardedStageActivity(input: GuardedStageInput): Promise<GuardedStageResult> {
  const context = Context.current()
  const attempt = context.info.attempt
  // Attempt scope is activity-owned per visit: genuine retries replay to one
  // row, while distinct visits always land distinct rows.
  await appendEvent(workerPoolFromEnv(), {
    idempotencyKey: `${input.partition}:attempt:${input.visitIndex}`,
    partition: input.partition,
    type: 't.research.stage_attempt',
    payload: {
      runId: input.runId,
      visitIndex: input.visitIndex,
      stage: input.stage,
      question: input.question,
      attempt,
    },
  })
  // Operation heartbeat for the stall sweeper (B5.3): stage boundaries.
  await recordHeartbeat(workerPoolFromEnv(), input.runId, 'research.stage', true)
  await workWithHeartbeats(context, STAGE_MS, () => ({
    runId: input.runId,
    visitIndex: input.visitIndex,
    at: Date.now(),
  }))
  await recordHeartbeat(workerPoolFromEnv(), input.runId, 'research.stage', false)
  return { findings: scriptedFindings(input.question), attempt }
}

export interface DetectLoopInput {
  runId: string
  partition: string
  visits: GuardVisit[]
  maxFruitlessRevisits: number
}

export async function detectLoopActivity(input: DetectLoopInput): Promise<LoopVerdict> {
  const verdict = decideLoop(input.visits, input.maxFruitlessRevisits)
  if (verdict.verdict === 'loop') {
    await appendEvent(workerPoolFromEnv(), {
      idempotencyKey: `${input.partition}:loop:${input.visits.length}`,
      partition: input.partition,
      type: 't.research.loop_finding',
      payload: { runId: input.runId, kind: verdict.kind, reason: verdict.reason },
    })
  }
  return verdict
}
