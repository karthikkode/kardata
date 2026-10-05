// Subagent delegation as child workflows. B2.4. The six agents/subagents.ts
// operations run durably: launch is startChild from the delegate parent,
// get/collect are queries on the child, message/redirect/cancel/finish are
// child signals. State lives in workflow variables (never in an activity),
// so a crashed worker resumes the exact inbox, goal, and status from history.
//
// Parent-thread contract (documentation/frontend-thread-contract.md): the
// parent partition holds the delegation call plus one completion entry per
// child and never any child intermediate. Child turn replies land in the
// child's own partition under the agent:<child-id> thread key. Sends to a
// finished child never relaunch: the parent appends t.subagent.missed_steer
// against the closed child id.
//
// Determinism notes: ids, goals, depth, and mode arrive in signal/input
// payloads; the only imports are the workflow SDK, the timeout table, and
// type-only agents shapes (erased at bundle time). No clocks, no random ids.
import {
  ActivityFailure,
  CancelledFailure,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  log,
  ParentClosePolicy,
  patched,
  proxyActivities,
  setHandler,
  startChild,
  uuid4,
  workflowInfo,
  type ChildWorkflowHandle,
} from '@temporalio/workflow'
import { registerQueueHandlers } from './inbox-queue.js'
import { resumableTurn } from './resumable-turn.js'
import { withPreparedExecution } from './epoch-start.js'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
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
import type * as epochActivities from '../activities/execution-epochs.js'

const childActivities = proxyActivities<typeof activities>(activityOptions('turn'))
const execution = proxyActivities<typeof epochActivities>(activityOptions('turn'))

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
}

