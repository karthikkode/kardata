// Session-run workflow: the agents turn loop as durable state. B2.2.
// Run states mirror agents/loop.ts exactly (IDLE/RUNNING/PAUSED/CANCELLING/
// FINISHED/ERROR) and every transition is checked with isLegalTransition.
// (State lives in a holder object because TypeScript narrows a `let` union
// to its initializer inside signal-handler closures.)
// Signals: send, steer, pause, resume, cancel. Queries: state.
// History is the event log: every turn persists via appendEventActivity, so
// the full run replays from events alone. The loop ends on cancel, error,
// or idle timeout (a RUNNING run with an empty inbox past idleTimeoutMs
// finishes itself so abandoned runs never persist).
import {
  ActivityFailure,
  CancelledFailure,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  log,
  patched,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow'
import { isLegalTransition, type RunState } from '@kardata/agents/loop'
import type { FakeStep } from '@kardata/agents'
import { activityOptions } from '../timeouts.js'
import type * as activities from '../activities/turn.js'

export interface SessionRunInput {
  sessionId: string
  /** Test-only scripted fake steps for the Karbot turn. Never set in
   * production: the activity resolves the session model or env provider. */
  fakeSteps?: FakeStep[]
  /** Idle close: a RUNNING run with an empty inbox for this long finishes
   * itself instead of persisting abandoned. Defaults to 24 h. */
  idleTimeoutMs?: number
}

/** Default idle close for abandoned session runs. */
export const DEFAULT_IDLE_TIMEOUT_MS = 24 * 3_600_000

export interface SessionRunState {
  state: RunState
  sessionId: string
  pending: number
}

export const sendSignal = defineSignal<[string]>('runSend')
export const steerSignal = defineSignal<[string]>('runSteer')
export interface SkillSignalArgs {
  prompt: string
  tools: string[]
  text: string
  mode?: 'default' | 'brainstorm'
}
export const skillSignal = defineSignal<[SkillSignalArgs]>('runSkill')
export const pauseSignal = defineSignal('runPause')
export const resumeSignal = defineSignal('runResume')
export const cancelSignal = defineSignal('runCancel')
export const stateQuery = defineQuery<SessionRunState>('runState')

const turn = proxyActivities<typeof activities>(activityOptions('turn'))

// Event keys are scoped by workflow run: the nonce restarts at zero for
// every run, so without the run id a replacement run (started by
// signalWithStart after the previous run finished) would reuse the earlier
// run's keys and its fresh user/reply messages would be swallowed as
// duplicates. The run id is fixed for the life of a run, so retries in
// the same run still share keys while separate runs never collide.
function idempotencyKey(sessionId: string, runId: string, scope: string, nonce: number): string {
  return `${sessionId}:${runId}:${scope}:${nonce}`
}

// Cancelling a scope surfaces two ways: bare CancelledFailure when the scope
// itself is cancelled with nothing in flight, or ActivityFailure with a
// cancelled cause when the scope cancels a running activity. Both mean the
// operator cancelled the turn — never an error.
function isCancellation(error: unknown): boolean {
  if (error instanceof CancelledFailure) return true
  return error instanceof ActivityFailure && error.cause instanceof CancelledFailure
}

export async function sessionRun(input: SessionRunInput): Promise<string> {
  const partition = `session:${input.sessionId}`
  const runTag = workflowInfo().runId
  const box: { state: RunState } = { state: 'IDLE' }
  // Reads go through a call boundary: TypeScript narrows property access
  // across awaits, which would erase reachable states from comparisons.
  const currentState = (): RunState => box.state
  const inbox: Array<{ text: string; skill?: { prompt: string; tools: string[]; mode: 'default' | 'brainstorm' } }> = []
  let nonce = 0
  let cancelRunningTurn: (() => void) | undefined

  const setState = (next: RunState): void => {
    if (!isLegalTransition(box.state, next)) {
      throw new Error(`illegal run transition ${box.state} -> ${next}`)
    }
    box.state = next
  }

  // Workflow-signal log (B5.1): signal name plus queue depth only. Signal
  // payloads are user text and never enter logs.
  setHandler(sendSignal, (text: string) => {
    inbox.push({ text })
    log.info('signal received', { signal: 'runSend', pending: inbox.length })
  })
  setHandler(steerSignal, (text: string) => {
    inbox.push({ text })
    log.info('signal received', { signal: 'runSteer', pending: inbox.length })
  })
  setHandler(skillSignal, (args: SkillSignalArgs) => {
    inbox.push({
      text: args.text,
      skill: { prompt: args.prompt, tools: args.tools, mode: args.mode ?? 'default' },
    })
    log.info('signal received', { signal: 'runSkill', pending: inbox.length })
  })
  setHandler(pauseSignal, () => {
    if (currentState() === 'RUNNING') setState('PAUSED')
    log.info('signal received', { signal: 'runPause', state: currentState() })
  })
  setHandler(resumeSignal, () => {
    if (currentState() === 'PAUSED') setState('RUNNING')
    log.info('signal received', { signal: 'runResume', state: currentState() })
  })
  setHandler(cancelSignal, () => {
    if (currentState() === 'RUNNING' || currentState() === 'PAUSED') {
      setState('CANCELLING')
      cancelRunningTurn?.()
    }
    log.info('signal received', { signal: 'runCancel', state: currentState() })
  })
  setHandler(stateQuery, () => ({ state: box.state, sessionId: input.sessionId, pending: inbox.length }))

  nonce += 1
  await turn.appendEventActivity({
    idempotencyKey: idempotencyKey(input.sessionId, runTag, 'session', 0),
    partition,
    type: 't.session.created',
    payload: { sessionId: input.sessionId, title: input.sessionId },
  })
  setState('RUNNING')

  for (;;) {
    if (currentState() === 'CANCELLING') {
      nonce += 1
      await turn.appendEventActivity({
        idempotencyKey: idempotencyKey(input.sessionId, runTag, 'cancelled', nonce),
        partition,
        type: 't.message.appended',
        payload: { threadKey: input.sessionId, kind: 'text', message: { text: 'run cancelled' } },
      })
      nonce += 1
      await turn.appendEventActivity({
        idempotencyKey: idempotencyKey(input.sessionId, runTag, 'finished', nonce),
        partition,
        type: 't.thread.finished',
        payload: { threadKey: input.sessionId },
      })
      setState('FINISHED')
      return 'cancelled'
    }
    if (currentState() === 'PAUSED') {
      await condition(() => currentState() !== 'PAUSED')
      continue
    }
    const item = inbox.shift()
    if (item === undefined) {
      const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
      const signalled = await condition(() => inbox.length > 0 || currentState() !== 'RUNNING', idleTimeoutMs)
      if (!signalled && currentState() === 'RUNNING' && inbox.length === 0) {
        // Idle close: no turn, steer, or state change for the whole window.
        // The finished event lands so the projector closes the thread.
        nonce += 1
        await turn.appendEventActivity({
          idempotencyKey: idempotencyKey(input.sessionId, runTag, 'idle', nonce),
          partition,
          type: 't.message.appended',
          payload: { threadKey: input.sessionId, kind: 'text', message: { text: 'run closed after idle timeout' } },
        })
        nonce += 1
        await turn.appendEventActivity({
          idempotencyKey: idempotencyKey(input.sessionId, runTag, 'finished', nonce),
          partition,
          type: 't.thread.finished',
          payload: { threadKey: input.sessionId },
        })
        setState('FINISHED')
        return 'idle-timeout'
      }
      continue
    }
    try {
      // Existing session workflows recorded the provider activity before
      // the user-message activity. Keep that order while replaying their
      // history; new turns record the user first. Removing this patch before
      // those workflow histories close would strand live chats.
      const userFirst = patched('session-user-before-turn-v1')
      if (userFirst) {
        nonce += 1
        await turn.appendEventActivity({
          idempotencyKey: idempotencyKey(input.sessionId, runTag, 'user', nonce),
          partition,
          type: 't.message.appended',
          payload: { threadKey: input.sessionId, kind: 'text', message: { text: item.text, role: 'user' } },
        })
      }
      const outcome = await CancellationScope.cancellable(async () => {
        // current() is a method returning the scope: capture the scope (not
        // the accessor) so the cancel signal reaches this exact turn.
        const scope = CancellationScope.current()
        cancelRunningTurn = () => scope.cancel()
        try {
          // Phase 3 Karbot turn: per-session model (Phase 1) resolved in
          // the activity, deltas on ephemeral outbox frames keyed by runKey.
          // runKey reuses the pre-turn nonce: deterministic across replays
          // and unique per turn because the nonce only grows.
          return await turn.karbotTurnActivity({
            sessionId: input.sessionId,
            threadKey: input.sessionId,
            runKey: patched('turn-runkey-v2') ? `karbot:${input.sessionId}:${runTag}:${nonce}` : `karbot:${input.sessionId}:${nonce}`,
            text: item.text,
            fakeSteps: input.fakeSteps,
            // Skill invocations ride the prompt seam with their declared
            // tool grant and mode; plain sends leave all three undefined.
            ...(item.skill === undefined
              ? {}
              : {
                  systemPrepend: [item.skill.prompt],
                  toolAllow: item.skill.tools,
                  ...(item.skill.mode === 'default' ? {} : { mode: item.skill.mode }),
                }),
          })
        } finally {
          cancelRunningTurn = undefined
        }
      })
      // Cancel that lands after the scope resolves still wins: a cancelled
      // run presents nothing more, so the finished turn is discarded rather
      // than appended as an orphan.
      if (currentState() === 'CANCELLING') continue
      if (!userFirst) {
        nonce += 1
        await turn.appendEventActivity({
          idempotencyKey: idempotencyKey(input.sessionId, runTag, 'user', nonce),
          partition,
          type: 't.message.appended',
          payload: { threadKey: input.sessionId, kind: 'text', message: { text: item.text, role: 'user' } },
        })
      }
      // Chronological order: the tools ran during the turn, before the
      // reply was composed, so they read between the user message and
      // the reply instead of trailing at the bottom of the thread.
      for (const toolCall of outcome.toolCalls) {
        nonce += 1
        await turn.appendEventActivity({
          idempotencyKey: idempotencyKey(input.sessionId, runTag, 'tool', nonce),
          partition,
          type: 't.message.appended',
          payload: { threadKey: input.sessionId, kind: 'tool', message: { ...toolCall } },
        })
      }
      nonce += 1
      await turn.appendEventActivity({
        idempotencyKey: idempotencyKey(input.sessionId, runTag, 'reply', nonce),
        partition,
        type: 't.message.appended',
        payload: {
          threadKey: input.sessionId,
          kind: 'text',
          message: {
            text: outcome.reply,
            role: 'agent',
            ...(outcome.reasoning ? { reasoning: outcome.reasoning } : {}),
          },
        },
      })
    } catch (error) {
      if (isCancellation(error)) {
        continue
      }
      nonce += 1
      await turn.appendEventActivity({
        idempotencyKey: idempotencyKey(input.sessionId, runTag, 'error', nonce),
        partition,
        type: 't.message.appended',
        payload: {
          threadKey: input.sessionId,
          kind: 'text',
          message: {
            text: 'I could not complete that reply. Please try again.',
            role: 'agent',
            failed: true,
            cause: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : String(error).slice(0, 500),
          },
        },
      })
      setState('ERROR')
      return 'error'
    }
  }
}
