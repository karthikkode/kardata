// Retired scripted turn scaffolding (B2.2 history): runTurnActivity and
// runChildTurnActivity simulate tool work so cancel-during-tool stays
// exercisable. Never called from a workflow; real turns run through
// karbotTurnActivity. Kept exported for history only.
import { Context } from '@temporalio/activity'
import { recordHeartbeat, workerPoolFromEnv } from '../../db/index.js'
import { sleep, type TurnOutcome } from './turn.js'

export interface TurnInput {
  sessionId: string
  text: string
}

// Scripted tool window: every turn spends TOOL_MS simulating tool work so
// cancel-during-tool is exercisable. B4.1 replaces this with real turns.
const TOOL_MS = 3_000

export interface ChildTurnInput {
  childId: string
  text: string
}

// Scripted child turn: shorter than a parent turn (CHILD_TOOL_MS) and with a
// distinct reply prefix so tests can prove child intermediates never land in
// the parent partition. B4.1 replaces this with real turns like its parent.
const CHILD_TOOL_MS = 1_000

// Retired scripted scaffolding: no workflow calls this (child turns run
// through karbotTurnActivity). Kept exported for history only.
/** @deprecated Never called from workflows; use karbotTurnActivity. */
export async function runChildTurnActivity(input: ChildTurnInput): Promise<TurnOutcome> {
  const context = Context.current()
  const deadline = Date.now() + CHILD_TOOL_MS
  while (Date.now() < deadline) {
    context.heartbeat({ childId: input.childId, at: Date.now() })
    await Promise.race([sleep(100), context.cancelled])
  }
  return {
    reply: `child-echo: ${input.text}`,
    toolCalls: [{ name: 'domain.scan', detail: 'scripted child scan', state: 'done' }],
  }
}

/** Answer the conversation first; tools provide evidence only when needed. */

// Retired scripted scaffolding: no workflow calls this (session turns run
// through karbotTurnActivity). Kept exported for history only.
/** @deprecated Never called from workflows; use karbotTurnActivity. */
export async function runTurnActivity(input: TurnInput): Promise<TurnOutcome> {
  const context = Context.current()
  const pool = workerPoolFromEnv()
  const runId = `session-run-${input.sessionId}`
  const deadline = Date.now() + TOOL_MS
  let beats = 0
  while (Date.now() < deadline) {
    context.heartbeat({ sessionId: input.sessionId, at: Date.now() })
    // Operation heartbeat for the stall sweeper (B5.3): the store helper
    // throttles to one write per 5 s, so the 100 ms Temporal cadence costs
    // nothing extra.
    beats += 1
    if (beats % 50 === 1) {
      await recordHeartbeat(pool, runId, 'turn', true)
    }
    // Cancellation surfaces here as a rejected promise: let it propagate so
    // the workflow sees CancelledFailure instead of an orphaned tool.
    await Promise.race([sleep(100), context.cancelled])
  }
  return {
    reply: `echo: ${input.text}`,
    toolCalls: [{ name: 'domain.scan', detail: 'scripted scan', state: 'done' }],
  }
}
