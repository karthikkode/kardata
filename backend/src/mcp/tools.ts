import { agentHistoryBoundary, ContextFileBlocked, recordThreadFileExposure, assertThreadFileContext, validateFileRefs } from '../db/context-files.js'
import { assertGlobalFileContext, sessionKind } from '../db/workspace.js'
// MCP tool bindings (Phase 2). Each tool wires one semantic operation
// from the binding table in documentation/db.md — the server adds
// auth, transport, and tool schemas, never SQL. Projector-only
// publishOutboxFrame/runCheckpointTx are intentionally absent.
import { McpServer } from '@modelcontextprotocol/server'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { Role, Scope } from '../auth/keys.js'
import { roleLevelAtLeast } from '../auth/keys.js'
import { childLogger, logOp } from '../observability/logging.js'

/** Role ladder lives in auth/keys.ts (viewer < operator < approver). */
import {
  appendEvent,
  readGlobalContext, proposeGlobalContext, readThreadContext, listSectorLibrary, proposeFileContext, requireThread, WorkspaceError, commitChildContext,
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
  listSectors,
  listSessions,
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
  readSectorDocument,
  readSectorPlan,
  readSectorThread,
  recordHeartbeat,
  recordLedgerProblem,
  deleteSession,
  renameSession,
  researchHealth,
  searchKb,
  referenceArtifact,
  releaseIdempotency,
  pauseSectorSweep,
  resolveArtifactScope,
  buildInheritedContext,
  saveInheritedContext,
  resumeSectorSweep,
  cancelThreadRun,
  pauseThreadRun,
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
  type SectorSweepRunner,
  subscribeOutbox,
  type ThreadMessenger,
  type TransactableDb,
  upsertLedgerCompany,
  updateSectorPlan,
} from '../db/index.js'
import { RunNotFound, ThreadNotAccepting, type SubagentDelegator } from '../temporal/gateway.js'
import { TOOL_NAMES, TOOL_SCHEMAS, type McpToolName } from './schemas.js'
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
import type { ArchiveTarget } from '../archive/targets.js'
import { attachSectorDocument, isPdfDocumentUpload, type FileProcessorRunner } from '../file-ingestion.js'

type BrowserActArgs = BrowserAct

export interface McpToolContext {
  /** Trusted file-processing capability; PDF attachment fails before effects
   * when absent. Model arguments cannot install a runner or choose authority. */
  fileProcessor?: FileProcessorRunner
  runReader?: { getRun(runId: string): Promise<{ sessionId: string; threadKey: string } | null> }
  executionThread?: string
  pool: TransactableDb
  scope: Scope | undefined
  role: Role
  /** Caller key id: idempotency keys are namespaced per caller, matching
   * the HTTP withIdempotency `${keyId}:${key}` convention. */
  keyId: string
  /** Sweep runner for research-start tools. Absent (tests, minimal embeds):
   * start tools fail closed instead of half-starting a sector. */
  runs?: SectorSweepRunner
  /** Subagent delegator for the delegation door. Absent: delegate calls
   * fail closed instead of half-launching a child. */
  delegator?: SubagentDelegator
  /** Thread messenger (runs gateway) for Karbot steering tools. Absent
   * outside the server: send/steer fail closed instead of half-signaling. */
  messenger?: ThreadMessenger
  /** Archive target for file body storage. Absent: the layer resolves its
   * default (filesystem dev target, GCS when configured). */
  archive?: ArchiveTarget
  /** Optional join-key logger. When present every tool execution emits the
   * start/done/error triple (op tool.call, tool name, latencyMs, outcome)
   * so cross-module calls always leave evidence. Absent in unit tests. */
  logger?: Logger
}

/** Ownership is derived only from validated server context, never tool arguments. */
function browserCaller(ctx: McpToolContext): string {
  return JSON.stringify([ctx.scope?.tenantId ?? null, ctx.scope?.projectId ?? null, ctx.keyId, ctx.executionThread ?? null])
}

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
      'Launch a leaf subagent researcher on a session goal (Karbot-only, operator). The child researches independently and reports back; collect via session threads. Pilot children never delegate further.',
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

const INVOKERS: Invokers = {
  'db.commit_child_context': async (ctx, args) => { const identity = await workspaceIdentity(ctx); await assertThreadFileContext(ctx.pool, identity.threadKey, ctx.scope); return commitChildContext(ctx.pool, identity.threadKey, args.proposalId, ctx.scope) },
  'db.get_global_context': async (ctx, args) => {
    const actor = ctx.executionThread ? await requireThread(ctx.pool, ctx.executionThread, ctx.scope) : undefined
    const sectorId = actor?.session.sectorId ?? args.sectorId
    if (!sectorId) throw new McpToolError('validation_failed', 'Specify sectorId outside a sector conversation.')
    if (actor?.session.sectorId && args.sectorId && args.sectorId !== actor.session.sectorId) throw new McpToolError('permission_denied', 'This execution is bound to another sector.')
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
    const identity = await workspaceIdentity(ctx)
    await assertThreadFileContext(ctx.pool, identity.threadKey, ctx.scope)
    return proposeGlobalContext(ctx.pool, { ...args, sectorId: identity.sectorId, sourceThread: identity.threadKey, owner: false, trustedResearch: true, scope: ctx.scope, id: `${identity.sectorId}:${scopedIdempotencyKey(ctx, args.idempotencyKey)}` })
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
  'db.get_sector_plan': async (ctx) => {
    const identity = await workspaceIdentity(ctx)
    return readSectorPlan(ctx.pool, identity.sectorId, ctx.scope)
  },
  'db.get_research_progress': async (ctx) => {
    const identity = await workspaceIdentity(ctx)
    return readResearchProgress(ctx.pool, identity.sectorId, ctx.scope)
  },
  'db.list_sector_sessions': async (ctx) => {
    const identity = await workspaceIdentity(ctx)
    return listSectorSessions(ctx.pool, identity.sectorId, ctx.scope)
  },
  'db.read_sector_thread': async (ctx, args) => {
    await workspaceIdentity(ctx)
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
    return ctx.delegator.delegateSubagent({
      sessionId: args.sessionId,
      goal,
      name: `Subagent ${siblings.length + 1}`,
      mode: args.mode ?? 'empty',
      queueCapacity: args.queueCapacity ?? 8,
      onAccepted: async (childId) => {
        await saveInheritedContext(ctx.pool, `agent:${childId}`, await buildInheritedContext(ctx.pool, parentThread))
      },
    })
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
}

/** Tool-level failure: answered as an MCP isError result, never thrown. */
export class McpToolError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Only explicit pre-dispatch failures may release a mutation replay guard. */
class McpPreconditionError extends DbContractError {
  readonly wireCode = 'unconfigured'
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

/** Skill-scoped grant: when present, only the listed tools may run. Skill
 * invocation passes its declared tool set so one skill can never reach
 * another skill's (or sensitive plumbing) tools. */
export interface ToolGrant {
  allow?: ReadonlySet<McpToolName>
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
