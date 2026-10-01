// Sector context documents: multi-format uploads attached to a sector
// while drafting (or later). Extraction runs server-side in file-pipeline
// (text read directly, PDFs/docx extracted, images and image-only PDFs via
// a configured OCR endpoint) and every file is indexed into units: turns
// include units, never raw bytes. Pure extraction is unit-tested without a
// database.
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { listDocumentUnits } from './document-units.js'
import { DbContractError } from './errors.js'
import { assertFileVisible, hiddenFileIds } from './workspace.js'
import type { ArchiveTarget } from '../archive/targets.js'
import type { Db } from './events.js'
import { createLogger, logOp } from '../observability/logging.js'

import {
  documentExtension,
  extractFileUnits,
  SECTOR_DOCUMENT_MAX_BYTES,
  sha256Hex,
  type ExtractionStatus,
  type OcrAdapter,
} from './file-pipeline.js'
import { getSector } from './sectors.js'

const documentLogger = createLogger({ op: 'file.ingest' })

export { documentExtension, SECTOR_DOCUMENT_MAX_BYTES, sha256Hex }

/** Legacy single-text extraction over the pipeline. needs-ocr degrades to
 * the historical rejection so existing callers keep their contract; new
 * callers use extractFileUnits plus the units index. Pure (no SQL). */
export async function extractDocumentText(filename: string, bytes: Buffer): Promise<{ text: string; mediaType: string }> {
  const extraction = await extractFileUnits(filename, bytes)
  if (extraction.status !== 'indexed') throw new DbContractError(extraction.detail ?? 'could not extract document text')
  return { text: extraction.units.map((unit) => unit.text).join('\n\n'), mediaType: extraction.mediaType }
}

export interface SectorDocument {
  id: string
  sectorId: string
  filename: string
  mediaType: string
  chars: number
  sha256: string
  createdAt: string
  /** indexed (units ready) or needs-ocr (stored, awaiting OCR). */
  status: ExtractionStatus
}

export interface IngestedDocument extends SectorDocument {
  detail?: string
  unitCount: number
}

const FilenameSchema = z.string().min(1).max(255)
const ContentSchema = z.string().min(1)

/** Attach one context document to a sector. The sector must exist and be
 * visible in scope; drafts and running sectors alike accept documents.
 * Extraction runs in file-pipeline (OCR via the injected adapter, absent
 * means images degrade to needs-ocr); every indexed file is chunked into
 * units. Re-uploading identical content returns the existing document:
 * ingest is idempotent on content hash. */
export async function ingestSectorDocument(
  db: Db,
  input: { sectorId: string; filename: string; contentBase64: string; scope?: Scope; ocr?: OcrAdapter; archive?: ArchiveTarget; source?: 'artifact' },
): Promise<IngestedDocument> {
  return logOp(documentLogger, 'file.ingest', async () => {
    if (!FilenameSchema.safeParse(input.filename).success) throw new DbContractError('filename must be 1-255 characters')
    if (!ContentSchema.safeParse(input.contentBase64).success) throw new DbContractError('contentBase64 must be non-empty')
    // Existence + scope read the projection; the insert reuses the
    // validated scope for tenant binding.
    if (!(await getSector(db, input.sectorId, input.scope))) throw new DbContractError(`unknown sector ${input.sectorId}`)
    let bytes: Buffer
    try {
      bytes = Buffer.from(input.contentBase64, 'base64')
    } catch {
      throw new DbContractError('contentBase64 is not valid base64')
    }
    if (bytes.length === 0) throw new DbContractError('document is empty')
    const extraction = await extractFileUnits(input.filename, bytes, input.ocr)
    if (extraction.status === 'failed') throw new DbContractError(extraction.detail ?? 'could not extract document text')
    const text = extraction.units.map((unit) => unit.text).join('\n\n')
    // Version identity includes bytes and extraction. Distinct scans cannot
    // alias by filename/empty OCR; generated files retain separate provenance.
    const sha256 = sha256Hex(JSON.stringify({ v: 2, source: input.source ?? 'upload', original: bytes.toString('base64'), units: extraction.units }))
    const duplicate = await db.query<{ id: string; filename: string; media_type: string; sha256: string; created_at: Date | string; status: string }>(
        `SELECT id, filename, media_type, sha256, created_at, status FROM sector_documents
         WHERE sector_id = $1 AND sha256 = $2 ORDER BY created_at ASC LIMIT 1`,
        [input.sectorId, sha256],
      )
    const id = duplicate.rows[0]?.id ?? `sdoc-${sha256Hex(`${input.sectorId}:${sha256}`).slice(0, 48)}`
    const originalHash = sha256Hex(bytes.toString('base64'))
    const archiveKey = `sector-uploads/${sha256Hex(input.sectorId)}/${originalHash}.base64`
    if (input.archive) await input.archive.write(archiveKey, bytes.toString('base64'))
    // One statement owns publication: an index failure rolls back the row and
    // its byte reference too. Content identity coalesces concurrent uploads via
    // the existing document primary key, while adopting legacy matching IDs.
    const { rows } = await db.query<{ id: string; filename: string; media_type: string; text: string; sha256: string; created_at: Date | string; status: ExtractionStatus }>(
      `WITH document AS (
         INSERT INTO sector_documents (id, sector_id, filename, media_type, text, sha256, status, tenant_id, project_id, archive_key, original_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(id) DO UPDATE SET
           archive_key=COALESCE(sector_documents.archive_key,EXCLUDED.archive_key),
           original_hash=COALESCE(sector_documents.original_hash,EXCLUDED.original_hash)
         WHERE sector_documents.sector_id=EXCLUDED.sector_id AND sector_documents.sha256=EXCLUDED.sha256
         RETURNING id,filename,media_type,text,sha256,created_at,status
       ), indexed AS (
         INSERT INTO sector_document_units (document_id,ord,kind,text,confidence,uncertain,sha256)
         SELECT document.id,u.ord,u.kind,u.text,u.confidence,u.uncertain,u.sha256
         FROM document CROSS JOIN jsonb_to_recordset($12::jsonb)
           AS u(ord integer,kind text,text text,confidence double precision,uncertain boolean,sha256 text)
         ON CONFLICT(document_id,ord) DO UPDATE SET kind=EXCLUDED.kind,text=EXCLUDED.text,
           confidence=EXCLUDED.confidence,uncertain=EXCLUDED.uncertain,sha256=EXCLUDED.sha256
         RETURNING ord
       ) SELECT document.* FROM document`,
      [id, input.sectorId, input.filename, extraction.mediaType, text, sha256, extraction.status,
        input.scope?.tenantId ?? null, input.scope?.projectId ?? null, input.archive ? archiveKey : null,
        input.archive ? originalHash : null,
        JSON.stringify(extraction.units.map((unit) => ({ ...unit, confidence: unit.confidence ?? null, sha256: sha256Hex(unit.text) })))],
    )
    const stored = rows[0]
    if (!stored) throw new DbContractError('document publication did not return a stored row')
    return {
      id: stored.id, sectorId: input.sectorId, filename: stored.filename, mediaType: stored.media_type,
      chars: stored.text.length, sha256: stored.sha256,
      createdAt: stored.created_at instanceof Date ? stored.created_at.toISOString() : String(stored.created_at),
      status: stored.status, ...(extraction.detail ? { detail: extraction.detail } : {}),
      unitCount: extraction.units.length,
    }
  }, { sectorId: input.sectorId })
}

