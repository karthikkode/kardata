import { ContextFileBlocked, assertThreadFileContext } from '../db/context-files.js'
import { sessionKind } from '../db/workspace.js'
// MCP tool bindings (Phase 2). Each tool wires one semantic operation
// from the binding table in documentation/db.md — the server adds
// auth, transport, and tool schemas, never SQL. Projector-only
// publishOutboxFrame/runCheckpointTx are intentionally absent.
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Role } from '../auth/keys.js'
import { roleLevelAtLeast } from '../auth/keys.js'
import { childLogger, logOp } from '../observability/logging.js'

/** Role ladder lives in auth/keys.ts (viewer < operator < approver). */
import {
  requireThread, WorkspaceError,
  DbContractError,
  getSession,
} from '../db/index.js'
import { TOOL_NAMES, TOOL_SCHEMAS, type McpToolName } from './schemas.js'
import { isPdfDocumentUpload } from '../file-ingestion.js'

import { INVOKERS } from './tool-invokers.js'
import { McpPreconditionError, McpToolError, type McpToolContext, type ToolGrant } from './tools-types.js'

/** Layer function behind each tool; the parity test pins this table. */
export const TOOL_LAYER: Record<McpToolName, string> = {
  'db.commit_child_context': 'commitChildContext',
  'db.get_global_context': 'readGlobalContext',
  'db.propose_global_context': 'proposeGlobalContext',
  'db.list_sector_files': 'listSectorLibrary',
  'db.propose_file_context': 'proposeFileContext',
  'db.get_local_context': 'readThreadContext',
  'db.append_event': 'appendEvent',
  'db.read_partition': 'readPartition',
  'db.find_event': 'findEventByKey',
  'db.read_events_after': 'readEventsAfter',
  'db.create_session': 'createSession',
  'db.rename_session': 'renameSession',
  'db.delete_session': 'deleteSession',
  'db.get_session': 'getSession',
  'db.list_sessions': 'listSessions',
  'db.list_sectors': 'listSectors',
  'db.get_sector': 'getSector',
  'db.list_companies': 'listCompanies',
  'db.list_sector_companies': 'listSectorCompanies',
  'db.sector_activity': 'sectorActivity',
  'db.create_sector': 'createSector',
  'db.attach_sector_document': 'attachSectorDocument',
  'db.list_sector_documents': 'listSectorDocuments',
  'db.read_sector_document': 'readSectorDocument',
  'db.query_document': 'querySectorDocument',
  'db.set_sector_state': 'setSectorState',
  'db.start_sector_research': 'startSectorResearch',
  'db.pause_sector_research': 'pauseSectorSweep',
  'db.resume_sector_research': 'resumeSectorSweep',
  'db.mark_company_found': 'markCompanyFound',
  'db.set_company_stage': 'setCompanyStage',
  'db.set_company_state': 'setCompanyState',
  'db.list_artifacts': 'listArtifacts',
  'db.create_artifact': 'createArtifact',
  'db.reference_artifact': 'referenceArtifact',
  'db.resolve_artifact_scope': 'resolveArtifactScope',
  'db.list_tenant_artifacts': 'listTenantArtifacts',
  'db.find_launch_parent': 'findLaunchParentWorkflowId',
  'db.get_thread': 'getThread',
  'db.get_sector_plan': 'readSectorPlan',
  'db.get_research_progress': 'readResearchProgress',
  'db.list_sector_sessions': 'listSectorSessions',
  'db.read_sector_thread': 'readSectorThread',
  'db.list_threads': 'listThreadHeaders',
  'db.send_message': 'sendThreadMessage',
  'db.steer_thread': 'steerThread',
  'db.pause_run': 'pauseThreadRun',
  'db.resume_run': 'resumeThreadRun',
  'db.cancel_run': 'cancelThreadRun',
  'db.research_health': 'researchHealth',
  'db.project_batch': 'projectBatch',
  'db.record_heartbeat': 'recordHeartbeat',
  'db.list_heartbeats': 'listHeartbeats',
  'db.read_outbox': 'readOutboxBacklog+latestOutboxSeq',
  'db.subscribe_outbox': 'subscribeOutbox',
  'db.project_usage': 'projectUsage',
  'db.run_totals': 'runTotals',
  'db.fleet_totals': 'fleetTotals',
  'db.find_key': 'findKeyByHash',
  'db.check_rate': 'checkRate',
  'db.claim_idempotency': 'claimIdempotency',
  'db.complete_idempotency': 'completeIdempotency',
  'db.release_idempotency': 'releaseIdempotency',
  'db.kb_search': 'searchKb',
  'db.update_sector_plan': 'updateSectorPlan',
  'db.delegate_subagent': 'delegateSubagent',
  'web_search': 'webSearch',
  'web_fetch': 'webFetch',
  'browser_navigate': 'browserNavigate',
  'browser_snapshot': 'browserSnapshot',
  'browser_act': 'browserAct',
  'browser_close': 'browserClose',
  'browser_screenshot': 'browserScreenshot',
  'db.ledger_upsert_company': 'upsertLedgerCompany',
  'db.ledger_get_company': 'getLedgerCompany',
  'db.ledger_list_companies': 'listLedgerCompanies',
  'db.ledger_record_problem': 'recordLedgerProblem',
  'db.ledger_list_problems': 'listLedgerProblems',
}

