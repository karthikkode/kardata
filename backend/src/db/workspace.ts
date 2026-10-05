import { bindExecutionEpoch, recoveryCheckpointHash, type EpochOwnership } from './execution-epochs.js'
import type { PendingProviderResponse, RecoveryOperation } from '@kardata/agents'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { serveArtifact } from '../artifacts/pipeline.js'
import type { ArchiveTarget } from '../archive/targets.js'
import type { Scope } from '../auth/keys.js'
import { appendEvent, createSession, findEventByKey, getSession, listArtifacts, listSessions, readPartition, resolveArtifactScope, type Db } from './events.js'
import { getSector } from './sectors.js'
import { getThreadHeader, listThreadHeaders } from './threads.js'
import { DURABLE_STREAM_LOCK_SQL, type TransactableDb } from './checkpoints.js'
import { DbContractError, WorkspaceError } from './errors.js'
export { WorkspaceError } from './errors.js'
import { publishOutboxFrame } from './outbox.js'
import { ingestSectorDocument, listSectorDocuments, readOriginalSectorDocument } from './sector-documents.js'
import { listSectorFileProcessing, type FileProcessingProgress } from './file-jobs.js'
import { listDocumentUnits } from './document-units.js'
import { progressSummary, type WorkItem } from '../temporal/research-plan.js'
import { discoverySample } from '../temporal/discovery-acceptance.js'
import { readSectorPlan, type SectorPlan } from './sector-plan.js'
import type { ChatMessage, Usage } from '@kardata/agents'
import { estimateTokens } from '@kardata/agents'
import { assertThreadFileContext, ContextFileBlocked, mergeFileRefs, threadFileRefs, validateFileRefs, recordThreadFileExposure, insertContextFileBlock, listContextFileBlocks, markContextFileBlockFailed, readContextFileBlock, resetContextFileBlock, type ContextFileRef } from './context-files.js'
import { createLogger, logOp } from '../observability/logging.js'

