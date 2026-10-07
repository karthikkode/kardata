// Run gateway helpers: workflow-id builders, the approved-coordinator
// transition, cancel signaling, status mapping, env caps, and
// connectivity classification.
import { randomUUID } from 'node:crypto'
import { appendEvent, enqueueQueuedSteering, getThread, setThreadPaused, type TransactableDb } from '../db/index.js'
import { CancelledFailure, WorkflowFailedError, WorkflowNotFoundError, type Client } from '@temporalio/client'
import { laneConfig } from './lanes.js'
import { createLogger, logOp } from '../observability/logging.js'
import { activeTraceId } from '../observability/temporal-tracing.js'
import { currentTraceId } from '../observability/tracing.js'
import { injectTraceparent, newTraceId } from '../observability/trace.js'
import {
  RunNotFound,
  SESSION_PREFIX,
  SESSION_WORKFLOW_TYPE,
  TemporalUnavailableError,
  ThreadNotAccepting,
  type ApprovedCoordinatorHandle,
  type CancelHandle,
  type CommandResult,
  type RunState,
  type SessionSignalStart,
} from './runs-types.js'

/** Single-flight key: one compaction workflow per sector at a time. */
export function contextCompactionWorkflowId(sectorId: string): string {
  return `context-compaction-${sectorId}`
}

const researchGatewayLogger = createLogger({ op: 'research.execution.transition' })

/** Only a confirmed paused, superseded execution may be replaced. */
export async function ensureApprovedCoordinator(handle: ApprovedCoordinatorHandle, version: number, start: () => Promise<unknown>, closeTimeoutMs = 60_000): Promise<void> {
  if (!Number.isInteger(version) || version < 1 || !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0) throw new TypeError('Invalid research transition limits')
  return logOp(researchGatewayLogger, 'research.execution.transition', async () => {
    const current = await handle.query('coordinatorState')
    if (!current.planVersion || current.planVersion === version) { await handle.signal('coordinatorResume'); return }
    if (!current.paused) throw new Error('Previous research is still stopping. Retry Start after it is paused.')
    await handle.cancel()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        handle.result().catch((error: unknown) => {
          if (!(error instanceof WorkflowFailedError && error.cause instanceof CancelledFailure)) throw error
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Previous research has not stopped. Retry Start after recovery.')), closeTimeoutMs) }),
      ])
    } finally { if (timer) clearTimeout(timer) }
    await start()
  }, { workflowId: handle.workflowId, planVersion: version })
}

/** Delegation parent workflow id for a session: one parent per session,
 * created on first delegation, shared by all its children. */
export function delegationWorkflowId(sessionId: string): string {
  return `delegation-${sessionId}`
}

/** Signal runCancel, mapping a closed handle to RunNotFound. Describe
 * succeeds on closed workflows, so the signal is where their absence
 * surfaces; callers treat it as already gone instead of 500ing. */