/** Capability tier: read (viewer), write (operator), sensitive (approver
 * plus, in Karbot flows, explicit user confirmation). Sensitive covers key
 * material, raw projection writes, and the exactly-once primitives. */
export type ToolCapability = 'read' | 'write' | 'sensitive'

/** Platform plumbing has no tenant/thread attribution and is never a
 * product capability for an authenticated scoped caller. */
export const PLATFORM_INTERNAL_TOOLS: ReadonlySet<McpToolName> = new Set([
  'db.append_event', 'db.read_partition', 'db.find_event', 'db.read_events_after',
  'db.project_batch', 'db.record_heartbeat', 'db.list_heartbeats', 'db.subscribe_outbox',
  'db.project_usage', 'db.fleet_totals', 'db.find_key', 'db.check_rate',
  'db.claim_idempotency', 'db.complete_idempotency', 'db.release_idempotency',
])

const SENSITIVE_TOOLS: ReadonlySet<McpToolName> = new Set([
  'db.find_key',
  'db.project_batch',
  'db.claim_idempotency',
  'db.complete_idempotency',
  'db.release_idempotency',
  // Live-run steering: approver role plus explicit user confirmation in
  // Karbot flows. A model message that moves a running agent is a
  // side effect on someone else's turn, never a quiet write. Run
  // pause/cancel mirror the route floors (operator); resume approves
  // the guarded path back, so it stays approver plus confirmation.
  'db.send_message',
  'db.steer_thread',
  'db.resume_run',
])

export function toolCapability(name: McpToolName): ToolCapability {
  if (SENSITIVE_TOOLS.has(name)) return 'sensitive'
  return TOOL_META[name].minRole === 'viewer' ? 'read' : 'write'
}