const workspaceLogger = createLogger({ op: 'workspace' })

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
const Id = z.string().min(1).max(255)
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new DbContractError(result.error.issues[0]?.message ?? 'invalid workspace input')
  return result.data
}
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
export async function sessionKind(db: Db, sessionId: string): Promise<'research' | 'normal'> {
  checked(Id, sessionId)
  const { rows } = await db.query('SELECT sector_id FROM sector_workspace WHERE research_session_id=$1', [sessionId])
  return rows.length ? 'research' : 'normal'
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
export interface ContextFileBlockView { fileId: string; filename: string; summary: string; addedVersion: number | null }
export function formatGlobalContext(sections: ContextSections, blocks?: ContextFileBlockView[]): string {
  const parts = (['scope', 'instructions', 'decisions', 'findings', 'questions'] as const).flatMap((key) => {
    const title = { scope: 'Scope', instructions: 'Instructions', decisions: 'Decisions', findings: 'Findings', questions: 'Open questions' }[key]
    return sections[key].trim() ? [`## ${title}\n\n${sections[key].trim()}`] : []
  })
  // Files are not a text section: ready block summaries render here,
  // ordered by added version then filename.
  const ready = (blocks ?? []).filter((block) => block.summary.trim()).sort((a, b) => (a.addedVersion ?? 0) - (b.addedVersion ?? 0) || a.filename.localeCompare(b.filename))
  if (ready.length) parts.push(`## Files\n\n${ready.map((block) => block.summary.trim()).join('\n\n')}`)
  return parts.join('\n\n')
}
interface WorkspaceRow { context_version: number; sections: unknown; research_session_id: string | null; protected_decisions: string; section_file_refs?: Record<string, ContextFileRef[] | null> }
async function workspaceRow(db: Db, sectorId: string): Promise<WorkspaceRow> {
  const { rows } = await db.query<WorkspaceRow>('SELECT * FROM sector_workspace WHERE sector_id=$1', [sectorId])
  return rows[0] ?? { context_version: 0, sections: {}, research_session_id: null, protected_decisions: '' }
}
interface ChangeRow { id: string; sector_id: string; base_version: number; sections: unknown; source_thread: string; author: string; state: ContextChange['state']; version: number | null; at: Date | string; file_ref: ContextChange['fileRef']; source_refs?: ContextFileRef[] | null }
function changeView(row: ChangeRow): ContextChange {
  return { id: row.id, baseVersion: row.base_version, sections: checked(ContextSections, row.sections), sourceThread: row.source_thread, author: row.author, state: row.state, version: row.version, at: new Date(row.at).toISOString(), fileRef: row.file_ref, ...(row.source_refs ? { sourceRefs: row.source_refs } : {}) }
}
async function persistSectionFileRefs(db: Db, sectorId: string, current: ContextSections, proposed: ContextSections, refs: ContextFileRef[], previous?: Record<string, ContextFileRef[] | null>) {
  const sections = { ...(previous ?? {}) }
  for (const key of ['scope','instructions','decisions','findings','questions'] as const) if (current[key] !== proposed[key]) sections[key] = refs
  await db.query('UPDATE sector_workspace SET section_file_refs=$2::jsonb WHERE sector_id=$1', [sectorId, JSON.stringify(sections)])
}
export async function assertGlobalFileContext(db: Db, sectorId: string, scope?: Scope): Promise<void> {
  await requireSector(db, sectorId, scope)
  const row = await workspaceRow(db, sectorId)
  const sections = checked(ContextSections, row.sections)
  for (const key of ['scope','instructions','decisions','findings','questions'] as const) if (sections[key] && row.section_file_refs?.[key] === null) throw new ContextFileBlocked('Legacy shared context has unverified file provenance. Owner must review and republish its current content before agents can use it.')
  await validateFileRefs(db, sectorId, mergeFileRefs(...Object.values(row.section_file_refs ?? {})), scope)
}
export async function readGlobalContext(db: Db, sectorId: string, scope?: Scope, includeHistory = true): Promise<GlobalContext> {
  const sector = await requireSector(db, sectorId, scope)
  const row = await workspaceRow(db, sectorId)
  const sections = checked(ContextSections, row.sections)
  if (!sections.scope && row.context_version === 0) sections.scope = sector.topic || sector.name
  const changes = includeHistory ? await db.query<ChangeRow>('SELECT * FROM workspace_changes WHERE sector_id=$1 ORDER BY at DESC LIMIT 100', [sectorId]) : { rows: [] }
  const library = new Map((await listSectorLibrary(db, sectorId, scope)).map((file) => [file.id, file]))
  const blocks = await listContextFileBlocks(db, sectorId)
  const views = blocks
    .filter((block) => {
      if (block.state !== 'ready') return false
      const file = library.get(block.fileId)
      return !!file && !file.hidden && file.hash === block.hash
    })
    .sort((a, b) => (a.addedVersion ?? 0) - (b.addedVersion ?? 0) || a.filename.localeCompare(b.filename))
    .map((block) => ({ fileId: block.fileId, filename: block.filename, summary: block.summary, addedVersion: block.addedVersion }))
  return {
    sectorId, version: row.context_version, sections, markdown: formatGlobalContext(sections, views),
    researchSessionId: row.research_session_id, changes: changes.rows.map(changeView),
    files: blocks.map((block) => ({ fileId: block.fileId, filename: block.filename, state: block.state, tokens: block.tokens, summary: block.summary, error: block.error })),
    usage: { ...globalContextUsageFrom(sections, blocks), aiUsage: await readContextAiUsage(db, sectorId, scope) },
  }
}
export async function notifyWorkspace(db: Db, sectorId: string, type: 'context-version' | 'approval' | 'work-progress', payload: unknown): Promise<void> {
  checked(Id, sectorId)
  checked(z.enum(['context-version', 'approval', 'work-progress']), type)
  const sessions = await listSessions(db, undefined, sectorId)
  for (const session of sessions) {
    for (const thread of await listThreadHeaders(db, session.id)) await publishOutboxFrame(db, thread.key, type, payload)
  }
}
export async function proposeGlobalContext(db: TransactableDb, input: {
  sectorId: string; baseVersion: number; sections: PartialContextSections; sourceThread: string; owner: boolean; scope?: Scope; id?: string
  fileRef?: NonNullable<ContextChange['fileRef']>
  trustedResearch?: boolean
}): Promise<ContextChange> {
  const patch = checked(PartialContextSections, input.sections)
  checked(z.number().int().nonnegative(), input.baseVersion)
  checked(Id, input.sectorId)
  checked(Id, input.sourceThread)
  await requireSector(db, input.sectorId, input.scope)
  const identity = input.owner ? undefined : await requireThread(db, input.sourceThread, input.scope)
  if (identity && identity.session.sectorId !== input.sectorId) throw new WorkspaceError('permission_denied', 'Conversation belongs to another sector.')
  if (identity && !input.fileRef) await assertThreadFileContext(db, input.sourceThread, input.scope)
  return workspaceTransaction(db, input.sectorId, async (tx) => {
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    const id = checked(Id, input.id ?? randomUUID())
    const old = await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1 AND sector_id=$2', [id, input.sectorId])
    if (old.rows[0]) return changeView(old.rows[0])
    if (row.context_version !== input.baseVersion) throw new WorkspaceError('conflict', 'Global context changed. Review the latest version.')
    const researchParent = input.trustedResearch === true && identity?.session.id === row.research_session_id && identity.thread.kind === 'session'
    // Every agent write needs owner approval: only the owner approves
    // directly. Research subagents land in parent-review first; the
    // parent commit forwards them as pending owner proposals.
    let state: ContextChange['state'] = input.owner ? 'approved' : input.trustedResearch && identity?.session.id === row.research_session_id && identity.thread.kind === 'subagent' ? 'parent-review' : 'pending'
    const currentSections = checked(ContextSections, row.sections)
    if (!currentSections.scope && row.context_version === 0) { const sector = await requireSector(tx, input.sectorId, input.scope); currentSections.scope = sector.topic || sector.name }
    // PATCH semantics: provided keys merge onto current; omitted keys
    // stay byte-identical; explicit '' clears. The stored proposal is
    // the merged whole, so approval applies a complete document.
    const sections: ContextSections = { ...currentSections }
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) sections[key as keyof ContextSections] = value
    if (!input.fileRef && (['scope','instructions','decisions','findings','questions'] as const).every((key) => sections[key] === currentSections[key])) throw new WorkspaceError('validation_failed', 'Proposal changes no section.')
    const onlyFileInclusion = Boolean(input.fileRef) && (['scope','instructions','decisions','findings','questions'] as const).every((key) => sections[key] === currentSections[key])
    if (identity && input.fileRef && !onlyFileInclusion) await assertThreadFileContext(tx, input.sourceThread, input.scope)
    const sourceRefs = mergeFileRefs(input.owner || onlyFileInclusion ? [] : await threadFileRefs(tx, input.sourceThread, input.scope), input.fileRef ? [input.fileRef] : [])
    await validateFileRefs(tx, input.sectorId, sourceRefs, input.scope)
    if (sourceRefs.length) state = 'pending'
    const version = state === 'approved' ? row.context_version + 1 : null
    const author = input.owner ? 'owner' : researchParent ? 'research' : 'session'
    // Idempotent replay: same id replays the first row (appendEvent idiom).
    // Callers needing retry-safety must pass stable ids; without one a
    // retry is a new proposal by definition.
    const result = await tx.query<ChangeRow>(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT(id) DO NOTHING RETURNING *`, [id, input.sectorId, input.baseVersion, JSON.stringify(sections), input.sourceThread, author, state, version, JSON.stringify(input.fileRef ?? null), JSON.stringify(sourceRefs)])
    const inserted = result.rows[0]
    if (!inserted) {
      // Lost race after the pre-SELECT: another writer claimed this id.
      // Replay the winner when it belongs to this sector; a stray cross-
      // sector collision fails loudly instead of merging contexts.
      const winner = (await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1', [id])).rows[0]
      if (!winner || winner.sector_id !== input.sectorId) throw new WorkspaceError('conflict', 'context change id collision')
      return changeView(winner)
    }
    if (state === 'approved') await persistSectionFileRefs(tx, input.sectorId, checked(ContextSections, row.sections), sections, sourceRefs, row.section_file_refs)
    if (state === 'approved') await tx.query('UPDATE sector_workspace SET context_version=$2, sections=$3::jsonb, protected_decisions=CASE WHEN $4 THEN $5 ELSE protected_decisions END WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(sections), input.owner, sections.decisions])
    await appendEvent(tx, { idempotencyKey: `workspace-change:${id}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state, version, sourceThread: input.sourceThread } })
    await notifyWorkspace(tx, input.sectorId, state === 'approved' ? 'context-version' : 'approval', { sectorId: input.sectorId, id, state, version })
    return changeView(inserted)
  })
}
export async function decideContextChange(db: TransactableDb, input: { sectorId: string; id: string; approve: boolean; scope?: Scope }): Promise<ContextChange> {
  await requireSector(db, input.sectorId, input.scope)
  checked(Id, input.id)
  return workspaceTransaction(db, input.sectorId, async (tx) => {
    const found = await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1 AND sector_id=$2', [input.id, input.sectorId])
    const proposal = found.rows[0]
    if (!proposal) throw new WorkspaceError('not_found', 'Proposal not found.')
    if (proposal.state === 'approved' || proposal.state === 'denied') {
      if ((proposal.state === 'approved') !== input.approve) throw new WorkspaceError('conflict', 'This proposal already has a different decision.')
      return changeView(proposal)
    }
    const current = await workspaceRow(tx, input.sectorId)
    if (input.approve && current.context_version !== proposal.base_version) throw new WorkspaceError('conflict', 'Proposal is stale. Submit it against the current context.')
    const state = input.approve ? 'approved' : 'denied'
    const version = input.approve ? current.context_version + 1 : null
    if (input.approve) await validateFileRefs(tx, input.sectorId, proposal.source_refs ?? (proposal.file_ref ? [proposal.file_ref] : []), input.scope)
    if (input.approve && proposal.source_refs === null && !proposal.file_ref) throw new ContextFileBlocked('Legacy proposal has no source receipt. Submit a fresh owner-reviewed proposal.')
    if (input.approve && proposal.file_ref) {
      // Agent file inclusion: summarize into a block, never inject raw
      // units. The version bumps when the summary lands, not now.
      const visibility = await tx.query<{ hidden: boolean }>('SELECT hidden FROM workspace_files WHERE sector_id=$1 AND file_id=$2', [input.sectorId, proposal.file_ref.fileId])
      if (visibility.rows[0]?.hidden) throw new WorkspaceError('conflict', 'Reveal the file before including it.')
      const file = (await listSectorLibrary(tx, input.sectorId, input.scope)).find((entry) => entry.id === proposal.file_ref?.fileId)
      if (!file || file.hash !== proposal.file_ref.hash) throw new WorkspaceError('conflict', 'The file version changed. Review a new proposal.')
      if (file.kind !== 'document' && !file.documentId) throw new WorkspaceError('conflict', 'Only processed documents can be included as shared context.')
      if (!proposal.file_ref.ords.length) throw new WorkspaceError('conflict', 'This file proposal names no readable units.')
      await insertContextFileBlock(tx, { sectorId: input.sectorId, fileId: file.id, documentId: file.kind === 'document' ? file.id : (file.documentId ?? file.id), hash: proposal.file_ref.hash, filename: proposal.file_ref.filename, requestedBy: `decision:${input.id}` })
      await resetContextFileBlock(tx, { sectorId: input.sectorId, fileId: file.id, hash: proposal.file_ref.hash, filename: proposal.file_ref.filename, documentId: file.kind === 'document' ? file.id : (file.documentId ?? file.id), requestedBy: `decision:${input.id}` })
      const updated = await tx.query<ChangeRow>(`UPDATE workspace_changes SET state='approved',version=NULL WHERE id=$1 RETURNING *`, [input.id])
      await appendEvent(tx, { idempotencyKey: `workspace-decision:${input.id}`, partition: `sector:${input.sectorId}`, type: 'sector.context.decided', payload: { changeId: input.id, state: 'approved', version: null } })
      await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, state: 'approved', version: null })
      const row = updated.rows[0]
      if (!row) throw new WorkspaceError('conflict', 'context decision missing')
      return changeView(row)
    }
    const previousSections = checked(ContextSections, current.sections)
    if (!previousSections.scope && current.context_version === 0) { const sector = await requireSector(tx, input.sectorId, input.scope); previousSections.scope = sector.topic || sector.name }
    if (input.approve) await persistSectionFileRefs(tx, input.sectorId, previousSections, checked(ContextSections, proposal.sections), proposal.source_refs ?? (proposal.file_ref ? [proposal.file_ref] : []), current.section_file_refs)
    if (input.approve) await tx.query('UPDATE sector_workspace SET context_version=$2,sections=$3::jsonb,protected_decisions=$4 WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(proposal.sections), checked(ContextSections, proposal.sections).decisions])
    const updated = await tx.query<ChangeRow>('UPDATE workspace_changes SET state=$2,version=$3 WHERE id=$1 RETURNING *', [input.id, state, version])
    await appendEvent(tx, { idempotencyKey: `workspace-decision:${input.id}`, partition: `sector:${input.sectorId}`, type: 'sector.context.decided', payload: { changeId: input.id, state, version } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, state, version })
    const row = updated.rows[0]
    if (!row) throw new WorkspaceError('conflict', 'context decision missing')
    return changeView(row)
  })
}
const GLOBAL_CONTEXT_BUDGET_TOKENS = 30000
export interface GlobalContextUsage {
  total: number; budget: number; method: 'estimated'
  bySection: { scope: number; instructions: number; decisions: number; findings: number; questions: number }
  byFile: Array<{ fileId: string; tokens: number }>
  aiUsage: { calls: number; inputTokens: number; outputTokens: number }
}
function globalContextUsageFrom(sections: ContextSections, blocks: Array<{ fileId: string; tokens: number }>): Omit<GlobalContextUsage, 'aiUsage'> {
  const bySection = {
    scope: estimateTokens(sections.scope), instructions: estimateTokens(sections.instructions),
    decisions: estimateTokens(sections.decisions), findings: estimateTokens(sections.findings),
    questions: estimateTokens(sections.questions),
  }
  const byFile = blocks.map((block) => ({ fileId: block.fileId, tokens: block.tokens }))
  const total = bySection.scope + bySection.instructions + bySection.decisions + bySection.findings + bySection.questions + byFile.reduce((sum, file) => sum + file.tokens, 0)
  return { total, budget: GLOBAL_CONTEXT_BUDGET_TOKENS, method: 'estimated', bySection, byFile }
}
export const ContextAiUsage = z.object({
  kind: z.enum(['file-summary', 'compaction']),
  fileId: z.string().min(1).optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  model: z.string().min(1),
}).strict()
export type ContextAiUsage = z.infer<typeof ContextAiUsage>
// Background AI spend lives on the event log, never on deletable rows:
// removing a file must not erase what its summary cost.
export async function recordContextAiUsage(db: Db, input: { sectorId: string; idempotencyKey: string; usage: ContextAiUsage; scope?: Scope }): Promise<void> {
  await requireSector(db, input.sectorId, input.scope)
  await appendEvent(db, { idempotencyKey: checked(Id, input.idempotencyKey), partition: `sector:${input.sectorId}`, type: 'sector.context.ai_usage', payload: checked(ContextAiUsage, input.usage) })
}
export async function readContextAiUsage(db: Db, sectorId: string, scope?: Scope): Promise<{ calls: number; inputTokens: number; outputTokens: number }> {
  await requireSector(db, sectorId, scope)
  const rows = await db.query<{ payload: unknown }>(`SELECT payload FROM events WHERE partition=$1 AND type='sector.context.ai_usage'`, [`sector:${sectorId}`])
  const total = { calls: 0, inputTokens: 0, outputTokens: 0 }
  for (const row of rows.rows) {
    const parsed = ContextAiUsage.safeParse(row.payload)
    if (!parsed.success) continue
    total.calls += 1
    total.inputTokens += parsed.data.inputTokens
    total.outputTokens += parsed.data.outputTokens
  }
  return total
}
export async function readGlobalContextUsage(db: Db, sectorId: string, scope?: Scope): Promise<GlobalContextUsage> {
  return (await readGlobalContext(db, sectorId, scope, false)).usage
}
export async function applyReadyContextFileBlock(db: TransactableDb, input: { sectorId: string; fileId: string; summary: string; tokens: number; inputTokens?: number; outputTokens?: number }): Promise<{ version: number } | null> {
  return workspaceTransaction(db, `context-block:${input.sectorId}:${input.fileId}`, async (tx) => {
    // Late completion after an owner removal: the row is gone, stay gone.
    const block = await readContextFileBlock(tx, input.sectorId, input.fileId)
    if (!block) return null
    // The first block may land before any text edit creates the row.
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    const version = row.context_version + 1
    await tx.query(`UPDATE context_file_blocks SET state='ready',summary=$3,tokens=$4,added_version=$5,error=NULL,input_tokens=$6,output_tokens=$7,updated_at=now()
      WHERE sector_id=$1 AND file_id=$2`, [input.sectorId, input.fileId, input.summary, input.tokens, version, input.inputTokens ?? 0, input.outputTokens ?? 0])
    const id = randomUUID()
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,'owner','owner','approved',$3,$5::jsonb,'[]'::jsonb)`,
      [id, input.sectorId, version, JSON.stringify(checked(ContextSections, row.sections)), JSON.stringify({ fileId: input.fileId, hash: block.hash, filename: block.filename, ords: [] })])
    await tx.query('UPDATE sector_workspace SET context_version=$2 WHERE sector_id=$1', [input.sectorId, version])
    await tx.query('INSERT INTO workspace_files(sector_id,file_id,included,approval_id) VALUES($1,$2,true,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET included=true,approval_id=$3', [input.sectorId, input.fileId, id])
    await appendEvent(tx, { idempotencyKey: `context-block-ready:${input.sectorId}:${input.fileId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, fileId: input.fileId } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version }
  })
}
export async function removeContextFileBlock(db: TransactableDb, input: { sectorId: string; fileId: string; scope?: Scope }): Promise<{ version: number; filename: string; hash: string; state: string }> {
  await requireSector(db, input.sectorId, input.scope)
  return workspaceTransaction(db, `context-block:${input.sectorId}:${input.fileId}`, async (tx) => {
    const block = await readContextFileBlock(tx, input.sectorId, input.fileId)
    if (!block) throw new WorkspaceError('not_found', 'File is not in the global context.')
    await tx.query('DELETE FROM context_file_blocks WHERE sector_id=$1 AND file_id=$2', [input.sectorId, input.fileId])
    await tx.query('UPDATE workspace_files SET included=false,approval_id=NULL WHERE sector_id=$1 AND file_id=$2', [input.sectorId, input.fileId])
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    const stripped: Record<string, ContextFileRef[] | null> = {}
    for (const [key, refs] of Object.entries(row.section_file_refs ?? {})) stripped[key] = refs === null ? null : refs.filter((ref) => ref.fileId !== input.fileId)
    const version = row.context_version + 1
    const id = randomUUID()
    await tx.query('UPDATE sector_workspace SET context_version=$2,section_file_refs=$3::jsonb WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(stripped)])
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,'owner','owner','approved',$3,$5::jsonb,'[]'::jsonb)`,
      [id, input.sectorId, version, JSON.stringify(checked(ContextSections, row.sections)), JSON.stringify({ fileId: input.fileId, hash: block.hash, filename: block.filename, ords: [] })])
    await appendEvent(tx, { idempotencyKey: `context-block-removed:${input.sectorId}:${input.fileId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, fileId: input.fileId, removed: true } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version, filename: block.filename, hash: block.hash, state: block.state }
  })
}
export async function applySystemCompaction(db: TransactableDb, input: {
  sectorId: string; baseVersion: number; reason: 'auto' | 'manual'
  baseScope: string; baseInstructions: string; baseBlocks: Array<{ fileId: string; hash: string; state: string }>
  sections: { decisions: string; findings: string; questions: string }
  inputTokens?: number; outputTokens?: number
}): Promise<{ version: number }> {
  return workspaceTransaction(db, `context-compaction:${input.sectorId}`, async (tx) => {
    const row = await workspaceRow(tx, input.sectorId)
    const current = checked(ContextSections, row.sections)
    if (row.context_version !== input.baseVersion) throw new WorkspaceError('conflict', 'Global context changed during compaction.')
    if (current.scope !== input.baseScope || current.instructions !== input.baseInstructions) {
      throw new WorkspaceError('conflict', 'Compaction must leave scope and instructions byte-identical.')
    }
    const blocks = await listContextFileBlocks(tx, input.sectorId)
    const canon = (entries: Array<{ fileId: string; hash: string; state: string }>) => entries.map((entry) => `${entry.fileId}:${entry.hash}:${entry.state}`).sort().join('\n')
    if (canon(blocks) !== canon(input.baseBlocks)) throw new WorkspaceError('conflict', 'Context files changed during compaction.')
    const sections: ContextSections = { scope: current.scope, instructions: current.instructions, ...input.sections }
    const version = row.context_version + 1
    const id = randomUUID()
    await tx.query('UPDATE sector_workspace SET context_version=$2,sections=$3::jsonb WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(sections)])
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs,input_tokens,output_tokens)
      VALUES($1,$2,$3,$4::jsonb,$5,'system:compaction','approved',$3,NULL,'[]'::jsonb,$6,$7)`,
      [id, input.sectorId, version, JSON.stringify(sections), `compaction:${input.reason}`, input.inputTokens ?? 0, input.outputTokens ?? 0])
    await appendEvent(tx, { idempotencyKey: `context-compaction:${input.sectorId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, reason: input.reason } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version }
  })
}
export async function restoreGlobalContextVersion(db: TransactableDb, input: { sectorId: string; version: number; scope?: Scope }): Promise<{ version: number; sections: ContextSections }> {
  await requireSector(db, input.sectorId, input.scope)
  return workspaceTransaction(db, `context-restore:${input.sectorId}`, async (tx) => {
    const found = await tx.query<ChangeRow>(`SELECT * FROM workspace_changes WHERE sector_id=$1 AND version=$2 AND state='approved' ORDER BY at DESC LIMIT 1`, [input.sectorId, input.version])
    const source = found.rows[0]
    if (!source) throw new WorkspaceError('not_found', 'Unknown context version.')
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    // Text sections only: file blocks keep their current state, and the
    // current file refs stay as they are (a removed file must not regain
    // provenance through a restore).
    const sections = checked(ContextSections, source.sections)
    const version = row.context_version + 1
    const id = randomUUID()
    await tx.query('UPDATE sector_workspace SET context_version=$2,sections=$3::jsonb WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(sections)])
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,'owner','owner','approved',$3,NULL,'[]'::jsonb)`,
      [id, input.sectorId, version, JSON.stringify(sections)])
    await appendEvent(tx, { idempotencyKey: `context-restore:${input.sectorId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, restoredFrom: input.version } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version, sections }
  })
}
const INHERITED_MESSAGE_CAP = 20
const INHERITED_TOKEN_CAP = 12000

