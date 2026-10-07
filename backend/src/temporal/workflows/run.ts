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
  continueAsNew,
  defineQuery,
  defineSignal,
  log,
  patched,
  proxyActivities,
  setHandler,
  uuid4,
  workflowInfo,
} from '@temporalio/workflow'
import { isLegalTransition, type RunState } from '@kardata/agents/loop'
import type { FakeStep } from '@kardata/agents'
import { activityOptions } from '../timeouts.js'
import type * as activities from '../activities/turn.js'
import { shouldContinueAsNew } from './can.js'
import { resumableTurn } from './resumable-turn.js'
import { registerQueueHandlers } from './inbox-queue.js'
import type { OriginalTurnRecovery } from '../turn-recovery.js'
import type { SendSignalPayload } from '../runs-types.js'

export interface SessionRunInput {
  sessionId: string
  /** Private server-prepared ownership proof, never a product request field. */
  ownerEpoch?: string
  recovery?: OriginalTurnRecovery
  /** Test-only scripted fake steps for the Karbot turn. Never set in
   * production: the activity resolves the session model or env provider. */
  fakeSteps?: FakeStep[]
  /** Idle close: a RUNNING run with an empty inbox for this long finishes
   * itself instead of persisting abandoned. Defaults to 24 h. */
  idleTimeoutMs?: number
  /** History caps that trip continue-as-new (defaults 10k events / 10 MB).
   * Tests set small values; production leaves both undefined. */
  historyEventLimit?: number
  historyByteLimit?: number
  /** Carry-over from the previous run in a continue-as-new chain. Set by
   * the workflow itself, never by callers. */
  resumed?: SessionRunResumed
}

export interface SessionRunInboxItem {
  text: string
  recovery?: OriginalTurnRecovery
  skill?: { prompt: string; tools: string[]; mode: 'default' | 'brainstorm' }
  traceparent?: string
  id?: string
  queuedAt?: number
}

export interface SessionRunResumed {
  inbox: SessionRunInboxItem[]
  state: 'RUNNING' | 'PAUSED'
  nonce: number
}

/** Default idle close for abandoned session runs. */
export const DEFAULT_IDLE_TIMEOUT_MS = 24 * 3_600_000

export interface SessionRunState {
  state: RunState
  sessionId: string
  pending: number
}