export const TOOL_META: Record<McpToolName, { description: string; minRole: Role }> = {
  'db.commit_child_context': { description: 'Research parent: commit a child finding or open question. Scope, decisions and file inclusion require owner approval.', minRole: 'operator' },
  'db.get_global_context': { description: 'Read approved sector shared context. Sector chats use their binding; general Karbot must provide sectorId. Pending updates remain private to their source/research parent.', minRole: 'viewer' },
  'db.propose_global_context': { description: 'Propose a versioned shared-context edit. Send only the sections you change; omitted sections stay unchanged, explicit empty string clears. Normal chats require owner approval; research children report to their parent.', minRole: 'operator' },
  'db.list_sector_files': { description: 'List visible indexed files shared by this sector.', minRole: 'viewer' },
  'db.propose_file_context': { description: 'Request owner approval to include exact file units in global context.', minRole: 'operator' },
  'db.get_local_context': { description: 'Read your own conversation working memory.', minRole: 'viewer' },
  'db.append_event': { description: 'Append an event (idempotent write; returns seq + duplicate flag).', minRole: 'operator' },
  'db.read_partition': { description: 'Read one partition paginated by afterSeq.', minRole: 'viewer' },
  'db.find_event': { description: 'Exactly-once event lookup by idempotency key.', minRole: 'viewer' },
  'db.read_events_after': { description: 'Projector catch-up batches from a global seq.', minRole: 'viewer' },
  'db.create_session': { description: 'Create a session (server-generated id; binds tenant).', minRole: 'operator' },
  'db.rename_session': { description: 'Rename a session (latest title wins; history preserved).', minRole: 'operator' },
  'db.delete_session': { description: 'Remove a session (tombstone: hidden from reads, history kept).', minRole: 'operator' },
  'db.get_session': { description: 'Read one session in scope.', minRole: 'viewer' },
  'db.list_sessions': { description: 'List sessions in scope.', minRole: 'viewer' },
  'db.list_sectors': { description: 'List sectors in scope with live company counts.', minRole: 'viewer' },
  'db.get_sector': { description: 'Read one sector in scope.', minRole: 'viewer' },
  'db.list_companies': { description: 'List companies in scope.', minRole: 'viewer' },
  'db.list_sector_companies': { description: 'List companies in one sector.', minRole: 'viewer' },
  'db.sector_activity': { description: 'Sector timeline derived from the sector partition.', minRole: 'viewer' },
  'db.create_sector': { description: 'Create a sector (appends sector.created).', minRole: 'operator' },
  'db.attach_sector_document': { description: 'Attach a context document to a sector. PDFs queue durable full-page/image processing and return current status/progress, not immediate indexed knowledge. Text/images retain their existing ingestion path. Failed/uncertain paid retries and context inclusion require owner review.', minRole: 'operator' },
  'db.list_sector_documents': { description: 'List context documents for a sector.', minRole: 'viewer' },
  'db.read_sector_document': { description: 'Read one context document with its full extracted text, for quoting a file back. needs-ocr rows carry empty text.', minRole: 'viewer' },
  'db.query_document': { description: 'Query a context document: TOC summary by default, targeted unit search/slice on demand. Cite units, never dump whole files.', minRole: 'viewer' },
  'db.set_sector_state': { description: 'Transition a sector (appends sector.state_changed).', minRole: 'operator' },
  'db.start_sector_research': { description: 'Start research on a draft sector: draft -> queued, then the sweep starts. Explicit only; already-started sectors conflict; a failed sweep start compensates back to draft. Pass sessionId (your calling chat) so the chat pins this research; pass idempotencyKey for safe retries.', minRole: 'operator' },
  'db.pause_sector_research': { description: 'Pause a running sector: running -> paused (owner intent in state). Only running sectors pause.', minRole: 'operator' },
  'db.resume_sector_research': { description: 'Resume a paused sector: paused -> running. Only paused sectors resume.', minRole: 'operator' },
  'db.mark_company_found': { description: 'Record a found company (appends company.found).', minRole: 'operator' },
  'db.set_company_stage': { description: 'Transition a company stage.', minRole: 'operator' },
  'db.set_company_state': { description: 'Transition a company state.', minRole: 'operator' },
  'db.list_artifacts': { description: 'Session files menu (own + referenced).', minRole: 'viewer' },
  'db.create_artifact': { description: 'Create and index a session file or report (visible in the session files menu).', minRole: 'operator' },
  'db.reference_artifact': { description: 'Cross-session artifact attach (indexed only).', minRole: 'operator' },
  'db.resolve_artifact_scope': { description: 'Owning scope for artifact serve.', minRole: 'viewer' },
  'db.list_tenant_artifacts': { description: 'Tenant attach discovery across sessions.', minRole: 'viewer' },
  'db.find_launch_parent': { description: 'Finished-child steer routing lookup.', minRole: 'viewer' },
  'db.get_thread': { description: 'Read one projected thread.', minRole: 'viewer' },
  'db.get_sector_plan': { description: 'Read the research plan.', minRole: 'viewer' },
  'db.get_research_progress': { description: 'Checked research progress.', minRole: 'viewer' },
  'db.list_sector_sessions': { description: 'Listed chats in this sector.', minRole: 'viewer' },
  'db.read_sector_thread': { description: 'Read a chat.', minRole: 'viewer' },
  'db.list_threads': { description: 'List projected threads for a session.', minRole: 'viewer' },
  'db.send_message': { description: 'Queue a message onto a thread (runSend): accepted, or missed_steer when nothing listens. Sensitive: approver plus user confirmation.', minRole: 'approver' },
  'db.steer_thread': { description: 'Interrupt a running turn with new direction (runSteer). Sensitive: approver plus user confirmation.', minRole: 'approver' },
  'db.pause_run': { description: 'Pause a session or research run (runPause). Mirrors the route floor: operator.', minRole: 'operator' },
  'db.resume_run': { description: 'Resume a paused run, optionally extending its budget. Sensitive: approver plus user confirmation.', minRole: 'approver' },
  'db.cancel_run': { description: 'Cancel a session run (runCancel). Mirrors the route floor: operator.', minRole: 'operator' },
  'db.research_health': { description: 'Read-only sector state, durable activity, thread states and recent scoped supervision observations. Stale means a running sector has no available thread; it does not prove a workflow is dead.', minRole: 'viewer' },
  'db.project_batch': { description: 'Projector batch apply (not for ad-hoc writes).', minRole: 'approver' },
  'db.record_heartbeat': { description: 'Record an operation liveness beat.', minRole: 'operator' },
  'db.list_heartbeats': { description: 'Latest liveness beat per run.', minRole: 'viewer' },
  'db.read_outbox': { description: 'Stream replay: backlog frames plus the latest seq.', minRole: 'viewer' },
  'db.subscribe_outbox': { description: 'Wait once for the next outbox notification (then close).', minRole: 'viewer' },
  'db.project_usage': { description: 'Project usage/cost ledger entries from events.', minRole: 'operator' },
  'db.run_totals': { description: 'Exact-decimal cost totals for one run.', minRole: 'viewer' },
  'db.fleet_totals': { description: 'Exact-decimal cost totals for the fleet.', minRole: 'viewer' },
  'db.find_key': { description: 'API-key hash lookup (auth stays in backend).', minRole: 'approver' },
  'db.check_rate': { description: 'Fixed-window rate counter check.', minRole: 'operator' },
  'db.claim_idempotency': { description: 'Claim a mutation key (exactly-once guard).', minRole: 'approver' },
  'db.complete_idempotency': { description: 'Store a mutation outcome for replay.', minRole: 'approver' },
  'db.release_idempotency': { description: 'Drop an in-progress mutation claim.', minRole: 'approver' },
  'db.kb_search': { description: 'Full-text search over the curated product knowledge corpus (cite source_path).', minRole: 'viewer' },
  'db.update_sector_plan': {
    description: 'Append a plan version on a planned sector (brainstorm edits); edits after approval re-open review to planned.',
    minRole: 'operator',
  },
  'db.delegate_subagent': {
    description:
      'Launch a leaf subagent researcher on a session goal (Karbot-only, operator). The child researches independently and reports back; collect via session threads. Pilot children never delegate further. Write self-contained goals carrying the facts the child needs; never point the child at global context for anything said in this conversation (the child inherits this conversation separately).',
    minRole: 'operator',
  },
  'web_search': { description: 'Web search (needs KARDATA_WEB_SEARCH_KEY, fails closed without it).', minRole: 'viewer' },
  'web_fetch': { description: 'Fetch a page as text (caps + SSRF guards).', minRole: 'viewer' },
  'browser_navigate': { description: 'Open a Chromium session on a URL (needs local Chromium).', minRole: 'operator' },
  'browser_snapshot': { description: 'Accessibility snapshot of a browser session.', minRole: 'viewer' },
  'browser_act': { description: 'Click/fill/press/scroll in a browser session.', minRole: 'operator' },
  'browser_close': { description: 'Close a browser session.', minRole: 'operator' },
  'browser_screenshot': {
    description:
      'Viewport JPEG of a browser session, only when the snapshot cannot answer (visual layout, canvas, CAPTCHA state). Snapshots stay the default: screenshots cost context every later turn.',
    minRole: 'operator',
  },
  'db.ledger_upsert_company': { description: 'Idempotent master-ledger company upsert keyed on domain.', minRole: 'operator' },
  'db.ledger_get_company': { description: 'Read one master-ledger company with its problem count.', minRole: 'viewer' },
  'db.ledger_list_companies': { description: 'List master-ledger companies with qualification/sector/query filters.', minRole: 'viewer' },
  'db.ledger_record_problem': { description: 'Append one researched problem to a ledger company (call per problem).', minRole: 'operator' },
  'db.ledger_list_problems': { description: 'List every researched problem for one ledger company.', minRole: 'viewer' },
}