/** Spawn-time brief for a child: the parent summary plus its recent
 * user/agent messages as Owner:/Agent: lines, capped at 12k estimated
 * tokens by dropping the oldest messages first. */
export async function buildInheritedContext(db: Db, parentThreadKey: string): Promise<string> {
  await requireThread(db, parentThreadKey)
  const local = await readThreadContext(db, parentThreadKey)
  const { rows } = await db.query<{ payload: unknown }>(
    `SELECT payload FROM thread_messages WHERE thread_key=$1 AND kind='text' ORDER BY seq DESC LIMIT 40`,
    [parentThreadKey],
  )
  const lines: string[] = []
  for (const row of [...rows].reverse()) {
    if (typeof row.payload !== 'object' || row.payload === null) continue
    const payload = row.payload as Record<string, unknown>
    if (typeof payload['text'] !== 'string') continue
    if (payload['role'] === 'user') lines.push(`Owner: ${payload['text']}`)
    else if (payload['role'] === 'agent') lines.push(`Agent: ${payload['text']}`)
  }
  const recent = lines.slice(-INHERITED_MESSAGE_CAP)
  const render = () => `Parent summary:\n${local.summary}\nRecent parent messages:\n${recent.join('\n')}`
  let body = render()
  while (recent.length > 0 && estimateTokens(body) > INHERITED_TOKEN_CAP) {
    recent.shift()
    body = render()
  }
  return body
}

/** Bare upsert: the child thread row may not have projected yet when the
 * brief lands between parent acceptance and the goal signal. */
export async function saveInheritedContext(db: Db, childThreadKey: string, inherited: string): Promise<void> {
  if (!childThreadKey) throw new DbContractError('childThreadKey must be a non-empty string')
  await db.query(
    `INSERT INTO thread_context(thread_key,inherited) VALUES($1,$2)
     ON CONFLICT(thread_key) DO UPDATE SET inherited=$2`,
    [childThreadKey, inherited],
  )
}

/** Owner pause flag: written by pause/resume runs, read at every
 * provider boundary. Missing row means running. */
export async function setThreadPaused(db: Db, threadKey: string, paused: boolean): Promise<void> {
  if (!threadKey) throw new DbContractError('threadKey must be a non-empty string')
  await db.query(
    `INSERT INTO thread_control(thread_key,paused,updated_at) VALUES($1,$2,now())
     ON CONFLICT(thread_key) DO UPDATE SET paused=$2,updated_at=now()`,
    [threadKey, paused],
  )
}

