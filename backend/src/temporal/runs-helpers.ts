// Run gateway helpers: workflow-id builders, the approved-coordinator
// transition, cancel signaling, and status mapping.
import { randomUUID } from 'node:crypto'
import { CancelledFailure, WorkflowFailedError, WorkflowNotFoundError } from '@temporalio/client'
import { laneConfig } from './lanes.js'
import { createLogger, logOp } from '../observability/logging.js'
import {
  RunNotFound,
  SESSION_PREFIX,
  SESSION_WORKFLOW_TYPE,
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
export function buildSessionSignalStart(
  sessionId: string,
  text: string,
  signal: 'runSend' | 'runSteer',
): SessionSignalStart {
  return {
    workflowType: SESSION_WORKFLOW_TYPE,
    workflowId: `${SESSION_PREFIX}${sessionId}`,
    taskQueue: laneConfig('turn').taskQueue,
    signal,
    signalArgs: [text],
    args: [{ sessionId }],
  }
}

export function commandId(): string {
  return `cmd-${randomUUID()}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
