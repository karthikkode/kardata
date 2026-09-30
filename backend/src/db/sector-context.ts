// Sector context assembly: the exact payload behind the Context button.
// System (sector brief), references (included file units cited
// document_id:ord plus user notes), empty history/tail at sector scope —
// per-turn history/tail attach in Phase D. Estimates come from the agents
// describeSegments over the same arrays the provider will receive.
import { randomUUID } from 'node:crypto'
import { assembleReferences, describeSegments, type ContextUsage } from '@kardata/agents'
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'
import { listDocumentUnits } from './document-units.js'
import { sha256Hex, type ExtractionStatus } from './file-pipeline.js'
import { listSectorDocuments, type SectorDocument } from './sector-documents.js'
import { getSector } from './sectors.js'

export interface ContextUnitView {
  ord: number
  kind: string
  text: string
  uncertain: boolean
  excluded: boolean
}

export interface ContextFileView {
  id: string
  filename: string
  mediaType: string
  status: ExtractionStatus
  sha256: string
  chars: number
  excluded: boolean
  units: ContextUnitView[]
}

export interface ContextNoteView {
  id: string
  text: string
  createdAt: string
}

export interface SectorDigest {
  version: string
  text: string
}

export interface SectorContextView {
  sectorId: string
  digest: SectorDigest
  segments: { system: string; references: string[]; history: string[]; tail: string[] }
  usage: ContextUsage
  files: ContextFileView[]
  notes: ContextNoteView[]
}

const NoteSchema = z.string().min(1).max(2000)

export async function listContextNotes(db: Db, sectorId: string): Promise<ContextNoteView[]> {
  const { rows } = await db.query<{ id: string; text: string; created_at: Date | string }>(
    'SELECT id, text, created_at FROM sector_context_notes WHERE sector_id = $1 ORDER BY created_at ASC',
    [sectorId],
  )
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }))
}

export async function addContextNotes(db: Db, sectorId: string, notes: string[]): Promise<ContextNoteView[]> {
  const created: ContextNoteView[] = []
  for (const note of notes) {
    if (!NoteSchema.safeParse(note).success) throw new DbContractError('note must be 1-2000 characters')
    const id = `snote-${randomUUID()}`
    const { rows } = await db.query<{ created_at: Date | string }>(
      'INSERT INTO sector_context_notes (id, sector_id, text) VALUES ($1, $2, $3) RETURNING created_at',
      [id, sectorId, note],
    )
    const at = rows[0]?.created_at
    created.push({ id, text: note, createdAt: at instanceof Date ? at.toISOString() : String(at ?? '') })
  }
  return created
}

export interface UnitRef {
  documentId: string
  /** -1 addresses the whole document; >= 0 addresses one unit. */
  ord: number
}

/** Set or clear exclusions. Whole-document and unit rows compose: a unit is
 * hidden when its own row or its document row says excluded. */
export async function setUnitExclusions(
  db: Db,
  sectorId: string,
  refs: UnitRef[],
  excluded: boolean,
): Promise<void> {
  for (const ref of refs) {
    if (!ref.documentId) throw new DbContractError('documentId must be non-empty')
    if (!Number.isInteger(ref.ord) || ref.ord < -1) throw new DbContractError('ord must be -1 (document) or a unit index')
    await db.query(
      `INSERT INTO sector_context_selection (sector_id, document_id, unit_ord, excluded)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sector_id, document_id, unit_ord) DO UPDATE SET excluded = EXCLUDED.excluded`,
      [sectorId, ref.documentId, ref.ord, excluded],
    )
  }
}

async function exclusionMap(db: Db, sectorId: string): Promise<Map<string, boolean>> {
  const { rows } = await db.query<{ document_id: string; unit_ord: number; excluded: boolean }>(
    'SELECT document_id, unit_ord, excluded FROM sector_context_selection WHERE sector_id = $1',
    [sectorId],
  )
  const map = new Map<string, boolean>()
  for (const row of rows) map.set(`${row.document_id}:${row.unit_ord}`, row.excluded)
  return map
}

/** Shared world-state digest: pointers, not prose. Read-computed from live
 * rows on every read (no invalidation bugs: same rows always yield the
 * same digest across sessions), versioned by content hash. The version
 * travels in its own field; the text carries no hash, so model-visible
 * prose never spends context on machine ids. */
export function buildSectorDigest(input: {
  sectorId: string
  name: string
  topic: string
  state: string
  documents: Array<{ id: string; filename: string; status: string; sha256: string }>
  noteCount: number
  exclusionCount: number
}): SectorDigest {
  const canonical = JSON.stringify({
    sector: [input.sectorId, input.name, input.topic, input.state],
    documents: input.documents.map((doc) => [doc.id, doc.sha256, doc.status]),
    notes: input.noteCount,
    exclusions: input.exclusionCount,
  })
  const version = sha256Hex(canonical).slice(0, 12)
  const docs = input.documents.length === 0
    ? 'no documents'
    : input.documents.map((doc) => `${doc.filename} (${doc.status})`).join(', ')
  return {
    version,
    text: `Sector ${input.name} (${input.state}): ${input.topic || 'no topic'}. Documents: ${docs}. Notes: ${input.noteCount}.`,
  }
}

