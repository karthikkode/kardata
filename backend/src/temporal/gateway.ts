// Runs gateway: HTTP commands and run reads over Temporal workflows. B3.1.
// One interface; the Temporal implementation below is production, tests
// inject a fake (tests/backend/fake-gateway.ts — never imported by product
// code). Reads that need thread state assume the request path already ran
// the projector; the gateway never projects.
//
// Addressing: runId is the Temporal workflow id. Session runs use
// `session-run-<sessionId>`; research and guarded runs are self-scoped
// (sessionId = runId, threadKey = `research:<runId>`). Child workflows are
// addressed by child id (`agent:<childId>` threads).
import { randomUUID } from 'node:crypto'
import {
  findLaunchParentWorkflowId,
  type TransactableDb,
} from '../db/index.js'
import {
  Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
  type WorkflowExecutionDescription,
  type Connection,
} from '@temporalio/client'
import { connectClient } from './connection.js'
import { laneConfig } from './lanes.js'
import { projectNewEvents } from '../projector.js'
import { getThread, listThreads } from '../db/index.js'

export type RunState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'SUSPENDED' | 'CANCELLING' | 'FINISHED' | 'ERROR'

export interface RunInfo {
  id: string
  sessionId: string
  threadKey: string
  state: RunState
  stageCursor?: string
  /** 0 until B5.x wires ledger/telemetry ratios; never a measured value. */
  budgetUsedRatio: number
  contextUsedRatio: number
  updatedAt: string
}

export interface CommandResult {
  commandId: string
  state: 'accepted' | 'missed_steer'
}

/** No such run or thread. Routes answer 404. */
export class RunNotFound extends Error {}

/** Thread exists but cannot take steer right now. Routes answer 409. */
export class ThreadNotAccepting extends Error {}

/** Resolved skill invocation: prompt and tool grant travel with the text
 * so the workflow needs no skill-registry import (workflows never import
 * the agents barrel, which pulls node:http). */
export interface SkillInvocation {
  name: string
  prompt: string
  tools: string[]
  text: string
  mode?: 'default' | 'brainstorm'
}

export interface RunsGateway {
  listRuns(sessionId?: string): Promise<RunInfo[]>
  getRun(runId: string): Promise<RunInfo | null>
  send(threadKey: string, text: string): Promise<CommandResult>
  sendSkill(threadKey: string, invocation: SkillInvocation): Promise<CommandResult>
  startSectorSweep(sectorId: string, scope?: { tenantId: string; projectId: string | null }): Promise<CommandResult>
  steer(threadKey: string, text: string): Promise<CommandResult>
  pauseRun(runId: string): Promise<CommandResult>
  resumeRun(runId: string, extendedBudgetMs?: number): Promise<CommandResult>
  cancelRun(runId: string): Promise<CommandResult>
}

export const SESSION_PREFIX = 'session-run-'

/** Minimal handle surface cancelRun needs: signalling a run. */
export interface CancelHandle {
  signal(signal: 'runCancel'): Promise<void>
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

/** Workflow type name of the session-run workflow (workflows/run.ts). The
 * gateway addresses it by string name so client code never bundles
 * workflow code. */
export const SESSION_WORKFLOW_TYPE = 'sessionRun'

export interface SessionSignalStart {
  workflowType: typeof SESSION_WORKFLOW_TYPE
  workflowId: string
  taskQueue: string
  signal: 'runSend' | 'runSteer'
  signalArgs: [string]
  args: [{ sessionId: string }]
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

function commandId(): string {
  return `cmd-${randomUUID()}`
}

function closeState(statusName: string): RunState {
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

export class TemporalRunsGateway implements RunsGateway {
  private clientPromise: Promise<Client> | undefined

  constructor(
    private readonly pool: TransactableDb,
    private readonly connection?: Connection,
  ) {}

  private client(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const connection = this.connection ?? (await connectClient())
        return new Client({ connection })
      })()
    }
    return this.clientPromise
  }

