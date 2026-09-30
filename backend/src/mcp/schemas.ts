// MCP tool input schemas (Phase 2). One entry per row of the MCP binding
// table in documentation/db.md, excluding projector-only
// publishOutboxFrame/runCheckpointTx. Schemas reuse the db layer's exported
// zod schemas (EventEnvelope, SectorState, CompanyStage) so tool inputs and
// layer validation cannot drift; the remaining shapes mirror the layer's
// inline validation one-to-one. A test pins the match
// (tests/backend/mcp.tools.test.ts).
import { z } from 'zod'
import {
  CompanyStage,
  EventEnvelope,
  LedgerQualification,
  RecordProblemInput,
  SectorState,
  UpsertCompanyInput,
} from '../db/index.js'

const NonEmpty = z.string().min(1)
const AfterSeq = z.number().int().min(0)
const StateFilter = SectorState
const QueryFilter = z.string().max(200)
const SectorIdFilter = NonEmpty.optional()
const PageLimit = z.number().int().min(1).max(500).optional()
const PageOffset = z.number().int().min(0).optional()

const StoredEvent = z.object({
  seq: z.number().int().min(0),
  idempotencyKey: NonEmpty,
  partition: NonEmpty,
  type: NonEmpty,
  payload: z.unknown(),
  redacted: z.boolean(),
  at: z.string(),
})

const ArtifactScope = z.object({
  kind: z.enum(['session', 'task']),
  id: NonEmpty,
})

