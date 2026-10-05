import { z } from 'zod'
import type { Scope } from '../auth/types.js'
import { createSession, getSession, listSessions, sessionKind } from './sessions.js'
import { DURABLE_STREAM_LOCK_SQL, readPartition, type Db } from './events.js'
import { getSector } from './sectors.js'
import { getThreadHeader, listThreadHeaders } from './threads.js'
import { type TransactableDb } from './checkpoints.js'
import { checked, DbContractError, Id, WorkspaceError } from './errors.js'
export { WorkspaceError } from './errors.js'
import { estimateTokens } from '@kardata/agents'

export const ContextFileRef = z.object({ readSectorId: z.string().min(1).optional(), fileId: z.string().min(1), hash: z.string().min(1), filename: z.string().min(1), ords: z.array(z.number().int().nonnegative()) }).strict()
export type ContextFileRef = z.infer<typeof ContextFileRef>

export const ContextSections = z.object({
  scope: z.string().max(24000).default(''), instructions: z.string().max(24000).default(''),
  decisions: z.string().max(24000).default(''),
  findings: z.string().max(48000).default(''), questions: z.string().max(24000).default(''),
}).strict()
export type ContextSections = z.infer<typeof ContextSections>
export const PartialContextSections = z.object({
  scope: z.string().max(24000).optional(), instructions: z.string().max(24000).optional(),
  decisions: z.string().max(24000).optional(),
  findings: z.string().max(48000).optional(), questions: z.string().max(24000).optional(),
}).strict()
export type PartialContextSections = z.infer<typeof PartialContextSections>
export interface GlobalContext {
  sectorId: string; version: number; sections: ContextSections; markdown: string
  researchSessionId: string | null; changes: ContextChange[]
  files: Array<{ fileId: string; filename: string; state: string; tokens: number; summary: string; error: string | null }>
  usage: GlobalContextUsage
}
export interface ContextChange {
  id: string; baseVersion: number; sections: ContextSections; sourceThread: string
  author: string; state: 'pending' | 'parent-review' | 'approved' | 'denied'; version: number | null; at: string
  sourceRefs?: ContextFileRef[]
  fileRef: { fileId: string; hash: string; filename: string; ords: number[] } | null
}
export interface ThreadContext { pendingResponse?: { round: number }; task?: string; sourceRefs?: ContextFileRef[]; contextBlocked?: string; pendingOperations?: Array<{ operationId: string; toolName: string; callId: string; reason: string }>; threadKey: string; notes: string; summary: string; coveredSeq: number; version: number; usage?: { inputTokens: number; budget: number; window: number; method: 'exact' | 'estimated' } }
export async function workspaceTransaction<T>(db: TransactableDb, key: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  checked(Id, key)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(DURABLE_STREAM_LOCK_SQL)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`workspace:${key}`])
    const tx: Db = { query: async <R>(text: string, params?: unknown[]) => {
      const result = await client.query(text, params)
      return { rows: result.rows as R[], rowCount: result.rowCount }
    } }
    const result = await fn(tx)
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
export async function requireSector(db: Db, sectorId: string, scope?: Scope) {
  checked(Id, sectorId)
  const sector = await getSector(db, sectorId, scope)
  if (!sector) throw new WorkspaceError('not_found', 'Sector not found.')
  return sector
}
export async function requireThread(db: Db, threadKey: string, scope?: Scope) {
  checked(Id, threadKey)
  const thread = await getThreadHeader(db, threadKey)
  const session = thread ? await getSession(db, thread.sessionId, scope) : undefined
  if (!thread || !session) throw new WorkspaceError('not_found', 'Conversation not found.')
  return { thread, session }
}
export async function ensureResearchSession(db: TransactableDb, sectorId: string, scope?: Scope) {
  await requireSector(db, sectorId, scope)
  return workspaceTransaction(db, sectorId, async (tx) => {
    const sector = await requireSector(tx, sectorId, scope)
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES ($1) ON CONFLICT DO NOTHING', [sectorId])
    const current = await tx.query<{ research_session_id: string | null }>('SELECT research_session_id FROM sector_workspace WHERE sector_id=$1', [sectorId])
    let sessionId = current.rows[0]?.research_session_id ?? sector.researchSessionId
    if (sessionId && (await getSession(tx, sessionId, scope))?.sectorId !== sectorId) sessionId = null
    if (!sessionId) {
      const events = await readPartition(tx, `sector:${sectorId}`)
      const planning = [...events].reverse().map((event) => ({ type: event.type, payload: z.object({ sessionId: z.string() }).safeParse(event.payload) })).find((event) => event.payload.success && event.type === 'sector.plan_started')
      const candidate = planning?.payload.success ? planning.payload.data.sessionId : undefined
      const found = typeof candidate === 'string' ? await getSession(tx, candidate, scope) : undefined
      if (found?.sectorId === sectorId) sessionId = found.id
    }
    if (!sessionId) sessionId = (await createSession(tx, 'Research', scope, sectorId)).id
    await tx.query('UPDATE sector_workspace SET research_session_id=$2 WHERE sector_id=$1', [sectorId, sessionId])
    const session = await getSession(tx, sessionId, scope)
    if (!session) throw new WorkspaceError('not_found', 'Research conversation not found.')
    return { ...session, kind: 'research' as const }
  })
}
export interface SectorSessionView {
  id: string
  kind: 'research' | 'normal'
  title: string
  updatedAt: string
  threadKeys: string[]
}

