// In-memory runs gateway for API contract tests. Mirrors the production
// gateway's decisions (404s, 409s, missed_steer, @name routing) without
// Temporal. Never imported by product code.
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  RunNotFound,
  ThreadNotAccepting,
  type CommandResult,
  type RunInfo,
  type RunsGateway,
  type SkillInvocation,
} from '../../backend/src/temporal/gateway.js'
import { getThread, listThreads } from '../../backend/src/db/index.js'

export class FakeRunsGateway implements RunsGateway {
  readonly signals: Array<{ workflowId: string; signal: string; args: unknown[] }> = []
  private runs = new Map<string, RunInfo>()
  private types = new Map<string, string>()
  /** Child workflow ids that closed; steers to them report missed_steer. */
  readonly closedChildren = new Set<string>()

  constructor(private readonly pool: Pool) {}

  addRun(run: RunInfo, workflowType = 'sessionRun'): void {
    this.runs.set(run.id, run)
    this.types.set(run.id, workflowType)
  }

  async listRuns(sessionId?: string): Promise<RunInfo[]> {
    const all = [...this.runs.values()]
    if (sessionId === undefined) return all
    return all.filter((run) => run.sessionId === sessionId || run.id === `session-run-${sessionId}`)
  }

  async getRun(runId: string): Promise<RunInfo | null> {
    return this.runs.get(runId) ?? null
  }

  async send(threadKey: string, text: string): Promise<CommandResult> {
    const target = await this.resolveTarget(threadKey, text, 'runSend')
    // Like production describe-then-signal: session targets need a live run.
    if (target.workflowId.startsWith('session-run-') && !this.runs.has(target.workflowId)) {
      throw new RunNotFound(`no such run ${target.workflowId}`)
    }
    this.signals.push({ workflowId: target.workflowId, signal: target.signal, args: [text] })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  readonly startedSweeps: string[] = []

  async startSectorSweep(sectorId: string): Promise<CommandResult> {
    this.startedSweeps.push(sectorId)
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  async sendSkill(threadKey: string, invocation: SkillInvocation): Promise<CommandResult> {
    const target = await this.resolveTarget(threadKey, invocation.text, 'runSend')
    if (target.workflowId.startsWith('session-run-') && !this.runs.has(target.workflowId)) {
      throw new RunNotFound(`no such run ${target.workflowId}`)
    }
    this.signals.push({
      workflowId: target.workflowId,
      signal: 'runSkill',
      args: [
        {
          prompt: invocation.prompt,
          tools: invocation.tools,
          text: invocation.text,
          ...(invocation.mode === undefined ? {} : { mode: invocation.mode }),
        },
      ],
    })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  async steer(threadKey: string, text: string): Promise<CommandResult> {
    const thread = await getThread(this.pool, threadKey)
    if (!thread) throw new RunNotFound(`no such thread ${threadKey}`)
    if (!thread.acceptingSteer) {
      if (thread.kind === 'subagent' && thread.status === 'FINISHED') {
        return { commandId: `cmd-${randomUUID()}`, state: 'missed_steer' }
      }
      throw new ThreadNotAccepting(`thread ${threadKey} is not accepting steer`)
    }
    const target = await this.resolveTarget(threadKey, text, 'runSteer')
    if (target.workflowId.startsWith('session-run-') && !this.runs.has(target.workflowId)) {
      throw new RunNotFound(`no such run ${target.workflowId}`)
    }
    this.signals.push({ workflowId: target.workflowId, signal: target.signal, args: [text] })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  async pauseRun(runId: string): Promise<CommandResult> {
    // Mirrors production requireType: research runs pause, guarded runs 409.
    const type = this.requireRun(runId)
    if (type !== 'sessionRun' && type !== 'researchRun') {
      throw new ThreadNotAccepting(`run ${runId} (${type}) has no path for this command`)
    }
    this.signals.push({ workflowId: runId, signal: 'runPause', args: [] })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  async resumeRun(runId: string, extendedBudgetMs?: number): Promise<CommandResult> {
    this.requireRun(runId)
    const args = extendedBudgetMs !== undefined ? [extendedBudgetMs] : []
    this.signals.push({ workflowId: runId, signal: 'runResume', args })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  /** Workflow ids that closed; mirrors production, where signalling a
   * closed handle reports the run gone instead of failing. */
  readonly closedRuns = new Set<string>()

  closeRun(runId: string): void {
    this.closedRuns.add(runId)
  }

  async cancelRun(runId: string): Promise<CommandResult> {
    // Mirrors production: only session runs cancel.
    const type = this.requireRun(runId)
    if (type !== 'sessionRun') {
      throw new ThreadNotAccepting(`run ${runId} (${type}) has no path for this command`)
    }
    if (this.closedRuns.has(runId)) throw new RunNotFound(`no such run ${runId}`)
    this.signals.push({ workflowId: runId, signal: 'runCancel', args: [] })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  private requireRun(runId: string): string {
    if (!this.runs.has(runId)) throw new RunNotFound(`no such run ${runId}`)
    return this.types.get(runId) ?? 'sessionRun'
  }

  private async resolveTarget(
    threadKey: string,
    text: string,
    sessionSignal: string,
  ): Promise<{ workflowId: string; signal: string }> {
    const thread = await getThread(this.pool, threadKey)
    if (!thread) throw new RunNotFound(`no such thread ${threadKey}`)
    if (thread.kind === 'subagent') {
      const childId = thread.key.replace(/^agent:/, '')
      if (this.closedChildren.has(childId)) throw new RunNotFound(`no such run ${childId}`)
      return { workflowId: childId, signal: 'childMessage' }
    }
    const children = await listThreads(this.pool, thread.sessionId)
    const lowered = text.toLowerCase()
    for (const child of children) {
      if (child.kind !== 'subagent') continue
      const name = childNameOf(child.messages)
      if (name && lowered.includes(`@${name.toLowerCase()}`)) {
        return { workflowId: child.key.replace(/^agent:/, ''), signal: 'childMessage' }
      }
    }
    return { workflowId: `session-run-${thread.sessionId}`, signal: sessionSignal }
  }
}

function childNameOf(messages: Array<{ payload: unknown }>): string | undefined {
  for (const message of messages) {
    const payload = message.payload as { launched?: string; name?: string }
    if (payload.launched === 'true' && typeof payload.name === 'string') return payload.name
  }
  return undefined
}