export const TOOL_SCHEMAS = {
  'db.append_event': EventEnvelope,
  'db.read_partition': z.object({
    partition: NonEmpty,
    afterSeq: AfterSeq.optional(),
  }),
  'db.find_event': z.object({
    idempotencyKey: NonEmpty,
  }),
  'db.read_events_after': z.object({
    fromSeq: AfterSeq,
    limit: z.number().int().positive(),
  }),
  'db.create_session': z.object({
    title: NonEmpty,
  }),
  'db.rename_session': z.object({
    sessionId: NonEmpty,
    title: NonEmpty,
  }),
  'db.delete_session': z.object({
    sessionId: NonEmpty,
  }),
  'db.get_session': z.object({
    sessionId: NonEmpty,
  }),
  'db.list_sessions': z.object({
    /** Narrows to one sector's chats; without it only general sessions list. */
    sectorId: NonEmpty.optional(),
  }),
  'db.list_sectors': z.object({
    state: StateFilter.optional(),
    query: QueryFilter.optional(),
  }),
  'db.get_sector': z.object({
    sectorId: NonEmpty,
  }),
  'db.list_companies': z.object({
    state: StateFilter.optional(),
    query: QueryFilter.optional(),
    sectorId: SectorIdFilter,
    limit: PageLimit,
    offset: PageOffset,
  }),
  'db.list_sector_companies': z.object({
    sectorId: NonEmpty,
    state: StateFilter.optional(),
    query: QueryFilter.optional(),
    limit: PageLimit,
    offset: PageOffset,
  }),
  'db.sector_activity': z.object({
    sectorId: NonEmpty,
    limit: PageLimit,
    offset: PageOffset,
  }),
  'db.create_sector': z.object({
    name: NonEmpty,
    topic: z.string().optional(),
    sectorId: NonEmpty.optional(),
    idempotencyKey: NonEmpty.optional(),
    state: SectorState.optional(),
  }),
  'db.attach_sector_document': z.object({
    sectorId: NonEmpty,
    filename: NonEmpty,
    contentBase64: NonEmpty,
  }),
  'db.list_sector_documents': z.object({
    sectorId: NonEmpty,
  }),
  'db.read_sector_document': z.object({
    sectorId: NonEmpty,
    documentId: NonEmpty,
  }),
  'db.query_document': z.object({
    documentId: NonEmpty,
    sectorId: NonEmpty.optional(),
    mode: z.enum(['summary', 'chunks']).optional(),
    query: z.string().max(500).optional(),
    ords: z.number().int().min(0).array().max(50).optional(),
  }),
  'db.set_sector_state': z.object({
    sectorId: NonEmpty,
    state: SectorState,
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.start_sector_research': z.object({
    sectorId: NonEmpty,
    /** Calling chat: recorded on the sector so the chat pins the research.
     * Must exist and belong to the sector. */
    sessionId: NonEmpty.optional(),
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.pause_sector_research': z.object({
    sectorId: NonEmpty,
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.resume_sector_research': z.object({
    sectorId: NonEmpty,
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.mark_company_found': z.object({
    sectorId: NonEmpty,
    name: NonEmpty,
    stage: CompanyStage.optional(),
    state: SectorState.optional(),
    companyId: NonEmpty.optional(),
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.set_company_stage': z.object({
    companyId: NonEmpty,
    stage: CompanyStage,
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.set_company_state': z.object({
    companyId: NonEmpty,
    state: SectorState,
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.list_artifacts': z.object({
    sessionId: NonEmpty,
  }),
  'db.create_artifact': z.object({
    sessionId: NonEmpty,
    name: NonEmpty,
    content: z.string().min(1),
    kind: z.enum(['file', 'report', 'proposal']).optional(),
    detail: z.string().max(1000).optional(),
    reason: z.enum(['subagent_output', 'user_upload', 'report', 'proposal']).optional(),
  }),
  'db.reference_artifact': z.object({
    artifactId: NonEmpty,
    fromScope: ArtifactScope,
    toSessionId: NonEmpty,
  }),
  'db.resolve_artifact_scope': z.object({
    sessionId: NonEmpty,
    artifactId: NonEmpty,
  }),
  'db.list_tenant_artifacts': z.object({
    tenantId: NonEmpty.optional(),
    projectId: NonEmpty.nullable().optional(),
  }),
  'db.find_launch_parent': z.object({
    childId: NonEmpty,
  }),
  'db.get_thread': z.object({
    threadKey: NonEmpty,
  }),
  'db.send_message': z.object({
    threadKey: NonEmpty,
    text: z.string().min(1).max(8000),
  }),
  'db.steer_thread': z.object({
    threadKey: NonEmpty,
    text: z.string().min(1).max(8000),
  }),
  'db.pause_run': z.object({
    runId: NonEmpty,
  }),
  'db.resume_run': z.object({
    runId: NonEmpty,
    extendedBudgetMs: z.number().int().positive().optional(),
  }),
  'db.cancel_run': z.object({
    runId: NonEmpty,
  }),
  'db.research_health': z.object({
    sectorId: NonEmpty,
  }),
  'db.list_threads': z.object({
    sessionId: NonEmpty,
  }),
  'db.project_batch': z.object({
    events: z.array(StoredEvent),
  }),
  'db.record_heartbeat': z.object({
    runId: NonEmpty,
    op: NonEmpty,
    busy: z.boolean(),
    nowMs: z.number().finite().optional(),
  }),
  'db.list_heartbeats': z.object({}),
  'db.read_outbox': z.object({
    threadKey: NonEmpty,
    afterSeq: AfterSeq.optional(),
    limit: z.number().int().positive().max(5000).optional(),
  }),
  'db.subscribe_outbox': z.object({
    timeoutMs: z.number().int().positive().max(30_000).optional(),
  }),
  'db.project_usage': z.object({
    events: z.array(StoredEvent),
  }),
  'db.run_totals': z.object({
    runId: NonEmpty,
  }),
  'db.fleet_totals': z.object({}),
  'db.find_key': z.object({
    keyHash: NonEmpty,
  }),
  'db.check_rate': z.object({
    bucket: NonEmpty,
    limitPerMin: z.number().int().positive(),
    nowMs: z.number().finite().optional(),
  }),
  'db.claim_idempotency': z.object({
    key: NonEmpty,
    fingerprint: NonEmpty,
  }),
  'db.complete_idempotency': z.object({
    key: NonEmpty,
    status: z.number().int().min(100).max(599),
    body: z.unknown().optional(),
  }),
  'db.release_idempotency': z.object({
    key: NonEmpty,
  }),
  'db.kb_search': z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  'db.update_sector_plan': z.object({
    sectorId: NonEmpty,
    markdown: z.string().min(1).max(8000),
    idempotencyKey: NonEmpty.optional(),
  }),
  'db.delegate_subagent': z.object({
    sessionId: NonEmpty,
    goal: z.string().min(1).max(8000),
    mode: z.enum(['empty', 'fork']).optional(),
    queueCapacity: z.number().int().min(1).max(32).optional(),
  }),
  'web_search': z.object({
    query: z.string().min(2).max(300),
    count: z.number().int().min(1).max(20).optional(),
    page: z.number().int().min(0).max(100).optional(),
  }),
  'web_fetch': z.object({
    url: NonEmpty,
  }),
  'browser_navigate': z.object({
    url: NonEmpty,
  }),
  'browser_snapshot': z.object({
    sessionId: NonEmpty,
  }),
  'browser_act': z.object({
    sessionId: NonEmpty,
    kind: z.enum(['click', 'fill', 'press', 'scroll']),
    selector: z.string().min(1).max(500).optional(),
    text: z.string().max(4000).optional(),
    key: z.string().min(1).max(40).optional(),
    direction: z.enum(['up', 'down']).optional(),
    pixels: z.number().int().min(100).max(5000).optional(),
  }),
  'browser_close': z.object({
    sessionId: NonEmpty,
  }),
  'browser_screenshot': z.object({
    sessionId: NonEmpty,
    fullPage: z.boolean().optional(),
  }),
  'db.ledger_upsert_company': UpsertCompanyInput,
  'db.ledger_get_company': z.object({
    companyId: NonEmpty,
  }),
  'db.ledger_list_companies': z.object({
    qualification: LedgerQualification.optional(),
    sector: z.string().max(120).optional(),
    query: QueryFilter.optional(),
  }),
  'db.ledger_record_problem': RecordProblemInput,
  'db.ledger_list_problems': z.object({
    companyId: NonEmpty,
  }),
}

export type McpToolName = keyof typeof TOOL_SCHEMAS

export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as McpToolName[]