export async function signalRunCancel(handle: CancelHandle, runId: string): Promise<void> {
  try {
    await handle.signal('runCancel')
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${runId}`)
    throw error
  }
}

/** Pure builder for the session signal-with-start: first send to a session
 * starts its workflow instead of 404ing; later sends signal the running
 * one (the server routes the signal to the existing execution). */
/** A send's trace: ambient OTel (MCP/activity callers), else the route ALS
 * trace, else fresh. Every session send carries its own message trace. */
export function sendTraceparent(): string {
  return injectTraceparent({ traceId: activeTraceId() ?? currentTraceId() ?? newTraceId() })
}

export function buildSessionSignalStart(
  sessionId: string,
  text: string,
  signal: 'runSend' | 'runSteer',
  traceparent: string,
): SessionSignalStart {
  return {
    workflowType: SESSION_WORKFLOW_TYPE,
    workflowId: `${SESSION_PREFIX}${sessionId}`,
    taskQueue: laneConfig('turn').taskQueue,
    signal,
    signalArgs: [{ text, traceparent }],
    args: [{ sessionId }],
  }
}

export function commandId(): string {
  return `cmd-${randomUUID()}`
}

/** Thread + partition a run id cancels: session runs own their session
 * thread, child runs (subagent, company research) own agent:<childId>. */
export function cancelThreadTarget(runId: string, type: string): { threadKey: string; partition: string } {
  if (type === 'sessionRun') {
    const sessionId = runId.slice(SESSION_PREFIX.length)
    return { threadKey: sessionId, partition: `session:${sessionId}` }
  }
  return { threadKey: `agent:${runId}`, partition: `child:${runId}` }
}

/** Prompt CANCELLING state for a run about to be cancelled, ahead of the
 * signal: the run can take seconds to unwind (activity cancellation),
 * and the UI releases its thinking indicator on the CANCELLING frame
 * instead of waiting for finished. Fails closed: a DB error aborts
 * before anything is cancelled. */
export async function appendCancelState(pool: TransactableDb, runId: string, type: string): Promise<void> {
  const target = cancelThreadTarget(runId, type)
  await appendEvent(pool, { idempotencyKey: `cancel-state:${runId}:${randomUUID()}`, partition: target.partition, type: 't.thread.state', payload: { threadKey: target.threadKey, status: 'CANCELLING', acceptingSteer: false } })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const TEMPORAL_DEADLINE_CODES: ReadonlySet<unknown> = new Set([4, 'DEADLINE_EXCEEDED'])

/** True when a Temporal client failure is the RPC deadline firing (F8
 * launch path): gRPC DEADLINE_EXCEEDED by code or message, up to 4
 * causes deep. Separate from isTemporalConnectivity (which deliberately
 * excludes code 4): only the launch path converts it, since only there
 * does a deadline mean the server is cut rather than slow work. */
export function isTemporalDeadlineExceeded(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || (typeof current !== 'object' && typeof current !== 'function')) return false
    if (TEMPORAL_DEADLINE_CODES.has((current as { code?: unknown }).code)) return true
    const message = (current as { message?: unknown }).message
    if (typeof message === 'string' && message.toLowerCase().includes('deadline exceeded')) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Launch-path error mapping (F8): a fired RPC deadline means the server
 * is cut, so it converts to TemporalUnavailableError (503) like
 * connectivity failures; anything else rethrows untouched. The client
 * cache drops on conversion so post-heal commands reconnect fresh. */
export function normalizeLaunchError(error: unknown, dropClient: () => void): unknown {
  if (!isTemporalDeadlineExceeded(error)) return error
  dropClient()
  return new TemporalUnavailableError('Temporal is unreachable; retry the command shortly.', { cause: error })
}

export function closeState(statusName: string): RunState {
  switch (statusName) {
    case 'COMPLETED':
    case 'CANCELLED':
      return 'FINISHED'
    case 'CONTINUED_AS_NEW':
      return 'RUNNING'
    default:
      return 'ERROR'
  }
}

export function mapResearchStatus(status: string): RunState {
  switch (status) {
    case 'running':
      return 'RUNNING'
    case 'paused':
      return 'PAUSED'
    case 'blocked':
      return 'ERROR'
    default:
      return 'FINISHED'
  }
}

export function childNameOf(messages: Array<{ payload: unknown }>): string | undefined {
  for (const message of messages) {
    const payload = message.payload as { launched?: string; name?: string }
    if (payload.launched === 'true' && typeof payload.name === 'string') return payload.name
  }
  return undefined
}

/** Describes a run and rejects handles whose workflow type has no path for
 * the requested command. */
export async function requireWorkflowType(client: Client, runId: string, allowed: string[]): Promise<string> {
  let description
  try {
    description = await client.workflow.getHandle(runId).describe()
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${runId}`)
    throw error
  }
  if (!allowed.includes(description.type)) {
    throw new ThreadNotAccepting(`run ${runId} (${description.type}) has no path for this command`)
  }
  return description.type
}

async function awaitQueuedState(
  pool: TransactableDb,
  threadKey: string,
  status: string,
  project: () => Promise<unknown>,
): Promise<void> {
  const started = Date.now()
  for (;;) {
    await project()
    const current = await getThread(pool, threadKey)
    if (current?.status === status || Date.now() - started > 5000) return
    await sleep(200)
  }
}

/** Pauses, resumes or cancels a QUEUED child via its live parent. Returns
 * null when the target is not a queued delegateParent child, so the
 * caller keeps its existing running path untouched — including a child
 * that promoted between the read and the control. A stale QUEUED row
 * whose parent is gone is a 409, not a silent no-op. */
