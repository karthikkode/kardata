// Deep-research stage activity. B2.5. One pipeline stage (a single briefed
// question) runs here in Node, where the full agents library is available:
// findings are captured with agents captureFinding (content hashes included)
// and each execution appends a stage_started marker, so the workflow test can
// prove pause/resume never re-executes a completed stage by counting markers.
//
// Scripted scaffolding: questions starting with 'refuse:' return zero
// findings so the refusal branch is exercisable without provider keys. B4.1
// replaces the script with the provider gateway behind the same proxy name.
import { Context } from '@temporalio/activity'
import { captureFinding, type Finding } from '@kardata/agents'
import { appendEvent, recordHeartbeat, workerPoolFromEnv } from '../../db/index.js'

export interface ResearchStageInput {
  runId: string
  partition: string
  stageIndex: number
  question: string
}

export interface ResearchStageResult {
  findings: Finding[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A stage spends STAGE_MS on scripted retrieval so pause-during-stage is
// exercisable: pause takes effect at the next stage boundary, never by
// killing the in-flight stage.
export const STAGE_MS = 1_200

export interface HeartbeatSink {
  heartbeat(details?: unknown): void
  cancelled: Promise<unknown>
}

/** Bounded scripted retrieval window shared by the plain and guarded stage
 * activities. Cancellation propagates so budget timeouts never orphan work. */
export async function workWithHeartbeats(
  sink: HeartbeatSink,
  workMs: number,
  beat: () => unknown,
): Promise<void> {
  const deadline = Date.now() + workMs
  while (Date.now() < deadline) {
    sink.heartbeat(beat())
    await Promise.race([sleep(100), sink.cancelled])
  }
}

/** Scripted findings shared by the plain and guarded stage activities:
 * `refuse:` questions yield nothing (refusal fixture); anything else yields
 * one hashed finding. Identity derives from the question content (never the
 * stage index), so revisiting a stage yields byte-identical findings and the
 * loop guard sees zero new evidence. B4.1 replaces this with retrieval. */
export function scriptedFindings(question: string): Finding[] {
  if (question.startsWith('refuse:')) return []
  return [
    captureFinding({
      claim: question,
      docId: question,
      url: `https://example.invalid/docs/${encodeURIComponent(question)}`,
      excerpt: `Evidence for: ${question}`,
    }),
  ]
}

export async function runResearchStageActivity(input: ResearchStageInput): Promise<ResearchStageResult> {
  const context = Context.current()
  const pool = workerPoolFromEnv()
  // Marker scope `started:<index>` is activity-owned: workflow-side keys use
  // `run-*` scopes so a retry replay can never collide with run bookkeeping.
  await appendEvent(pool, {
    idempotencyKey: `${input.partition}:started:${input.stageIndex}`,
    partition: input.partition,
    type: 't.research.stage_started',
    payload: { runId: input.runId, stageIndex: input.stageIndex, question: input.question },
  })
  // Operation heartbeat for the stall sweeper (B5.3): stage boundaries beat
  // at operation granularity, never at the 100 ms Temporal cadence.
  await recordHeartbeat(pool, input.runId, 'research.stage', true)
  await workWithHeartbeats(context, STAGE_MS, () => ({
    runId: input.runId,
    stageIndex: input.stageIndex,
    at: Date.now(),
  }))
  await recordHeartbeat(pool, input.runId, 'research.stage', false)
  return { findings: scriptedFindings(input.question) }
}
