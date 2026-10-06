// MCP tool handler table: one invoker per binding-table tool. Pure
// dispatch leaves (validation, roles, grants) to invokeTool in tools.ts.
import { agentHistoryBoundary, ContextFileBlocked, recordThreadFileExposure, assertThreadFileContext, validateFileRefs } from '../db/context-files.js'
import { assertGlobalFileContext } from '../db/workspace-global-context.js'
// MCP tool bindings (Phase 2). Each tool wires one semantic operation
// from the binding table in documentation/db.md — the server adds
// auth, transport, and tool schemas, never SQL. Projector-only
// publishOutboxFrame/runCheckpointTx are intentionally absent.
import { z } from 'zod'

/** Role ladder lives in auth/keys.ts (viewer < operator < approver). */
import {
  appendEvent,
  readGlobalContext, proposeGlobalContext, readThreadContext, listSectorLibrary, proposeFileContext, requireThread, commitChildContext,
  checkRate,
  claimIdempotency,
  completeIdempotency,
  createArtifact,
  createSector,
  createSession,
  DbContractError,
  findEventByKey,
  findKeyByHash,
  findLaunchParentWorkflowId,
  fleetTotals,
  getLedgerCompany,
  getSector,
  getSession,
  getThread,
  latestOutboxSeq,
  listLedgerCompanies,
  listLedgerProblems,
  listArtifacts,
  listCompanies,
  listHeartbeats,
  listSectorCompanies,
  listSectorDocuments,
  listSectorSessions,
  listMonitors,
  listSectors,
  listSessions,
  listSupervisionAlerts,
  listTenantArtifacts,
  listThreadHeaders,
  markCompanyFound,
  projectBatch,
  projectUsage,
  querySectorDocument,
  readEventsAfter,
  readOutboxBacklog,
  readPartition,
  readResearchProgress,
  readSectorCost,
  readSectorDocument,
  readSectorEvaluation,
  readSectorPlan,
  readSectorThread,
  readThreadCost,
  recentActivity,
  recordHeartbeat,
  threadHealth,
  recordLedgerProblem,
  deleteSession,
  renameSession,
  researchHealth,
  searchKb,
  referenceArtifact,
  releaseIdempotency,
  pauseSectorSweep,
  researchSessionBinding,
  requireSector,
  restartSectorSweep,
  startMonitor,
  stopMonitor,
  resolveArtifactScope,
  buildInheritedContext,
  saveInheritedContext,
  resumeSectorSweep,
  cancelThreadRun,
  getThreadHeader,
  getThreadRun,
  listThreadQueue,
  listThreadRuns,
  pauseThreadRun,
  removeThreadQueueItem,
  reorderThreadQueue,
  resumeThreadRun,
  runTotals,
  sectorActivity,
  sendThreadMessage,
  steerThread,
  SectorTransitionError,
  setCompanyStage,
  setCompanyState,
  SectorStartError,
  setSectorState,
  startSectorResearch,
  subscribeOutbox,
  upsertLedgerCompany,
  updateSectorPlan,
} from '../db/index.js'
import { RunNotFound, ThreadNotAccepting } from '../temporal/runs-types.js'
import { TOOL_SCHEMAS, type McpToolName } from './schemas.js'
import {
  pooledBrowserAct,
  pooledBrowserClose,
  pooledBrowserNavigate,
  pooledBrowserScreenshot,
  pooledBrowserSnapshot,
  pooledWebFetch,
  pooledWebSearch,
} from '../browserPool/facade.js'
import type { BrowserAct } from '../retrieval/browser.js'
import { RetrievalError } from '../retrieval/web.js'
import { attachSectorDocument } from '../file-ingestion.js'
type BrowserActArgs = BrowserAct

import { McpPreconditionError, McpToolError, type McpToolContext } from './tools-types.js'

/** Ownership is derived only from validated server context, never tool arguments. */
function browserCaller(ctx: McpToolContext): string {
  return JSON.stringify([ctx.scope?.tenantId ?? null, ctx.scope?.projectId ?? null, ctx.keyId, ctx.executionThread ?? null])
}

type SchemaMap = typeof TOOL_SCHEMAS
type Invokers = {
  [K in McpToolName]: (ctx: McpToolContext, args: z.output<SchemaMap[K]>) => Promise<unknown>
}

/** Namespace a caller-supplied idempotency key to the calling key, so one
 * MCP caller can never claim, complete, or release another caller's key. */
function scopedIdempotencyKey(ctx: McpToolContext, key: string): string {
  return `${ctx.keyId}:${key}`
}