const preDispatchFailures = new WeakSet<object>()

/** Validates args against the tool schema, enforces the tool role floor
 * plus the optional skill grant, and dispatches to the bound layer
 * function. */
export async function invokeTool(
  name: McpToolName,
  ctx: McpToolContext,
  args: unknown,
  grant: ToolGrant = {},
): Promise<unknown> {
  let dispatched = false
  const work = async () => {
    const meta = TOOL_META[name]
    if (!roleLevelAtLeast(ctx.role, meta.minRole)) {
      throw new McpToolError('permission_denied', `role ${ctx.role} cannot call ${name} (needs ${meta.minRole})`)
    }
    if ((ctx.scope || ctx.executionThread) && PLATFORM_INTERNAL_TOOLS.has(name)) throw new McpToolError('permission_denied', 'Platform internals are unavailable to scoped callers. Use authorized product tools.')
    if (grant.allow !== undefined && !grant.allow.has(name)) {
      throw new McpToolError('permission_denied', `tool ${name} is outside this skill's grant`)
    }
    const schema = TOOL_SCHEMAS[name] as z.ZodType
    const parsed = schema.safeParse(args)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const where = first ? [...first.path.map(String), first.message].join(': ') : 'invalid input'
      throw new McpToolError('validation_failed', `${name}: ${where}`)
    }
    if (ctx.scope && ['db.get_thread', 'db.read_sector_thread', 'db.send_message', 'db.steer_thread', 'db.read_outbox'].includes(name)) {
      await requireThread(ctx.pool, (parsed.data as { threadKey: string }).threadKey, ctx.scope)
    }
    if (ctx.scope && name === 'db.subscribe_outbox') throw new McpToolError('permission_denied', 'Unattributed fleet notifications are unavailable to scoped callers.')
    if (ctx.scope && ['db.list_threads', 'db.list_artifacts', 'db.resolve_artifact_scope'].includes(name)) {
      const target = await getSession(ctx.pool, (parsed.data as { sessionId: string }).sessionId, ctx.scope)
      if (!target) throw new McpToolError('permission_denied', 'Conversation is outside the authorized scope.')
    }
    if (ctx.executionThread) {
      const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
      if (name === 'db.update_sector_plan') {
        const kind = await sessionKind(ctx.pool, actor.session.id)
        if (kind !== 'research' || actor.thread.kind !== 'session') {
          throw new McpToolError('permission_denied', 'Only the research conversation can change the plan. Suggest the change to the owner instead.')
        }
      }
      if (['db.get_thread', 'db.read_sector_thread', 'db.read_outbox'].includes(name)) await assertThreadFileContext(ctx.pool, (parsed.data as { threadKey: string }).threadKey, ctx.scope)
      if (name === 'db.delegate_subagent' && actor.thread.kind === 'subagent') throw new McpToolError('permission_denied', 'Leaf subagents cannot delegate further.')
      if (name === 'db.rename_session' && actor.thread.kind === 'subagent') throw new McpToolError('permission_denied', 'Conversation naming belongs to the parent or owner.')
      if (name === 'db.delete_session') throw new McpToolError('permission_denied', 'Conversation deletion requires owner confirmation in the UI.')
      if (name === 'db.set_sector_state') throw new McpToolError('permission_denied', 'Use the approved research lifecycle operations.')
      if (name === 'db.resume_run' && typeof parsed.data === 'object' && parsed.data !== null && 'extendedBudgetMs' in parsed.data && parsed.data.extendedBudgetMs !== undefined) throw new McpToolError('permission_denied', 'Budget changes require owner approval in the UI.')
      if (actor.thread.kind === 'subagent' && typeof parsed.data === 'object' && parsed.data !== null) {
        const args = parsed.data as Record<string, unknown>
        if (typeof args['threadKey'] === 'string' && args['threadKey'] !== actor.thread.key) throw new McpToolError('permission_denied', 'Child conversations are isolated. Use the assigned parent brief.')
        for (const field of (name.startsWith('db.') ? ['sessionId', 'toSessionId'] : [])) {
          if (typeof args[field] === 'string' && args[field] !== actor.session.id) throw new McpToolError('permission_denied', 'This child is bound to its parent session.')
        }
      }
      const sectorId = actor.session.sectorId
      if (sectorId && typeof parsed.data === 'object' && parsed.data !== null) {
        const args = parsed.data as Record<string, unknown>
        if (typeof args['sectorId'] === 'string' && args['sectorId'] !== sectorId) throw new McpToolError('permission_denied', 'This execution is bound to another sector.')
        for (const field of (name.startsWith('db.') ? ['sessionId', 'toSessionId'] : [])) {
          if (typeof args[field] !== 'string') continue
          const target = await getSession(ctx.pool, args[field], ctx.scope)
          if (!target || target.sectorId !== sectorId) throw new McpToolError('permission_denied', 'Conversation is outside this sector.')
        }
        if (typeof args['threadKey'] === 'string') {
          const target = await requireThread(ctx.pool, args['threadKey'], ctx.scope)
          if (target.session.sectorId !== sectorId) throw new McpToolError('permission_denied', 'Thread is outside this sector.')
          if (name !== 'db.read_sector_thread' && (target.session.id !== actor.session.id || (actor.thread.kind === 'subagent' && target.thread.key !== actor.thread.key))) throw new McpToolError('permission_denied', 'Local conversations are isolated. Use shared context to communicate.')
        }
        if (['db.list_sessions','db.list_companies','db.research_health','db.query_document'].includes(name)) args['sectorId'] = sectorId
        if (name === 'db.create_artifact') args['producedBy'] = ctx.executionThread
      }
    }
    if (['db.send_message', 'db.steer_thread', 'db.pause_run', 'db.resume_run', 'db.cancel_run'].includes(name) && !ctx.messenger) throw new McpPreconditionError('Thread control is unavailable: no messenger attached.')
    if (['db.start_sector_research', 'db.pause_sector_research', 'db.resume_sector_research'].includes(name) && !ctx.runs) throw new McpPreconditionError('Research control is unavailable: no sweep runner attached.')
    if (['db.pause_run', 'db.resume_run', 'db.cancel_run'].includes(name) && (ctx.scope || ctx.executionThread)) {
      if (!ctx.runReader) throw new McpPreconditionError('A scoped run reader is required.')
      const run = await ctx.runReader.getRun((parsed.data as { runId: string }).runId)
      const target = run ? await getSession(ctx.pool, run.sessionId, ctx.scope) : undefined
      if (!run || !target) throw new McpToolError('permission_denied', 'Run is outside the authorized scope.')
      if (ctx.executionThread) {
        const actor = await requireThread(ctx.pool, ctx.executionThread, ctx.scope)
        if ((actor.thread.kind === 'subagent' && run.threadKey !== actor.thread.key) || (actor.session.sectorId && (target.sectorId !== actor.session.sectorId || target.id !== actor.session.id || (actor.thread.kind === 'subagent' && run.threadKey !== actor.thread.key)))) throw new McpToolError('permission_denied', 'Run is outside this conversation.')
      }
    }
    const invoker = INVOKERS[name] as (ctx: McpToolContext, args: unknown) => Promise<unknown>
    if (name === 'db.attach_sector_document') {
      const upload = parsed.data as { filename: string; contentBase64: string }
      if (isPdfDocumentUpload(upload.filename, upload.contentBase64) && (typeof ctx.fileProcessor?.startFileProcessing !== 'function' || !ctx.archive)) throw new McpPreconditionError('PDF attachment requires a file-processing runner and archive.')
    }
    dispatched = true
    return invoker(ctx, parsed.data)
  }
  try { return await (ctx.logger ? logOp(childLogger(ctx.logger, { op: 'tool.call' }), 'tool.call', work, { tool: name }) : work()) } catch (error) {
    if (!dispatched && typeof error === 'object' && error !== null) preDispatchFailures.add(error)
    throw error
  }
}

