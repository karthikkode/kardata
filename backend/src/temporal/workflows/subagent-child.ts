// Subagent child workflow: one child run per delegated goal. Split from
// subagents.ts (the delegate parent); the parent signals this workflow's
// childMessage/childRedirect/childCancel/childFinish signals and reads the
// childState/childSummary/canDelegate queries. State lives in workflow
// variables (never in an activity), so a crashed worker resumes the exact
// inbox, goal, and status from history.
//
// Child-turn contract (documentation/frontend-thread-contract.md): child
// turn replies land in the child's own partition under the agent:<child-id>
// thread key. Sends to a finished child never relaunch: the parent appends
// t.subagent.missed_steer against the closed child id.
//
// Determinism notes: ids, goals, depth, and mode arrive in signal/input
// payloads; the only imports are the workflow SDK, the timeout table, and
// type-only agents shapes (erased at bundle time). No clocks, no random ids.
import {
  ActivityFailure,
  CancelledFailure,
  CancellationScope,
  ContinueAsNew,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  getExternalWorkflowHandle,
  log,
  patched,
  proxyActivities,
  setHandler,
  uuid4,
  workflowInfo,
} from '@temporalio/workflow'
import { shouldContinueAsNew } from './can.js'
import { registerQueueHandlers } from './inbox-queue.js'
import { resumableTurn } from './resumable-turn.js'
import type { OriginalTurnRecovery } from '../turn-recovery.js'
import type {
  ChildSnapshot,
  ChildStatus,
  ChildSummary,
  ContextMode,
  FakeStep,
} from '@kardata/agents'
import { activityOptions } from '../timeouts.js'
import type * as activities from '../activities/turn.js'

const childActivities = proxyActivities<typeof activities>(activityOptions('turn'))

export interface DelegateRequest {
  recovery?: OriginalTurnRecovery
  childId: string
  goal: string
  /** Owner-given display name; recorded on the launch event. */
  name?: string
  depth: number
  mode: ContextMode
  maxDepth: number
  queueCapacity: number
  /** Test-only scripted fake steps for the Karbot turn. Never set in
   * production. Forwarded verbatim into the child input. */
  fakeSteps?: FakeStep[]
  /** Finish close for a cancelled child (see SubagentChildInput).
   * Forwarded verbatim into the child input. */
  childFinishTimeoutMs?: number
  /** History caps that trip the child's continue-as-new (defaults 10k
   * events / 10 MB). Forwarded verbatim into the child input. */
  historyEventLimit?: number
  historyByteLimit?: number
}

export interface SubagentChildInput extends DelegateRequest {
  ownerEpoch?: string
  parentSessionId: string
  parentPartition: string
  /** Finish close: a cancelled child with no finish signal for this long
   * completes itself (status cancelled) instead of waiting forever.
   * Defaults to 1 h. */
  childFinishTimeoutMs?: number
  /** Carry-over from the previous run in a continue-as-new chain. Set by
   * the workflow itself, never by callers. */
  resumed?: SubagentRunResumed
}

export type SubagentInboxItem = string | { id: string; text: string; queuedAt: number }

export interface SubagentRunResumed {
  inbox: SubagentInboxItem[]
  missedSteer: string[]
  goal: string
  threadLength: number
  nonce: number
  acceptingSteer: boolean
  paused: boolean
  contextPaused: boolean
}

/** Default finish close for cancelled children. */
export const DEFAULT_CHILD_FINISH_TIMEOUT_MS = 3_600_000

export interface SteerRequest {
  childId: string
  text: string
}

export interface RedirectRequest extends SteerRequest {
  newGoal: string
}


export interface NoteDoneRequest {
  childId: string
  status: ChildStatus
}

