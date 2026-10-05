import { createHash } from 'node:crypto'
// Server-derived provenance. Agent text and arguments never grant inclusion.
import type { Scope } from '../auth/types.js'
import { appendEvent, type Db } from './events.js'
import { listArtifacts } from './event-artifacts.js'
import type { TransactableDb } from './checkpoints.js'
import { WorkspaceError } from './errors.js'
import { listDocumentUnitOrdinals } from './document-units.js'
import { listSectorLibrary } from './workspace-library.js'
import { requireThread, workspaceTransaction, type ContextFileRef } from './workspace.js'

export class ContextFileBlocked extends WorkspaceError {
  constructor(message = 'Context depends on a hidden, changed, or unverified file. Reveal the exact source version or safely rebuild context before resuming.') { super('conflict', message) }
}
export function mergeFileRefs(...groups: Array<ContextFileRef[] | null | undefined>): ContextFileRef[] {
  const merged = new Map<string, ContextFileRef>()
  for (const group of groups) for (const ref of group ?? []) {
    const id = `${ref.readSectorId ?? ""}:${ref.fileId}:${ref.hash}`
    const prior = merged.get(id)
    merged.set(id, { ...ref, ords: [...new Set([...(prior?.ords ?? []), ...ref.ords])].sort((a, b) => a - b) })
  }
  return [...merged.values()].sort((a,b) => a.fileId.localeCompare(b.fileId) || a.hash.localeCompare(b.hash))
}
export async function validateFileRefs(db: Db, sectorId: string, refs: ContextFileRef[], scope?: Scope): Promise<void> {
  if (!refs.length) return
  const files = new Map((await listSectorLibrary(db, sectorId, scope)).map((file) => [file.id, file]))
  for (const ref of refs) {
    if (ref.readSectorId && ref.readSectorId !== sectorId) throw new ContextFileBlocked('The file dependency belongs to another read scope. Import and review its target-library version explicitly.')
    const file = files.get(ref.fileId)
    if (!file || file.hidden || file.hash !== ref.hash || file.status !== 'indexed') throw new ContextFileBlocked(`Source ${ref.filename} is hidden, changed, or unavailable. Reveal its exact version or start a clean conversation; stored history is retained.`)
    const units = new Set(await listDocumentUnitOrdinals(db, file.documentId ?? file.id))
    if (ref.ords.some((ord) => !units.has(ord))) throw new ContextFileBlocked('Context source units changed. Review the exact file version before resuming.')
  }
}
export async function threadFileRefs(db: Db, threadKey: string, scope?: Scope): Promise<ContextFileRef[]> {
  const { thread, session } = await requireThread(db, threadKey, scope)
  const { rows } = await db.query<{ file_exposures: ContextFileRef[]; file_inheritance_set: boolean }>('SELECT file_exposures,file_inheritance_set FROM thread_context WHERE thread_key=$1', [threadKey])
  const own = rows[0]
  if (thread.kind !== 'subagent' || own?.file_inheritance_set) return mergeFileRefs(own?.file_exposures)
  const parent = await db.query<{ file_exposures: ContextFileRef[] }>('SELECT file_exposures FROM thread_context WHERE thread_key=$1', [session.id])
  return mergeFileRefs(own?.file_exposures, parent.rows[0]?.file_exposures)

}
export async function recordThreadFileExposure(db: TransactableDb, threadKey: string, sectorId: string, fileId: string, ords?: number[], scope?: Scope, expectedHash?: string): Promise<ContextFileRef> {
  const actor = await requireThread(db, threadKey, scope)
  if (actor.session.sectorId && actor.session.sectorId !== sectorId) throw new WorkspaceError('permission_denied', 'File exposure belongs to another sector.')
  return workspaceTransaction(db, sectorId, async (tx) => {
    const file = (await listSectorLibrary(tx, sectorId, scope)).find((entry) => entry.id === fileId || entry.documentId === fileId)
    if (!file || file.hidden || file.status !== 'indexed') throw new ContextFileBlocked('File is hidden, unavailable, or unindexed. No content was exposed.')
    if (expectedHash !== undefined && file.hash !== expectedHash) {
      // Indexed artifacts use the extraction-version hash in the library, while
      // serveArtifact verifies their immutable archive-body hash.
      const artifact = file.kind === 'artifact' && file.sessionId ? (await listArtifacts(tx, file.sessionId, true)).find((entry) => entry.artifactId === file.id) : undefined
      if (!artifact || artifact.sha256 !== expectedHash) throw new ContextFileBlocked('The source version changed before its content was exposed.')
    }
    const all = await listDocumentUnitOrdinals(tx, file.documentId ?? file.id)
    const ref = { readSectorId: sectorId, fileId: file.id, hash: file.hash, filename: file.filename, ords: ords ?? all }
    if (ref.ords.some((ord) => !all.includes(ord))) throw new ContextFileBlocked('The returned file units changed before exposure.')
    await tx.query('INSERT INTO thread_context(thread_key) VALUES($1) ON CONFLICT DO NOTHING', [threadKey])
    const prior = await tx.query<{ file_exposures: ContextFileRef[] }>('SELECT file_exposures FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])
    const refs = mergeFileRefs(prior.rows[0]?.file_exposures, await threadFileRefs(tx, threadKey, scope), [ref])
    await tx.query('UPDATE thread_context SET file_exposures=$2::jsonb,file_inheritance_set=true WHERE thread_key=$1', [threadKey, JSON.stringify(refs)])
    await appendEvent(tx, { idempotencyKey: `file-exposure:${createHash('sha256').update(JSON.stringify([threadKey, ref])).digest('hex')}`, partition: threadKey, type: 't.file.exposed', payload: { threadKey, ref } })
    return ref
  })
}
export async function assertThreadFileContext(db: Db, threadKey: string, scope?: Scope): Promise<void> {
  const { session } = await requireThread(db, threadKey, scope)
  const refs = await threadFileRefs(db, threadKey, scope)
  if (session.sectorId) await validateFileRefs(db, session.sectorId, refs, scope)
  else for (const ref of refs) {
    if (!ref.readSectorId) throw new ContextFileBlocked('This file dependency has no verified read scope. Owner must safely rebuild context before resuming.')
    await validateFileRefs(db, ref.readSectorId, [ref], scope)
  }

  const { rows } = await db.query<{ summary: string; summary_file_refs: ContextFileRef[] | null; working_messages: unknown; working_file_refs: ContextFileRef[] | null; history_provenance_known: boolean }>('SELECT summary,summary_file_refs,working_messages,working_file_refs,history_provenance_known FROM thread_context WHERE thread_key=$1', [threadKey])
  const row = rows[0]
  if (row?.history_provenance_known === false || row?.summary && row.summary_file_refs === null || row?.working_messages && row.working_file_refs === null) throw new ContextFileBlocked('This legacy context has unverified file provenance. Keep its history and start a clean conversation, or safely rebuild its context before resuming.')
  if (session.sectorId) await validateFileRefs(db, session.sectorId, mergeFileRefs(row?.summary_file_refs, row?.working_file_refs), scope)
}

export async function inheritThreadFileRefs(db: TransactableDb, threadKey: string, scope?: Scope): Promise<void> {
  await workspaceTransaction(db, threadKey, async (tx) => {
    const refs = await threadFileRefs(tx, threadKey, scope)
    await tx.query('UPDATE thread_context SET file_exposures=$2::jsonb,file_inheritance_set=true WHERE thread_key=$1 AND NOT file_inheritance_set', [threadKey, JSON.stringify(refs)])
  })
}

export async function agentHistoryBoundary(db: Db, threadKey: string): Promise<{ coveredSeq: number; outboxAfter: number }> {
  const { rows } = await db.query<{ covered_seq: number; rebuilt_outbox_floor: number; rebuilt_history: boolean }>('SELECT covered_seq,rebuilt_outbox_floor,rebuilt_history FROM thread_context WHERE thread_key=$1', [threadKey])
  return rows[0]?.rebuilt_history ? { coveredSeq: Number(rows[0].covered_seq), outboxAfter: Number(rows[0].rebuilt_outbox_floor) } : { coveredSeq: 0, outboxAfter: 0 }
}

// A6: one standardized summary block per context file. The block row is the
// provenance record; the version bumps only when the summary lands.
type ContextFileBlockState = 'summarizing' | 'ready' | 'failed' | 'legacy'
export interface ContextFileBlock {
  sectorId: string; fileId: string; documentId: string; hash: string; filename: string
  state: ContextFileBlockState; summary: string; tokens: number; error: string | null
  requestedBy: string; addedVersion: number | null; inputTokens: number; outputTokens: number
}
interface ContextFileBlockRow {
  sector_id: string; file_id: string; document_id: string; hash: string; filename: string
  state: ContextFileBlockState; summary: string; tokens: number; error: string | null
  requested_by: string; added_version: number | null; input_tokens: number; output_tokens: number
}
function blockView(row: ContextFileBlockRow): ContextFileBlock {
  return {
    sectorId: row.sector_id, fileId: row.file_id, documentId: row.document_id, hash: row.hash,
    filename: row.filename, state: row.state, summary: row.summary, tokens: Number(row.tokens),
    error: row.error, requestedBy: row.requested_by,
    addedVersion: row.added_version === null ? null : Number(row.added_version),
    inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens),
  }
}
export async function readContextFileBlock(db: Db, sectorId: string, fileId: string): Promise<ContextFileBlock | undefined> {
  const { rows } = await db.query<ContextFileBlockRow>('SELECT * FROM context_file_blocks WHERE sector_id=$1 AND file_id=$2', [sectorId, fileId])
  return rows[0] ? blockView(rows[0]) : undefined
}
export async function listContextFileBlocks(db: Db, sectorId: string): Promise<ContextFileBlock[]> {
  const { rows } = await db.query<ContextFileBlockRow>('SELECT * FROM context_file_blocks WHERE sector_id=$1 ORDER BY filename', [sectorId])
  return rows.map(blockView)
}
export async function insertContextFileBlock(db: Db, input: { sectorId: string; fileId: string; documentId: string; hash: string; filename: string; requestedBy: string }): Promise<ContextFileBlock> {
  const { rows } = await db.query<ContextFileBlockRow>(
    `INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,requested_by)
     VALUES ($1,$2,$3,$4,$5,'summarizing',$6)
     ON CONFLICT (sector_id,file_id) DO NOTHING RETURNING *`,
    [input.sectorId, input.fileId, input.documentId, input.hash, input.filename, input.requestedBy])
  const row = rows[0] ?? (await db.query<ContextFileBlockRow>('SELECT * FROM context_file_blocks WHERE sector_id=$1 AND file_id=$2', [input.sectorId, input.fileId])).rows[0]
  if (!row) throw new WorkspaceError('conflict', 'Context file block vanished during insert.')
  return blockView(row)
}
export async function resetContextFileBlock(db: Db, input: { sectorId: string; fileId: string; hash: string; filename: string; documentId: string; requestedBy: string }): Promise<ContextFileBlock | undefined> {
  const { rows } = await db.query<ContextFileBlockRow>(
    `UPDATE context_file_blocks SET state='summarizing',error=NULL,hash=$3,filename=$4,document_id=$5,requested_by=$6,updated_at=now()
     WHERE sector_id=$1 AND file_id=$2 AND state IN ('failed','legacy') RETURNING *`,
    [input.sectorId, input.fileId, input.hash, input.filename, input.documentId, input.requestedBy])
  return rows[0] ? blockView(rows[0]) : undefined
}
export async function markContextFileBlockFailed(db: Db, sectorId: string, fileId: string, error: string): Promise<void> {
  await db.query(`UPDATE context_file_blocks SET state='failed',error=$3,updated_at=now()
    WHERE sector_id=$1 AND file_id=$2 AND state IN ('summarizing','ready','legacy')`, [sectorId, fileId, error])
}