export async function isThreadPaused(db: Db, threadKey: string): Promise<boolean> {
  const researchState = await researchThreadState(db, threadKey).catch(() => null)
  if (researchState === 'paused' || researchState === 'planning' || researchState === 'planned') return true
  const { rows } = await db.query<{ paused: boolean }>('SELECT paused FROM thread_control WHERE thread_key=$1', [threadKey])
  return rows[0]?.paused ?? false
}

export async function readInheritedContext(db: Db, threadKey: string): Promise<string> {
  const { rows } = await db.query<{ inherited: string }>('SELECT inherited FROM thread_context WHERE thread_key=$1', [threadKey])
  return rows[0]?.inherited ?? ''
}

export async function readThreadContext(db: Db, threadKey: string, scope?: Scope): Promise<ThreadContext> {
  await requireThread(db, threadKey, scope)
  const { rows } = await db.query<{ notes: string; summary: string; covered_seq: number | string; version: number; usage: ThreadContext['usage']; working_user: string | null; working_meta: TurnContinuation['meta'] | null }>('SELECT * FROM thread_context WHERE thread_key=$1', [threadKey])
  const row = rows[0]
  let contextBlocked: string | undefined
  try { await assertThreadFileContext(db, threadKey, scope) } catch (error) { if (!(error instanceof ContextFileBlocked)) throw error; contextBlocked = error.message }
  return { ...(row?.working_meta?.pendingResponse ? { pendingResponse: { round: row.working_meta.pendingResponse.round } } : {}), ...(row?.working_user ? { task: row.working_user } : {}), sourceRefs: await threadFileRefs(db, threadKey, scope), ...(contextBlocked ? { contextBlocked } : {}), threadKey, notes: row?.notes ?? '', summary: row?.summary ?? '', coveredSeq: Number(row?.covered_seq ?? 0), version: row?.version ?? 0, ...(row?.usage ? { usage: row.usage } : {}), ...(row?.working_meta?.blockedOperations?.length ? { pendingOperations: row.working_meta.blockedOperations.map((operation) => ({ operationId: operation.operationId, toolName: operation.call.name, callId: operation.call.id, reason: operation.reason })) } : {}) }
}
export async function saveThreadContext(db: TransactableDb, threadKey: string, input: { version: number; notes?: string; summary?: string; coveredSeq?: number }, scope?: Scope, lease?: string): Promise<ThreadContext> {
  checked(z.object({ version: z.number().int().nonnegative(), notes: z.string().max(24000).optional(), summary: z.string().max(48000).optional(), coveredSeq: z.number().int().nonnegative().optional() }).strict(), input)
  await requireThread(db, threadKey, scope)
  return workspaceTransaction(db, threadKey, async (tx) => {
    if (lease && !(await tx.query('SELECT thread_key FROM thread_context WHERE thread_key=$1 AND active_lease=$2', [threadKey, lease])).rows.length) throw new WorkspaceError('conflict', 'This attempt no longer owns its summary.')
    const current = await readThreadContext(tx, threadKey, scope)
    const fileRefs = await threadFileRefs(tx, threadKey, scope)
    const identity = await requireThread(tx, threadKey, scope)
    if (input.summary !== undefined && identity.session.sectorId) await validateFileRefs(tx, identity.session.sectorId, fileRefs, scope)
    if (current.version !== input.version) throw new WorkspaceError('conflict', 'Local context changed. Try again.')
    if ((input.coveredSeq ?? current.coveredSeq) < current.coveredSeq) throw new WorkspaceError('conflict', 'Summary coverage cannot move backwards.')
    await tx.query(`INSERT INTO thread_context(thread_key,notes,summary,covered_seq,version) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(thread_key) DO UPDATE SET notes=$2,summary=$3,covered_seq=$4,version=$5`, [threadKey, input.notes ?? current.notes, input.summary ?? current.summary, input.coveredSeq ?? current.coveredSeq, current.version + 1])
    if (input.summary !== undefined) await tx.query('UPDATE thread_context SET summary_file_refs=$2::jsonb WHERE thread_key=$1', [threadKey, JSON.stringify(fileRefs)])
    if (input.summary !== undefined) await publishOutboxFrame(tx, threadKey, 'compaction', { version: current.version + 1, coveredSeq: input.coveredSeq })
    return readThreadContext(tx, threadKey, scope)
  })
}
export async function rebuildThreadContext(db: TransactableDb, threadKey: string, input: { version: number; summary: string; independent: true; author: string }, scope?: Scope): Promise<ThreadContext> {
  checked(z.object({ version: z.number().int().nonnegative(), summary: z.string().trim().min(1).max(48000), independent: z.literal(true), author: Id }).strict(), input)
  await requireThread(db, threadKey, scope)
  return workspaceTransaction(db, threadKey, async (tx) => {
    await tx.query('INSERT INTO thread_context(thread_key) VALUES($1) ON CONFLICT DO NOTHING', [threadKey])
    const before = await readThreadContext(tx, threadKey, scope)
    const state = await tx.query<{ active_run: string | null; active_lease: string | null; working_meta: TurnContinuation['meta'] | null }>('SELECT active_run,active_lease,working_meta FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])
    const row = state.rows[0]
    if (row?.active_run || row?.active_lease) throw new WorkspaceError('conflict', 'Pause the active turn before rebuilding private context.')
    if (before.version !== input.version) throw new WorkspaceError('conflict', 'Local context changed. Review the latest version.')
    if (row?.working_meta?.pendingResponse) throw new ContextFileBlocked('A paid provider response is waiting for durable recording. Resume its original turn after storage and source availability recover before rebuilding.')
    if (before.contextBlocked && row?.working_meta?.blockedOperations?.length) throw new ContextFileBlocked('Unresolved operations retain their original source-dependent arguments. Reveal or reconcile those original operations before rebuilding.')
    const coverage = await tx.query<{ covered: number }>('SELECT COALESCE(MAX(seq),0) AS covered FROM thread_messages WHERE thread_key=$1', [threadKey])
    const coveredSeq = Math.max(before.coveredSeq, Number(coverage.rows[0]?.covered ?? 0))
    const changed = await tx.query(`UPDATE thread_context SET summary=$2,covered_seq=$3,version=version+1,summary_file_refs='[]'::jsonb,file_exposures='[]'::jsonb,file_inheritance_set=true,history_provenance_known=true,
      working_messages=CASE WHEN working_messages IS NULL THEN NULL ELSE $4::jsonb END,
      working_file_refs=CASE WHEN working_messages IS NULL THEN NULL ELSE '[]'::jsonb END,rebuilt_history=true,rebuilt_outbox_floor=(SELECT COALESCE(MAX(seq),0) FROM outbox WHERE thread_key=$1)
      WHERE thread_key=$1 AND version=$5 AND active_run IS NULL AND active_lease IS NULL RETURNING thread_key`, [threadKey, input.summary, coveredSeq, JSON.stringify([{ role: 'assistant', text: input.summary, contextSeq: coveredSeq }]), input.version])
    if (!changed.rows.length) throw new WorkspaceError('conflict', 'Context changed during source review.')
    await appendEvent(tx, { idempotencyKey: `context-rebuild:${threadKey}:v${input.version + 1}`, partition: threadKey, type: 't.context.rebuilt', payload: { threadKey, author: input.author, previousVersion: input.version, version: input.version + 1, previousSummary: before.summary, previousSources: before.sourceRefs, replacement: input.summary, coveredSeq, independent: true } })
    await publishOutboxFrame(tx, threadKey, 'compaction', { version: input.version + 1, coveredSeq, rebuilt: true })
    return readThreadContext(tx, threadKey, scope)
  })
}
export async function enqueueSteering(db: TransactableDb, threadKey: string, text: string, id: string, scope?: Scope): Promise<{ id: string; state: string }> {
  await requireThread(db, threadKey, scope)
  checked(z.string().trim().min(1).max(24000), text); checked(Id, id)
  return workspaceTransaction(db, threadKey, async (tx) => {
    const { rows } = await tx.query<{ state: string }>(`INSERT INTO thread_instructions(id,thread_key,text,state)
      VALUES($1,$2,$3,CASE WHEN EXISTS(SELECT 1 FROM thread_context WHERE thread_key=$2 AND active_run IS NOT NULL) THEN 'pending' ELSE 'missed' END)
      ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING state`, [id, threadKey, text])
    return { id, state: rows[0]?.state ?? 'missed' }
  })
}
export async function readSteeringReceiptsPage(db: Db, threadKey: string, afterId = '', limit = 200, scope?: Scope): Promise<{ items: Array<{ id: string; state: 'consumed' | 'missed' }>; nextAfterId: string | null }> {
  await requireThread(db, threadKey, scope)
  checked(z.string().max(255), afterId); checked(z.number().int().min(1).max(200), limit)
  const { rows } = await db.query<{ id: string; state: 'consumed' | 'missed' }>(
    "SELECT id,state FROM thread_instructions WHERE thread_key=$1 AND state IN ('consumed','missed') AND id>$2 ORDER BY id LIMIT $3",
    [threadKey, afterId, limit + 1])
  const items = rows.slice(0, limit)
  return { items, nextAfterId: rows.length > limit ? items.at(-1)!.id : null }
}

export async function beginThreadTurn(db: TransactableDb, threadKey: string, runKey: string, owner?: EpochOwnership, recoveryProof?: { runKey: string; user: string; checkpointHash: string }): Promise<string> {
  checked(Id, threadKey); checked(Id, runKey)
  const lease = randomUUID()
  await workspaceTransaction(db, threadKey, async (tx) => {
    if (recoveryProof) {
      checked(z.object({ runKey: Id, user: z.string().min(1), checkpointHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), recoveryProof)
      await tx.query('SELECT thread_key FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])
      const saved = await readTurnContinuation(tx, threadKey)
      if (!owner || runKey !== recoveryProof.runKey || !saved || saved.runKey !== recoveryProof.runKey || saved.user !== recoveryProof.user || recoveryCheckpointHash(saved) !== recoveryProof.checkpointHash) throw new WorkspaceError('conflict', 'The original checkpoint changed. Review this task and retry Resume.')
    }
    if (!owner && (await tx.query<{ active_epoch: string | null }>('SELECT active_epoch FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])).rows[0]?.active_epoch) throw new WorkspaceError('conflict', 'A legacy attempt cannot replace a validated execution owner.')
    if (owner && owner.threadKey !== threadKey) throw new WorkspaceError('permission_denied', 'Execution epoch belongs to another thread.')
    const epoch = owner ? await bindExecutionEpoch(tx, owner) : null
    await tx.query('INSERT INTO thread_context(thread_key,active_run,active_lease,active_epoch,active_workflow_id,active_execution_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(thread_key) DO UPDATE SET active_run=$2,active_lease=$3,active_epoch=$4,active_workflow_id=$5,active_execution_id=$6', [threadKey, runKey, lease, epoch, owner?.workflowId ?? null, owner?.executionId ?? null])
    if (owner && epoch) {
      const latest = await tx.query<{ payload: { status?: string; recoveryEpoch?: string } }>("SELECT payload FROM events WHERE type='t.thread.state' AND payload->>'threadKey'=$1 ORDER BY seq DESC LIMIT 1", [threadKey])
      const state = latest.rows[0]?.payload
      if (state?.status === 'PAUSED' && typeof state.recoveryEpoch === 'string') await appendEvent(tx, { idempotencyKey: `execution-started:${epoch}:${owner.executionId}`, partition: `session:${owner.sessionId}`, type: 't.thread.state', payload: { threadKey, status: 'RUNNING', acceptingSteer: true, ownerEpoch: epoch, executionId: owner.executionId } })
    }
  })
  return lease
}
export async function consumeSteering(db: TransactableDb, threadKey: string, runKey: string, round: number, lease?: string): Promise<string[]> {
  checked(Id, threadKey); checked(Id, runKey); checked(z.number().int().positive(), round)
  return workspaceTransaction(db, threadKey, async (tx) => {
    if (lease && !(await tx.query('SELECT thread_key FROM thread_context WHERE thread_key=$1 AND active_run=$2 AND active_lease=$3', [threadKey, runKey, lease])).rows.length) throw new WorkspaceError('conflict', 'This turn attempt no longer owns its context.')
    const { rows } = await tx.query<{ id: string }>(`UPDATE thread_instructions SET state='consumed',run_key=$2,round=$3
      WHERE thread_key=$1 AND state='pending' RETURNING id`, [threadKey, runKey, round])
    const replay = await tx.query<{ text: string }>('SELECT text FROM thread_instructions WHERE thread_key=$1 AND run_key=$2 AND round=$3 ORDER BY at,id', [threadKey, runKey, round])
    if (rows.length) await publishOutboxFrame(tx, threadKey, 'steering-consumption', { ids: rows.map((row) => row.id), runKey, round })
    return replay.rows.map((row) => row.text)
  })
}
export async function finishSteering(db: TransactableDb, threadKey: string, runKey: string, lease?: string): Promise<void> {
  checked(Id, threadKey); checked(Id, runKey)
  await workspaceTransaction(db, threadKey, async (tx) => {
    const active = await tx.query('SELECT active_run FROM thread_context WHERE thread_key=$1 AND active_run=$2 AND ($3::text IS NULL OR active_lease=$3)', [threadKey, runKey, lease ?? null])
    if (!active.rows.length) return
    const { rows } = await tx.query<{ id: string }>("UPDATE thread_instructions SET state='missed' WHERE thread_key=$1 AND state='pending' RETURNING id", [threadKey])
    await tx.query('UPDATE thread_context SET active_run=NULL,active_lease=NULL,active_epoch=NULL,active_workflow_id=NULL,active_execution_id=NULL WHERE thread_key=$1 AND active_run=$2 AND ($3::text IS NULL OR active_lease=$3)', [threadKey, runKey, lease ?? null])
    if (rows.length) await publishOutboxFrame(tx, threadKey, 'steering-consumption', { ids: rows.map((row) => row.id), state: 'missed' })
  })
}

export interface LibraryFile {
  id: string; filename: string; status: string; source: string; hash: string
  hidden: boolean; included: boolean; kind: 'document' | 'artifact'; sessionId?: string; documentId?: string
  processing?: FileProcessingProgress
}
export async function readSectorLibraryFile(db: Db, sectorId: string, fileId: string, archive: ArchiveTarget, scope?: Scope) {
  return logOp(workspaceLogger, 'workspace.file.read', () => readLibraryFile(db, sectorId, fileId, archive, scope), { sectorId, fileId })
}
async function readLibraryFile(db: Db, sectorId: string, fileId: string, archive: ArchiveTarget, scope?: Scope) {
  checked(Id, fileId)
  const file = (await listSectorLibrary(db, sectorId, scope)).find((entry) => entry.id === fileId)
  if (!file) throw new WorkspaceError('not_found', 'File not found in this sector.')
  await assertFileVisible(db, sectorId, fileId)
  if (file.kind === 'document') return readOriginalSectorDocument(db, sectorId, fileId, archive, scope)
  if (!file.sessionId) throw new WorkspaceError('conflict', 'File origin is unavailable.')
  const origin = await resolveArtifactScope(db, file.sessionId, fileId)
  if (!origin) throw new WorkspaceError('not_found', 'File origin is unavailable.')
  const result = await serveArtifact(archive, origin.scope, fileId, {
    log: (fields) => workspaceLogger.info(fields),
    findEvent: (key) => findEventByKey(db, key),
    record: async (event) => { await appendEvent(db, event) },
  })
  return { filename: file.filename, mediaType: 'text/plain', text: result.body, contentBase64: Buffer.from(result.body, 'utf8').toString('base64'), originalAvailable: true }
}
export async function listSectorLibrary(db: Db, sectorId: string, scope?: Scope): Promise<LibraryFile[]> {
  await requireSector(db, sectorId, scope)
  const flags = await db.query<{ file_id: string; hidden: boolean; included: boolean; document_id: string | null }>('SELECT * FROM workspace_files WHERE sector_id=$1', [sectorId])
  const files = new Map<string, LibraryFile>()
  const arrivedAt = new Map<string, number>()
  for (const doc of await listSectorDocuments(db, sectorId, scope, true)) {
    files.set(doc.id, { id: doc.id, filename: doc.filename, status: doc.status, hash: doc.sha256, source: 'Uploaded', hidden: false, included: false, kind: 'document' })
    arrivedAt.set(doc.id, new Date(doc.createdAt).getTime())
  }
  const sessions = await listSessions(db, scope, sectorId)
  for (const session of sessions) {
    for (const artifact of await listArtifacts(db, session.id, true)) {
      if (!files.has(artifact.artifactId)) files.set(artifact.artifactId, { id: artifact.artifactId, filename: artifact.name ?? 'Untitled file', status: artifact.indexed ? 'indexed' : 'processing', hash: artifact.sha256 ?? '', source: artifact.producedBy ?? session.title, hidden: false, included: false, kind: 'artifact', sessionId: session.id })
    }
  }
  const artifactIds = [...files.values()].filter((file) => file.kind === 'artifact').map((file) => file.id)
  if (artifactIds.length) {
    const arrivals = await db.query<{ id: string; created_at: Date }>(`SELECT payload->>'artifactId' AS id,min(at) AS created_at
      FROM events WHERE partition=ANY($1::text[]) AND type=ANY($2::text[]) AND payload->>'artifactId'=ANY($3::text[])
      GROUP BY payload->>'artifactId'`, [sessions.map((session) => `artifact:session:${session.id}`), ['t.artifact.stored', 't.artifact.referenced', 't.artifact.indexed'], artifactIds])
    for (const arrival of arrivals.rows) arrivedAt.set(arrival.id, new Date(arrival.created_at).getTime())
  }
  for (const flag of flags.rows) {
    const file = files.get(flag.file_id)
    if (file) {
      file.hidden = flag.hidden; file.included = flag.included && !flag.hidden
      if (flag.document_id) { file.documentId = flag.document_id; const indexed = files.get(flag.document_id); if (indexed) file.hash = indexed.hash; files.delete(flag.document_id) }
    }
  }
  for (const file of files.values()) if (file.kind === 'artifact' && !file.documentId) file.status = 'processing'
  const processing = await listSectorFileProcessing(db, sectorId, scope)
  for (const file of files.values()) if (processing[file.documentId ?? file.id]) file.processing = processing[file.documentId ?? file.id]
  return [...files.values()].sort((a, b) => (arrivedAt.get(b.id) ?? 0) - (arrivedAt.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
export async function setFileVisibility(db: TransactableDb, sectorId: string, fileId: string, hidden: boolean, scope?: Scope) {
  checked(Id, fileId); checked(z.boolean(), hidden)
  const file = (await listSectorLibrary(db, sectorId, scope)).find((item) => item.id === fileId)
  if (!file) throw new WorkspaceError('not_found', 'File not found.')
  return workspaceTransaction(db, sectorId, async (tx) => {
    await tx.query('INSERT INTO workspace_files(sector_id,file_id,hidden) VALUES($1,$2,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET hidden=$3', [sectorId, fileId, hidden])
    await notifyWorkspace(tx, sectorId, 'context-version', { fileId, hidden })
    return { ...file, hidden, included: file.included && !hidden }
  })
}
export async function assertFileVisible(db: Db, sectorId: string, fileId: string): Promise<void> {
  checked(Id, sectorId); checked(Id, fileId)
  const { rows } = await db.query<{ hidden: boolean }>('SELECT hidden FROM workspace_files WHERE sector_id=$1 AND (file_id=$2 OR document_id=$2)', [sectorId, fileId])
  if (rows.some((row) => row.hidden)) throw new WorkspaceError('permission_denied', 'This file is hidden from agents.')
}
export async function hiddenFileIds(db: Db, sectorId: string): Promise<Set<string>> {
  checked(Id, sectorId)
  const { rows } = await db.query<{ file_id: string; document_id: string | null }>('SELECT file_id,document_id FROM workspace_files WHERE sector_id=$1 AND hidden', [sectorId])
  return new Set(rows.flatMap((row) => row.document_id ? [row.file_id, row.document_id] : [row.file_id]))
}
export async function proposeFileContext(db: TransactableDb, input: { sectorId: string; fileId: string; baseVersion: number; sourceThread: string; scope?: Scope; ords?: number[] }) {
  checked(Id, input.sectorId)
  checked(Id, input.fileId)
  checked(z.number().int().nonnegative(), input.baseVersion)
  checked(Id, input.sourceThread)
  const file = (await listSectorLibrary(db, input.sectorId, input.scope)).find((item) => item.id === input.fileId)
  if (!file || file.hidden || file.status !== 'indexed') throw new WorkspaceError('conflict', 'Only visible indexed files can be included.')
  const documentId = file.documentId ?? (file.kind === 'document' ? file.id : undefined)
  if (!documentId) throw new WorkspaceError('conflict', 'This file needs document indexing before inclusion.')
  const all = await listDocumentUnits(db, documentId)
  const ords = input.ords ?? all.map((unit) => unit.ord)
  checked(z.array(z.number().int().nonnegative()).min(1), ords)
  if (ords.some((ord) => !all.some((unit) => unit.ord === ord))) throw new WorkspaceError('validation_failed', 'Unknown file unit.')
  const current = await readGlobalContext(db, input.sectorId, input.scope)
  return proposeGlobalContext(db, { ...input, owner: false, sections: current.sections, fileRef: { fileId: file.id, hash: file.hash, filename: file.filename, ords } })
}
export async function indexSectorArtifact(db: Db, sectorId: string, artifactId: string, name: string, body: string, scope?: Scope): Promise<void> {
  checked(Id, sectorId)
  checked(Id, artifactId)
  if (typeof name !== 'string' || !name) throw new DbContractError('name must be a non-empty string')
  if (typeof body !== 'string' || !body) throw new DbContractError('body must be a non-empty string')
  await requireSector(db, sectorId, scope)
  const filename = /\.(md|txt|csv|json)$/i.test(name) ? name : `${name}.txt`
  const doc = await ingestSectorDocument(db, { sectorId, filename, contentBase64: Buffer.from(body).toString('base64'), source: 'artifact', scope })
  await db.query('INSERT INTO workspace_files(sector_id,file_id,document_id) VALUES($1,$2,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET document_id=$3', [sectorId, artifactId, doc.id])
}
export async function previewContextChange(db: Db, sectorId: string, id: string, scope?: Scope) {
  await requireSector(db, sectorId, scope)
  checked(Id, id)
  const result = await db.query<ChangeRow>('SELECT * FROM workspace_changes WHERE sector_id=$1 AND id=$2', [sectorId, id])
  const row = result.rows[0]
  if (!row) throw new WorkspaceError('not_found', 'Proposal not found.')
  const change = changeView(row)
  const sources = []
  for (const ref of mergeFileRefs(change.sourceRefs, change.fileRef ? [change.fileRef] : [])) {
    await validateFileRefs(db, sectorId, [ref], scope)
    const file = (await listSectorLibrary(db, sectorId, scope)).find((entry) => entry.id === ref.fileId)!
    const units = (await listDocumentUnits(db, file.documentId ?? file.id)).filter((unit) => ref.ords.includes(unit.ord))
    sources.push({ ref, units: units.map((unit) => ({ ord: unit.ord, text: unit.text, uncertain: unit.uncertain })) })
  }
  return { change, units: sources.find((source) => source.ref.fileId === change.fileRef?.fileId)?.units ?? [], sources }

}
export async function commitChildContext(db: TransactableDb, threadKey: string, id: string, scope?: Scope) {
  checked(Id, threadKey)
  checked(Id, id)
  const { thread, session } = await requireThread(db, threadKey, scope)
  if (!session.sectorId || thread.kind !== 'session' || await sessionKind(db, session.id) !== 'research') throw new WorkspaceError('permission_denied', 'Only the research parent can commit a child update.')
  // Retry-safe: a replayed commit returns the first result instead of
  // re-entering the parent-review guard on the now-approved child row.
  const committed = await db.query<ChangeRow>(`SELECT * FROM workspace_changes WHERE id=$1 AND sector_id=$2`, [`parent-commit:${id}`, session.sectorId])
  if (committed.rows[0]) return changeView(committed.rows[0])
  const preview = await previewContextChange(db, session.sectorId, id, scope)
  if (preview.change.state !== 'parent-review' || preview.change.fileRef || preview.change.sourceRefs?.length) throw new WorkspaceError('permission_denied', 'This update requires owner approval.')
  // The parent commit forwards the child update as a NEW pending owner
  // proposal. It never approves: the child row stays parent-review until
  // the owner decides the forwarded proposal.
  return proposeGlobalContext(db, { sectorId: session.sectorId, baseVersion: preview.change.baseVersion, sections: preview.change.sections, sourceThread: threadKey, owner: false, trustedResearch: true, scope, id: `parent-commit:${id}` })
}

const ResearchBudget = z.object({ runId: Id, spentMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
export async function readResearchBudget(db: Db, sectorId: string, scope?: Scope): Promise<number> {
  await requireSector(db, sectorId, scope)
  const { rows } = await db.query<{ payload: unknown }>("SELECT payload FROM events WHERE partition=$1 AND type='sector.research.budget_recorded' ORDER BY seq", [`sector:${sectorId}`])
  const runs = new Map<string, number>()
  for (const row of rows) {
    const budget = checked(ResearchBudget, row.payload)
    runs.set(budget.runId, Math.max(runs.get(budget.runId) ?? 0, budget.spentMs))
  }
  const total = [...runs.values()].reduce((sum, spent) => sum + spent, 0)
  if (!Number.isSafeInteger(total)) throw new WorkspaceError('validation_failed', 'Research budget usage exceeds its supported range.')
  return total
}
export async function recordResearchBudget(db: TransactableDb, input: { sectorId: string; runId: string; spentMs: number; checkpoint: number; scope?: Scope }): Promise<void> {
  checked(ResearchBudget, { runId: input.runId, spentMs: input.spentMs })
  checked(z.number().int().positive(), input.checkpoint)
  await workspaceTransaction(db, input.sectorId, async (tx) => {
    await requireSector(tx, input.sectorId, input.scope)
    const idempotencyKey = `research-budget:${input.sectorId}:${input.runId}:${input.checkpoint}`
    const existing = await findEventByKey(tx, idempotencyKey)
    if (existing) {
      if (ResearchBudget.parse(existing.payload).spentMs !== input.spentMs) throw new WorkspaceError('conflict', 'Research budget checkpoint changed on replay.')
      return
    }
    await appendEvent(tx, { idempotencyKey, partition: `sector:${input.sectorId}`, type: 'sector.research.budget_recorded', payload: { runId: input.runId, spentMs: input.spentMs } })
  })
}
interface ResearchWorkRow { id: string; kind: WorkItem['kind']; title: string; state: WorkItem['state']; attempts: number; child_id: string | null; evidence: string[]; detail: string; cursor: WorkItem['cursor']; source_url: string | null }
function researchWorkView(row: ResearchWorkRow): WorkItem {
  const item: WorkItem = { id: row.id, kind: row.kind, title: row.title, state: row.state, attempts: row.attempts, childId: row.child_id, evidence: row.evidence, detail: row.detail, ...(row.source_url ? { sourceUrl: row.source_url } : {}), ...(row.cursor ? { cursor: row.cursor } : {}) }
  return { ...item, receiptVersion: researchWorkReceiptVersion(item) }
}
function researchWorkReceiptVersion(item: WorkItem): string {
  const { receiptVersion: _version, ...receipt } = item
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex')
}
export async function readResearchProgress(db: Db, sectorId: string, scope?: Scope) {
  const sector = await requireSector(db, sectorId, scope)
  const plan = await readSectorPlan(db, sectorId, scope)
  const version = ['planning', 'planned'].includes(sector.state) ? plan?.latest?.version ?? 0 : plan?.approvedVersion ?? plan?.latest?.version ?? 0
  const { rows } = await db.query<ResearchWorkRow>('SELECT * FROM research_work WHERE sector_id=$1 AND plan_version=$2 ORDER BY at,id', [sectorId, version])
  const items: WorkItem[] = rows.map(researchWorkView)
  const workspace = await db.query<{ discovery_closed: boolean }>('SELECT discovery_closed FROM sector_workspace WHERE sector_id=$1', [sectorId])
  const approved = plan?.versions.find((entry) => entry.version === version)?.executable
  const expected = approved?.discovery.map((direction) => `${sectorId}:v${version}:discovery:${direction.id}`) ?? []
  const closed = (workspace.rows[0]?.discovery_closed ?? false) && expected.length > 0 && expected.every((id) => items.some((item) => item.id === id && item.state === 'complete'))
  return { sectorId, state: sector.state, planVersion: version, plan, items, budgetUsedMs: await readResearchBudget(db, sectorId, scope), ...progressSummary(items, closed, sector.state === 'complete') }
}
/** Publication guard reads counts/identity, never every receipt body under the lock. */
export async function readDiscoveryPublicationState(db: Db, sectorId: string, version: number, intakeId: string, scope?: Scope) {
  await requireSector(db, sectorId, scope); checked(z.number().int().positive(), version); checked(Id, intakeId)
  const { rows } = await db.query<{ companies: string; accepted: boolean }>(`SELECT count(*) FILTER(WHERE kind='company') AS companies,bool_or(id=$3 AND state='complete' AND left(detail,7)='accept:') AS accepted FROM research_work WHERE sector_id=$1 AND plan_version=$2`, [sectorId, version, intakeId])
  return { companyCount: Number(rows[0]?.companies ?? 0), accepted: rows[0]?.accepted ?? false }
}

/** Compact Temporal state; API progress continues to expose the exact DB records. */
export async function readResearchCoordinatorProgress(db: Db, sectorId: string, version: number, scope?: Scope, afterIntakeId?: string) {
  const sector = await requireSector(db, sectorId, scope)
  checked(z.number().int().positive(), version)
  if (afterIntakeId !== undefined) checked(Id, afterIntakeId)
  const plan = await readSectorPlan(db, sectorId, scope)
  if (!plan?.versions.some((entry) => entry.version === version)) throw new DbContractError('Unknown research plan version.')
  const counters = await db.query<{ total: string; completed: string; unresolved: string; companies: string; intakes: string }>(`SELECT count(*) FILTER(WHERE state<>'excluded') AS total,count(*) FILTER(WHERE state='complete') AS completed,count(*) FILTER(WHERE state IN ('blocked','failed')) AS unresolved,count(*) FILTER(WHERE kind='company') AS companies,count(*) FILTER(WHERE kind='discovery' AND position(':intake:' in id)>0 AND state NOT IN ('complete','excluded')) AS intakes FROM research_work WHERE sector_id=$1 AND plan_version=$2`, [sectorId, version])
  const count = counters.rows[0]!
  const companyRows = await db.query<{ id: string; kind: 'company'; source_url: string | null }>('SELECT id,kind,COALESCE(source_url,evidence->>0) AS source_url FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND kind=\'company\'', [sectorId, version])
  const knownDomains = [...new Set(companyRows.rows.flatMap((row) => { const url = row.source_url; if (!url) return []; try { return [new URL(url).hostname.toLowerCase().replace(/^www\./, '')] } catch { return [] } }))]
  const sampleIds = discoverySample(companyRows.rows).map((row) => row.id)
  const work = await db.query<ResearchWorkRow>(`SELECT id,kind,left(title,240) AS title,state,attempts,child_id,CASE WHEN source_url IS NULL THEN evidence ELSE '[]'::jsonb END AS evidence,left(detail,160) AS detail,CASE WHEN cursor IS NULL THEN NULL ELSE jsonb_build_object('queryIndex',cursor->'queryIndex','page',cursor->'page','seenDomains','[]'::jsonb) END AS cursor,source_url
    FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND (id=ANY($3::text[]) OR (kind='discovery' AND position(':intake:' in id)=0)) ORDER BY at,id`, [sectorId, version, sampleIds])
  const retries = await db.query<{ id: string; kind: 'discovery'; title: string; state: WorkItem['state']; attempts: number; child_id: string | null; detail: string }>(`SELECT id,kind,left(title,240) AS title,state,attempts,child_id,left(detail,160) AS detail FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND kind='discovery' AND position(':intake:' in id)>0 AND state IN ('pending','running','blocked','failed') AND (state='pending' OR left(detail,10)<>'uncertain:') AND ($3::text IS NULL OR id COLLATE "C">$3 COLLATE "C") ORDER BY id COLLATE "C" LIMIT 101`, [sectorId, version, afterIntakeId ?? null])
  const items: WorkItem[] = work.rows.map(researchWorkView)
  items.push(...retries.rows.slice(0,100).map((row) => ({ id: row.id, kind: row.kind, title: row.title, state: row.state, attempts: row.attempts, childId: row.child_id, evidence: [], detail: row.detail })))
  return { sectorId, state: sector.state, planVersion: version, plan: undefined, items, budgetUsedMs: await readResearchBudget(db, sectorId, scope), completed: Number(count.completed), total: Number(count.total), unresolved: Number(count.unresolved), discoveryClosed: false, estimatedPercent: null, companyCount: Number(count.companies), knownDomains, unresolvedIntakeCount: Number(count.intakes), ...(retries.rows.length > 100 ? { retryNextId: retries.rows[99]!.id } : {}) }
}

export async function readResearchWorkItem(db: Db, sectorId: string, version: number, id: string, scope?: Scope): Promise<WorkItem> {
  await requireSector(db, sectorId, scope); checked(Id, id); checked(z.number().int().positive(), version)
  const { rows } = await db.query<ResearchWorkRow>('SELECT * FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND id=$3', [sectorId, version, id])
  const row = rows[0]
  if (!row) throw new WorkspaceError('not_found', 'Research work is not in this sector and plan version.')
  return researchWorkView(row)
}

/** Existing PK identities make batch dedup bounded by search-page size. */
export async function researchIntakeReceipts(db: Db, sectorId: string, version: number, ids: string[], scope?: Scope): Promise<string[]> {
  await requireSector(db, sectorId, scope); checked(z.number().int().positive(), version); checked(z.array(Id).max(20), ids)
  const { rows } = await db.query<{ id: string }>('SELECT id FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND id=ANY($3::text[])', [sectorId, version, ids])
  return rows.map((row) => row.id)
}

/** Called inside the owner approval transaction; never infer semantic scope compatibility. */
export async function retainCompatibleDiscovery(db: Db, input: { sectorId: string; version: number; plan: SectorPlan; contextScope: string; contextDecisions: string; scope?: Scope }): Promise<number> {
  return logOp(workspaceLogger, 'research.work.retain', async () => {
    checked(z.number().int().positive(), input.version)
    if (input.plan.sectorId !== input.sectorId) throw new WorkspaceError('permission_denied', 'Plan belongs to another sector.')
    await requireSector(db, input.sectorId, input.scope)
    const previousVersion = input.plan.approvedVersion
    const previous = input.plan.versions.find((version) => version.version === previousVersion)?.executable
    const next = input.plan.versions.find((version) => version.version === input.version)?.executable
    if (!previousVersion || previousVersion >= input.version || !previous || !next || previous.researchDepth !== 'discovery' || next.researchDepth !== 'discovery' || !input.plan.approvedContext || input.plan.approvedContext.scope !== input.contextScope || input.plan.approvedContext.decisions !== input.contextDecisions || previous.companyBrief !== next.companyBrief || JSON.stringify(previous.acceptance) !== JSON.stringify(next.acceptance)) return 0
    const oldPrefix = `${input.sectorId}:v${previousVersion}:`
    const newPrefix = `${input.sectorId}:v${input.version}:`
    const counts = await db.query<{ n: string }>(`SELECT count(*) AS n FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND state='complete' AND kind='company' AND source_url IS NOT NULL AND jsonb_array_length(evidence)>=3 AND left(id,length($3))=$3`, [input.sectorId, previousVersion, oldPrefix])
    if (Number(counts.rows[0]?.n ?? 0) > next.budgets.maxCompanies) throw new WorkspaceError('conflict', 'The revised limit is below the completed discoveries. Review their retention before reducing the limit.')
    const directionIds = previous.budgets.maxCompanies === next.budgets.maxCompanies && previous.discoveryTarget === next.discoveryTarget ? next.discovery.filter((direction) => previous.discovery.some((old) => JSON.stringify(old) === JSON.stringify(direction))).map((direction) => `${oldPrefix}discovery:${direction.id}`) : []
    const copied = await db.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,child_id,evidence,detail,cursor,source_url)
      SELECT $4||substring(id from length($3)+1),sector_id,$5,kind,title,state,attempts,child_id,evidence,detail||$6,cursor,source_url
      FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND left(id,length($3))=$3 AND (
        (state='complete' AND kind='company' AND source_url IS NOT NULL AND jsonb_array_length(evidence)>=3) OR
        (kind='discovery' AND position(':intake:' in id)>0) OR (state='complete' AND id=ANY($7::text[])))
      ON CONFLICT(id) DO NOTHING`, [input.sectorId, previousVersion, oldPrefix, newPrefix, input.version, `\nRetained from approved plan v${previousVersion}; scope and acceptance unchanged.`, directionIds])
    const count = copied.rowCount ?? 0
    await appendEvent(db, { idempotencyKey: `research-retained:${input.sectorId}:v${input.version}`, partition: `sector:${input.sectorId}`, type: 'sector.research.work_retained', payload: { sourceVersion: previousVersion, planVersion: input.version, count, sourcePrefix: oldPrefix, destinationPrefix: newPrefix } })
    return count
  }, { sectorId: input.sectorId, planVersion: input.version })
}

export async function recordResearchWork(db: Db, input: { sectorId: string; planVersion: number; item: WorkItem; scope?: Scope }) {
  await requireSector(db, input.sectorId, input.scope)
  checked(z.number().int().positive(), input.planVersion)
  checked(z.object({ id: Id, kind: z.enum(['discovery','company']), title: z.string().min(1), receiptVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: z.enum(['pending','running','complete','blocked','failed','excluded']), attempts: z.number().int().nonnegative(), childId: z.string().nullable(), evidence: z.array(z.string()), detail: z.string(), sourceUrl: z.string().url().optional(), cursor: z.object({ queryIndex: z.number().int().nonnegative(), page: z.number().int().nonnegative(), seenDomains: z.array(z.string()) }).optional() }).strict(), input.item)
  const item = input.item
  const written = await db.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,child_id,evidence,detail,cursor,source_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12) ON CONFLICT(id) DO UPDATE SET state=$6,attempts=GREATEST(research_work.attempts,$7),child_id=$8,evidence=$9::jsonb,detail=$10,cursor=$11::jsonb,source_url=COALESCE(research_work.source_url,$12)
    WHERE research_work.state NOT IN ('complete','excluded') AND research_work.sector_id=EXCLUDED.sector_id AND research_work.plan_version=EXCLUDED.plan_version`, [item.id, input.sectorId, input.planVersion, item.kind, item.title, item.state, item.attempts, item.childId, JSON.stringify(item.evidence), item.detail, JSON.stringify(item.cursor ?? null), item.sourceUrl ?? null])
  if (!written.rowCount) {
    const existing = await db.query<{ sector_id: string; plan_version: number; state: WorkItem['state'] }>('SELECT sector_id,plan_version,state FROM research_work WHERE id=$1', [item.id])
    const row = existing.rows[0]
    if (!row || row.sector_id !== input.sectorId) throw new WorkspaceError('permission_denied', 'Work identity belongs to another sector.')
    if (row.plan_version !== input.planVersion) throw new WorkspaceError('conflict', 'Work identity belongs to another plan version.')
    return // A completed receipt is immutable; do not emit a false new state.
  }
  await notifyWorkspace(db, input.sectorId, 'work-progress', { sectorId: input.sectorId, id: item.id, state: item.state })
}
export async function closeDiscovery(db: Db, sectorId: string): Promise<void> {
  checked(Id, sectorId)
  await db.query('UPDATE sector_workspace SET discovery_closed=true WHERE sector_id=$1', [sectorId])
  await notifyWorkspace(db, sectorId, 'work-progress', { sectorId, discoveryClosed: true })
}
export async function workspaceReferences(db: Db, sectorId: string, scope?: Scope, threadKey?: string): Promise<string[]> {
  checked(Id, sectorId)
  await assertGlobalFileContext(db, sectorId, scope)
  const context = await readGlobalContext(db, sectorId, scope, false)
  if (threadKey) { const row = await workspaceRow(db, sectorId); for (const ref of mergeFileRefs(...Object.values(row.section_file_refs ?? {}))) await recordThreadFileExposure(db as TransactableDb, threadKey, sectorId, ref.fileId, ref.ords, scope) }
  const references = context.markdown ? [context.markdown] : []
  const blocks = await listContextFileBlocks(db, sectorId)
  const library = (await listSectorLibrary(db, sectorId, scope)).sort((a, b) => a.id.localeCompare(b.id))
  const libraryById = new Map(library.map((file) => [file.id, file]))
  for (const block of blocks) {
    const file = libraryById.get(block.fileId)
    if (block.state === 'ready' && file && !file.hidden && file.hash !== block.hash) await markContextFileBlockFailed(db, sectorId, block.fileId, 'file changed')
  }
  // Ready blocks ride in the markdown above; raw unit lines survive only for
  // legacy blocks until they are summarized.
  const legacy = new Set(blocks.filter((block) => block.state === 'legacy').map((block) => block.fileId))
  for (const file of library) {
    if (!file.included || file.hidden || (file.kind !== 'document' && !file.documentId)) continue
    if (!legacy.has(file.id)) continue
    const approved = await db.query<ChangeRow>('SELECT c.* FROM workspace_changes c JOIN workspace_files f ON f.approval_id=c.id WHERE f.sector_id=$1 AND f.file_id=$2', [sectorId, file.id])
    const approval = approved.rows[0]?.file_ref
    if (!approval || approval.hash !== file.hash) continue
    if (threadKey) await recordThreadFileExposure(db as TransactableDb, threadKey, sectorId, file.id, approval.ords, scope)
    const units = await listDocumentUnits(db, file.documentId ?? file.id)
    for (const unit of units.filter((entry) => approval.ords.includes(entry.ord))) references.push(`[${file.filename}:${unit.ord}] ${unit.text}`)
  }
  return references
}
/** Optimistic boundary read: references may record exposures in their own
 * transaction. Never label a mixed global document with an unrelated version. */
export async function workspaceReferenceSnapshot(db: Db, sectorId: string, threadKey: string): Promise<{ references: string[]; contextVersion: number; planVersion: number | null }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readGlobalContext(db, sectorId, undefined, false)
    const planBefore = await readSectorPlan(db, sectorId)
    const references = await workspaceReferences(db, sectorId, undefined, threadKey)
    const after = await readGlobalContext(db, sectorId, undefined, false)
    const planAfter = await readSectorPlan(db, sectorId)
    await assertThreadFileContext(db, threadKey)
    if (before.version === after.version && planBefore?.approvedVersion === planAfter?.approvedVersion) return { references, contextVersion: before.version, planVersion: planBefore?.approvedVersion ?? null }
  }
  throw new WorkspaceError('conflict', 'Shared context changed repeatedly while preparing this round. Retry at the next boundary.')
}
export interface TurnContinuation { user: string; messages: ChatMessage[]; runKey: string; sources: Array<{ url: string; key: string; hash: string }>; meta: { round: number; usage: Usage; toolCalls: number; elapsedMs: number; blockedOperations?: RecoveryOperation[]; pendingResponse?: PendingProviderResponse } }
export async function readTurnContinuation(db: Db, threadKey: string): Promise<TurnContinuation | undefined> {
  checked(Id, threadKey)
  const { rows } = await db.query<{ working_user: string | null; working_messages: ChatMessage[] | null; working_run: string | null; working_sources: TurnContinuation['sources']; working_meta: TurnContinuation['meta'] }>('SELECT working_user,working_messages,working_run,working_sources,working_meta FROM thread_context WHERE thread_key=$1', [threadKey])
  const row = rows[0]
  return row?.working_user && row.working_messages && row.working_run && row.working_meta ? { user: row.working_user, messages: row.working_messages, runKey: row.working_run, sources: row.working_sources, meta: row.working_meta } : undefined
}
export async function saveTurnContinuation(db: Db, threadKey: string, continuation: TurnContinuation, lease?: string): Promise<void> {
  checked(Id, threadKey); checked(Id, continuation.runKey)
  checked(z.string().min(1), continuation.user)
  if (!Array.isArray(continuation.messages) || continuation.messages.some((message) => !['user','assistant','tool','system'].includes(message.role))) throw new DbContractError('Invalid continuation messages')
  const saved = await db.query(`INSERT INTO thread_context(thread_key,working_user,working_messages,working_run,working_sources,working_meta) SELECT $1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb
    WHERE $7::text IS NULL OR EXISTS(SELECT 1 FROM thread_context WHERE thread_key=$1 AND active_run=$4 AND active_lease=$7)
    ON CONFLICT(thread_key) DO UPDATE SET working_user=$2,working_messages=$3::jsonb,working_run=$4,working_sources=$5::jsonb,working_meta=$6::jsonb
    WHERE $7::text IS NULL OR (thread_context.active_run=$4 AND thread_context.active_lease=$7)`, [threadKey, continuation.user, JSON.stringify(continuation.messages), continuation.runKey, JSON.stringify(continuation.sources), JSON.stringify(continuation.meta), lease ?? null])
  if (!saved.rowCount) throw new WorkspaceError('conflict', 'This turn attempt no longer owns its checkpoint.')
  const refs = await threadFileRefs(db, threadKey)
  await db.query('UPDATE thread_context SET working_file_refs=$2::jsonb WHERE thread_key=$1 AND ($3::text IS NULL OR active_lease=$3)', [threadKey, JSON.stringify(refs), lease ?? null])
}
export async function clearTurnContinuation(db: Db, threadKey: string, lease?: string): Promise<void> {
  checked(Id, threadKey)
  await db.query('UPDATE thread_context SET working_user=NULL,working_messages=NULL,working_run=NULL,working_meta=NULL,working_sources=\'[]\'::jsonb WHERE thread_key=$1 AND ($2::text IS NULL OR active_lease=$2)', [threadKey, lease ?? null])
}
/** Atomically repair durable history and the parked working view. A
 * running activity or changed checkpoint prevents stale replacement. */
export async function commitThreadCompaction(db: TransactableDb, threadKey: string, input: { version: number; summary: string; coveredSeq: number; continuation?: { previous: TurnContinuation; messages: ChatMessage[] } }, scope?: Scope): Promise<ThreadContext> {
  await requireThread(db, threadKey, scope)
  checked(z.number().int().nonnegative(), input.version)
  checked(z.number().int().nonnegative(), input.coveredSeq)
  checked(z.string().trim().min(1).max(96000), input.summary)
  return workspaceTransaction(db, threadKey, async (tx) => {
    await tx.query('INSERT INTO thread_context(thread_key) VALUES($1) ON CONFLICT DO NOTHING', [threadKey])
    const refs = await threadFileRefs(tx, threadKey, scope)
    const identity = await requireThread(tx, threadKey, scope)
    if (identity.session.sectorId) await validateFileRefs(tx, identity.session.sectorId, refs, scope)
    const changed = await tx.query(`UPDATE thread_context SET summary=$2,covered_seq=$3,version=version+1,
      working_messages=CASE WHEN $4::text IS NOT NULL THEN $5::jsonb ELSE working_messages END
      WHERE thread_key=$1 AND version=$6 AND active_run IS NULL AND covered_seq <= $3
      AND ($4::text IS NULL OR (working_run=$4 AND working_messages=$7::jsonb)) RETURNING thread_key`,
      [threadKey, input.summary, input.coveredSeq, input.continuation?.previous.runKey ?? null, JSON.stringify(input.continuation?.messages ?? null), input.version, JSON.stringify(input.continuation?.previous.messages ?? null)])
    if (!changed.rows.length) throw new WorkspaceError('conflict', 'Context is running or changed during compaction. Pause and review the latest context before retrying.')
    await tx.query('UPDATE thread_context SET summary_file_refs=$2::jsonb,working_file_refs=CASE WHEN working_messages IS NULL THEN working_file_refs ELSE $2::jsonb END WHERE thread_key=$1', [threadKey, JSON.stringify(refs)])
    await publishOutboxFrame(tx, threadKey, 'compaction', { coveredSeq: input.coveredSeq, version: input.version + 1 })
    return readThreadContext(tx, threadKey, scope)
  })
}
async function researchThreadState(db: Db, threadKey: string): Promise<string | null> {
  checked(Id, threadKey)
  const { rows } = await db.query<{ state: string }>(`SELECT s.state FROM research_work w JOIN sectors s ON s.id=w.sector_id WHERE w.child_id=$1`, [threadKey.replace(/^agent:/, '')])
  return rows[0]?.state ?? null
}
export async function recordContextMeasurement(db: Db, threadKey: string, usage: NonNullable<ThreadContext['usage']>): Promise<void> {
  checked(Id, threadKey)
  checked(z.object({ inputTokens: z.number().int().nonnegative(), budget: z.number().int().positive(), window: z.number().int().positive(), method: z.enum(['exact','estimated']) }).strict(), usage)
  await db.query('UPDATE thread_context SET usage=$2::jsonb WHERE thread_key=$1', [threadKey, JSON.stringify(usage)])
}