/** Every session of a sector with its thread keys, including agent:*
 * subagent threads. Sector chats read siblings through this. */
export async function listSectorSessions(db: Db, sectorId: string, scope?: Scope): Promise<SectorSessionView[]> {
  checked(Id, sectorId)
  const sessions = await listSessions(db, scope, sectorId)
  const views: SectorSessionView[] = []
  for (const session of sessions) {
    const headers = await listThreadHeaders(db, session.id)
    views.push({ id: session.id, kind: await sessionKind(db, session.id), title: session.title, updatedAt: session.updatedAt, threadKeys: headers.map((header) => header.key) })
  }
  return views
}

export async function researchSessionBinding(db: Db, sectorId: string): Promise<string | null> {
  checked(Id, sectorId)
  return (await workspaceRow(db, sectorId)).research_session_id
}
export interface SessionSettings { useGlobalContext: boolean; purpose: string }
/** Per-chat settings. A missing row means the defaults: switch on. */
export async function readSessionSettings(db: Db, sessionId: string): Promise<SessionSettings> {
  checked(Id, sessionId)
  const { rows } = await db.query<{ use_global_context: boolean; purpose: string }>('SELECT use_global_context,purpose FROM session_settings WHERE session_id=$1', [sessionId])
  const row = rows[0]
  return row ? { useGlobalContext: row.use_global_context, purpose: row.purpose } : { useGlobalContext: true, purpose: 'chat' }
}
/** Set the per-chat global context switch. Returns undefined for an
 * unknown session so routes answer 404. */
export async function setUseGlobalContext(db: Db, sessionId: string, value: boolean, scope?: Scope): Promise<SessionSettings | undefined> {
  checked(Id, sessionId)
  const session = await getSession(db, sessionId, scope)
  if (!session) return undefined
  const { rows } = await db.query<{ use_global_context: boolean; purpose: string }>(
    `INSERT INTO session_settings (session_id, use_global_context) VALUES ($1, $2)
     ON CONFLICT (session_id) DO UPDATE SET use_global_context=EXCLUDED.use_global_context, updated_at=now()
     RETURNING use_global_context, purpose`,
    [sessionId, value],
  )
  const row = rows[0]
  return row ? { useGlobalContext: row.use_global_context, purpose: row.purpose } : undefined
}
/** Set the per-chat purpose (chat or context-rewrite). Returns undefined
 * for an unknown session so routes answer 404. */
export async function setSessionPurpose(db: Db, sessionId: string, purpose: string, scope?: Scope): Promise<SessionSettings | undefined> {
  checked(Id, sessionId)
  const session = await getSession(db, sessionId, scope)
  if (!session) return undefined
  const { rows } = await db.query<{ use_global_context: boolean; purpose: string }>(
    `INSERT INTO session_settings (session_id, purpose) VALUES ($1, $2)
     ON CONFLICT (session_id) DO UPDATE SET purpose=EXCLUDED.purpose, updated_at=now()
     RETURNING use_global_context, purpose`,
    [sessionId, purpose],
  )
  const row = rows[0]
  return row ? { useGlobalContext: row.use_global_context, purpose: row.purpose } : undefined
}

