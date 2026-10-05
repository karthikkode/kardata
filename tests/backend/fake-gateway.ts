// In-memory runs gateway for API contract tests. Mirrors the production
// gateway's decisions (404s, 409s, missed_steer, @name routing) without
// Temporal. Never imported by product code.
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { RunNotFound, SESSION_PREFIX, ThreadNotAccepting, type CommandResult, type RunInfo, type RunsGateway, type SkillInvocation } from '../../backend/src/temporal/runs-types.js'
import { getThread, listThreads, requireThread, setThreadPaused, WorkspaceError } from '../../backend/src/db/index.js'

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
    // Like production signalWithStart: a first session send starts the run.
    if (target.workflowId.startsWith('session-run-') && !this.runs.has(target.workflowId)) {
      const sessionId = target.workflowId.slice('session-run-'.length)
      this.addRun({ id: target.workflowId, sessionId, threadKey: sessionId, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: new Date().toISOString() })
    }
    this.signals.push({ workflowId: target.workflowId, signal: target.signal, args: [text] })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  readonly startedSweeps: string[] = []

  async startSectorSweep(sectorId: string): Promise<CommandResult> {
    this.startedSweeps.push(sectorId)
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  readonly startedPlans: string[] = []

  async startSectorPlan(sectorId: string): Promise<CommandResult> {
    this.startedPlans.push(sectorId)
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  readonly startedFileSummaries: Array<{ sectorId: string; fileId: string; hash: string }> = []

  async startContextFileSummary(sectorId: string, fileId: string, hash: string): Promise<CommandResult> {
    this.startedFileSummaries.push({ sectorId, fileId, hash })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  readonly cancelledFileSummaries: Array<{ sectorId: string; fileId: string; hash: string }> = []

  async cancelContextFileSummary(sectorId: string, fileId: string, hash: string): Promise<CommandResult> {
    this.cancelledFileSummaries.push({ sectorId, fileId, hash })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  readonly startedCompactions: Array<{ sectorId: string; reason: 'auto' | 'manual' }> = []

  async startContextCompaction(sectorId: string, reason: 'auto' | 'manual'): Promise<CommandResult> {
    this.startedCompactions.push({ sectorId, reason })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  /** Cancelled sweep ids; already-gone runs accept quietly like production. */
  readonly cancelledSweeps: string[] = []

  async cancelSectorSweep(sectorId: string): Promise<CommandResult> {
    this.cancelledSweeps.push(sectorId)
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  /** Delegated children in launch order. */
  readonly delegated: Array<{ sessionId: string; goal: string; mode: string; queueCapacity: number; name?: string }> = []

  /** Accept/goal order per child, mirroring production's split. */
  readonly delegationOrder: string[] = []

  /** Waiting inbox items per run workflow id. */
  readonly queues = new Map<string, Array<{ id: string; text: string; queuedAt: number }>>()

  seedQueue(runId: string, items: Array<{ id: string; text: string; queuedAt: number }>): void {
    this.queues.set(runId, items.map((item) => ({ ...item })))
  }

  private async queueRunId(threadKey: string): Promise<string> {
    const identity = await requireThread(this.pool, threadKey)
    return identity.thread.kind === 'subagent' ? threadKey.slice('agent:'.length) : `${SESSION_PREFIX}${identity.session.id}`
  }

  async listQueue(threadKey: string): Promise<Array<{ id: string; text: string; queuedAt: number }>> {
    const queue = this.queues.get(await this.queueRunId(threadKey))
    if (!queue) throw new RunNotFound(`no such run for thread ${threadKey}`)
    return queue.map((item) => ({ ...item }))
  }

  async removeQueued(threadKey: string, id: string): Promise<boolean> {
    const queue = this.queues.get(await this.queueRunId(threadKey))
    if (!queue) throw new RunNotFound(`no such run for thread ${threadKey}`)
    const at = queue.findIndex((item) => item.id === id)
    if (at < 0) return false
    queue.splice(at, 1)
    return true
  }

  async reorderQueue(threadKey: string, ids: string[]): Promise<void> {
    const queue = this.queues.get(await this.queueRunId(threadKey))
    if (!queue) throw new RunNotFound(`no such run for thread ${threadKey}`)
    const known = new Set(queue.map((item) => item.id))
    if (ids.length !== queue.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
      throw new WorkspaceError('validation_failed', 'Queue ids must exactly match the current queue.')
    }
    queue.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  }

  async delegateSubagent(input: { sessionId: string; goal: string; mode: string; queueCapacity: number; name?: string; onAccepted?: (childId: string) => Promise<void> }): Promise<{
    childId: string
    commandId: string
    queued: boolean
  }> {
    const childId = `child-fake-${this.delegated.length + 1}`
    const { onAccepted, ...recorded } = input
    this.delegated.push({ ...recorded })
    this.delegationOrder.push(`accepted:${childId}`)
    await onAccepted?.(childId)
    this.delegationOrder.push(`goal:${childId}`)
    return { childId, commandId: `cmd-${randomUUID()}`, queued: false }
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
    // Mirrors production requireType: session, research, subagent and company runs pause.
    const type = this.requireRun(runId)
    if (type !== 'sessionRun' && type !== 'researchRun' && type !== 'subagentRun' && type !== 'companyResearch') {
      throw new ThreadNotAccepting(`run ${runId} (${type}) has no path for this command`)
    }
    if (type === 'subagentRun' || type === 'companyResearch') {
      await setThreadPaused(this.pool, `agent:${runId}`, true)
      this.signals.push({ workflowId: runId, signal: 'childPause', args: [] })
      return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
    }
    this.signals.push({ workflowId: runId, signal: 'runPause', args: [] })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  async resumeRun(runId: string, extendedBudgetMs?: number): Promise<CommandResult> {
    // Mirrors production per-type resume signals.
    const type = this.requireRun(runId)
    const args = extendedBudgetMs !== undefined ? [extendedBudgetMs] : []
    if (type === 'subagentRun' || type === 'companyResearch') {
      if (type === 'subagentRun') await setThreadPaused(this.pool, `agent:${runId}`, false)
      this.signals.push({ workflowId: runId, signal: 'childResume', args })
      return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
    }
    this.signals.push({ workflowId: runId, signal: type === 'researchRun' ? 'researchResume' : 'runResume', args })
    return { commandId: `cmd-${randomUUID()}`, state: 'accepted' }
  }

  /** Workflow ids that closed; mirrors production, where signalling a
   * closed handle reports the run gone instead of failing. */
  readonly closedRuns = new Set<string>()

  closeRun(runId: string): void {
    this.closedRuns.add(runId)
  }

  async cancelRun(runId: string): Promise<CommandResult> {
    // Mirrors production: session, subagent and company runs cancel (any
    // other type 409s); a company cancel is a handle cancel, recorded here
    // as the 'cancel' signal for observability.
    const type = this.requireRun(runId)
    if (type !== 'sessionRun' && type !== 'subagentRun' && type !== 'companyResearch') {
      throw new ThreadNotAccepting(`run ${runId} (${type}) has no path for this command`)
    }
    if (this.closedRuns.has(runId)) throw new RunNotFound(`no such run ${runId}`)
    if (type === 'companyResearch') this.signals.push({ workflowId: runId, signal: 'cancel', args: [] })
    else if (type === 'subagentRun') {
      this.signals.push({ workflowId: runId, signal: 'childCancel', args: [] })
      this.signals.push({ workflowId: runId, signal: 'childFinish', args: [] })
    } else this.signals.push({ workflowId: runId, signal: 'runCancel', args: [] })
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