function toTextResult(value: unknown): string {
  return JSON.stringify(value ?? null) ?? 'null'
}

/** Builds the MCP server with every binding-table tool registered. A fresh
 * server is built per request (stateless transport), so handlers close over
 * the request's pool, scope, and role. With a grant, only allowed tools are
 * even listed (visibility), and invokeTool re-enforces it per call — a
 * grant narrows on top of role floors, never widens past them. */
export function createMcpServer(ctx: McpToolContext, grant: ToolGrant = {}): McpServer {
  const server = new McpServer({ name: 'kardata', version: '1.0.0' })
  const allow = grant.allow
  const names = allow !== undefined ? TOOL_NAMES.filter((name) => allow.has(name)) : TOOL_NAMES
  for (const name of names) {
    const meta = TOOL_META[name]
    server.registerTool(
      name,
      { description: meta.description, inputSchema: TOOL_SCHEMAS[name], annotations: { readOnlyHint: toolCapability(name) === 'read' } },
      async (args: Record<string, unknown>) => {
        try {
          const result = await invokeTool(name, ctx, args, grant)
          return { content: [{ type: 'text' as const, text: toTextResult(result) }] }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'internal error'
          const code = error instanceof McpPreconditionError ? error.wireCode : error instanceof McpToolError ? error.code : error instanceof WorkspaceError ? error.code : error instanceof DbContractError ? 'validation_failed' : 'internal'
          // Evidence failures carry the no-guess directive: the model reads
          // this text mid-research, and a bare code is what it used to
          // paper over with parametric knowledge.
          const directive =
            code === 'unconfigured' || code === 'blocked' || code === 'fetch_failed'
              ? ' Do not fill this gap from memory: report what you could not verify, or retry once with a narrower query.'
              : ''
          const text = code === 'internal' ? `${name}: internal error` : `${code}: ${message}${directive}`
          const beforeEffect = error instanceof ContextFileBlocked && ['db.propose_global_context','db.propose_file_context','db.commit_child_context'].includes(name) || error instanceof McpPreconditionError || (typeof error === 'object' && error !== null && preDispatchFailures.has(error))
          return { content: [{ type: 'text' as const, text }], isError: true, ...(beforeEffect ? { _meta: { 'kardata/retry-safe-before-effect': true } } : toolCapability(name) !== 'read' ? { _meta: { 'kardata/operation-uncertain': true } } : {}) }
        }
      },
    )
  }
  return server
}
