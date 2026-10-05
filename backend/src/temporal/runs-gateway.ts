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
  enqueueSteering,
  readSectorPlan,
  appendEvent,
  reserveExecutionIntent,confirmExecutionIntent,markExecutionIntent,
  type TransactableDb,
  reserveFileProcessingDispatch, markFileProcessingDispatchOutcome, readFileProcessingJob,
} from '../db/index.js'
import {
  Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
  type WorkflowExecutionDescription,
  type Connection,
} from '@temporalio/client'
import { connectClient,temporalNamespace } from './connection.js'
import { laneConfig } from './lanes.js'
import { createLogger, logOp } from '../observability/logging.js'
import { projectNewEvents } from '../projector.js'
import { loadOriginalTurnRecovery } from './turn-recovery.js'
import { defaultPayloadConverter } from '@temporalio/common'
import { getThread, listThreads, listThreadHeaders, requireThread, setThreadPaused, WorkspaceError } from '../db/index.js'

import {
  buildSessionSignalStart,
  childNameOf,
  closeState,
  commandId,
  contextCompactionWorkflowId,
  delegationWorkflowId,
  ensureApprovedCoordinator,
  mapResearchStatus,
  signalRunCancel,
  sleep,
} from './runs-helpers.js'
import {
  SESSION_PREFIX,
  SESSION_WORKFLOW_TYPE,
  RunNotFound,
  ThreadNotAccepting,
  type CommandResult,
  type DelegateSubagentInput,
  type DelegatedChild,
  type RunInfo,
  type RunState,
  type RunsGateway,
  type SkillInvocation,
} from './runs-types.js'

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
        return new Client({ connection,namespace: temporalNamespace() })
      })()
    }
    return this.clientPromise
  }

  async startFileProcessing(jobId: string, revision: number): Promise<void> {
    if (!/^fjob-[a-f0-9]{48}$/.test(jobId) || !Number.isInteger(revision) || revision < 0) throw new TypeError('Invalid file processing admission.')
    await logOp(createLogger({ op: 'file.processing.dispatch' }), 'file.processing.dispatch', async () => {
      const job = await readFileProcessingJob(this.pool, jobId)
      if (job.revision !== revision) throw new Error('A newer file revision owns admission.')
      if (job.state === 'complete') return
      const reservation = await reserveFileProcessingDispatch(this.pool, jobId, revision)
      if (!reservation.nonce || !reservation.workflowId) {
        throw new Error('File admission has no durable reservation identity.')
      }
      const nonce = reservation.nonce, workflowId = reservation.workflowId
      const client = await this.client()
      try {
        if (reservation.ownsReservation) {
          const handle = await client.connection.withDeadline(Date.now() + 2_000, () => client.workflow.start('fileProcessing', {
            workflowId, taskQueue: laneConfig('research').taskQueue,
            args: [{ jobId, revision, dispatchNonce: nonce }],
          }))
          await markFileProcessingDispatchOutcome(this.pool, { jobId, revision, nonce, workflowId, outcome: 'confirmed', executionId: handle.firstExecutionRunId })
          return
        }
        const handle = client.workflow.getHandle(workflowId)
        const description = await client.connection.withDeadline(Date.now() + 2_000, () => handle.describe())
        if (description.type !== 'fileProcessing') throw new Error('File execution type does not match its reserved owner.')
        const history = await client.connection.withDeadline(Date.now() + 2_000, () => client.connection.workflowService.getWorkflowExecutionHistory({ namespace: client.options.namespace, execution: { workflowId, runId: description.runId }, maximumPageSize: 20 }))
        if (Buffer.byteLength(JSON.stringify(history.history)) > 1_048_576) throw new Error('File admission history exceeds its bounded inspection budget.')
        const started = history.history?.events?.find((event) => event.workflowExecutionStartedEventAttributes)?.workflowExecutionStartedEventAttributes
        const payloads = started?.input?.payloads
        const args = payloads ? await defaultPayloadConverter.fromPayload(payloads[0]!) as { jobId?: string; revision?: number; dispatchNonce?: string } : null
        if (!args || args.jobId !== jobId || args.revision !== revision || args.dispatchNonce !== reservation.nonce) throw new Error('File execution input does not match its reserved owner.')
        await markFileProcessingDispatchOutcome(this.pool, { jobId, revision, nonce, workflowId, outcome: 'confirmed', executionId: description.runId })
      } catch (error) {
        await markFileProcessingDispatchOutcome(this.pool, { jobId, revision, nonce, workflowId, outcome: 'uncertain' })
        throw new Error('File dispatch outcome requires durable owner inspection.', { cause: error })
      }
    }, { jobId, revision })
  }

  async listRuns(sessionId?: string): Promise<RunInfo[]> {
    const client = await this.client()
    const runs: RunInfo[] = []
    if (sessionId !== undefined) {
      // A session directory is bounded by its own recorded graph. Describing
      // unrelated histories makes chat loading scale with the entire fleet.
      const headers = await listThreadHeaders(this.pool, sessionId)
      const children = new Map(headers.filter((thread) => thread.kind === 'subagent').map((thread) => [thread.key.replace(/^agent:/, ''), thread]))
      const candidates = new Set([`${SESSION_PREFIX}${sessionId}`, sessionId, ...children.keys()])
      for (const id of candidates) {
        try {
          const description = await client.workflow.getHandle(id).describe()
          if (!['sessionRun', 'researchRun', 'companyResearch', 'subagentRun'].includes(description.type)) continue
          let info = this.describeRun(id, description.type, description)
          if (description.type === 'companyResearch' || description.type === 'subagentRun') {
            const child = children.get(id)
            if (!child) continue
            info = { ...info, sessionId: child.sessionId, threadKey: child.key, state: child.status === 'PAUSED' ? 'PAUSED' : info.state }
          }
          runs.push(info)
        } catch (error) { if (!(error instanceof WorkflowNotFoundError)) throw error }
      }
      return runs
    }
    // Summary-level on purpose: state comes from describe only, no per-run
    // queries. Detail (cursor, precise pause/suspend) is getRun's job.
    const executions = client.workflow.list({ pageSize: 100 })
    for await (const execution of executions) {
      const type = execution.type
      if (type !== 'sessionRun' && type !== 'researchRun' && type !== 'companyResearch' && type !== 'subagentRun') continue
      let info: RunInfo
      try {
        const description = await client.workflow.getHandle(execution.workflowId).describe()
        info = this.describeRun(execution.workflowId, type, description)
        if (type === 'companyResearch' || type === 'subagentRun') {
          const child = await getThread(this.pool, `agent:${execution.workflowId}`)
          if (!child) continue
          info = { ...info, sessionId: child.sessionId, threadKey: child.key, state: child.status === 'PAUSED' ? 'PAUSED' : info.state }
        }
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
    if (type === 'companyResearch' || type === 'subagentRun') {
      const thread = await getThread(this.pool, `agent:${runId}`)
      if (!thread) return null
      return { id: runId, sessionId: thread.sessionId, threadKey: thread.key, state: description.status.name === 'RUNNING' ? 'RUNNING' : closeState(description.status.name), budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: thread.updatedAt }
    }
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
    if (!target.sessionId) {
      const child = await getThread(this.pool, `agent:${target.workflowId}`)
      if (child?.status === 'FINISHED' || child?.status === 'ERROR') return this.recordMissedSteer(child.key, text)
    }
    await this.signalTarget(target)
    return { commandId: commandId(), state: 'accepted' }
  }

  /** Sector sweep start: one workflow per sector, idempotent by
   * workflow id — a running sweep for this sector is accepted, not
   * duplicated. State flips (draft -> queued -> running) stay in the
   * event log; this only owns the workflow lifecycle. */
  async startSectorSweep(sectorId: string, scope?: { tenantId: string; projectId: string | null }): Promise<CommandResult> {
    const client = await this.client()
    const plan = await readSectorPlan(this.pool, sectorId, scope)
    const approved = plan?.versions.find((entry) => entry.version === plan.approvedVersion)
    const start = () => client.workflow.start(approved?.executable ? 'sectorCoordinator' : 'sectorSweep', {
        workflowId: `sector-sweep-${sectorId}`,
        taskQueue: laneConfig('research').taskQueue,
        args: [{ sectorId,ownerEpochProtocol: true, ...(scope === undefined ? {} : { scope }) }],
      })
    try {
      await start()
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        const handle = client.workflow.getHandle(`sector-sweep-${sectorId}`)
        if ((await handle.describe()).type === 'sectorCoordinator' && approved) await ensureApprovedCoordinator(handle, approved.version, start)
        return { commandId: commandId(), state: 'accepted' }
      }
      throw error
    }
    return { commandId: commandId(), state: 'accepted' }
  }

  /** Sector sweep halt: cancelling the workflow stops the run; the pause
   * route records the state separately, so a gone run is accepted, never
   * an error. Mirrors signalRunCancel's closed-handle mapping. */
  async cancelSectorSweep(sectorId: string): Promise<CommandResult> {
    const client = await this.client()
    try {
      const handle = client.workflow.getHandle(`sector-sweep-${sectorId}`)
      if ((await handle.describe()).type === 'sectorCoordinator') await handle.signal('coordinatorPause')
      else await handle.cancel()
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return { commandId: commandId(), state: 'accepted' }
      throw error
    }
    return { commandId: commandId(), state: 'accepted' }
  }

  /** Delegation door: signal-with-start the session's parent (first
   * delegation creates it), wait for the child to start, then feed the
   * goal as its first work item — a launched child with an empty inbox
   * would idle forever. The child id is caller-generated — workflows
   * never mint ids — so the caller learns it synchronously for
   * collect/steer. Depth 0 and maxDepth 0 keep pilot children leaf
   * researchers. */
  async delegateSubagent(input: DelegateSubagentInput): Promise<DelegatedChild> {
    const childId = `child-${randomUUID()}`
    const client = await this.client()
    await client.workflow.signalWithStart('delegateParent', {
      workflowId: delegationWorkflowId(input.sessionId),
      taskQueue: input.taskQueue ?? laneConfig('turn').taskQueue,
      signal: 'parentDelegate',
      signalArgs: [
        {
          childId,
          goal: input.goal,
          ...(input.name === undefined ? {} : { name: input.name }),
          depth: 0,
          mode: input.mode,
          maxDepth: 0,
          queueCapacity: input.queueCapacity,
          ...(input.fakeSteps === undefined ? {} : { fakeSteps: input.fakeSteps }),
        },
      ],
      args: [{ sessionId: input.sessionId,ownerEpochProtocol: true }],
    })
    // The parent starts the child asynchronously (duplicate ids and a
    // full fan-out reject instead of starting): poll its state, then feed
    // the goal. A rejection surfaces here as a timeout, never a silent
    // idle child.
    const parent = client.workflow.getHandle(delegationWorkflowId(input.sessionId))
    const deadline = Date.now() + 30_000
    for (;;) {
      try {
        const state = (await parent.query('parentState')) as {
          children: Array<{ childId: string }>
        }
        if (state.children.some((child) => child.childId === childId)) break
      } catch {
        // Parent not yet picked up: keep polling until the deadline.
      }
      if (Date.now() > deadline) {
        throw new Error(
          `delegation ${childId} not accepted (duplicate id or max in-flight children reached?)`,
        )
      }
      await sleep(500)
    }
    await input.onAccepted?.(childId)
    await client.workflow.getHandle(childId).signal('childMessage', input.goal)
    return { childId, commandId: commandId() }
  }

  /** Sector plan start: one workflow per sector, idempotent by
   * workflow id — a planning run for this sector is accepted, not
   * duplicated. The planning chat session rides along: turns run there
   * visibly. Mirrors startSectorSweep. */
  async startSectorPlan(
    sectorId: string,
    scope?: { tenantId: string; projectId: string | null },
    sessionId?: string,
  ): Promise<CommandResult> {
    if (!sessionId) throw new Error('startSectorPlan needs the planning chat sessionId')
    const client = await this.client()
    await this.startWithEpoch(sessionId,sessionId,`sector-plan-${sectorId}`,async (ownerEpoch) => {
      try { return await client.workflow.start('sectorPlan', {
        workflowId: `sector-plan-${sectorId}`,
        taskQueue: laneConfig('research').taskQueue,
        args: [{ sectorId, sessionId,ownerEpoch, ...(scope === undefined ? {} : { scope }) }],
      })
      } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        return client.workflow.getHandle(`sector-plan-${sectorId}`)
      }
      throw error
      }
    })
    return { commandId: commandId(), state: 'accepted' }
  }

  /** Context file summary: one workflow per sector, file and content
   * hash. A re-add while summarizing reuses the running workflow; a
   * retry after the file changed starts a new hash-suffixed workflow. */
  async startContextFileSummary(sectorId: string, fileId: string, hash: string): Promise<CommandResult> {
    const client = await this.client()
    const workflowId = `context-file-${sectorId}-${fileId}-${hash.slice(0, 8)}`
    try {
      await client.workflow.start('contextFileSummary', {
        workflowId,
        taskQueue: laneConfig('research').taskQueue,
        args: [{ sectorId, fileId, hash }],
      })
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return { commandId: commandId(), state: 'accepted' }
      throw error
    }
    return { commandId: commandId(), state: 'accepted' }
  }

  async cancelContextFileSummary(sectorId: string, fileId: string, hash: string): Promise<CommandResult> {
    const client = await this.client()
    const handle = client.workflow.getHandle(`context-file-${sectorId}-${fileId}-${hash.slice(0, 8)}`)
    try {
      await handle.cancel()
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return { commandId: commandId(), state: 'accepted' }
      throw error
    }
    return { commandId: commandId(), state: 'accepted' }
  }

  async startContextCompaction(sectorId: string, reason: 'auto' | 'manual'): Promise<CommandResult> {
    const client = await this.client()
    try {
      await client.workflow.start('globalContextCompaction', {
        workflowId: contextCompactionWorkflowId(sectorId),
        taskQueue: laneConfig('research').taskQueue,
        args: [{ sectorId, reason }],
      })
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return { commandId: commandId(), state: 'accepted' }
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
      await this.startWithEpoch(target.sessionId,target.sessionId,`${SESSION_PREFIX}${target.sessionId}`,(ownerEpoch) => client.workflow.signalWithStart(SESSION_WORKFLOW_TYPE, {
        workflowId: `${SESSION_PREFIX}${target.sessionId}`,
        taskQueue: laneConfig('turn').taskQueue,
        signal: 'runSkill',
        signalArgs,
        args: [{ sessionId: target.sessionId,ownerEpoch }],
      }))
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
    const id = commandId()
    const instruction = await enqueueSteering(this.pool, threadKey, text, id)
    return { commandId: id, state: instruction.state === 'missed' ? 'missed_steer' : 'accepted' }
  }

  async pauseRun(runId: string): Promise<CommandResult> {
    // Only pausable types are listed: other runs (e.g. companyResearch) 409 via requireType.
    const type = await this.requireType(runId, ['sessionRun', 'researchRun', 'subagentRun'])
    const client = await this.client()
    if (type === 'subagentRun') {
      await setThreadPaused(this.pool, `agent:${runId}`, true)
      await client.workflow.getHandle(runId).signal('childPause')
      return { commandId: commandId(), state: 'accepted' }
    }
    await client.workflow.getHandle(runId).signal(type === 'sessionRun' ? 'runPause' : 'researchPause')
    return { commandId: commandId(), state: 'accepted' }
  }

  // _extendedBudgetMs is kept for API compatibility (OpenAPI/commands route);
  // no remaining run type consumes it since the guarded workflow was deleted.
  async resumeRun(runId: string, _extendedBudgetMs?: number): Promise<CommandResult> {
    const type = await this.requireType(runId, ['sessionRun', 'researchRun', 'companyResearch', 'subagentRun'])
    const client = await this.client()
    const handle = client.workflow.getHandle(runId)
    const description=await handle.describe()
    if (description.status.name!=='RUNNING') {
      if (type==='sessionRun') {
        const sessionId=runId.slice(SESSION_PREFIX.length)
        const recovery=await loadOriginalTurnRecovery(this.pool,client,sessionId)
        await this.startWithEpoch(sessionId,sessionId,runId,(ownerEpoch) => client.workflow.start('sessionRun',{ workflowId: runId,taskQueue: laneConfig('turn').taskQueue,args: [{ sessionId,ownerEpoch,recovery }] }))
        return { commandId: commandId(),state: 'accepted' }
      }
      if (type==='subagentRun') {
        const thread=await getThread(this.pool,`agent:${runId}`)
        if (!thread) throw new RunNotFound('The stopped child has no scoped conversation.')
        const recovery=await loadOriginalTurnRecovery(this.pool,client,thread.key)
        const started=await client.connection.withDeadline(Date.now()+5_000,() => client.connection.workflowService.getWorkflowExecutionHistory({ namespace: client.options.namespace,execution: { workflowId: runId,runId: description.runId },maximumPageSize: 1 }))
        if (Buffer.byteLength(JSON.stringify(started.history))>1024*1024) throw new ThreadNotAccepting('The original child contract exceeds the recovery limit.')
        const attrs=started.history?.events?.[0]?.workflowExecutionStartedEventAttributes
        const payload=attrs?.input?.payloads?.[0]
        const original=payload ? defaultPayloadConverter.fromPayload<Record<string,unknown>>(payload) : undefined
        if (!original || original['childId']!==runId || original['parentSessionId']!==thread.sessionId || attrs?.parentWorkflowExecution?.workflowId!==delegationWorkflowId(thread.sessionId)) throw new ThreadNotAccepting('The child lacks a validated parent contract. Review its parent before restarting.')
        await client.workflow.signalWithStart('delegateParent',{ workflowId: delegationWorkflowId(thread.sessionId),taskQueue: laneConfig('turn').taskQueue,signal: 'parentRecover',signalArgs: [{ ...original,recovery }],args: [{ sessionId: thread.sessionId,ownerEpochProtocol: true }] })
        return { commandId: commandId(),state: 'accepted' }
      }
      if (type==='companyResearch') throw new ThreadNotAccepting('Resume the approved sector research to retry this stopped child with its original checkpoint. Its evidence is retained.')
      throw new ThreadNotAccepting('This legacy stopped workflow has no verified original-turn recovery contract. Review its retained work before restarting.')
    }
    if (type === 'sessionRun') await handle.signal('runResume')
    else if (type === 'researchRun') await handle.signal('researchResume')
    else if (type === 'subagentRun') {
      await setThreadPaused(this.pool, `agent:${runId}`, false)
      await handle.signal('childResume')
    } else if (type === 'companyResearch') await handle.signal('childResume')
    else throw new ThreadNotAccepting(`run ${runId} (${type}) has no path for this command`)
    return { commandId: commandId(), state: 'accepted' }
  }

  async cancelRun(runId: string): Promise<CommandResult> {
    const type = await this.requireType(runId, ['sessionRun','subagentRun','companyResearch'])
    const client = await this.client()
    const handle = client.workflow.getHandle(runId)
    if (type === 'companyResearch') await handle.cancel()
    else if (type === 'subagentRun') { await handle.signal('childCancel'); await handle.signal('childFinish') }
    else await signalRunCancel(handle, runId)
    return { commandId: commandId(), state: 'accepted' }
  }

  /** Resolve a thread to its run workflow: session threads to
   * session-run-<sessionId>, agent:<childId> to the child. */
  private async queueWorkflowId(threadKey: string): Promise<string> {
    const identity = await requireThread(this.pool, threadKey)
    return identity.thread.kind === 'subagent' ? threadKey.slice('agent:'.length) : `${SESSION_PREFIX}${identity.session.id}`
  }

  async listQueue(threadKey: string): Promise<Array<{ id: string; text: string; queuedAt: number }>> {
    const workflowId = await this.queueWorkflowId(threadKey)
    const client = await this.client()
    try {
      return await client.workflow.getHandle(workflowId).query<Array<{ id: string; text: string; queuedAt: number }>>('queueItems')
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${workflowId}`)
      throw error
    }
  }

  async removeQueued(threadKey: string, id: string): Promise<boolean> {
    const workflowId = await this.queueWorkflowId(threadKey)
    const client = await this.client()
    try {
      return await client.workflow.getHandle(workflowId).executeUpdate<boolean, [string]>('queueRemove', { args: [id] })
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${workflowId}`)
      throw error
    }
  }

  async reorderQueue(threadKey: string, ids: string[]): Promise<void> {
    const workflowId = await this.queueWorkflowId(threadKey)
    const client = await this.client()
    try {
      await client.workflow.getHandle(workflowId).executeUpdate<boolean, [string[]]>('queueReorder', { args: [ids] })
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${workflowId}`)
      // The workflow rejects non-exact id sets with QueueMismatch; the
      // message is the stable contract across the update boundary.
      if (error instanceof Error && error.message.includes('Queue ids must exactly match')) {
        throw new WorkspaceError('validation_failed', 'Queue ids must exactly match the current queue.')
      }
      throw error
    }
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
      await this.startWithEpoch(target.sessionId,target.sessionId,start.workflowId,(ownerEpoch) => client.workflow.signalWithStart(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: start.taskQueue,
        signal: start.signal,
        signalArgs: start.signalArgs,
        args: [{ ...start.args[0],ownerEpoch }],
      }))
      return
    }
    try {
      await client.workflow.getHandle(target.workflowId).signal(target.signal, ...target.args)
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) throw new RunNotFound(`no such run ${target.workflowId}`)
      throw error
    }
  }

  private async startWithEpoch(sessionId: string, threadKey: string, workflowId: string, launch: (epoch: string) => Promise<{ firstExecutionRunId?: string; describe(): Promise<WorkflowExecutionDescription> }>): Promise<void> {
    const epoch = await reserveExecutionIntent(this.pool,{ sessionId,threadKey,workflowId,requestKey: `gateway:${commandId()}` })
    const logger = createLogger({ runId: workflowId })
    try {
      await logOp(logger,'execution.start',async () => {
        const client = await this.client()
        const { handle,description } = await client.connection.withDeadline(Date.now()+5_000,async () => {
          const handle = await launch(epoch)
          return { handle,description: await handle.describe() }
        })
        const firstExecutionId = description.raw.workflowExecutionInfo?.firstRunId ?? handle.firstExecutionRunId
        if (!firstExecutionId) throw new Error('Temporal did not confirm the execution chain')
        await confirmExecutionIntent(this.pool,{ epoch,sessionId,threadKey,workflowId,executionId: description.runId,firstExecutionId })
      },{ epoch,threadKey,rpcDeadlineMs: 5_000 })
    } catch (error) {
      await markExecutionIntent(this.pool,epoch)
      await projectNewEvents(this.pool)
      throw error
    }
  }

  /** A finished child's steer rides the parent's parentSteer path (resolved
   * through the launch isolation record) and reports missed_steer. */
  private async recordMissedSteer(threadKey: string, text: string): Promise<CommandResult> {
    const childId = threadKey.replace(/^agent:/, '')
    const thread = await getThread(this.pool, threadKey)
    if (!thread) throw new RunNotFound(`no such thread ${threadKey}`)
    const id = commandId()
    await appendEvent(this.pool, { idempotencyKey: `missed:${id}`, partition: `session:${thread.sessionId}`, type: 't.subagent.missed_steer', payload: { childId, text } })
    await projectNewEvents(this.pool)
    return { commandId: id, state: 'missed_steer' }

  }
}