interface WorkspaceRow { context_version: number; sections: unknown; research_session_id: string | null; protected_decisions: string; section_file_refs?: Record<string, ContextFileRef[] | null> }
/** Shared workspace-row read for the workspace slices. */
export async function workspaceRow(db: Db, sectorId: string): Promise<WorkspaceRow> {
  const { rows } = await db.query<WorkspaceRow>('SELECT * FROM sector_workspace WHERE sector_id=$1', [sectorId])
  return rows[0] ?? { context_version: 0, sections: {}, research_session_id: null, protected_decisions: '' }
}

const GLOBAL_CONTEXT_BUDGET_TOKENS = 30000
export interface GlobalContextUsage {
  total: number; budget: number; method: 'estimated'
  bySection: { scope: number; instructions: number; decisions: number; findings: number; questions: number }
  byFile: Array<{ fileId: string; tokens: number }>
  aiUsage: { calls: number; inputTokens: number; outputTokens: number }
}
export function globalContextUsageFrom(sections: ContextSections, blocks: Array<{ fileId: string; tokens: number }>): Omit<GlobalContextUsage, 'aiUsage'> {
  const bySection = {
    scope: estimateTokens(sections.scope), instructions: estimateTokens(sections.instructions),
    decisions: estimateTokens(sections.decisions), findings: estimateTokens(sections.findings),
    questions: estimateTokens(sections.questions),
  }
  const byFile = blocks.map((block) => ({ fileId: block.fileId, tokens: block.tokens }))
  const total = bySection.scope + bySection.instructions + bySection.decisions + bySection.findings + bySection.questions + byFile.reduce((sum, file) => sum + file.tokens, 0)
  return { total, budget: GLOBAL_CONTEXT_BUDGET_TOKENS, method: 'estimated', bySection, byFile }
}

export interface ThreadHealth {
  threadKey: string; sessionId: string; sectorId?: string; kind: string; status: string
  acceptingSteer: boolean; queueDepth: number; updatedAt: string
  lastRound: { round: number; attempt: number; model: string; outcome: string; errorCode: string | null; latencyMs: number | null; at: string } | null
  stalled: boolean
}

/** One thread's liveness snapshot: projected state plus its latest
 * provider round. Stalled mirrors the no-progress threshold in
 * temporal/timeouts.ts (15 min), which this layer cannot import. */
export async function threadHealth(db: Db, threadKey: string, scope?: Scope, now: Date = new Date()): Promise<ThreadHealth> {
  const identity = await requireThread(db, threadKey, scope)
  const { rows } = await db.query<{
    round: number; attempt: number; model: string; outcome: string
    error_code: string | null; latency_ms: number | null; finished_at: Date | null; started_at: Date
  }>(`SELECT round, attempt, model, outcome, error_code, latency_ms, finished_at, started_at
      FROM execution_rounds WHERE thread_key = $1 ORDER BY round DESC, attempt DESC LIMIT 1`, [threadKey])
  const last = rows[0]
  const lastAt = last ? new Date(last.finished_at ?? last.started_at).getTime() : new Date(identity.thread.updatedAt).getTime()
  const live = !['FINISHED', 'ERROR', 'PAUSED', 'SUSPENDED'].includes(identity.thread.status)
  return {
    threadKey, sessionId: identity.session.id, ...(identity.session.sectorId ? { sectorId: identity.session.sectorId } : {}),
    kind: identity.thread.kind, status: identity.thread.status, acceptingSteer: identity.thread.acceptingSteer,
    queueDepth: identity.thread.queueDepth, updatedAt: identity.thread.updatedAt,
    lastRound: last ? { round: last.round, attempt: last.attempt, model: last.model, outcome: last.outcome, errorCode: last.error_code, latencyMs: last.latency_ms, at: new Date(last.finished_at ?? last.started_at).toISOString() } : null,
    stalled: live && now.getTime() - lastAt > 15 * 60 * 1000,
  }
}

export interface RecentActivity {
  rounds: Array<{ round: number; attempt: number; model: string; outcome: string; errorCode: string | null; latencyMs: number | null; inputTokens: number | null; outputTokens: number | null; at: string }>
  toolCalls: Array<{ tool: string; argsHash: string; outcome: string; errorCode: string | null; latencyMs: number | null; at: string }>
  events: Array<{ seq: number; type: string; at: string }>
}