/** Model-visible citation label per document: the uploader's filename, not
 * the storage id. Repeats (same name, different content) take a stable
 * creation-order suffix so every label stays unique. Internal selection,
 * reads, and tool args keep using the storage ids. */
export function citationLabels(documents: Array<{ id: string; filename: string }>): Map<string, string> {
  const seen = new Map<string, number>()
  const labels = new Map<string, string>()
  for (const document of documents) {
    const count = (seen.get(document.filename) ?? 0) + 1
    seen.set(document.filename, count)
    labels.set(document.id, count === 1 ? document.filename : `${document.filename} (${count})`)
  }
  return labels
}

export async function getSectorContext(db: Db, sectorId: string, scope?: Scope): Promise<SectorContextView> {
  const sector = await getSector(db, sectorId, scope)
  if (!sector) throw new DbContractError(`unknown sector ${sectorId}`)
  const system = sector.topic ? `Sector ${sector.name}: ${sector.topic}` : `Sector ${sector.name}`
  const documents: SectorDocument[] = await listSectorDocuments(db, sectorId, scope)
  const exclusions = await exclusionMap(db, sectorId)
  const notes = await listContextNotes(db, sectorId)
  const digest = buildSectorDigest({
    sectorId,
    name: sector.name,
    topic: sector.topic,
    state: sector.state,
    documents: documents.map((document) => ({ id: document.id, filename: document.filename, status: document.status, sha256: document.sha256 })),
    noteCount: notes.length,
    exclusionCount: [...exclusions.values()].filter(Boolean).length,
  })
  const files: ContextFileView[] = []
  const entries: Array<{ documentId: string; ord: number; text: string }> = []
  const labels = citationLabels(documents)
  for (const document of documents) {
    const docExcluded = exclusions.get(`${document.id}:-1`) ?? false
    const units = await listDocumentUnits(db, document.id)
    const views: ContextUnitView[] = units.map((unit) => {
      const excluded = docExcluded || (exclusions.get(`${document.id}:${unit.ord}`) ?? false)
      return { ord: unit.ord, kind: unit.kind, text: unit.text, uncertain: unit.uncertain, excluded }
    })
    files.push({
      id: document.id,
      filename: document.filename,
      mediaType: document.mediaType,
      status: document.status,
      sha256: document.sha256,
      chars: document.chars,
      excluded: docExcluded,
      units: views,
    })
    if (!docExcluded) {
      const label = labels.get(document.id) ?? document.filename
      for (const view of views) {
        if (!view.excluded) entries.push({ documentId: label, ord: view.ord, text: view.text })
      }
    }
  }
  const references = [digest.text, ...assembleReferences(entries)]
  notes.forEach((note, index) => references.push(`[note:${index + 1}] ${note.text}`))
  const segments = { system, references, history: [] as string[], tail: [] as string[] }
  const usage = describeSegments({ system: [system], tools: [], references, history: [], tail: [] })
  return { sectorId, digest, segments, usage, files, notes }
}

export interface CompactContextResult {
  sectorId: string
  compacted: boolean
  beforeCount: number
  afterCount: number
  digest: SectorDigest
  notes: ContextNoteView[]
  usage: ContextUsage
}

/** Consolidate multiple context notes into one bounded summary note.
 * Visibility passes through getSectorContext (unknown/invisible sectors
 * fail before any write). Below two notes there is nothing to merge and
 * the call reports compacted:false — a retry after success is an honest
 * no-op, never a duplicate. The consolidated text carries every source
 * note verbatim (bounded at 2000 chars like note writes); truncation is
 * reported, never silent. */
export async function compactSectorContext(
  db: Db,
  sectorId: string,
  scope?: Scope,
): Promise<CompactContextResult> {
  const current = await getSectorContext(db, sectorId, scope)
  if (current.notes.length <= 1) {
    return {
      sectorId,
      compacted: false,
      beforeCount: current.notes.length,
      afterCount: current.notes.length,
      digest: current.digest,
      notes: current.notes,
      usage: current.usage,
    }
  }
  const joined = current.notes.map((note, index) => `[${index + 1}] ${note.text}`).join('\n')
  const header = `Consolidated summary (${current.notes.length} notes):\n`
  const truncated = header.length + joined.length > 2000
  const consolidated = truncated
    ? `${header}${joined.slice(0, 2000 - header.length - 15)}...(truncated)`
    : `${header}${joined}`
  await db.query('DELETE FROM sector_context_notes WHERE sector_id = $1', [sectorId])
  await addContextNotes(db, sectorId, [consolidated])
  const updated = await getSectorContext(db, sectorId, scope)
  return {
    sectorId,
    compacted: true,
    beforeCount: current.notes.length,
    afterCount: updated.notes.length,
    digest: updated.digest,
    notes: updated.notes,
    usage: updated.usage,
  }
}