export interface SubagentChildInput extends DelegateRequest {
  ownerEpoch?: string
  parentSessionId: string
  parentPartition: string
  /** Finish close: a cancelled child with no finish signal for this long
   * completes itself (status cancelled) instead of waiting forever.
   * Defaults to 1 h. */
  childFinishTimeoutMs?: number
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

export interface ParentState {
  sessionId: string
  children: Array<{ childId: string; status: ChildStatus | 'running'; goalFed: boolean }>
  /** Accepted but unstarted children, in promotion order. */
  queued: string[]
  /** Latest rejections, newest last (cap 20): lets the gateway fail a
   * queue-full racer fast instead of after the 30 s acceptance poll. */
  rejected: Array<{ childId: string; reason: string }>
}

export const parentDelegateSignal = defineSignal<[DelegateRequest]>('parentDelegate')
export const parentSteerSignal = defineSignal<[SteerRequest]>('parentSteer')
// Liveness protocol: whoever observes a child close must signal noteDone.
// The parent tracks running children in memory only, so a close without
// noteDone leaves a stale 'running' entry and later relaunches of that id
// reject as duplicates instead of starting.
export const parentNoteDoneSignal = defineSignal<[NoteDoneRequest]>('parentNoteDone')
export const parentRecoverSignal = defineSignal<[DelegateRequest]>('parentRecover')
export const parentFinishSignal = defineSignal('parentFinish')
export const parentStateQuery = defineQuery<ParentState>('parentState')

export const childMessageSignal = defineSignal<[string]>('childMessage')
export const childRedirectSignal = defineSignal<[string]>('childRedirect')
export const childCancelSignal = defineSignal('childCancel')
export const childFinishSignal = defineSignal('childFinish')
export const childStateQuery = defineQuery<ChildSnapshot>('childState')
export const childSummaryQuery = defineQuery<ChildSummary>('childSummary')
export const childCanDelegateQuery = defineQuery<boolean>('childCanDelegate')

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

export interface DelegateParentInput {
  ownerEpochProtocol?: boolean
  sessionId: string
  /** Idle close: no delegation, steer, or finish for this long cancels any
   * running children and completes the parent instead of wedging it open.
   * Defaults to 24 h. */
  parentIdleTimeoutMs?: number
  /** Fan-out cap: delegations arriving while this many children run wait
   * in the durable queue instead of starting. Defaults to 50. */
  maxInFlight?: number
  /** Queue cap: delegations arriving while this many children wait reject
   * immediately as `t.subagent.rejected` (the gateway refuses before
   * signalling, so callers see a 409, never a timeout). Defaults to 2000. */
  maxQueued?: number
}

/** Default idle close for delegation parents. */
export const DEFAULT_PARENT_IDLE_TIMEOUT_MS = 24 * 3_600_000

/** Default fan-out cap for delegation parents. */
export const DEFAULT_MAX_IN_FLIGHT_CHILDREN = 50

/** Default durable-queue cap for delegation parents. */
export const DEFAULT_MAX_QUEUED_CHILDREN = 2000

export async function delegateParent(input: DelegateParentInput): Promise<string> {
  const partition = `session:${input.sessionId}`
  const delegations: DelegateRequest[] = []
  const steers: SteerRequest[] = []
  const waiting: DelegateRequest[] = []
  const queuedNotified = new Set<string>()
  const promoted = new Set<string>()
  const rejections: Array<{ childId: string; reason: string }> = []
  function noteRejection(childId: string, reason: string): void {
    rejections.push({ childId, reason })
    if (rejections.length > 20) rejections.shift()
  }
  const children = new Map<string, { status: ChildStatus | 'running'; goalFed: boolean; handle?: ChildWorkflowHandle<typeof subagentRun> }>()
  let nonce = 0
  let finishRequested = false

  // Signal payloads carry goals and text: only names, ids, and counts log.
  setHandler(parentDelegateSignal, (request: DelegateRequest) => {
    delegations.push(request)
    log.info('signal received', { signal: 'parentDelegate', pending: delegations.length })
  })
  setHandler(parentRecoverSignal,(request: DelegateRequest) => {
    if (!request.recovery) { log.warn('recovery signal rejected',{ code: 'recovery_proof_missing' }); return }
    delegations.push(request)
    log.info('signal received',{ signal: 'parentRecover',pending: delegations.length })
  })
  setHandler(parentSteerSignal, (request: SteerRequest) => {
    steers.push(request)
    log.info('signal received', { signal: 'parentSteer', pending: steers.length })
  })
  setHandler(parentNoteDoneSignal, (request: NoteDoneRequest) => {
    const record = children.get(request.childId)
    if (record) record.status = request.status
    // A freed slot promotes the head of the durable queue: the promotion
    // lands in delegations so the wait below wakes on the same predicate.
    // Spurious promotions self-correct (the launch re-checks the cap).
    const next = waiting.shift()
    if (next) {
      promoted.add(next.childId)
      delegations.push(next)
    }
    log.info('signal received', { signal: 'parentNoteDone', childId: request.childId, status: request.status })
  })
  setHandler(parentFinishSignal, () => {
    finishRequested = true
    log.info('signal received', { signal: 'parentFinish' })
  })
  setHandler(parentStateQuery, () => ({
    sessionId: input.sessionId,
    children: [...children.entries()].map(([childId, record]) => ({ childId, status: record.status, goalFed: record.goalFed })),
    queued: waiting.map((request) => request.childId),
    rejected: [...rejections],
  }))

  nonce += 1
  await childActivities.appendEventActivity({
    idempotencyKey: idempotencyKey(partition, 'session', nonce),
    partition,
    type: 't.session.created',
    payload: { sessionId: input.sessionId, title: input.sessionId },
  })

  for (;;) {
    if (finishRequested) return 'done'
    // Steers drain before delegations every iteration, by design: an
    // operator redirect to a live child jumps ahead of queued launches so a
    // stale queue can never delay a course correction.
    const steer = steers.shift()
    if (steer !== undefined) {
      const record = children.get(steer.childId)
      if (record && record.status === 'running' && record.handle) {
        await record.handle.signal(childMessageSignal, steer.text)
      } else {
        // Finished (or unknown) child: never relaunch; the text lands as
        // missed steer against the closed child id.
        nonce += 1
        await childActivities.appendEventActivity({
          idempotencyKey: idempotencyKey(partition, 'missed', nonce),
          partition,
          type: 't.subagent.missed_steer',
          payload: { childId: steer.childId, text: steer.text },
        })
      }
      continue
    }
    const request = delegations.shift()
    if (request === undefined) {
      const parentIdleTimeoutMs = input.parentIdleTimeoutMs ?? DEFAULT_PARENT_IDLE_TIMEOUT_MS
      const signalled = await condition(
        () => delegations.length > 0 || steers.length > 0 || finishRequested,
        parentIdleTimeoutMs,
      )
      if (!signalled && !finishRequested && delegations.length === 0 && steers.length === 0) {
        // Idle close: cooperatively cancel-then-finish running children
        // (the same two-step close operators use) so none outlives the
        // parent as an orphan, then complete with a terminal entry.
        for (const record of children.values()) {
          if (record.status === 'running' && record.handle) {
            try {
              await record.handle.signal(childCancelSignal)
              await record.handle.signal(childFinishSignal)
            } catch {
              // Already closed: the completion entry (or missed steer)
              // recorded the outcome; nothing left to close.
            }
            record.status = 'cancelled'
          }
        }
        nonce += 1
        await childActivities.appendEventActivity({
          idempotencyKey: idempotencyKey(partition, 'parent-expired', nonce),
          partition,
          type: 't.subagent.parent_expired',
          payload: { sessionId: input.sessionId, children: children.size },
        })
        return 'parent-idle-timeout'
      }
      continue
    }
    const existing = children.get(request.childId)
    if (request.recovery) {
      if (!(await execution.originalRecoveryReadyActivity({ threadKey: `agent:${request.childId}`,sessionId: input.sessionId,checkpointHash: request.recovery.checkpointHash }))) continue
      children.delete(request.childId)
    }
    if ((existing?.status === 'running' || waiting.some((queued) => queued.childId === request.childId)) && !request.recovery) {
      // A duplicate workflowId would throw inside startChild and fail the
      // parent: reject the duplicate as an event and keep the running (or
      // waiting) child. Finished children may relaunch under the same id
      // (server reuses the id once the previous run closes), so only
      // running or waiting duplicates reject.
      nonce += 1
      await childActivities.appendEventActivity({
        idempotencyKey: idempotencyKey(partition, 'rejected', nonce),
        partition,
        type: 't.subagent.rejected',
        payload: {
          childId: request.childId,
          goal: request.goal,
          depth: request.depth,
          maxDepth: request.maxDepth,
          reason: 'duplicate delegation for a running child',
        },
      })
      noteRejection(request.childId, 'duplicate delegation for a running child')
      continue
    }
    if (!request.goal.trim() || request.depth > request.maxDepth) {
      nonce += 1
      await childActivities.appendEventActivity({
        idempotencyKey: idempotencyKey(partition, 'rejected', nonce),
        partition,
        type: 't.subagent.rejected',
        payload: {
          childId: request.childId,
          goal: request.goal,
          depth: request.depth,
          maxDepth: request.maxDepth,
          reason: !request.goal.trim() ? 'delegation needs a non-empty goal' : `depth exceeds max ${request.maxDepth}`,
        },
      })
      noteRejection(request.childId, !request.goal.trim() ? 'delegation needs a non-empty goal' : `depth exceeds max ${request.maxDepth}`)
      continue
    }
    const maxInFlight = input.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT_CHILDREN
    const maxQueued = input.maxQueued ?? DEFAULT_MAX_QUEUED_CHILDREN
    const running = [...children.values()].filter((record) => record.status === 'running').length
    if (running >= maxInFlight) {
      if (!patched('child-queue-v1')) {
        // Pre-4.2.3 histories: over-cap rejected instead of queueing.
        nonce += 1
        await childActivities.appendEventActivity({
          idempotencyKey: idempotencyKey(partition, 'rejected', nonce),
          partition,
          type: 't.subagent.rejected',
          payload: {
            childId: request.childId,
            goal: request.goal,
            depth: request.depth,
            maxDepth: request.maxDepth,
            reason: `max in-flight children ${maxInFlight} reached`,
          },
        })
        noteRejection(request.childId, `max in-flight children ${maxInFlight} reached`)
        continue
      }
      if (waiting.length >= maxQueued) {
        nonce += 1
        await childActivities.appendEventActivity({
          idempotencyKey: idempotencyKey(partition, 'rejected', nonce),
          partition,
          type: 't.subagent.rejected',
          payload: {
            childId: request.childId,
            goal: request.goal,
            depth: request.depth,
            maxDepth: request.maxDepth,
            reason: `child queue full (${maxQueued} waiting)`,
          },
        })
        noteRejection(request.childId, `child queue full (${maxQueued} waiting)`)
        continue
      }
      waiting.push(request)
      if (!queuedNotified.has(request.childId)) {
        queuedNotified.add(request.childId)
        nonce += 1
        await childActivities.appendEventActivity({
          idempotencyKey: idempotencyKey(partition, 'queued', nonce),
          partition,
          type: 't.subagent.queued',
          payload: { childId: request.childId, goal: request.goal, depth: request.depth, position: waiting.length },
        })
      }
      continue
    }
    nonce += 1
    await childActivities.appendEventActivity({
      idempotencyKey: idempotencyKey(partition, 'delegated', nonce),
      partition,
      type: 't.subagent.delegated',
      payload: { childId: request.childId, goal: request.goal, depth: request.depth, mode: request.mode },
    })
    // REQUEST_CANCEL (not the TERMINATE default): a cancelled parent
    // cooperatively cancels the running child — mirroring agents cancel()
    // propagation — so the child still records its completion entry instead
    // of dying silent.
    const ownerEpoch = input.ownerEpochProtocol && patched('execution-epoch-v1') ? await execution.prepareExecutionIntentActivity({ workflowId: request.childId,threadKey: `agent:${request.childId}`,sessionId: input.sessionId,requestKey: `child:${request.childId}:${nonce}` }) : undefined
    let handle: ChildWorkflowHandle<typeof subagentRun>
    try { handle = await withPreparedExecution(ownerEpoch,() => startChild(subagentRun, {
      workflowId: request.childId,
      parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_REQUEST_CANCEL,
      args: [
        {
          ...request,
          parentSessionId: input.sessionId,
          parentPartition: partition,
          ...(ownerEpoch ? { ownerEpoch } : {}),
        },
      ],
    })) } catch (error) {
      if (request.recovery && error instanceof WorkflowExecutionAlreadyStartedError) {
        if (existing) children.set(request.childId,existing)
        continue
      }
      throw error
    }
    // Promoted launches feed the goal parent-side: the gateway returns
    // queued without signalling, so the parent owns the first work item.
    // Direct launches leave the feed to the gateway (goalFed false).
    const fed = promoted.delete(request.childId)
    if (fed) await handle.signal(childMessageSignal, request.goal)
    children.set(request.childId, { status: 'running', goalFed: fed, handle })
  }
}

export async function subagentRun(input: SubagentChildInput): Promise<string> {
  const childPartition = `child:${input.childId}`
  const threadKey = `agent:${input.childId}`
  const box: { status: ChildStatus } = { status: 'running' }
  const goalBox: { goal: string } = { goal: input.goal }
  // Inbox ids gate once here (same contract as sessionRun): handlers
  // close over the flag so old histories keep plain strings.
  const inboxIds = patched('inbox-ids-v1')
  function stamp(text: string): string | { id: string; text: string; queuedAt: number } {
    return inboxIds ? { id: uuid4(), text, queuedAt: Date.now() } : text
  }
  const inbox: Array<string | { id: string; text: string; queuedAt: number }> = input.recovery ? [stamp(input.recovery.text)] : []
  let recovering=input.recovery
  const missedSteer: string[] = []
  const currentStatus = (): ChildStatus => box.status
  let nonce = 0
  let threadLength = 0
  let acceptingSteer = true
  let contextPaused = false
  let paused = false
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

  try {
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
    return finalStatus
  } catch (error) {
    if (isCancellation(error)) {
      // Parent cancelled: the completion entry still lands (non-cancellable)
      // so the parent thread shows the closed child instead of silence.
      box.status = 'cancelled'
      await CancellationScope.nonCancellable(() => appendCompletion())
    }
    throw error
  }
}