interface ActivityRoundRow {
  round: number; attempt: number; model: string; outcome: string; error_code: string | null
  latency_ms: number | null; input_tokens: number | null; output_tokens: number | null
  finished_at: Date | null; started_at: Date; session_id: string | null; thread_key: string
}
interface ActivityCallRow { tool: string; args_hash: string; outcome: string; error_code: string | null; latency_ms: number | null; at: Date }
interface ActivityEventRow { seq: string; type: string; at: Date }

function toRecentActivity(rounds: ActivityRoundRow[], calls: ActivityCallRow[], events: ActivityEventRow[]): RecentActivity {
  return {
    rounds: rounds.map((row) => ({ round: row.round, attempt: row.attempt, model: row.model, outcome: row.outcome, errorCode: row.error_code, latencyMs: row.latency_ms, inputTokens: row.input_tokens, outputTokens: row.output_tokens, at: new Date(row.finished_at ?? row.started_at).toISOString() })),
    toolCalls: calls.map((row) => ({ tool: row.tool, argsHash: row.args_hash, outcome: row.outcome, errorCode: row.error_code, latencyMs: row.latency_ms, at: new Date(row.at).toISOString() })),
    events: events.map((row) => ({ seq: Number(row.seq), type: row.type, at: new Date(row.at).toISOString() })),
  }
}

/** Recent execution evidence by trace or thread, newest first, each
 * source capped at limit (default 50, max 200). No bodies or refs: use
 * read_sector_thread for transcript detail. A trace touching a session
 * outside the scope fails closed rather than redacting. */
export async function recentActivity(db: Db, selector: { traceId?: string; threadKey?: string; limit?: number }, scope?: Scope): Promise<RecentActivity> {
  const limit = selector.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new DbContractError('limit must be an integer 1..200')
  if ((selector.traceId ? 1 : 0) + (selector.threadKey ? 1 : 0) !== 1) throw new DbContractError('exactly one of traceId, threadKey is required')
  if (selector.threadKey) {
    const identity = await requireThread(db, selector.threadKey, scope)
    const partition = identity.thread.kind === 'subagent' ? `child:${selector.threadKey.slice('agent:'.length)}` : `session:${identity.session.id}`
    const [rounds, calls, events] = await Promise.all([
      db.query<ActivityRoundRow>(`SELECT round, attempt, model, outcome, error_code, latency_ms, input_tokens, output_tokens, finished_at, started_at, session_id, thread_key
        FROM execution_rounds WHERE thread_key = $1 ORDER BY round DESC, attempt DESC LIMIT $2`, [selector.threadKey, limit]),
      db.query<ActivityCallRow>(`SELECT tool, args_hash, outcome, error_code, latency_ms, at
        FROM tool_calls WHERE thread_key = $1 ORDER BY at DESC, id DESC LIMIT $2`, [selector.threadKey, limit]),
      db.query<ActivityEventRow>(`SELECT seq, type, at FROM events WHERE partition = $1 AND payload->>'threadKey' = $2 ORDER BY seq DESC LIMIT $3`, [partition, selector.threadKey, limit]),
    ])
    return toRecentActivity(rounds.rows, calls.rows, events.rows)
  }
  const traceId = selector.traceId as string
  const rounds = await db.query<ActivityRoundRow>(`SELECT round, attempt, model, outcome, error_code, latency_ms, input_tokens, output_tokens, finished_at, started_at, session_id, thread_key
    FROM execution_rounds WHERE trace_id = $1 ORDER BY round DESC, attempt DESC LIMIT $2`, [traceId, limit])
  if (scope) {
    for (const sessionId of new Set(rounds.rows.map((row) => row.session_id).filter((id): id is string => typeof id === 'string' && id.length > 0))) {
      if (!(await getSession(db, sessionId, scope))) throw new WorkspaceError('permission_denied', 'Trace touches a conversation outside the authorized scope.')
    }
  }
  const [calls, events] = await Promise.all([
    db.query<ActivityCallRow>(`SELECT c.tool, c.args_hash, c.outcome, c.error_code, c.latency_ms, c.at
      FROM tool_calls c JOIN execution_rounds r ON r.id = c.round_id WHERE r.trace_id = $1 ORDER BY c.at DESC, c.id DESC LIMIT $2`, [traceId, limit]),
    db.query<ActivityEventRow>(`SELECT seq, type, at FROM events WHERE trace_id = $1 ORDER BY seq DESC LIMIT $2`, [traceId, limit]),
  ])
  return toRecentActivity(rounds.rows, calls.rows, events.rows)
}