/** Context documents for one sector, newest last. Scope-filtered like
 * every other sector read. */
export async function listSectorDocuments(db: Db, sectorId: string, scope?: Scope, includeHidden = false): Promise<SectorDocument[]> {
  const sector = await getSector(db, sectorId, scope)
  if (!sector) throw new DbContractError(`unknown sector ${sectorId}`)
  const { rows } = await db.query<{
    id: string
    sector_id: string
    filename: string
    media_type: string
    text: string
    sha256: string
    status: string
    created_at: Date | string
  }>(
    `SELECT id, sector_id, filename, media_type, text, sha256, status, created_at
     FROM sector_documents WHERE sector_id = $1 ORDER BY created_at ASC`,
    [sectorId],
  )
  const hidden = includeHidden ? new Set<string>() : await hiddenFileIds(db, sectorId)
  return rows.filter((row) => !hidden.has(row.id)).map((row) => ({
    id: row.id,
    sectorId: row.sector_id,
    filename: row.filename,
    mediaType: row.media_type,
    chars: row.text.length,
    sha256: row.sha256,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    status: (row.status === 'needs-ocr' ? 'needs-ocr' : 'indexed') as ExtractionStatus,
  }))
}

/** One context document with its full extracted text, so a worker can quote
 * a file back instead of only listing it. Scope-filtered like every other
 * sector read; unknown sectors and documents share the contract error.
 * needs-ocr rows carry empty text: the caller sees the status, not a gap. */
export async function readSectorDocument(
  db: Db,
  sectorId: string,
  documentId: string,
  scope?: Scope,
): Promise<SectorDocument & { text: string }> {
  const sector = await getSector(db, sectorId, scope)
  if (!sector) throw new DbContractError(`unknown sector ${sectorId}`)
  await assertFileVisible(db, sectorId, documentId)
  const { rows } = await db.query<{
    id: string
    filename: string
    media_type: string
    text: string
    sha256: string
    status: string
    created_at: Date | string
  }>(
    `SELECT id, filename, media_type, text, sha256, status, created_at
     FROM sector_documents WHERE sector_id = $1 AND id = $2`,
    [sectorId, documentId],
  )
  const row = rows[0]
  if (!row) throw new DbContractError(`unknown document ${documentId} in sector ${sectorId}`)
  return {
    id: row.id,
    sectorId,
    filename: row.filename,
    mediaType: row.media_type,
    chars: row.text.length,
    sha256: row.sha256,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    status: (row.status === 'needs-ocr' ? 'needs-ocr' : 'indexed') as ExtractionStatus,
    text: row.text,
  }
}