export async function controlQueuedChild(
  pool: TransactableDb,
  client: Client,
  runId: string,
  action: 'pause' | 'resume' | 'cancel',
  project: () => Promise<unknown>,
): Promise<CommandResult | null> {
  const threadKey = `agent:${runId}`
  const thread = await getThread(pool, threadKey)
  if (!thread || thread.kind !== 'subagent') return null
  if (thread.status !== 'QUEUED' && thread.status !== 'PAUSED') return null
  const parent = client.workflow.getHandle(delegationWorkflowId(thread.sessionId))
  let queued: string[]
  try {
    queued = ((await parent.query('parentState')) as { queued?: string[] }).queued ?? []
  } catch (queryError) {
    if (!(queryError instanceof WorkflowNotFoundError)) throw queryError
    throw new ThreadNotAccepting(`child ${runId} has no live parent; it can no longer be controlled`)
  }
  if (!queued.includes(runId)) return null
  if (action === 'cancel') await appendCancelState(pool, runId, 'subagentRun')
  try {
    await parent.signal('parentChildControl', { childId: runId, action })
  } catch (signalError) {
    if (!(signalError instanceof WorkflowNotFoundError)) throw signalError
    throw new ThreadNotAccepting(`child ${runId} has no live parent; it can no longer be controlled`)
  }
  if (action !== 'cancel') await setThreadPaused(pool, threadKey, action === 'pause')
  const expect = action === 'cancel' ? 'FINISHED' : action === 'pause' ? 'PAUSED' : 'QUEUED'
  await awaitQueuedState(pool, threadKey, expect, project)
  return { commandId: commandId(), state: 'accepted' }
}

/** Steers a QUEUED child, or a PAUSED child with no live workflow yet: the
 * instruction waits pending for its first turn instead of recording
 * missed. Returns null for session threads and children with a live
 * workflow, which keep their existing steer path. */
export async function steerQueuedChild(
  pool: TransactableDb,
  client: Client,
  thread: { key: string; kind: string; status: string },
  text: string,
): Promise<CommandResult | null> {
  if (thread.kind !== 'subagent') return null
  if (thread.status === 'PAUSED') {
    try {
      await client.workflow.getHandle(thread.key.slice('agent:'.length)).describe()
      return null
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error
    }
  } else if (thread.status !== 'QUEUED') {
    return null
  }
  const id = commandId()
  await enqueueQueuedSteering(pool, thread.key, text, id)
  return { commandId: id, state: 'accepted' }
}

/** Delegation caps from the environment (Node side only: workflows take
 * them via DelegateParentInput). Invalid values fail the delegation fast
 * with the variable named. */
export function childCapsFromEnv(env: NodeJS.ProcessEnv = process.env): { maxInFlight: number; maxQueued: number } {
  const parse = (name: 'KARDATA_MAX_CHILDREN_IN_FLIGHT' | 'KARDATA_MAX_CHILDREN_QUEUED', fallback: number): number => {
    const raw = env[name]
    if (raw === undefined || raw === '') return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
    return value
  }
  return { maxInFlight: parse('KARDATA_MAX_CHILDREN_IN_FLIGHT', 50), maxQueued: parse('KARDATA_MAX_CHILDREN_QUEUED', 2000) }
}

const TEMPORAL_CONNECTIVITY_CODES: ReadonlySet<unknown> = new Set([
  14, 'UNAVAILABLE', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT', 'ECONNRESET',
])
const TEMPORAL_CONNECTIVITY_MESSAGE_PARTS = [
  'connection refused', 'unavailable', 'failed to connect', 'transport error', 'tonic',
]

/** True when a Temporal client failure means the server is unreachable
 * (F8): gRPC UNAVAILABLE, refused/reset/timed-out sockets, or the bridge's
 * transport errors, found on the error or up to 4 causes deep. Domain
 * errors (not-found, already-started) and bugs never match. */
export function isTemporalConnectivity(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || (typeof current !== 'object' && typeof current !== 'function')) return false
    if (TEMPORAL_CONNECTIVITY_CODES.has((current as { code?: unknown }).code)) return true
    const message = (current as { message?: unknown }).message
    if (typeof message === 'string') {
      const text = message.toLowerCase()
      if (TEMPORAL_CONNECTIVITY_MESSAGE_PARTS.some((part) => text.includes(part))) return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