async function workspaceIdentity(ctx: McpToolContext) {
  if (!ctx.executionThread) throw new McpToolError('permission_denied', 'Verified execution context is required.')
  const identity = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
  if (!identity.session.sectorId) throw new McpToolError('permission_denied', 'A sector conversation is required.')
  return { sectorId: identity.session.sectorId, threadKey: ctx.executionThread }
}

/** Sector scope shared by Karbot-readable sector tools: the caller's
 * sector binding wins when present (an explicit sectorId must match
 * it); outside a sector conversation sectorId is required. */
async function sectorScope(ctx: McpToolContext, argSectorId?: string) {
  const actor = ctx.executionThread ? await requireThread(ctx.pool, ctx.executionThread, ctx.scope) : undefined
  const sectorId = actor?.session.sectorId ?? argSectorId
  if (!sectorId) throw new McpToolError('validation_failed', 'Specify sectorId outside a sector conversation.')
  if (actor?.session.sectorId && argSectorId && argSectorId !== actor.session.sectorId) throw new McpToolError('permission_denied', 'This execution is bound to another sector.')
  return { sectorId, actor }
}

export const INVOKERS: Invokers = {
  'db.commit_child_context': async (ctx, args) => { const identity = await workspaceIdentity(ctx); await assertThreadFileContext(ctx.pool, identity.threadKey, ctx.scope); return commitChildContext(ctx.pool, identity.threadKey, args.proposalId, ctx.scope) },
  'db.get_global_context': async (ctx, args) => {
    const { sectorId, actor } = await sectorScope(ctx, args.sectorId)
    await assertGlobalFileContext(ctx.pool, sectorId, ctx.scope)
    const context = await readGlobalContext(ctx.pool, sectorId, ctx.scope)
    const parent = actor?.thread.kind === 'session' && actor.session.id === context.researchSessionId
    const visibleChanges = []
    for (const change of context.changes.filter((change) => (change.sourceRefs !== undefined || change.fileRef !== null) && actor && (change.sourceThread === ctx.executionThread || (parent && change.state === 'parent-review')))) {
      try { if (change.sourceRefs?.length) await validateFileRefs(ctx.pool, sectorId, change.sourceRefs, ctx.scope); visibleChanges.push(change) }
      catch (error) { if (!(error instanceof ContextFileBlocked)) throw error }
    }
    return { ...context, changes: visibleChanges }

  },
  'db.propose_global_context': async (ctx, args) => {
    const { sectorId } = await sectorScope(ctx, args.sectorId)
    if (!ctx.executionThread) throw new McpToolError('permission_denied', 'Verified execution context is required.')
    await assertThreadFileContext(ctx.pool, ctx.executionThread, ctx.scope)
    return proposeGlobalContext(ctx.pool, { ...args, sectorId, sourceThread: ctx.executionThread, owner: false, trustedResearch: true, scope: ctx.scope, id: `${sectorId}:${scopedIdempotencyKey(ctx, args.idempotencyKey)}` })
  },
  'db.list_sector_files': async (ctx) => {
    const identity = await workspaceIdentity(ctx)
    return (await listSectorLibrary(ctx.pool, identity.sectorId, ctx.scope)).filter((file) => !file.hidden)
  },
  'db.propose_file_context': async (ctx, args) => {
    const identity = await workspaceIdentity(ctx)
    return proposeFileContext(ctx.pool, { ...args, sectorId: identity.sectorId, sourceThread: identity.threadKey, scope: ctx.scope })
  },
  'db.get_local_context': async (ctx) => {
    if (!ctx.executionThread) throw new McpToolError('permission_denied', 'Verified execution context is required.')
    await assertThreadFileContext(ctx.pool, ctx.executionThread, ctx.scope)
    const local = await readThreadContext(ctx.pool, ctx.executionThread, ctx.scope)
    const { task: _ownerTask, ...agentLocal } = local
    return agentLocal
  },
  // Approval verdicts flow only through POST /v1/commands/approve (approver
  // floor): an operator caller must not forge t.approval.* events here.
  'db.append_event': (ctx, args) => {
    if (args.type.startsWith('t.approval.')) {
      throw new McpToolError('permission_denied', `db.append_event cannot write ${args.type}; use the approve command`)
    }
    return appendEvent(ctx.pool, args)
  },
  'db.read_partition': (ctx, args) => readPartition(ctx.pool, args.partition, args.afterSeq ?? 0),
  'db.find_event': (ctx, args) => findEventByKey(ctx.pool, args.idempotencyKey),
  'db.read_events_after': (ctx, args) => readEventsAfter(ctx.pool, args.fromSeq, args.limit),
  'db.create_session': (ctx, args) => createSession(ctx.pool, args.title, ctx.scope),
  'db.rename_session': async (ctx, args) => {
    const record = await renameSession(ctx.pool, args.sessionId, args.title, ctx.scope)
    if (!record) throw new DbContractError(`unknown session ${args.sessionId}`)
    return record
  },
  'db.delete_session': async (ctx, args) => {
    const deleted = await deleteSession(ctx.pool, args.sessionId, ctx.scope)
    if (!deleted) throw new DbContractError(`unknown session ${args.sessionId}`)
    return { sessionId: args.sessionId, deleted: true }
  },
  'db.get_session': (ctx, args) => getSession(ctx.pool, args.sessionId, ctx.scope),
  'db.list_sessions': (ctx, args) => listSessions(ctx.pool, ctx.scope, args.sectorId),
  'db.list_sectors': async (ctx, args) => {
    const rows = await listSectors(ctx.pool, ctx.scope, args)
    if (!ctx.executionThread) return rows
    const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
    return actor.session.sectorId ? rows.filter((sector) => sector.id === actor.session.sectorId) : rows
  },
  'db.get_sector': (ctx, args) => getSector(ctx.pool, args.sectorId, ctx.scope),
  'db.list_companies': (ctx, args) =>
    listCompanies(ctx.pool, ctx.scope, args, { limit: args.limit, offset: args.offset }),
  'db.list_sector_companies': (ctx, args) =>
    listSectorCompanies(ctx.pool, args.sectorId, ctx.scope, { state: args.state, query: args.query }, { limit: args.limit, offset: args.offset }),
  'db.sector_activity': (ctx, args) =>
    sectorActivity(ctx.pool, args.sectorId, ctx.scope, { limit: args.limit, offset: args.offset }),
  'db.create_sector': (ctx, args) =>
    createSector(ctx.pool, {
      name: args.name,
      topic: args.topic,
      sectorId: args.sectorId,
      idempotencyKey: args.idempotencyKey,
      initialState: args.state,
      scope: ctx.scope,
    }),
  'db.attach_sector_document': (ctx, args) =>
    attachSectorDocument(ctx.pool, { sectorId: args.sectorId, filename: args.filename, contentBase64: args.contentBase64, scope: ctx.scope, archive: ctx.archive, fileProcessor: ctx.fileProcessor, sourceThread: ctx.executionThread, logger: ctx.logger }),
  'db.list_sector_documents': (ctx, args) => listSectorDocuments(ctx.pool, args.sectorId, ctx.scope),
  'db.read_sector_document': async (ctx, args) => {
    const result = await readSectorDocument(ctx.pool, args.sectorId, args.documentId, ctx.scope)
    if (ctx.executionThread && result.text) await recordThreadFileExposure(ctx.pool, ctx.executionThread, args.sectorId, args.documentId, undefined, ctx.scope, result.sha256)
    return result
  },
  'db.query_document': async (ctx, args) => {
    const identity = ctx.executionThread ? await requireThread(ctx.pool, ctx.executionThread, ctx.scope) : undefined
    const sourceSector = args.sectorId ?? identity?.session.sectorId
    const source = sourceSector ? await readSectorDocument(ctx.pool, sourceSector, args.documentId, ctx.scope) : undefined
    const result = await querySectorDocument(ctx.pool, {
      documentId: args.documentId,
      ...(args.sectorId === undefined ? {} : { sectorId: args.sectorId }),
      ...(args.mode === undefined ? {} : { mode: args.mode }),
      ...(args.query === undefined ? {} : { query: args.query }),
      ...(args.ords === undefined ? {} : { ords: args.ords }),
      scope: ctx.scope,
    })
    if (ctx.executionThread && source?.text) { const identity = await requireThread(ctx.pool, ctx.executionThread, ctx.scope); const sectorId = args.sectorId ?? identity.session.sectorId; if (!sectorId || !source) throw new McpToolError('permission_denied', 'Specify sectorId to retain the file source scope.'); await recordThreadFileExposure(ctx.pool, ctx.executionThread, sectorId, args.documentId, 'units' in result ? result.units.map((unit) => unit.ord) : undefined, ctx.scope, source.sha256) }
    return result
  },
  'db.set_sector_state': (ctx, args) =>
    setSectorState(ctx.pool, args.sectorId, args.state, { scope: ctx.scope, idempotencyKey: args.idempotencyKey }).then(() => ({ ok: true })),
  'db.start_sector_research': async (ctx, args) => {
    const key = args.idempotencyKey ? `sector-start:${args.sectorId}:${ctx.keyId}:${args.idempotencyKey}` : undefined
    try {
      return await startSectorResearch(ctx.pool, ctx.runs, args.sectorId, ctx.scope, key, args.sessionId)
    } catch (error: unknown) {
      if (error instanceof SectorStartError) throw new DbContractError(`${error.failure}: ${error.message}`)
      throw error
    }
  },
  'db.pause_sector_research': async (ctx, args) => {
    const key = args.idempotencyKey ? `sector-pause:${args.sectorId}:${ctx.keyId}:${args.idempotencyKey}` : undefined
    try {
      // Same lifecycle as the route: halt the run before recording paused.
      // Without a sweep runner this fails closed instead of relabeling.
      return await pauseSectorSweep(ctx.pool, ctx.runs, args.sectorId, ctx.scope, key)
    } catch (error: unknown) {
      if (error instanceof SectorTransitionError) throw new DbContractError(`${error.failure}: ${error.message}`)
      throw error
    }
  },
  'db.resume_sector_research': async (ctx, args) => {
    const key = args.idempotencyKey ? `sector-resume:${args.sectorId}:${ctx.keyId}:${args.idempotencyKey}` : undefined
    try {
      return await resumeSectorSweep(ctx.pool, ctx.runs, args.sectorId, ctx.scope, key)
    } catch (error: unknown) {
      if (error instanceof SectorTransitionError) throw new DbContractError(`${error.failure}: ${error.message}`)
      throw error
    }
  },
  'db.mark_company_found': (ctx, args) =>
    markCompanyFound(ctx.pool, {
      sectorId: args.sectorId,
      name: args.name,
      stage: args.stage,
      state: args.state,
      companyId: args.companyId,
      idempotencyKey: args.idempotencyKey,
      scope: ctx.scope,
    }),
  'db.set_company_stage': (ctx, args) =>
    setCompanyStage(ctx.pool, args.companyId, args.stage, { scope: ctx.scope, idempotencyKey: args.idempotencyKey }).then(() => ({ ok: true })),
  'db.set_company_state': (ctx, args) =>
    setCompanyState(ctx.pool, args.companyId, args.state, { scope: ctx.scope, idempotencyKey: args.idempotencyKey }).then(() => ({ ok: true })),
  'db.list_artifacts': (ctx, args) => listArtifacts(ctx.pool, args.sessionId),
  // Session files: bytes land in the request archive target when the
  // server provides one, else the layer's resolved default.
  'db.create_artifact': (ctx, args) =>
    createArtifact(
      ctx.pool,
      {
        sessionId: args.sessionId,
        name: args.name,
        content: args.content,
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        ...(args.detail === undefined ? {} : { detail: args.detail }),
        ...(args.reason === undefined ? {} : { reason: args.reason }),
        scope: ctx.scope,
        producedBy: ctx.executionThread,
        ...(ctx.executionThread === undefined ? {} : { authorThread: ctx.executionThread }),
      },
      ctx.archive,
    ),
  'db.reference_artifact': (ctx, args) =>
    referenceArtifact(ctx.pool, { artifactId: args.artifactId, fromScope: args.fromScope, toSessionId: args.toSessionId, scope: ctx.scope }, ctx.archive),
  'db.resolve_artifact_scope': (ctx, args) => resolveArtifactScope(ctx.pool, args.sessionId, args.artifactId),
  'db.list_tenant_artifacts': (ctx, args) => {
    const scope = ctx.scope ?? (args.tenantId === undefined
      ? undefined
      : { tenantId: args.tenantId, projectId: args.projectId ?? null })
    if (!scope) throw new DbContractError('tenant scope required: sign in or pass tenantId')
    return listTenantArtifacts(ctx.pool, scope)
  },
  'db.find_launch_parent': (ctx, args) => findLaunchParentWorkflowId(ctx.pool, args.childId),
  'db.get_thread': async (ctx, args) => {
    let target = await getThread(ctx.pool, args.threadKey)
    if (target && ctx.executionThread) { const boundary = await agentHistoryBoundary(ctx.pool, args.threadKey); target = { ...target, messages: target.messages.filter((message) => message.seq > boundary.coveredSeq) } }
    if (!target || !ctx.executionThread || args.threadKey === ctx.executionThread) return target
    const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
    if (actor.session.sectorId && target.kind === 'subagent') {
      const reply = [...target.messages].reverse().find((message) => typeof message.payload === 'object' && message.payload !== null && 'role' in message.payload && message.payload.role === 'agent')
      return { ...target, messages: reply && target.status === 'FINISHED' ? [reply] : [] }
    }
    return target
  },
  'db.get_sector_plan': async (ctx, args) => {
    const { sectorId } = await sectorScope(ctx, args.sectorId)
    return readSectorPlan(ctx.pool, sectorId, ctx.scope)
  },
  'db.get_research_progress': async (ctx, args) => {
    const { sectorId } = await sectorScope(ctx, args.sectorId)
    return readResearchProgress(ctx.pool, sectorId, ctx.scope)
  },
  'db.list_sector_sessions': async (ctx, args) => {
    const { sectorId } = await sectorScope(ctx, args.sectorId)
    return listSectorSessions(ctx.pool, sectorId, ctx.scope)
  },
  'db.read_sector_thread': async (ctx, args) => {
    const { sectorId } = await sectorScope(ctx, args.sectorId)
    const target = await requireThread(ctx.pool, args.threadKey, ctx.scope)
    if (target.session.sectorId !== sectorId) throw new McpToolError('permission_denied', 'Conversation is outside this sector.')
    return readSectorThread(ctx.pool, args.threadKey, { fromSeq: args.fromSeq, limit: args.limit })
  },
  'db.list_threads': (ctx, args) => listThreadHeaders(ctx.pool, args.sessionId),
  'db.send_message': async (ctx, args) => {
    try {
      return await sendThreadMessage(ctx.messenger, args.threadKey, args.text)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'db.steer_thread': async (ctx, args) => {
    try {
      return await steerThread(ctx.messenger, args.threadKey, args.text)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'db.pause_run': async (ctx, args) => {
    try {
      return await pauseThreadRun(ctx.messenger, args.runId)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'db.resume_run': async (ctx, args) => {
    try {
      return await resumeThreadRun(ctx.messenger, args.runId, args.extendedBudgetMs)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'db.cancel_run': async (ctx, args) => {
    try {
      return await cancelThreadRun(ctx.messenger, args.runId)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'db.research_health': (ctx, args) => researchHealth(ctx.pool, args.sectorId, ctx.scope),
  'db.project_batch': (ctx, args) => projectBatch(ctx.pool, args.events),
  'db.record_heartbeat': (ctx, args) =>
    recordHeartbeat(ctx.pool, args.runId, args.op, args.busy, args.nowMs ?? Date.now()).then(() => ({ ok: true })),
  'db.list_heartbeats': (ctx) => listHeartbeats(ctx.pool),
  'db.read_outbox': async (ctx, args) => {
    const boundary = ctx.executionThread ? await agentHistoryBoundary(ctx.pool, args.threadKey) : { outboxAfter: 0 }
    const afterSeq = Math.max(args.afterSeq ?? 0, boundary.outboxAfter)
    const [frames, latestSeq] = await Promise.all([
      readOutboxBacklog(ctx.pool, args.threadKey, afterSeq, args.limit),
      latestOutboxSeq(ctx.pool, args.threadKey),
    ])
    return { frames, latestSeq }
  },
  'db.subscribe_outbox': async (ctx, args) => {
    const timeoutMs = args.timeoutMs ?? 1000
    const subscription = await subscribeOutbox(ctx.pool)
    try {
      const payload = await new Promise<string | undefined>((resolve, reject) => {
        const timer = setTimeout(() => resolve(undefined), timeoutMs)
        subscription.onError((error) => {
          clearTimeout(timer)
          reject(error)
        })
        subscription.onNotification((next) => {
          clearTimeout(timer)
          resolve(next)
        })
      })
      return { notified: payload !== undefined, payload: payload ?? null }
    } finally {
      await subscription.close()
    }
  },
  'db.project_usage': (ctx, args) => projectUsage(ctx.pool, args.events),
  'db.run_totals': (ctx, args) => runTotals(ctx.pool, args.runId),
  'db.fleet_totals': (ctx) => fleetTotals(ctx.pool),
  'db.find_key': (ctx, args) => findKeyByHash(ctx.pool, args.keyHash),
  'db.check_rate': (ctx, args) => checkRate(ctx.pool, args.bucket, args.limitPerMin, args.nowMs ?? Date.now()),
  'db.claim_idempotency': (ctx, args) => claimIdempotency(ctx.pool, scopedIdempotencyKey(ctx, args.key), args.fingerprint),
  'db.complete_idempotency': (ctx, args) =>
    completeIdempotency(ctx.pool, scopedIdempotencyKey(ctx, args.key), args.status, args.body ?? null).then(() => ({ ok: true })),
  'db.release_idempotency': (ctx, args) =>
    releaseIdempotency(ctx.pool, scopedIdempotencyKey(ctx, args.key)).then(() => ({ ok: true })),
  'db.kb_search': (ctx, args) => searchKb(ctx.pool, args.query, args.limit ?? 5),
  // Brainstorm edits: versioned, planned-or-approved only, fail-closed
  // without or outside those states (never a silent overwrite).
  'db.update_sector_plan': async (ctx, args) => {
    const key = args.idempotencyKey ? `${ctx.keyId}:${args.idempotencyKey}` : undefined
    try {
      return await updateSectorPlan(ctx.pool, args.sectorId, args.markdown, ctx.scope, key)
    } catch (error: unknown) {
      if (error instanceof SectorTransitionError) throw new DbContractError(`${error.failure}: ${error.message}`)
      throw error
    }
  },
  // Delegation door: the main agent launches leaf researchers by
  // instruction. Session ownership is verified first (unknown or
  // out-of-scope sessions never launch); without a delegator the call
  // fails closed instead of half-launching a child.
  'db.delegate_subagent': async (ctx, args) => {
    if (!ctx.delegator) throw new McpPreconditionError('Delegation is unavailable: no subagent delegator attached.')
    const goal = args.goal.trim()
    if (!goal) throw new DbContractError('goal must be a non-empty string')
    const session = await getSession(ctx.pool, args.sessionId, ctx.scope)
    if (!session) throw new DbContractError(`unknown session ${args.sessionId}`)
    const parentThread = ctx.executionThread ?? args.sessionId
    const siblings = (await listThreadHeaders(ctx.pool, args.sessionId)).filter((thread) => thread.kind === 'subagent')
    try {
      return await ctx.delegator.delegateSubagent({
        sessionId: args.sessionId,
        goal,
        name: `Subagent ${siblings.length + 1}`,
        mode: args.mode ?? 'empty',
        queueCapacity: args.queueCapacity ?? 8,
        onAccepted: async (childId) => {
          await saveInheritedContext(ctx.pool, `agent:${childId}`, await buildInheritedContext(ctx.pool, parentThread))
        },
      })
    } catch (error: unknown) {
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  // Retrieval tools route through the browser-pool facade (single entry:
  // bounded 0-16 slots, query/document caches, tiered fallback). Tool
  // names, schemas, roles, and error codes are unchanged; TOOL_LAYER
  // still names the underlying layer functions (parity test intact).
  'web_search': (_ctx, args) =>
    rethrowRetrieval(pooledWebSearch(process.env, args.query, { count: args.count, page: args.page })),
  'web_fetch': (_ctx, args) => rethrowRetrieval(pooledWebFetch(args.url)),
  'browser_navigate': (ctx, args) => rethrowRetrieval(pooledBrowserNavigate(args.url, { caller: browserCaller(ctx), logger: ctx.logger })),
  'browser_snapshot': (ctx, args) => rethrowRetrieval(pooledBrowserSnapshot(args.sessionId, browserCaller(ctx))),
  'browser_act': (ctx, args) =>
    rethrowRetrieval(
      pooledBrowserAct(args.sessionId, {
        kind: args.kind,
        ...(args.selector === undefined ? {} : { selector: args.selector }),
        ...(args.text === undefined ? {} : { text: args.text }),
        ...(args.key === undefined ? {} : { key: args.key }),
        ...(args.direction === undefined ? {} : { direction: args.direction }),
        ...(args.pixels === undefined ? {} : { pixels: args.pixels }),
      } as BrowserActArgs, browserCaller(ctx)),
    ),
  'browser_close': (ctx, args) => rethrowRetrieval(pooledBrowserClose(args.sessionId, browserCaller(ctx))),
  'browser_screenshot': (ctx, args) => rethrowRetrieval(pooledBrowserScreenshot(args.sessionId, { fullPage: args.fullPage }, browserCaller(ctx))),
  'db.ledger_upsert_company': (ctx, args) => upsertLedgerCompany(ctx.pool, args),
  'db.ledger_get_company': (ctx, args) => getLedgerCompany(ctx.pool, args.companyId),
  'db.ledger_list_companies': (ctx, args) =>
    listLedgerCompanies(ctx.pool, { qualification: args.qualification, sector: args.sector, query: args.query }),
  'db.ledger_record_problem': (ctx, args) => recordLedgerProblem(ctx.pool, args),
  'db.ledger_list_problems': (ctx, args) => listLedgerProblems(ctx.pool, args.companyId),
  'ops.list_runs': async (ctx, args) => {
    let sectorId = args.sectorId
    if (ctx.executionThread) {
      const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
      sectorId = actor.session.sectorId ?? sectorId
    }
    const runs = await listThreadRuns(ctx.messenger)
    const sessions = new Map<string, { sectorId?: string } | undefined>()
    const kinds = new Map<string, string | null>()
    const out: typeof runs = []
    for (const run of runs) {
      if (args.state && run.state !== args.state) continue
      if (!sessions.has(run.sessionId)) sessions.set(run.sessionId, await getSession(ctx.pool, run.sessionId, ctx.scope))
      const session = sessions.get(run.sessionId)
      if (!session) {
        // Legacy research runs attribute to no session: visible only on
        // an unfiltered fleet dump by an unattributed caller, never in
        // scoped tools or under sector/kind filters.
        if (ctx.scope || ctx.executionThread || sectorId || args.kind) continue
        out.push(run)
        continue
      }
      if (sectorId && session.sectorId !== sectorId) continue
      if (args.kind) {
        if (!kinds.has(run.threadKey)) kinds.set(run.threadKey, (await getThreadHeader(ctx.pool, run.threadKey))?.kind ?? null)
        if (kinds.get(run.threadKey) !== args.kind) continue
      }
      out.push(run)
    }
    return out
  },
  'ops.get_run': async (ctx, args) => {
    const run = await getThreadRun(ctx.messenger, args.runId)
    if (!run) throw new McpToolError('not_found', `no such run ${args.runId}`)
    const session = await getSession(ctx.pool, run.sessionId, ctx.scope)
    if (!session) throw new McpToolError('permission_denied', 'Run is outside the authorized scope.')
    if (ctx.executionThread) {
      const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
      if (actor.session.sectorId && session.sectorId !== actor.session.sectorId) throw new McpToolError('permission_denied', 'Run is outside this sector.')
    }
    return run
  },
  'ops.thread_queue': async (ctx, args) => {
    try {
      return await listThreadQueue(ctx.messenger, args.threadKey)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      throw error
    }
  },
  'ops.queue_remove': async (ctx, args) => {
    try {
      return { removed: await removeThreadQueueItem(ctx.messenger, args.threadKey, args.id) }
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      throw error
    }
  },
  'ops.queue_reorder': async (ctx, args) => {
    try {
      await reorderThreadQueue(ctx.messenger, args.threadKey, args.ids)
      return { ok: true }
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      throw error
    }
  },
  'ops.list_alerts': async (ctx, args) => {
    if (!ctx.scope) throw new McpToolError('permission_denied', 'Notifications never use unscoped open-mode authority.')
    let sectorId = args.sectorId
    if (ctx.executionThread) {
      const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
      sectorId = actor.session.sectorId ?? sectorId
    }
    const page = await listSupervisionAlerts(ctx.pool, ctx.scope, args.beforeSeq ?? Number.MAX_SAFE_INTEGER, args.limit ?? 20)
    if (!sectorId) return page
    const sectors = new Map<string, string | undefined>()
    const items: typeof page.items = []
    for (const item of page.items) {
      let itemSector = item.sectorId
      if (!itemSector && item.sessionId) {
        if (!sectors.has(item.sessionId)) sectors.set(item.sessionId, (await getSession(ctx.pool, item.sessionId, ctx.scope))?.sectorId)
        itemSector = sectors.get(item.sessionId) ?? null
      }
      if (itemSector === sectorId) items.push(item)
    }
    return { items, nextBeforeSeq: page.nextBeforeSeq }
  },
  'ops.thread_health': (ctx, args) => threadHealth(ctx.pool, args.threadKey, ctx.scope),
  'ops.cost': async (ctx, args) => {
    // One object schema (unions list empty in tools/list), so the
    // exactly-one rule lives here, before any query runs.
    if ((args.threadKey ? 1 : 0) + (args.sectorId ? 1 : 0) !== 1) {
      throw new McpToolError('validation_failed', 'exactly one of threadKey, sectorId is required')
    }
    if (args.threadKey) return readThreadCost(ctx.pool, args.threadKey, ctx.scope)
    const { sectorId } = await sectorScope(ctx, args.sectorId)
    return readSectorCost(ctx.pool, sectorId, ctx.scope)
  },
  'ops.sector_evaluation': async (ctx, args) => {
    const { sectorId } = await sectorScope(ctx, args.sectorId)
    return readSectorEvaluation(ctx.pool, sectorId, ctx.scope)
  },
  'ops.recent_activity': (ctx, args) => {
    if ((args.traceId ? 1 : 0) + (args.threadKey ? 1 : 0) !== 1) {
      throw new McpToolError('validation_failed', 'exactly one of traceId, threadKey is required')
    }
    return recentActivity(ctx.pool, args, ctx.scope)
  },
  'ops.pause_run': async (ctx, args) => {
    try {
      return await pauseThreadRun(ctx.messenger, args.runId)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'ops.resume_run': async (ctx, args) => {
    try {
      return await resumeThreadRun(ctx.messenger, args.runId, args.extendedBudgetMs)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'ops.cancel_run': async (ctx, args) => {
    try {
      return await cancelThreadRun(ctx.messenger, args.runId)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'ops.spawn_subagent': async (ctx, args) => {
    if (!ctx.delegator) throw new McpPreconditionError('Delegation is unavailable: no subagent delegator attached.')
    const goal = args.goal.trim()
    if (!goal) throw new DbContractError('goal must be a non-empty string')
    const target = await requireThread(ctx.pool, args.threadKey, ctx.scope)
    const siblings = (await listThreadHeaders(ctx.pool, target.session.id)).filter((thread) => thread.kind === 'subagent')
    try {
      return await ctx.delegator.delegateSubagent({
        sessionId: target.session.id,
        goal,
        name: `Subagent ${siblings.length + 1}`,
        mode: 'empty',
        queueCapacity: 8,
        onAccepted: async (childId) => {
          await saveInheritedContext(ctx.pool, `agent:${childId}`, await buildInheritedContext(ctx.pool, args.threadKey))
        },
      })
    } catch (error: unknown) {
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'ops.restart_sector_research': async (ctx, args) => {
    const key = args.idempotencyKey ? `sector-restart:${args.sectorId}:${ctx.keyId}:${args.idempotencyKey}` : undefined
    try {
      return await restartSectorSweep(ctx.pool, ctx.runs, args.sectorId, ctx.scope, key)
    } catch (error: unknown) {
      if (error instanceof SectorTransitionError) throw new DbContractError(`${error.failure}: ${error.message}`)
      throw error
    }
  },
  'db.request_plan': async (ctx, args) => {
    await requireSector(ctx.pool, args.sectorId, ctx.scope)
    const sessionId = await researchSessionBinding(ctx.pool, args.sectorId)
    if (!sessionId) throw new McpToolError('not_found', `sector ${args.sectorId} has no research session`)
    try {
      return await sendThreadMessage(ctx.messenger, sessionId, args.instruction)
    } catch (error: unknown) {
      if (error instanceof RunNotFound) throw new McpToolError('not_found', error.message)
      if (error instanceof ThreadNotAccepting) throw new McpToolError('conflict', error.message)
      throw error
    }
  },
  'ops.start_monitor': async (ctx, args) => {
    if (!ctx.scope) throw new McpToolError('permission_denied', 'Monitors require a scoped caller.')
    if (!ctx.executionThread) throw new McpToolError('permission_denied', 'Verified execution context is required.')
    const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
    return startMonitor(ctx.pool, ctx.monitor, {
      sectorId: args.sectorId, threadKey: args.threadKey, everyMinutes: args.everyMinutes,
      brief: args.brief, until: args.until, karbotSessionId: actor.session.id,
      karbotThreadKey: ctx.executionThread, scope: ctx.scope,
    })
  },
  'ops.stop_monitor': async (ctx, args) => {
    if (!ctx.scope) throw new McpToolError('permission_denied', 'Monitors require a scoped caller.')
    return stopMonitor(ctx.pool, ctx.monitor, { monitorId: args.monitorId, sectorId: args.sectorId, threadKey: args.threadKey }, ctx.scope)
  },
  'ops.list_monitors': async (ctx) => {
    if (!ctx.scope) throw new McpToolError('permission_denied', 'Monitors require a scoped caller.')
    return listMonitors(ctx.pool, ctx.scope)
  },
}

/** Retrieval failures become isError text with their own code
 * (unconfigured/blocked/fetch_failed/overload), never a throw. */
async function rethrowRetrieval<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    if (error instanceof RetrievalError) throw new McpToolError(error.code, error.message)
    throw error
  }
}