// Numeric coverage: every number-like token in the source must appear in the
// summary, copied exactly. Trailing punctuation is an extraction artifact,
// not part of the number; a trailing % is semantic and kept.
const NUMBER_TOKEN = /\d[\d,.:/-]*%?/g
export function extractNumberTokens(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.match(NUMBER_TOKEN) ?? []) {
    if (raw.length < 2) continue
    const token = raw.replace(/[.,:/-]+$/, '')
    if (token.length >= 2 && !seen.has(token)) seen.add(token)
  }
  return [...seen]
}
export function findMissingNumbers(source: string, summary: string): Array<{ token: string; snippet: string }> {
  const present = new Set(extractNumberTokens(summary))
  const missing: Array<{ token: string; snippet: string }> = []
  for (const token of extractNumberTokens(source)) {
    if (present.has(token)) continue
    const at = source.indexOf(token)
    const snippet = at < 0 ? token : source.slice(Math.max(0, at - 60), at + token.length + 60)
    missing.push({ token, snippet })
  }
  return missing
}
export function chunkDocumentUnits<T extends { text: string }>(units: T[], maxTokens: number, count: (text: string) => number): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let used = 0
  for (const unit of units) {
    const size = count(unit.text)
    if (current.length > 0 && used + size > maxTokens) { chunks.push(current); current = []; used = 0 }
    current.push(unit)
    used += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
export function parseJsonObject(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? reply).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch { return undefined }
    }
    return undefined
  }
}
export function normalizeSectionsJson(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed
  const record = parsed as Record<string, unknown>
  for (const key of ['decisions', 'findings', 'questions']) {
    const value = record[key]
    if (Array.isArray(value)) record[key] = value.map((entry) => String(entry)).join('\n')
  }
  return record
}
const BLOCK_TEMPLATE_MARKERS = ['### ', '**Overview.**', '**Key facts**', '**Entities**', '**Tables and data**', '**Gaps or unclear parts**', 'Source: full original in Files ▸ ']
export function validateBlockTemplate(summary: string): string[] {
  const issues: string[] = []
  let floor = -1
  for (const marker of BLOCK_TEMPLATE_MARKERS) {
    const at = summary.indexOf(marker)
    if (at < 0) { issues.push(`Missing heading ${marker.trim() || marker}.`); continue }
    if (at <= floor) issues.push(`Heading ${marker.trim() || marker} is out of order.`)
    floor = Math.max(floor, at)
  }
  return issues
}