export interface QuerySectorDocumentInput {
  documentId: string
  sectorId?: string
  mode?: 'summary' | 'chunks'
  query?: string
  ords?: number[]
  scope?: Scope
}
export async function readOriginalSectorDocument(db: Db, sectorId: string, documentId: string, archive: ArchiveTarget, scope?: Scope) {
  const doc = await readSectorDocument(db, sectorId, documentId, scope)
  const { rows } = await db.query<{ archive_key: string | null; original_hash: string | null }>('SELECT archive_key,original_hash FROM sector_documents WHERE id=$1', [documentId])
  const stored = rows[0]
  if (!stored?.archive_key) return { filename: doc.filename, mediaType: doc.mediaType, text: doc.text, originalAvailable: false }
  const contentBase64 = await archive.read(stored.archive_key)
  if (contentBase64 === undefined || sha256Hex(contentBase64) !== stored.original_hash) throw new DbContractError('Original file is missing or corrupt')
  return { filename: doc.filename, mediaType: doc.mediaType, text: doc.text, contentBase64, originalAvailable: true }
}

export interface DocumentTocEntry {
  ord: number
  kind: string
  preview: string
  uncertain: boolean
}

export interface DocumentSummaryResult {
  documentId: string
  filename: string
  status: ExtractionStatus
  mediaType: string
  chars: number
  totalUnits: number
  toc: DocumentTocEntry[]
}

export interface DocumentChunksResult {
  documentId: string
  filename: string
  status: ExtractionStatus
  units: Array<{ ord: number; kind: string; text: string; uncertain: boolean }>
}

export type QuerySectorDocumentResult = DocumentSummaryResult | DocumentChunksResult

/** Dual-mode document query: a TOC summary by default, targeted unit
 * search/slice on demand — turns cite units instead of dumping whole
 * files into context. Visibility always passes through the owning
 * sector: without a sectorId the owner is resolved from the document
 * row first, so an id alone never crosses tenants. Previews are capped
 * slices; only explicit chunk reads return full unit text. */
export async function querySectorDocument(
  db: Db,
  input: QuerySectorDocumentInput,
): Promise<QuerySectorDocumentResult> {
  if (!z.string().min(1).safeParse(input.documentId).success) {
    throw new DbContractError('documentId must be a non-empty string')
  }
  const sectorId = input.sectorId ?? (await owningSectorId(db, input.documentId))
  const sector = await getSector(db, sectorId, input.scope)
  if (!sector) throw new DbContractError(`unknown sector ${sectorId}`)
  await assertFileVisible(db, sectorId, input.documentId)
  const { rows } = await db.query<{
    id: string
    filename: string
    media_type: string
    text: string
    status: string
  }>(
    `SELECT id, filename, media_type, text, status
     FROM sector_documents WHERE sector_id = $1 AND id = $2`,
    [sectorId, input.documentId],
  )
  const doc = rows[0]
  if (!doc) throw new DbContractError(`unknown document ${input.documentId} in sector ${sectorId}`)
  const status = (doc.status === 'needs-ocr' ? 'needs-ocr' : 'indexed') as ExtractionStatus
  const base = { documentId: doc.id, filename: doc.filename, status }
  const mode = input.mode ?? (input.query || (input.ords && input.ords.length > 0) ? 'chunks' : 'summary')
  if (mode === 'chunks') {
    if (input.ords && input.ords.length > 0) {
      const { rows: slices } = await db.query<{ ord: number; kind: string; text: string; uncertain: boolean }>(
        `SELECT ord, kind, text, uncertain FROM sector_document_units
         WHERE document_id = $1 AND ord = ANY($2::int[]) ORDER BY ord ASC`,
        [input.documentId, input.ords],
      )
      return { ...base, units: slices }
    }
    if (input.query && input.query.trim().length > 0) {
      const { rows: matches } = await db.query<{ ord: number; kind: string; text: string; uncertain: boolean }>(
        `SELECT ord, kind, text, uncertain FROM sector_document_units
         WHERE document_id = $1 AND text ILIKE $2 ORDER BY ord ASC LIMIT 10`,
        [input.documentId, `%${input.query.trim()}%`],
      )
      return { ...base, units: matches }
    }
    const units = await listDocumentUnits(db, input.documentId)
    return {
      ...base,
      units: units.slice(0, 20).map((unit) => ({ ord: unit.ord, kind: unit.kind, text: unit.text, uncertain: unit.uncertain })),
    }
  }
  const units = await listDocumentUnits(db, input.documentId)
  return {
    ...base,
    mediaType: doc.media_type,
    chars: doc.text.length,
    totalUnits: units.length,
    toc: units.map((unit) => ({
      ord: unit.ord,
      kind: unit.kind,
      preview: unit.text.slice(0, 150).replace(/\s+/g, ' ').trim(),
      uncertain: unit.uncertain,
    })),
  }
}

/** Owning sector for a document id; unknown ids fail before any sector
 * read so enumeration learns nothing. */
async function owningSectorId(db: Db, documentId: string): Promise<string> {
  const { rows } = await db.query<{ sector_id: string }>(
    'SELECT sector_id FROM sector_documents WHERE id = $1',
    [documentId],
  )
  const owner = rows[0]?.sector_id
  if (!owner) throw new DbContractError(`unknown document ${documentId}`)
  return owner
}