  async listRuns(sessionId?: string): Promise<RunInfo[]> {
    const client = await this.client()
    const runs: RunInfo[] = []
    // Summary-level on purpose: state comes from describe only, no per-run
    // queries. Detail (cursor, precise pause/suspend) is getRun's job.
    const executions = client.workflow.list({ pageSize: 100 })
    for await (const execution of executions) {
      const type = execution.type
      if (type !== 'sessionRun' && type !== 'researchRun' && type !== 'guardedResearchRun') continue
      let info: RunInfo
      try {
        const description = await client.workflow.getHandle(execution.workflowId).describe()
        info = this.describeRun(execution.workflowId, type, description)
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) continue
        throw error
      }
      if (sessionId !== undefined) {
        if (info.sessionId !== sessionId && info.id !== `${SESSION_PREFIX}${sessionId}`) continue
      }
      runs.push(info)
    }
    return runs
  }

  async getRun(runId: string): Promise<RunInfo | null> {
    const client = await this.client()
    const handle = client.workflow.getHandle(runId)
    let description: WorkflowExecutionDescription
    try {
      description = await handle.describe()
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return null
      throw error
    }
    const type = description.type
    if (description.status.name === 'RUNNING') {
      try {
        if (type === 'sessionRun') {
          const state = (await handle.query('runState')) as { state: RunState; sessionId: string }
          return {
            id: runId,
            sessionId: state.sessionId,
            threadKey: state.sessionId,
            state: state.state,
            budgetUsedRatio: 0,
            contextUsedRatio: 0,
            // Running workflows expose no close time: last-observed-at.
            updatedAt: new Date().toISOString(),
          }
        }
        if (type === 'researchRun') {
          const state = (await handle.query('researchState')) as {
            runId: string
            status: string
            cursor: number
          }
          return {
            id: runId,
            sessionId: state.runId,
            threadKey: `research:${state.runId}`,
            state: mapResearchStatus(state.status),
            stageCursor: String(state.cursor),
            budgetUsedRatio: 0,
            contextUsedRatio: 0,
            // Running workflows expose no close time: last-observed-at.
            updatedAt: new Date().toISOString(),
          }
        }
        if (type === 'guardedResearchRun') {
          const state = (await handle.query('guardState')) as {
            runId: string
            status: RunState
            cursor: number
          }
          return {
            id: runId,
            sessionId: state.runId,
            threadKey: `research:${state.runId}`,
            state: state.status,
            stageCursor: String(state.cursor),
            budgetUsedRatio: 0,
            contextUsedRatio: 0,
            // Running workflows expose no close time: last-observed-at.
            updatedAt: new Date().toISOString(),
          }
        }
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) throw error
        // Closed between describe and query: fall through to close mapping.
        description = await handle.describe()
      }
    }
    return this.describeRun(runId, type, description)
  }

  async send(threadKey: string, text: string): Promise<CommandResult> {
    const target = await this.resolveTarget(threadKey, text, 'runSend')
    await this.signalTarget(target)
    return { commandId: commandId(), state: 'accepted' }
  }

  /** Sector sweep start: one workflow per sector, idempotent by
   * workflow id — a running sweep for this sector is accepted, not
   * duplicated. State flips (draft -> queued -> running) stay in the
   * event log; this only owns the workflow lifecycle. */
  async startSectorSweep(sectorId: string, scope?: { tenantId: string; projectId: string | null }): Promise<CommandResult> {
    const client = await this.client()
    try {
      await client.workflow.start('sectorSweep', {
        workflowId: `sector-sweep-${sectorId}`,
        taskQueue: laneConfig('research').taskQueue,
        args: [{ sectorId, ...(scope === undefined ? {} : { scope }) }],
      })
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        return { commandId: commandId(), state: 'accepted' }
      }
      throw error
    }
    return { commandId: commandId(), state: 'accepted' }
  }

  /** Skill invocation: same targeting as send, but the runSkill signal
   * carries the resolved prompt and tool grant. Skills address session
   * runs only — child threads keep the plain message path. */
  async sendSkill(threadKey: string, invocation: SkillInvocation): Promise<CommandResult> {
    const target = await this.resolveTarget(threadKey, invocation.text, 'runSend')
    if (!target.sessionId) {
      throw new ThreadNotAccepting(`skill /${invocation.name} runs on session threads, not ${threadKey}`)
    }
    const client = await this.client()
    const signalArgs = [
      {
        prompt: invocation.prompt,
        tools: invocation.tools,
        text: invocation.text,
        ...(invocation.mode === undefined ? {} : { mode: invocation.mode }),
      },
    ]
    try {
      await client.workflow.signalWithStart(SESSION_WORKFLOW_TYPE, {
        workflowId: `${SESSION_PREFIX}${target.sessionId}`,
        taskQueue: laneConfig('turn').taskQueue,
        signal: 'runSkill',
        signalArgs,
        args: [{ sessionId: target.sessionId }],
      })
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${threadKey}`)
      throw error
    }
    return { commandId: commandId(), state: 'accepted' }
  }

  async steer(threadKey: string, text: string): Promise<CommandResult> {
    await projectNewEvents(this.pool)
    const thread = await getThread(this.pool, threadKey)
    if (!thread) throw new RunNotFound(`no such thread ${threadKey}`)
    if (!thread.acceptingSteer) {
      // Finished children record the steer instead of relaunching; anything
      // else that cannot take steer is a conflict the caller resolves.
      if (thread.kind === 'subagent' && thread.status === 'FINISHED') {
        return this.recordMissedSteer(threadKey, text)
      }
      throw new ThreadNotAccepting(`thread ${threadKey} is not accepting steer`)
    }
    const target = await this.resolveTarget(threadKey, text, 'runSteer')
    await this.signalTarget(target)
    return { commandId: commandId(), state: 'accepted' }
  }

  async pauseRun(runId: string): Promise<CommandResult> {
    // Guarded runs have no pause signal by design: the loop/unit/run guards
    // suspend them, and resumeRun (approved guardResume) is the way back.
    const type = await this.requireType(runId, ['sessionRun', 'researchRun'])
    const client = await this.client()
    await client.workflow.getHandle(runId).signal(type === 'sessionRun' ? 'runPause' : 'researchPause')
    return { commandId: commandId(), state: 'accepted' }
  }

  async resumeRun(runId: string, extendedBudgetMs?: number): Promise<CommandResult> {
    const type = await this.requireType(runId, ['sessionRun', 'researchRun', 'guardedResearchRun'])
    const client = await this.client()
    const handle = client.workflow.getHandle(runId)
    if (type === 'sessionRun') await handle.signal('runResume')
    else if (type === 'researchRun') await handle.signal('researchResume')
    else await handle.signal('guardResume', { approved: true, extendRunMs: extendedBudgetMs })
    return { commandId: commandId(), state: 'accepted' }
  }

  async cancelRun(runId: string): Promise<CommandResult> {
    await this.requireType(runId, ['sessionRun'])
    const client = await this.client()
    await signalRunCancel(client.workflow.getHandle(runId), runId)
    return { commandId: commandId(), state: 'accepted' }
  }

  private describeRun(
    runId: string,
    type: string,
    description: Pick<WorkflowExecutionDescription, 'status' | 'startTime' | 'closeTime'>,
  ): RunInfo {
    const status = description.status.name
    const updatedAt = description.closeTime ?? description.startTime
    if (type === 'sessionRun') {
      const sessionId = runId.startsWith(SESSION_PREFIX) ? runId.slice(SESSION_PREFIX.length) : runId
      return {
        id: runId,
        sessionId,
        threadKey: sessionId,
        state: status === 'RUNNING' ? 'RUNNING' : closeState(status),
        budgetUsedRatio: 0,
        contextUsedRatio: 0,
        updatedAt: updatedAt.toISOString(),
      }
    }
    return {
      id: runId,
      sessionId: runId,
      threadKey: `research:${runId}`,
      state: status === 'RUNNING' ? 'RUNNING' : closeState(status),
      budgetUsedRatio: 0,
      contextUsedRatio: 0,
      updatedAt: updatedAt.toISOString(),
    }
  }

  private async requireType(runId: string, allowed: string[]): Promise<string> {
    const client = await this.client()
    let description: WorkflowExecutionDescription
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

  /** Session text with @name goes to that subagent's thread; anything else
   * stays on the addressed thread. Unknown threads are 404. */
  private async resolveTarget(
    threadKey: string,
    text: string,
    sessionSignal: 'runSend' | 'runSteer',
  ): Promise<{ workflowId: string; signal: string; args: [string]; sessionId?: string }> {
    // Commands resolve threads, so they project like reads do.
    await projectNewEvents(this.pool)
    const thread = await getThread(this.pool, threadKey)
    if (!thread) throw new RunNotFound(`no such thread ${threadKey}`)
    if (thread.kind === 'subagent') {
      return { workflowId: thread.key.replace(/^agent:/, ''), signal: 'childMessage', args: [text] }
    }
    const children = await listThreads(this.pool, thread.sessionId)
    const lowered = text.toLowerCase()
    for (const child of children) {
      if (child.kind !== 'subagent') continue
      const name = childNameOf(child.messages)
      if (name && lowered.includes(`@${name.toLowerCase()}`)) {
        return { workflowId: child.key.replace(/^agent:/, ''), signal: 'childMessage', args: [text] }
      }
    }
    return {
      workflowId: `${SESSION_PREFIX}${thread.sessionId}`,
      signal: sessionSignal,
      args: [text],
      sessionId: thread.sessionId,
    }
  }

  private async signalTarget(target: {
    workflowId: string
    signal: string
    args: [string]
    sessionId?: string
  }): Promise<void> {
    const client = await this.client()
    // Session threads start their workflow on first send: absent workflows
    // start instead of 404ing, running ones just get the signal. Child
    // targets keep the strict signal — their parent must already exist.
    if (target.sessionId && (target.signal === 'runSend' || target.signal === 'runSteer')) {
      const start = buildSessionSignalStart(target.sessionId, target.args[0] ?? '', target.signal)
      await client.workflow.signalWithStart(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: start.taskQueue,
        signal: start.signal,
        signalArgs: start.signalArgs,
        args: start.args,
      })
      return
    }
    try {
      await client.workflow.getHandle(target.workflowId).signal(target.signal, ...target.args)
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${target.workflowId}`)
      throw error
    }
  }

  /** A finished child's steer rides the parent's parentSteer path (resolved
   * through the launch isolation record) and reports missed_steer. */
  private async recordMissedSteer(threadKey: string, text: string): Promise<CommandResult> {
    const childId = threadKey.replace(/^agent:/, '')
    const parentWorkflowId = await findLaunchParentWorkflowId(this.pool, childId)
    if (!parentWorkflowId) throw new RunNotFound(`no addressable run for ${threadKey}`)
    const client = await this.client()
    try {
      await client.workflow.getHandle(parentWorkflowId).signal('parentSteer', { childId, text })
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${parentWorkflowId}`)
      throw error
    }
    return { commandId: commandId(), state: 'missed_steer' }
  }
}

function mapResearchStatus(status: string): RunState {
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

function childNameOf(messages: Array<{ payload: unknown }>): string | undefined {
  for (const message of messages) {
    const payload = message.payload as { launched?: string; name?: string }
    if (payload.launched === 'true' && typeof payload.name === 'string') return payload.name
  }
  return undefined
}
