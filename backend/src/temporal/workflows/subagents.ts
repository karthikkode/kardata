// Delegate parent: durable fan-out over subagent-child workflows. B2.4.
// The six agents/subagents.ts operations run durably: launch is startChild
// from this parent, get/collect are queries on the child,
// message/redirect/cancel/finish are child signals. State lives in workflow
// variables (never in an activity), so a crashed worker resumes the exact
// inbox, goal, and status from history.
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
  CancellationScope,
  ContinueAsNew,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  getExternalWorkflowHandle,
  log,
  ParentClosePolicy,
  patched,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
  type ChildWorkflowHandle,
  type ExternalWorkflowHandle,
} from '@temporalio/workflow'
import { shouldContinueAsNew } from './can.js'
import { applyChildControl, parentChildControlSignal, shiftUnpaused, type ChildControlRequest } from './child-controls.js'
import { withPreparedExecution } from './epoch-start.js'
import {
  childCancelSignal,
  childFinishSignal,
  childMessageSignal,
  parentNoteDoneSignal,
  subagentRun,
  type DelegateRequest,
  type NoteDoneRequest,
  type SteerRequest,
} from './subagent-child.js'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
import type {
  ChildStatus,
} from '@kardata/agents'
import { activityOptions } from '../timeouts.js'
import type * as activities from '../activities/turn.js'
import type * as epochActivities from '../activities/execution-epochs.js'
// The child surface stays importable from here: turn-bundle re-exports this
// module, and the registry IDs keep their subagents.* names.
export {
  childCanDelegateQuery,
  childCancelSignal,
  childFinishSignal,
  childMessageSignal,
  childRedirectSignal,
  childStateQuery,
  childSummaryQuery,
  DEFAULT_CHILD_FINISH_TIMEOUT_MS,
  parentNoteDoneSignal,
  subagentRun,
} from './subagent-child.js'

const childActivities = proxyActivities<typeof activities>(activityOptions('turn'))
const execution = proxyActivities<typeof epochActivities>(activityOptions('turn'))

export interface ParentState {
  sessionId: string
  children: Array<{ childId: string; status: ChildStatus | 'running'; goalFed: boolean }>
  /** Accepted but unstarted children, in promotion order. */
  queued: string[]
  /** Latest rejections, newest last (cap 20): lets the gateway fail a
   * queue-full racer fast instead of after the 30 s acceptance poll. */
  rejected: Array<{ childId: string; reason: string }>
  /** Queued children parked past promotion until resumed. */
  pausedQueued: string[]
}

export const parentDelegateSignal = defineSignal<[DelegateRequest]>('parentDelegate')
export const parentSteerSignal = defineSignal<[SteerRequest]>('parentSteer')
export const parentRecoverSignal = defineSignal<[DelegateRequest]>('parentRecover')
export const parentFinishSignal = defineSignal('parentFinish')
export const parentStateQuery = defineQuery<ParentState>('parentState')

function idempotencyKey(partition: string, scope: string, nonce: number): string {
  return `${partition}:${scope}:${nonce}`
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
  /** History caps that trip continue-as-new (defaults 10k events / 10 MB).
   * Tests set small values; production leaves both undefined. */
  historyEventLimit?: number
  historyByteLimit?: number
  /** Carry-over from the previous run in a continue-as-new chain. Set by
   * the workflow itself, never by callers. */
  resumed?: DelegateParentResumed
}

export interface DelegateParentResumed {
  delegations: DelegateRequest[]
  steers: SteerRequest[]
  controls: ChildControlRequest[]
  waiting: DelegateRequest[]
  promoted: string[]
  queuedNotified: string[]
  pausedQueued: string[]
  rejections: Array<{ childId: string; reason: string }>
  children: Array<{ childId: string; status: ChildStatus | 'running'; goalFed: boolean }>
  nonce: number
}

/** Default idle close for delegation parents. */
export const DEFAULT_PARENT_IDLE_TIMEOUT_MS = 24 * 3_600_000

/** Default fan-out cap for delegation parents. */
export const DEFAULT_MAX_IN_FLIGHT_CHILDREN = 50

/** Default durable-queue cap for delegation parents. */
export const DEFAULT_MAX_QUEUED_CHILDREN = 2000

