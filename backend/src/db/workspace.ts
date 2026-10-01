import type { RecoveryOperation } from '@kardata/agents'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { serveArtifact } from '../artifacts/pipeline.js'
import type { ArchiveTarget } from '../archive/targets.js'
import type { Scope } from '../auth/keys.js'
import { appendEvent, createSession, findEventByKey, getSession, listArtifacts, listSessions, readPartition, resolveArtifactScope, type Db } from './events.js'
import { getSector } from './sectors.js'
import { getThreadHeader, listThreadHeaders } from './threads.js'
import { DURABLE_STREAM_LOCK_SQL, type TransactableDb } from './checkpoints.js'
import { DbContractError } from './errors.js'
import { publishOutboxFrame } from './outbox.js'
import { ingestSectorDocument, listSectorDocuments, readOriginalSectorDocument } from './sector-documents.js'
import { listDocumentUnits } from './document-units.js'
import { progressSummary, type WorkItem } from '../temporal/research-plan.js'
import { readSectorPlan, type SectorPlan } from './sector-plan.js'
import type { ChatMessage, Usage } from '@kardata/agents'
import { createLogger, logOp } from '../observability/logging.js'

const workspaceLogger = createLogger({ op: 'workspace' })

export class WorkspaceError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'permission_denied' | 'validation_failed', message: string) { super(message) }
}
export const ContextSections = z.object({
  scope: z.string().max(24000).default(''), decisions: z.string().max(24000).default(''),
  findings: z.string().max(48000).default(''), questions: z.string().max(24000).default(''),
}).strict()
export type ContextSections = z.infer<typeof ContextSections>
export interface GlobalContext {
  sectorId: string; version: number; sections: ContextSections; markdown: string
  researchSessionId: string | null; changes: ContextChange[]
}
export interface ContextChange {
  id: string; baseVersion: number; sections: ContextSections; sourceThread: string
  author: string; state: 'pending' | 'parent-review' | 'approved' | 'denied'; version: number | null; at: string
  fileRef: { fileId: string; hash: string; filename: string; ords: number[] } | null
}
export interface ThreadContext { pendingOperations?: Array<{ operationId: string; toolName: string; callId: string; reason: string }>; threadKey: string; notes: string; summary: string; coveredSeq: number; version: number; usage?: { inputTokens: number; budget: number; window: number; method: 'exact' | 'estimated' } }
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
export async function researchSessionBinding(db: Db, sectorId: string): Promise<string | null> {
  checked(Id, sectorId)
  return (await workspaceRow(db, sectorId)).research_session_id
}
export function formatGlobalContext(sections: ContextSections): string {
  return (['scope', 'decisions', 'findings', 'questions'] as const).flatMap((key) => {
    const title = { scope: 'Scope', decisions: 'Decisions', findings: 'Findings', questions: 'Open questions' }[key]
    return sections[key].trim() ? [`## ${title}\n\n${sections[key].trim()}`] : []
  }).join('\n\n')
}
interface WorkspaceRow { context_version: number; sections: unknown; research_session_id: string | null; protected_decisions: string }
async function workspaceRow(db: Db, sectorId: string): Promise<WorkspaceRow> {
  const { rows } = await db.query<WorkspaceRow>('SELECT * FROM sector_workspace WHERE sector_id=$1', [sectorId])
  return rows[0] ?? { context_version: 0, sections: {}, research_session_id: null, protected_decisions: '' }
}
interface ChangeRow { id: string; sector_id: string; base_version: number; sections: unknown; source_thread: string; author: string; state: ContextChange['state']; version: number | null; at: Date | string; file_ref: ContextChange['fileRef'] }
function changeView(row: ChangeRow): ContextChange {
  return { id: row.id, baseVersion: row.base_version, sections: checked(ContextSections, row.sections), sourceThread: row.source_thread, author: row.author, state: row.state, version: row.version, at: new Date(row.at).toISOString(), fileRef: row.file_ref }
}
export async function readGlobalContext(db: Db, sectorId: string, scope?: Scope): Promise<GlobalContext> {
  const sector = await requireSector(db, sectorId, scope)
  const row = await workspaceRow(db, sectorId)
  const sections = checked(ContextSections, row.sections)
  if (!sections.scope && row.context_version === 0) sections.scope = sector.topic || sector.name
  const changes = await db.query<ChangeRow>('SELECT * FROM workspace_changes WHERE sector_id=$1 ORDER BY at DESC LIMIT 100', [sectorId])
  return { sectorId, version: row.context_version, sections, markdown: formatGlobalContext(sections), researchSessionId: row.research_session_id, changes: changes.rows.map(changeView) }
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
  sectorId: string; baseVersion: number; sections: ContextSections; sourceThread: string; owner: boolean; scope?: Scope; id?: string
  fileRef?: NonNullable<ContextChange['fileRef']>
  trustedResearch?: boolean
}): Promise<ContextChange> {
  const sections = checked(ContextSections, input.sections)
  checked(z.number().int().nonnegative(), input.baseVersion)
  checked(Id, input.sectorId)
  checked(Id, input.sourceThread)
  await requireSector(db, input.sectorId, input.scope)
  const identity = input.owner ? undefined : await requireThread(db, input.sourceThread, input.scope)
  if (identity && identity.session.sectorId !== input.sectorId) throw new WorkspaceError('permission_denied', 'Conversation belongs to another sector.')
  return workspaceTransaction(db, input.sectorId, async (tx) => {
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    const id = checked(Id, input.id ?? randomUUID())
    const old = await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1 AND sector_id=$2', [id, input.sectorId])
    if (old.rows[0]) return changeView(old.rows[0])
    if (row.context_version !== input.baseVersion) throw new WorkspaceError('conflict', 'Global context changed. Review the latest version.')
    const researchParent = input.trustedResearch === true && identity?.session.id === row.research_session_id && identity.thread.kind === 'session'
    let state: ContextChange['state'] = input.owner || researchParent ? 'approved' : input.trustedResearch && identity?.session.id === row.research_session_id && identity.thread.kind === 'subagent' ? 'parent-review' : 'pending'
    if (input.fileRef) state = 'pending'
    if (researchParent && !input.owner) {
      const current = checked(ContextSections, row.sections)
      if (!current.scope && row.context_version === 0) { const sector = await requireSector(tx, input.sectorId, input.scope); current.scope = sector.topic || sector.name }
      if (sections.scope !== current.scope || sections.decisions !== current.decisions) state = 'pending'
    }
    const version = state === 'approved' ? row.context_version + 1 : null
    const author = input.owner ? 'owner' : researchParent ? 'research' : 'session'
    // Idempotent replay: same id replays the first row (appendEvent idiom).
    // Callers needing retry-safety must pass stable ids; without one a
    // retry is a new proposal by definition.
    const result = await tx.query<ChangeRow>(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(id) DO NOTHING RETURNING *`, [id, input.sectorId, input.baseVersion, JSON.stringify(sections), input.sourceThread, author, state, version, JSON.stringify(input.fileRef ?? null)])
    const inserted = result.rows[0]
    if (!inserted) {
      // Lost race after the pre-SELECT: another writer claimed this id.
      // Replay the winner when it belongs to this sector; a stray cross-
      // sector collision fails loudly instead of merging contexts.
      const winner = (await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1', [id])).rows[0]
      if (!winner || winner.sector_id !== input.sectorId) throw new WorkspaceError('conflict', 'context change id collision')
      return changeView(winner)
    }
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
    if (input.approve && proposal.file_ref) {
      const visibility = await tx.query<{ hidden: boolean }>('SELECT hidden FROM workspace_files WHERE sector_id=$1 AND file_id=$2', [input.sectorId, proposal.file_ref.fileId])
      if (visibility.rows[0]?.hidden) throw new WorkspaceError('conflict', 'Reveal the file before including it.')
      const file = (await listSectorLibrary(tx, input.sectorId, input.scope)).find((entry) => entry.id === proposal.file_ref?.fileId)
      if (!file || file.hash !== proposal.file_ref.hash) throw new WorkspaceError('conflict', 'The file version changed. Review a new proposal.')
      await tx.query('INSERT INTO workspace_files(sector_id,file_id,included,approval_id) VALUES($1,$2,true,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET included=true,approval_id=$3', [input.sectorId, proposal.file_ref.fileId, input.id])
    }
    if (input.approve) await tx.query('UPDATE sector_workspace SET context_version=$2,sections=$3::jsonb,protected_decisions=$4 WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(proposal.sections), checked(ContextSections, proposal.sections).decisions])
    const updated = await tx.query<ChangeRow>('UPDATE workspace_changes SET state=$2,version=$3 WHERE id=$1 RETURNING *', [input.id, state, version])
    await appendEvent(tx, { idempotencyKey: `workspace-decision:${input.id}`, partition: `sector:${input.sectorId}`, type: 'sector.context.decided', payload: { changeId: input.id, state, version } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, state, version })
    const row = updated.rows[0]
    if (!row) throw new WorkspaceError('conflict', 'context decision missing')
    return changeView(row)
  })
}
export async function readThreadContext(db: Db, threadKey: string, scope?: Scope): Promise<ThreadContext> {
  await requireThread(db, threadKey, scope)
  const { rows } = await db.query<{ notes: string; summary: string; covered_seq: number | string; version: number; usage: ThreadContext['usage']; working_meta: TurnContinuation['meta'] | null }>('SELECT * FROM thread_context WHERE thread_key=$1', [threadKey])
  const row = rows[0]
  return { threadKey, notes: row?.notes ?? '', summary: row?.summary ?? '', coveredSeq: Number(row?.covered_seq ?? 0), version: row?.version ?? 0, ...(row?.usage ? { usage: row.usage } : {}), ...(row?.working_meta?.blockedOperations?.length ? { pendingOperations: row.working_meta.blockedOperations.map((operation) => ({ operationId: operation.operationId, toolName: operation.call.name, callId: operation.call.id, reason: operation.reason })) } : {}) }
}
export async function saveThreadContext(db: TransactableDb, threadKey: string, input: { version: number; notes?: string; summary?: string; coveredSeq?: number }, scope?: Scope, lease?: string): Promise<ThreadContext> {
  checked(z.object({ version: z.number().int().nonnegative(), notes: z.string().max(24000).optional(), summary: z.string().max(48000).optional(), coveredSeq: z.number().int().nonnegative().optional() }).strict(), input)
  await requireThread(db, threadKey, scope)
  return workspaceTransaction(db, threadKey, async (tx) => {
    if (lease && !(await tx.query('SELECT thread_key FROM thread_context WHERE thread_key=$1 AND active_lease=$2', [threadKey, lease])).rows.length) throw new WorkspaceError('conflict', 'This attempt no longer owns its summary.')
    const current = await readThreadContext(tx, threadKey, scope)
    if (current.version !== input.version) throw new WorkspaceError('conflict', 'Local context changed. Try again.')
    if ((input.coveredSeq ?? current.coveredSeq) < current.coveredSeq) throw new WorkspaceError('conflict', 'Summary coverage cannot move backwards.')
    await tx.query(`INSERT INTO thread_context(thread_key,notes,summary,covered_seq,version) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(thread_key) DO UPDATE SET notes=$2,summary=$3,covered_seq=$4,version=$5`, [threadKey, input.notes ?? current.notes, input.summary ?? current.summary, input.coveredSeq ?? current.coveredSeq, current.version + 1])
    if (input.summary !== undefined) await publishOutboxFrame(tx, threadKey, 'compaction', { version: current.version + 1, coveredSeq: input.coveredSeq })
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

export async function beginThreadTurn(db: TransactableDb, threadKey: string, runKey: string): Promise<string> {
  checked(Id, threadKey); checked(Id, runKey)
  const lease = randomUUID()
  await workspaceTransaction(db, threadKey, async (tx) => {
    await tx.query('INSERT INTO thread_context(thread_key,active_run,active_lease) VALUES($1,$2,$3) ON CONFLICT(thread_key) DO UPDATE SET active_run=$2,active_lease=$3', [threadKey, runKey, lease])
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
    await tx.query('UPDATE thread_context SET active_run=NULL,active_lease=NULL WHERE thread_key=$1 AND active_run=$2 AND ($3::text IS NULL OR active_lease=$3)', [threadKey, runKey, lease ?? null])
    if (rows.length) await publishOutboxFrame(tx, threadKey, 'steering-consumption', { ids: rows.map((row) => row.id), state: 'missed' })
  })
}

export interface LibraryFile {
  id: string; filename: string; status: string; source: string; hash: string
  hidden: boolean; included: boolean; kind: 'document' | 'artifact'; sessionId?: string; documentId?: string
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
  for (const doc of await listSectorDocuments(db, sectorId, scope, true)) {
    files.set(doc.id, { id: doc.id, filename: doc.filename, status: doc.status, hash: doc.sha256, source: 'Uploaded', hidden: false, included: false, kind: 'document' })
  }
  for (const session of await listSessions(db, scope, sectorId)) {
    for (const artifact of await listArtifacts(db, session.id, true)) {
      if (!files.has(artifact.artifactId)) files.set(artifact.artifactId, { id: artifact.artifactId, filename: artifact.name ?? 'Untitled file', status: artifact.indexed ? 'indexed' : 'processing', hash: artifact.sha256 ?? '', source: artifact.producedBy ?? session.title, hidden: false, included: false, kind: 'artifact', sessionId: session.id })
    }
  }
  for (const flag of flags.rows) {
    const file = files.get(flag.file_id)
    if (file) {
      file.hidden = flag.hidden; file.included = flag.included && !flag.hidden
      if (flag.document_id) { file.documentId = flag.document_id; const indexed = files.get(flag.document_id); if (indexed) file.hash = indexed.hash; files.delete(flag.document_id) }
    }
  }
  return [...files.values()]
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
  if (!change.fileRef) return { change, units: [] }
  const file = (await listSectorLibrary(db, sectorId, scope)).find((entry) => entry.id === change.fileRef?.fileId)
  if (!file || file.hidden || file.hash !== change.fileRef.hash) throw new WorkspaceError('conflict', 'This file is hidden or its version changed. Review a new proposal.')
  const units = (await listDocumentUnits(db, file.documentId ?? file.id)).filter((unit) => change.fileRef?.ords.includes(unit.ord))
  return { change, units: units.map((unit) => ({ ord: unit.ord, text: unit.text, uncertain: unit.uncertain })) }
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
  if (preview.change.state !== 'parent-review' || preview.change.fileRef) throw new WorkspaceError('permission_denied', 'This update requires owner approval.')
  const result = await proposeGlobalContext(db, { sectorId: session.sectorId, baseVersion: preview.change.baseVersion, sections: preview.change.sections, sourceThread: threadKey, owner: false, trustedResearch: true, scope, id: `parent-commit:${id}` })
  if (result.state === 'approved') await db.query("UPDATE workspace_changes SET state='approved',version=$2 WHERE id=$1 AND state='parent-review'", [id, result.version])
  return result
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
export async function readResearchProgress(db: Db, sectorId: string, scope?: Scope) {
  const sector = await requireSector(db, sectorId, scope)
  const plan = await readSectorPlan(db, sectorId, scope)
  const version = ['planning', 'planned'].includes(sector.state) ? plan?.latest?.version ?? 0 : plan?.approvedVersion ?? plan?.latest?.version ?? 0
  const { rows } = await db.query<{ id: string; kind: WorkItem['kind']; title: string; state: WorkItem['state']; attempts: number; child_id: string | null; evidence: string[]; detail: string; cursor: WorkItem['cursor']; source_url: string | null }>('SELECT * FROM research_work WHERE sector_id=$1 AND plan_version=$2 ORDER BY at,id', [sectorId, version])
  const items: WorkItem[] = rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title, state: row.state, attempts: row.attempts, childId: row.child_id, evidence: row.evidence, detail: row.detail, ...(row.source_url ? { sourceUrl: row.source_url } : {}), ...(row.cursor ? { cursor: row.cursor } : {}) }))
  const workspace = await db.query<{ discovery_closed: boolean }>('SELECT discovery_closed FROM sector_workspace WHERE sector_id=$1', [sectorId])
  const approved = plan?.versions.find((entry) => entry.version === version)?.executable
  const expected = approved?.discovery.map((direction) => `${sectorId}:v${version}:discovery:${direction.id}`) ?? []
  const closed = (workspace.rows[0]?.discovery_closed ?? false) && expected.length > 0 && expected.every((id) => items.some((item) => item.id === id && item.state === 'complete'))
  return { sectorId, state: sector.state, planVersion: version, plan, items, budgetUsedMs: await readResearchBudget(db, sectorId, scope), ...progressSummary(items, closed, sector.state === 'complete') }
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
  checked(z.object({ id: Id, kind: z.enum(['discovery','company']), title: z.string().min(1), state: z.enum(['pending','running','complete','blocked','failed']), attempts: z.number().int().nonnegative(), childId: z.string().nullable(), evidence: z.array(z.string()), detail: z.string(), sourceUrl: z.string().url().optional(), cursor: z.object({ queryIndex: z.number().int().nonnegative(), page: z.number().int().nonnegative(), seenDomains: z.array(z.string()) }).optional() }).strict(), input.item)
  const item = input.item
  const written = await db.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,child_id,evidence,detail,cursor,source_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12) ON CONFLICT(id) DO UPDATE SET state=$6,attempts=GREATEST(research_work.attempts,$7),child_id=$8,evidence=$9::jsonb,detail=$10,cursor=$11::jsonb,source_url=COALESCE(research_work.source_url,$12)
    WHERE research_work.state <> 'complete' AND research_work.sector_id=EXCLUDED.sector_id AND research_work.plan_version=EXCLUDED.plan_version`, [item.id, input.sectorId, input.planVersion, item.kind, item.title, item.state, item.attempts, item.childId, JSON.stringify(item.evidence), item.detail, JSON.stringify(item.cursor ?? null), item.sourceUrl ?? null])
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
export async function workspaceReferences(db: Db, sectorId: string, scope?: Scope): Promise<string[]> {
  checked(Id, sectorId)
  const context = await readGlobalContext(db, sectorId, scope)
  const references = context.markdown ? [context.markdown] : []
  for (const file of (await listSectorLibrary(db, sectorId, scope)).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!file.included || file.hidden || (file.kind !== 'document' && !file.documentId)) continue
    const approved = await db.query<ChangeRow>('SELECT c.* FROM workspace_changes c JOIN workspace_files f ON f.approval_id=c.id WHERE f.sector_id=$1 AND f.file_id=$2', [sectorId, file.id])
    const approval = approved.rows[0]?.file_ref
    if (!approval || approval.hash !== file.hash) continue
    const units = await listDocumentUnits(db, file.documentId ?? file.id)
    for (const unit of units.filter((entry) => approval.ords.includes(entry.ord))) references.push(`[${file.filename}:${unit.ord}] ${unit.text}`)
  }
  return references
}
export interface TurnContinuation { user: string; messages: ChatMessage[]; runKey: string; sources: Array<{ url: string; key: string; hash: string }>; meta: { round: number; usage: Usage; toolCalls: number; elapsedMs: number; blockedOperations?: RecoveryOperation[] } }
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
    const changed = await tx.query(`UPDATE thread_context SET summary=$2,covered_seq=$3,version=version+1,
      working_messages=CASE WHEN $4::text IS NOT NULL THEN $5::jsonb ELSE working_messages END
      WHERE thread_key=$1 AND version=$6 AND active_run IS NULL AND covered_seq <= $3
      AND ($4::text IS NULL OR (working_run=$4 AND working_messages=$7::jsonb)) RETURNING thread_key`,
      [threadKey, input.summary, input.coveredSeq, input.continuation?.previous.runKey ?? null, JSON.stringify(input.continuation?.messages ?? null), input.version, JSON.stringify(input.continuation?.previous.messages ?? null)])
    if (!changed.rows.length) throw new WorkspaceError('conflict', 'Context is running or changed during compaction. Pause and review the latest context before retrying.')
    await publishOutboxFrame(tx, threadKey, 'compaction', { coveredSeq: input.coveredSeq, version: input.version + 1 })
    return readThreadContext(tx, threadKey, scope)
  })
}
export async function researchThreadState(db: Db, threadKey: string): Promise<string | null> {
  checked(Id, threadKey)
  const { rows } = await db.query<{ state: string }>(`SELECT s.state FROM research_work w JOIN sectors s ON s.id=w.sector_id WHERE w.child_id=$1`, [threadKey.replace(/^agent:/, '')])
  return rows[0]?.state ?? null
}
export async function recordContextMeasurement(db: Db, threadKey: string, usage: NonNullable<ThreadContext['usage']>): Promise<void> {
  checked(Id, threadKey)
  checked(z.object({ inputTokens: z.number().int().nonnegative(), budget: z.number().int().positive(), window: z.number().int().positive(), method: z.enum(['exact','estimated']) }).strict(), usage)
  await db.query('UPDATE thread_context SET usage=$2::jsonb WHERE thread_key=$1', [threadKey, JSON.stringify(usage)])
}