export const sendSignal = defineSignal<[string | SendSignalPayload]>('runSend')
export const steerSignal = defineSignal<[string | SendSignalPayload]>('runSteer')
export interface SkillSignalArgs {
  prompt: string
  tools: string[]
  text: string
  mode?: 'default' | 'brainstorm'
  traceparent?: string
}
export const skillSignal = defineSignal<[SkillSignalArgs]>('runSkill')
export const pauseSignal = defineSignal('runPause')
export const resumeSignal = defineSignal('runResume')
export const cancelSignal = defineSignal('runCancel')
export const stopTurnSignal = defineSignal('runStopTurn')
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
  // Inbox ids gate once here: handlers close over the flag so old
  // histories keep pushing id-less entries while new runs stamp every
  // item for the queue view.
  const inboxIds = patched('inbox-ids-v1')
  function stamp<T extends { text: string }>(item: T): T & { id?: string; queuedAt?: number } {
    return inboxIds ? { ...item, id: uuid4(), queuedAt: Date.now() } : item
  }
  // Continued runs reuse the carried inbox and nonce; fresh runs seed
  // from the recovery proof exactly like before the can-v1 patch.
  function initialInbox(): SessionRunInboxItem[] {
    return input.resumed?.inbox ?? (input.recovery ? [stamp({ text: input.recovery.text,recovery: input.recovery })] : [])
  }
  function initialNonce(): number {
    return input.resumed?.nonce ?? 0
  }
  const inbox: SessionRunInboxItem[] = initialInbox()
  let nonce = initialNonce()
  let cancelRunningTurn: (() => void) | undefined
  // First-WFT state signals dispatch after registration but before
  // enterInitialState runs, while the box is still IDLE: their RUNNING /
  // PAUSED guards would drop them (observed: a pre-entry pause logged
  // state IDLE and the run proceeded). Record the intent and apply it at
  // entry; old histories keep the drop via the patch gate.
  const preEntryState = patched('session-preentry-state-v1')
  let preEntry: 'PAUSED' | 'CANCELLING' | 'RUNNING' | undefined

  const setState = (next: RunState): void => {
    if (!isLegalTransition(box.state, next)) {
      throw new Error(`illegal run transition ${box.state} -> ${next}`)
    }
    box.state = next
  }

  // Workflow-signal log (B5.1): signal name plus queue depth only. Signal
  // payloads are user text and never enter logs.
  // Bare-string payloads are old signals replaying through new code (and
  // supervision nudges): same text, no per-turn trace.
  const queueText = (payload: string | SendSignalPayload): void => {
    inbox.push(stamp(typeof payload === 'string' ? { text: payload } : { text: payload.text, ...(payload.traceparent === undefined ? {} : { traceparent: payload.traceparent }) }))
  }
  setHandler(sendSignal, (payload: string | SendSignalPayload) => {
    queueText(payload)
    log.info('signal received', { signal: 'runSend', pending: inbox.length })
  })
  setHandler(steerSignal, (payload: string | SendSignalPayload) => {
    queueText(payload)
    log.info('signal received', { signal: 'runSteer', pending: inbox.length })
  })
  setHandler(skillSignal, (args: SkillSignalArgs) => {
    inbox.push(stamp({
      text: args.text,
      skill: { prompt: args.prompt, tools: args.tools, mode: args.mode ?? 'default' },
      ...(args.traceparent === undefined ? {} : { traceparent: args.traceparent }),
    }))
    log.info('signal received', { signal: 'runSkill', pending: inbox.length })
  })
  registerQueueHandlers(inbox)
  setHandler(pauseSignal, () => {
    if (currentState() === 'RUNNING') setState('PAUSED')
    else if (preEntryState && currentState() === 'IDLE' && preEntry !== 'CANCELLING') preEntry = 'PAUSED'
    log.info('signal received', { signal: 'runPause', state: currentState() })
  })
  setHandler(resumeSignal, () => {
    if (currentState() === 'PAUSED') setState('RUNNING')
    else if (preEntryState && currentState() === 'IDLE' && preEntry !== 'CANCELLING') preEntry = 'RUNNING'
    log.info('signal received', { signal: 'runResume', state: currentState() })
  })
  setHandler(cancelSignal, () => {
    if (currentState() === 'RUNNING' || currentState() === 'PAUSED') {
      setState('CANCELLING')
      cancelRunningTurn?.()
    } else if (preEntryState && currentState() === 'IDLE') {
      // Terminal intent wins over any earlier pre-entry pause or resume;
      // no turn runs before entry so there is nothing to cancel yet.
      preEntry = 'CANCELLING'
    }
    log.info('signal received', { signal: 'runCancel', state: currentState() })
  })
  setHandler(stopTurnSignal, () => {
    // Loop stop: cancel the in-flight turn only. The run stays alive: the
    // turn catch discards the partial outcome and the loop continues, and
    // the cancelled activity releases its lease in its own finally.
    cancelRunningTurn?.()
    log.info('signal received', { signal: 'runStopTurn', state: currentState() })
  })
  setHandler(stateQuery, () => ({ state: box.state, sessionId: input.sessionId, pending: inbox.length }))

  // Continued runs skip session.created (the first run recorded it; a
  // second row would double it) and re-enter PAUSED when the chain
  // continued mid-pause, so the pause gate holds across runs.
  async function enterInitialState(): Promise<void> {
    if (!input.resumed) {
      nonce += 1
      await turn.appendEventActivity({
        idempotencyKey: idempotencyKey(input.sessionId, runTag, 'session', 0),
        partition,
        type: 't.session.created',
        payload: { sessionId: input.sessionId, title: input.sessionId },
      })
    }
    setState('RUNNING')
    if (input.resumed?.state === 'PAUSED') setState('PAUSED')
    // Pre-entry intent is fresher than carried state: a first-WFT pause
    // or cancel holds, and a first-WFT resume releases a carried pause.
    // Every apply is source-guarded (no self-transitions exist).
    if (preEntry === 'CANCELLING' && (currentState() === 'RUNNING' || currentState() === 'PAUSED')) setState('CANCELLING')
    else if (preEntry === 'PAUSED' && currentState() === 'RUNNING') setState('PAUSED')
    else if (preEntry === 'RUNNING' && currentState() === 'PAUSED') setState('RUNNING')
  }
  await enterInitialState()

  // A turn killed while the run survives (runStopTurn: loop guard,
  // supervision) must still answer: without a receipt the UI waits for a
  // reply that never arrives and the thinking indicator sticks forever. A
  // run-level cancel (CANCELLING) owns its own receipt ('run cancelled' +
  // finished) at the loop top, so it skips this.
  async function appendTurnStoppedReceipt(): Promise<void> {
    if (currentState() === 'CANCELLING' || !patched('turn-cancel-receipt-v1')) return
    nonce += 1
    await turn.appendEventActivity({
      idempotencyKey: idempotencyKey(input.sessionId, runTag, 'turn-stopped', nonce),
      partition,
      type: 't.message.appended',
      payload: {
        threadKey: input.sessionId,
        kind: 'text',
        message: {
          text: 'That reply was stopped before it finished. Tell me how to proceed and I will continue.',
          role: 'agent',
          stopped: true,
        },
      },
    })
  }

  function buildContinuation(): SessionRunInput | undefined {
    const info = workflowInfo()
    if (!patched('can-v1')) return undefined
    if (!shouldContinueAsNew(info.historyLength, info.historySize, info.continueAsNewSuggested, input.historyEventLimit, input.historyByteLimit)) {
      return undefined
    }
    return {
      sessionId: input.sessionId,
      ...(input.ownerEpoch === undefined ? {} : { ownerEpoch: input.ownerEpoch }),
      ...(input.fakeSteps === undefined ? {} : { fakeSteps: input.fakeSteps }),
      ...(input.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: input.idleTimeoutMs }),
      ...(input.historyEventLimit === undefined ? {} : { historyEventLimit: input.historyEventLimit }),
      ...(input.historyByteLimit === undefined ? {} : { historyByteLimit: input.historyByteLimit }),
      resumed: { inbox, state: currentState() === 'PAUSED' ? 'PAUSED' : 'RUNNING', nonce },
    }
  }

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
    // Continue-as-new between turns: the inbox, pause state, and nonce
    // carry into a fresh run. Idempotency keys and runKeys embed the run
    // id, so nothing collides; old histories skip via the patch gate.
    const continued = buildContinuation()
    if (continued !== undefined) {
      await continueAsNew<typeof sessionRun>(continued)
      // Unreachable: the new run owns the inbox now.
      return 'continued'
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
      if (userFirst && !item.recovery) {
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
          const runKey = item.recovery?.runKey ?? (patched('turn-runkey-v2') ? `karbot:${input.sessionId}:${runTag}:${nonce}` : `karbot:${input.sessionId}:${nonce}`)
          return await resumableTurn(() => turn.karbotTurnActivity({
            sessionId: input.sessionId,
            threadKey: input.sessionId,
            runKey,
            text: item.text,
            ...(item.traceparent === undefined ? {} : { traceparent: item.traceparent }),
            fakeSteps: input.fakeSteps,
            ...(item.recovery ? { recovery: item.recovery } : {}),
            ...(input.ownerEpoch ? { ownerEpoch: input.ownerEpoch,ownerFirstExecutionId: workflowInfo().firstExecutionRunId,ownerContinuedFromExecutionId: workflowInfo().continuedFromExecutionRunId } : {}),
            // Skill invocations ride the prompt seam with their declared
            // tool grant and mode; plain sends leave all three undefined.
            ...(item.skill === undefined
              ? {}
              : {
                  systemPrepend: [item.skill.prompt],
                  toolAllow: item.skill.tools,
                  ...(item.skill.mode === 'default' ? {} : { mode: item.skill.mode }),
                }),
          }), async (reason, kind) => {
            if (currentState() === 'RUNNING') setState('PAUSED')
            nonce += 1
            await turn.appendEventActivity({ idempotencyKey: idempotencyKey(input.sessionId, runTag, 'context-paused', nonce), partition, type: 't.thread.state', payload: { threadKey: input.sessionId, status: 'PAUSED', acceptingSteer: false } })
            nonce += 1
            await turn.appendEventActivity({ idempotencyKey: idempotencyKey(input.sessionId, runTag, 'context-error', nonce), partition, type: 't.message.appended', payload: { threadKey: input.sessionId, kind: 'tool', message: { id: `context-${nonce}`, name: kind === 'operation' ? 'operation.recovery' : 'context.compaction', state: 'failed', detail: reason } } })
          }, async () => {
            await condition(() => currentState() !== 'PAUSED')
            if (currentState() === 'CANCELLING') throw new CancelledFailure('Cancelled while context was paused')
            nonce += 1
            await turn.appendEventActivity({ idempotencyKey: idempotencyKey(input.sessionId, runTag, 'context-resumed', nonce), partition, type: 't.thread.state', payload: { threadKey: input.sessionId, status: 'RUNNING', acceptingSteer: true } })
          })
        } finally {
          cancelRunningTurn = undefined
        }
      })
      // Cancel that lands after the scope resolves still wins: a cancelled
      // run presents nothing more, so the finished turn is discarded rather
      // than appended as an orphan.
      if (currentState() === 'CANCELLING') continue
      // Missed-steer redelivery (F13 rework): steers that landed too late
      // for this turn's rounds were receipted as missed; queue their texts
      // as one follow-up turn instead of holding turns open. The push
      // reads the recorded activity result, so replays decide
      // identically; pause/cancel gates treat it like any queued item.
      const redeliver = outcome.missedSteering ?? []
      if (redeliver.length > 0) {
        inbox.push(stamp({ text: redeliver.map((row) => row.text).join('\n\n') }))
        log.info('signal received', { signal: 'runSteer-redeliver', pending: inbox.length })
      }
      if (!userFirst && !item.recovery) {
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
        await appendTurnStoppedReceipt()
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