export async function delegateParent(input: DelegateParentInput): Promise<string> {
  const partition = `session:${input.sessionId}`
  const carried = input.resumed
  const delegations: DelegateRequest[] = carried?.delegations ?? []
  const steers: SteerRequest[] = carried?.steers ?? []
  const controls: ChildControlRequest[] = carried?.controls ?? []
  const waiting: DelegateRequest[] = carried?.waiting ?? []
  const pausedQueued = new Set<string>(carried?.pausedQueued ?? [])
  const queuedNotified = new Set<string>(carried?.queuedNotified ?? [])
  const promoted = new Set<string>(carried?.promoted ?? [])
  const rejections: Array<{ childId: string; reason: string }> = carried?.rejections ?? []
  function noteRejection(childId: string, reason: string): void {
    rejections.push({ childId, reason })
    if (rejections.length > 20) rejections.shift()
  }
  // Handles cannot cross continue-as-new: running children re-derive by
  // id. Staleness still follows the noteDone protocol — a close without
  // noteDone was already stale before the chain, never because of it.
  const children = new Map<string, { status: ChildStatus | 'running'; goalFed: boolean; handle?: ChildWorkflowHandle<typeof subagentRun> | ExternalWorkflowHandle }>()
  for (const child of carried?.children ?? []) {
    children.set(child.childId, {
      status: child.status,
      goalFed: child.goalFed,
      ...(child.status === 'running' ? { handle: getExternalWorkflowHandle(child.childId) } : {}),
    })
  }
  let nonce = carried?.nonce ?? 0
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
  setHandler(parentChildControlSignal, (request: ChildControlRequest) => {
    controls.push(request)
    log.info('signal received', { signal: 'parentChildControl', pending: controls.length })
  })
  setHandler(parentNoteDoneSignal, (request: NoteDoneRequest) => {
    const record = children.get(request.childId)
    const wasRunning = record?.status === 'running'
    if (record) record.status = request.status
    // Promote only on a running→done transition: duplicates must not free
    // the same slot twice. The promotion lands in delegations so the wait
    // below wakes on the same predicate.
    if (wasRunning) {
      const next = shiftUnpaused(waiting, pausedQueued)
      if (next) {
        promoted.add(next.childId)
        delegations.push(next)
      }
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
    pausedQueued: [...pausedQueued],
  }))

  const cancelRunningChildren = async (): Promise<void> => {
    for (const [, record] of children) {
      if (record.status !== 'running' || !record.handle) continue
      try { await record.handle.signal(childCancelSignal); await record.handle.signal(childFinishSignal) } catch { /* already closed */ }
      record.status = 'cancelled'
    }
  }

  // Continued runs skip session.created (the first run recorded it).
  if (!carried) {
    nonce += 1
    await childActivities.appendEventActivity({
      idempotencyKey: idempotencyKey(partition, 'session', nonce),
      partition,
      type: 't.session.created',
      payload: { sessionId: input.sessionId, title: input.sessionId },
    })
  }

  try {
    for (;;) {
      if (finishRequested) {
        await cancelRunningChildren()
        return 'done'
      }
      // Continue-as-new between iterations: signals, queue, promotions, and
      // the children map carry into a fresh run (patch-gated for old runs).
      const parentInfo = workflowInfo()
      if (
        patched('can-v1') &&
        shouldContinueAsNew(parentInfo.historyLength, parentInfo.historySize, parentInfo.continueAsNewSuggested, input.historyEventLimit, input.historyByteLimit)
      ) {
        await continueAsNew<typeof delegateParent>({
          sessionId: input.sessionId,
          ...(input.ownerEpochProtocol === undefined ? {} : { ownerEpochProtocol: input.ownerEpochProtocol }),
          ...(input.parentIdleTimeoutMs === undefined ? {} : { parentIdleTimeoutMs: input.parentIdleTimeoutMs }),
          ...(input.maxInFlight === undefined ? {} : { maxInFlight: input.maxInFlight }),
          ...(input.maxQueued === undefined ? {} : { maxQueued: input.maxQueued }),
          ...(input.historyEventLimit === undefined ? {} : { historyEventLimit: input.historyEventLimit }),
          ...(input.historyByteLimit === undefined ? {} : { historyByteLimit: input.historyByteLimit }),
          resumed: {
            delegations,
            steers,
            controls,
            waiting,
            promoted: [...promoted],
            queuedNotified: [...queuedNotified],
            pausedQueued: [...pausedQueued],
            rejections,
            children: [...children.entries()].map(([childId, record]) => ({ childId, status: record.status, goalFed: record.goalFed })),
            nonce,
          },
        })
        // Unreachable: the new run owns the queue now.
        return 'continued'
      }
      // Steers drain before delegations every iteration: a redirect to a live
      // child jumps ahead of queued launches, never delayed by a stale queue.
      const steer = steers.shift()
      if (steer !== undefined) {
        const record = children.get(steer.childId)
        if (record && record.status === 'running' && record.handle) {
          await record.handle.signal(childMessageSignal, steer.text)
        } else {
          // Finished (or unknown) child: never relaunch; the text lands as
          // missed steer against the closed child id. Queued children steer
          // through pending thread instructions (gateway path), not here.
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
      // Queued-child controls drain with steers, ahead of launches: a pause
      // lands before the next promotion. Old histories hold no such
      // signals, so the gate only ever opens on new runs.
      if (patched('queued-controls-v1')) {
        const control = controls.shift()
        if (control !== undefined) {
          await applyChildControl({
            waiting,
            paused: pausedQueued,
            isRunning: (childId) => children.get(childId)?.status === 'running',
            forwardToChild: async (childId, signals) => {
              const handle = children.get(childId)?.handle
              if (!handle) return
              for (const signal of signals) {
                try { await handle.signal(signal) } catch { /* already closed */ }
              }
            },
            completeCancelled: async (childId) => {
              nonce += 1
              await childActivities.appendEventActivity({
                idempotencyKey: idempotencyKey(partition, `cancelled-${childId}`, nonce),
                partition,
                type: 't.subagent.completed',
                payload: { summary: { id: childId, status: 'cancelled' } },
              })
            },
            noteState: async (childId, status, acceptingSteer) => {
              nonce += 1
              await childActivities.appendEventActivity({
                idempotencyKey: idempotencyKey(partition, `queued-state-${childId}`, nonce),
                partition,
                type: 't.thread.state',
                payload: { threadKey: `agent:${childId}`, status, acceptingSteer },
              })
            },
          }, control)
          continue
        }
      }
      const request = delegations.shift()
      if (request === undefined) {
        const parentIdleTimeoutMs = input.parentIdleTimeoutMs ?? DEFAULT_PARENT_IDLE_TIMEOUT_MS
        const signalled = await condition(
          () => delegations.length > 0 || steers.length > 0 || controls.length > 0 || finishRequested,
          parentIdleTimeoutMs,
        )
        if (!signalled && !finishRequested && delegations.length === 0 && steers.length === 0 && controls.length === 0) {
          // Idle close: no running child outlives the parent as an orphan,
          // then complete with a terminal entry.
          await cancelRunningChildren()
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
        // A duplicate workflowId would throw inside startChild: reject it as
        // an event instead. Finished ids may relaunch (server reuses the id
        // once the previous run closes); only running/waiting duplicates reject.
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
      // ABANDON: children survive continue-as-new (REQUEST_CANCEL would kill
      // them when the old run closes). Cancel/finish/idle propagate
      // explicitly; noteDone reunites stragglers with the new run.
      const ownerEpoch = input.ownerEpochProtocol && patched('execution-epoch-v1') ? await execution.prepareExecutionIntentActivity({ workflowId: request.childId,threadKey: `agent:${request.childId}`,sessionId: input.sessionId,requestKey: `child:${request.childId}:${nonce}` }) : undefined
      let handle: ChildWorkflowHandle<typeof subagentRun>
      try { handle = await withPreparedExecution(ownerEpoch,() => startChild(subagentRun, {
        workflowId: request.childId,
        parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
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
      // Promoted launches feed the goal parent-side (the gateway returned
      // queued without signalling); direct launches leave it to the gateway.
      const fed = promoted.delete(request.childId)
      if (fed) await handle.signal(childMessageSignal, request.goal)
      children.set(request.childId, { status: 'running', goalFed: fed, handle })
    }
  } catch (error) {
    // ABANDON orphans running children on unwind: cancel them explicitly.
    // Continue-as-new restarts cleanly and must not touch them.
    if (!(error instanceof ContinueAsNew)) await CancellationScope.nonCancellable(() => cancelRunningChildren())
    throw error
  }
}