export const childMessageSignal = defineSignal<[string]>('childMessage')
export const childRedirectSignal = defineSignal<[string]>('childRedirect')
export const childCancelSignal = defineSignal('childCancel')
export const childFinishSignal = defineSignal('childFinish')
export const childStateQuery = defineQuery<ChildSnapshot>('childState')
export const childSummaryQuery = defineQuery<ChildSummary>('childSummary')
export const childCanDelegateQuery = defineQuery<boolean>('childCanDelegate')

// Liveness protocol: whoever observes a child close must signal noteDone.
// The parent tracks running children in memory only, so a close without
// noteDone leaves a stale 'running' entry and later relaunches of that id
// reject as duplicates instead of starting.
export const parentNoteDoneSignal = defineSignal<[NoteDoneRequest]>('parentNoteDone')

function idempotencyKey(partition: string, scope: string, nonce: number): string {
  return `${partition}:${scope}:${nonce}`
}

// Cancelling a scope surfaces two ways: bare CancelledFailure when the scope
// itself is cancelled with nothing in flight, or ActivityFailure with a
// cancelled cause when the scope cancels a running activity. Same rule as
// the session-run workflow: both mean operator cancel, never error.
function isCancellation(error: unknown): boolean {
  if (error instanceof CancelledFailure) return true
  return error instanceof ActivityFailure && error.cause instanceof CancelledFailure
}

