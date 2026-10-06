// Run gateway helpers: workflow-id builders, the approved-coordinator
// transition, cancel signaling, and status mapping.
import { randomUUID } from 'node:crypto'
import { appendEvent, type TransactableDb } from '../db/index.js'
import { CancelledFailure, WorkflowFailedError, WorkflowNotFoundError } from '@temporalio/client'
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
  type ApprovedCoordinatorHandle,
  type CancelHandle,
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