export async function subagentRun(input: SubagentChildInput): Promise<string> {
  const childPartition = `child:${input.childId}`
  const threadKey = `agent:${input.childId}`
  const carried = input.resumed
  const box: { status: ChildStatus } = { status: 'running' }
  const goalBox: { goal: string } = { goal: carried?.goal ?? input.goal }
  // Inbox ids gate once here (same contract as sessionRun): handlers
  // close over the flag so old histories keep plain strings.
  const inboxIds = patched('inbox-ids-v1')
  function stamp(text: string): string | { id: string; text: string; queuedAt: number } {
    return inboxIds ? { id: uuid4(), text, queuedAt: Date.now() } : text
  }
  const inbox: SubagentInboxItem[] = carried?.inbox ?? (input.recovery ? [stamp(input.recovery.text)] : [])
  // A continued run never re-arms recovery: the proof resolved in the
  // previous run, and carried inbox items resume by their own runKeys.
  let recovering = carried ? undefined : input.recovery
  const missedSteer: string[] = carried?.missedSteer ?? []
  const currentStatus = (): ChildStatus => box.status
  let nonce = carried?.nonce ?? 0
  let threadLength = carried?.threadLength ?? 0
  let acceptingSteer = carried?.acceptingSteer ?? true
  let contextPaused = carried?.contextPaused ?? false
  let paused = carried?.paused ?? false
  const eventKey = patched('child-event-run-v2') ? `${childPartition}:${workflowInfo().runId}` : childPartition
  let finishRequested = false
  let cancelRunningTurn: (() => void) | undefined

  const summary = (): ChildSummary => ({
    id: input.childId,
    goal: goalBox.goal,
    status: box.status,
    depth: input.depth,
    mode: input.mode,
    threadLength,
    missedSteer: [...missedSteer],
  })

  setHandler(childMessageSignal, (text: string) => {
    // Mirror agents/subagents.ts: only a running, accepting child queues;
    // everything else lands as missed steer, never a relaunch.
    if (currentStatus() === 'running' && acceptingSteer && inbox.length < input.queueCapacity) {
      inbox.push(stamp(text))
    } else {
      missedSteer.push(text)
    }
    log.info('signal received', { signal: 'childMessage', pending: inbox.length })
  })
  setHandler(defineSignal('childPause'), () => {
    if (currentStatus() === 'running') paused = true
    log.info('signal received', { signal: 'childPause', status: currentStatus() })
  })
  setHandler(defineSignal('childResume'), () => {
    contextPaused = false
    paused = false
    acceptingSteer = currentStatus() === 'running'
    log.info('signal received', { signal: 'childResume', status: currentStatus() })
  })
  setHandler(childRedirectSignal, (newGoal: string) => {
    // Mirror redirect: empty goals reject with the goal untouched.
    if (!newGoal.trim()) return
    goalBox.goal = newGoal
    if (currentStatus() === 'running' && acceptingSteer) {
      inbox.push(stamp(`Course correction. New goal: ${newGoal}`))
    } else {
      missedSteer.push(`Course correction. New goal: ${newGoal}`)
    }
    log.info('signal received', { signal: 'childRedirect' })
  })
  setHandler(childCancelSignal, () => {
    if (currentStatus() === 'running') {
      box.status = 'cancelled'
      cancelRunningTurn?.()
    }
    log.info('signal received', { signal: 'childCancel', status: currentStatus() })
  })
  setHandler(childFinishSignal, () => {
    finishRequested = true
    log.info('signal received', { signal: 'childFinish' })
  })
  setHandler(childStateQuery, () => ({
    id: input.childId,
    goal: goalBox.goal,
    status: box.status,
    acceptingSteer: acceptingSteer && box.status === 'running',
    queueDepth: inbox.length,
    // Durable children have no wall clock: uptime across replays and worker
    // restarts is meaningless, so elapsed stays an explicit sentinel.
    elapsedMs: -1,
    lastTool: threadLength > 0 ? 'domain.scan' : undefined,
  }))
  setHandler(childSummaryQuery, () => summary())
  registerQueueHandlers(inbox)
  // Fork children continue the parent conversation and must not delegate;
  // deeper nesting stops at the launch cap. Mirrors canDelegate.
  setHandler(childCanDelegateQuery, () => input.mode !== 'fork' && input.depth + 1 <= input.maxDepth)

  const appendCompletion = async (): Promise<void> => {
    nonce += 1
    await childActivities.appendEventActivity({
      idempotencyKey: idempotencyKey(patched('child-event-run-v2') ? eventKey : input.parentPartition, `completed-${input.childId}`, nonce),
      partition: input.parentPartition,
      type: 't.subagent.completed',
      payload: { summary: summary() },
    })
  }

  // Liveness: the closing child signals noteDone so the parent frees the
  // slot and promotes the queue. Best-effort, always after the completion
  // entry lands; pre-fix histories replay without the signal.
  const noteDoneProtocol = patched('child-notedone-v1')
  const noteParentDone = async (status: ChildStatus): Promise<void> => {
    const parentWorkflowId = noteDoneProtocol ? workflowInfo().parent?.workflowId : undefined
    if (!parentWorkflowId) return
    try {
      await getExternalWorkflowHandle(parentWorkflowId).signal(parentNoteDoneSignal, { childId: input.childId, status })
    } catch { log.warn('parent noteDone failed', { childId: input.childId, status }) }
  }

  try {
    // Continued runs skip launched (the first run recorded it).
    if (!carried) {
      nonce += 1
      await childActivities.appendEventActivity({
        idempotencyKey: idempotencyKey(patched('child-event-run-v2') ? eventKey : input.parentPartition, `launched-${input.childId}`, nonce),
        partition: input.parentPartition,
        type: 't.subagent.launched',
        payload: {
          childId: input.childId,
          parentSessionId: input.parentSessionId,
          parentWorkflowId: workflowInfo().parent?.workflowId ?? 'unknown',
          depth: input.depth,
          mode: input.mode,
          goal: input.goal,
          ...(input.name === undefined ? {} : { name: input.name }),
          queueCapacity: input.queueCapacity,
          canDelegate: input.mode !== 'fork' && input.depth + 1 <= input.maxDepth,
        },
      })
    }

    for (;;) {
      // Two-step close like agents finish(): cancel marks the child and
      // stops the turn, but the workflow completes only on finish — so a
      // post-cancel message deterministically lands as missed steer.
      if (currentStatus() === 'cancelled' && !finishRequested) {
        const childFinishTimeoutMs = input.childFinishTimeoutMs ?? DEFAULT_CHILD_FINISH_TIMEOUT_MS
        const finished = await condition(() => finishRequested, childFinishTimeoutMs)
        // A finish that never arrives still closes: the completion entry
        // below records cancelled, so the parent never waits on silence.
        if (!finished) finishRequested = true
        continue
      }
      if (finishRequested) break
      // Continue-as-new between turns: the inbox, missed steer, goal,
      // thread length, and pause flags carry into a fresh run. Mid-recovery
      // and cancelled runs never continue; old histories skip via the patch.
      const childInfo = workflowInfo()
      if (
        !recovering &&
        currentStatus() === 'running' &&
        patched('can-v1') &&
        shouldContinueAsNew(childInfo.historyLength, childInfo.historySize, childInfo.continueAsNewSuggested, input.historyEventLimit, input.historyByteLimit)
      ) {
        await continueAsNew<typeof subagentRun>({
          childId: input.childId,
          goal: input.goal,
          depth: input.depth,
          mode: input.mode,
          maxDepth: input.maxDepth,
          queueCapacity: input.queueCapacity,
          parentSessionId: input.parentSessionId,
          parentPartition: input.parentPartition,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.fakeSteps === undefined ? {} : { fakeSteps: input.fakeSteps }),
          ...(input.childFinishTimeoutMs === undefined ? {} : { childFinishTimeoutMs: input.childFinishTimeoutMs }),
          ...(input.historyEventLimit === undefined ? {} : { historyEventLimit: input.historyEventLimit }),
          ...(input.historyByteLimit === undefined ? {} : { historyByteLimit: input.historyByteLimit }),
          ...(input.ownerEpoch === undefined ? {} : { ownerEpoch: input.ownerEpoch }),
          resumed: {
            inbox,
            missedSteer,
            goal: goalBox.goal,
            threadLength,
            nonce,
            acceptingSteer,
            paused,
            contextPaused,
          },
        })
        // Unreachable: the new run owns the inbox now.
        return 'continued'
      }
      // Owner pause gate: no new inbox item starts while paused. The
      // header flips through the regular thread-state events.
      if (patched('subagent-pause-v1') && paused) {
        nonce += 1
        await childActivities.appendEventActivity({ idempotencyKey: idempotencyKey(eventKey, 'owner-paused', nonce), partition: childPartition, type: 't.thread.state', payload: { threadKey, status: 'PAUSED', acceptingSteer: false } })
        await condition(() => !paused || currentStatus() === 'cancelled' || finishRequested)
        if (currentStatus() === 'cancelled' || finishRequested) continue
        nonce += 1
        await childActivities.appendEventActivity({ idempotencyKey: idempotencyKey(eventKey, 'owner-resumed', nonce), partition: childPartition, type: 't.thread.state', payload: { threadKey, status: 'RUNNING', acceptingSteer: true } })
      }
      const next = inbox.shift()
      if (next === undefined) {
        await condition(() => inbox.length > 0 || finishRequested || currentStatus() === 'cancelled')
        continue
      }
      const text = typeof next === 'string' ? next : next.text
      try {
        if (patched('child-user-before-turn-v1') && !recovering) {
          nonce += 1
          await childActivities.appendEventActivity({ idempotencyKey: idempotencyKey(eventKey, 'user', nonce), partition: childPartition, type: 't.message.appended', payload: { threadKey, kind: 'text', message: { role: 'user', text } } })
          threadLength += 1
        }
        const outcome = await CancellationScope.cancellable(async () => {
          const scope = CancellationScope.current()
          cancelRunningTurn = () => scope.cancel()
          try {
            // Phase 3 Karbot turn in the child's own partition: the parent
            // session's model applies (children carry no model of their
            // own), deltas keyed by the child runKey.
            const runKey = `karbot:${eventKey}:${nonce}`
            return await resumableTurn(() => childActivities.karbotTurnActivity({
              sessionId: input.parentSessionId,
              threadKey,
              runKey: recovering?.runKey ?? (patched('child-runkey-v2') ? runKey : `karbot:${input.childId}:${nonce}`),
              ...(recovering ? { recovery: recovering } : {}),
              ...(input.ownerEpoch ? { ownerEpoch: input.ownerEpoch,ownerFirstExecutionId: workflowInfo().firstExecutionRunId,ownerContinuedFromExecutionId: workflowInfo().continuedFromExecutionRunId } : {}),
              text,
              fakeSteps: input.fakeSteps,
            }), async (reason, kind) => {
              if (kind === 'pause') paused = true
              else {
                contextPaused = true
                acceptingSteer = false
              }
              nonce += 1
              await childActivities.appendEventActivity({ idempotencyKey: idempotencyKey(eventKey, kind === 'pause' ? 'owner-paused' : 'context-paused', nonce), partition: childPartition, type: 't.thread.state', payload: { threadKey, status: 'PAUSED', acceptingSteer: false } })
              if (kind !== 'pause') {
                nonce += 1
                await childActivities.appendEventActivity({ idempotencyKey: idempotencyKey(eventKey, 'context-error', nonce), partition: childPartition, type: 't.message.appended', payload: { threadKey, kind: 'tool', message: { id: `context-${nonce}`, name: kind === 'operation' ? 'operation.recovery' : 'context.compaction', state: 'failed', detail: reason } } })
              }
            }, async () => {
              await condition(() => (!contextPaused && !paused) || currentStatus() === 'cancelled' || finishRequested)
              if (currentStatus() === 'cancelled' || finishRequested) throw new CancelledFailure('Child stopped while context was paused')
              nonce += 1
              await childActivities.appendEventActivity({ idempotencyKey: idempotencyKey(eventKey, 'context-resumed', nonce), partition: childPartition, type: 't.thread.state', payload: { threadKey, status: 'RUNNING', acceptingSteer: true } })
            }, { parkPause: patched('subagent-pause-v1') })
          } finally {
            cancelRunningTurn = undefined
          }
        })
        // A cancel that lands after the scope resolves still wins: the
        // finished turn is discarded rather than appended as an orphan.
        if (currentStatus() === 'cancelled') continue
        nonce += 1
        await childActivities.appendEventActivity({
          idempotencyKey: idempotencyKey(eventKey, 'reply', nonce),
          partition: childPartition,
          type: 't.message.appended',
          payload: { threadKey, kind: 'text', message: { text: outcome.reply, role: 'agent' } },
        })
        threadLength += 1
        recovering=undefined
      } catch (error) {
        if (isCancellation(error)) continue
        throw error
      }
    }

    // Finish drains the leftover inbox into missed steer, exactly like
    // agents finish(); a cancelled child reports cancelled, never finished.
    missedSteer.push(...inbox.splice(0, inbox.length).map((item) => (typeof item === 'string' ? item : item.text)))
    acceptingSteer = false
    const finalStatus: ChildStatus = currentStatus() === 'cancelled' ? 'cancelled' : 'finished'
    box.status = finalStatus
    await appendCompletion()
    await noteParentDone(finalStatus)
    return finalStatus
  } catch (error) {
    // Continue-as-new unwinds through here: rethrow before the failure
    // note, or every chain reports the healthy child as failed (freeing
    // its parent slot), and the awaited note stretches the CAN across
    // WFTs so signals arriving mid-unwind miss the carry. Same guard as
    // delegateParent; ungated like it because the CAN is a replay
    // firewall (closed runs never replay).
    if (error instanceof ContinueAsNew) throw error
    if (isCancellation(error)) {
      // Parent cancelled: the completion entry still lands (non-cancellable)
      // so the parent thread shows the closed child instead of silence.
      box.status = 'cancelled'
      await CancellationScope.nonCancellable(async () => { await appendCompletion(); await noteParentDone('cancelled') })
    } else {
      await noteParentDone('failed')
    }
    throw error
  }
}
