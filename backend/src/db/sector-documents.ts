// Sector context documents: multi-format uploads attached to a sector
// while drafting (or later). Extraction runs server-side in file-pipeline
// (text read directly, PDFs/docx extracted, images and image-only PDFs via
// a configured OCR endpoint) and every file is indexed into units: turns
// include units, never raw bytes. Pure extraction is unit-tested without a
// database.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { countDocumentUnits, insertDocumentUnits } from './document-units.js'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'
import {
  documentExtension,
  extractFileUnits,
  SECTOR_DOCUMENT_MAX_BYTES,
  sha256Hex,
  type ExtractionStatus,
  type OcrAdapter,
} from './file-pipeline.js'
import { getSector } from './sectors.js'

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
  input: { sectorId: string; filename: string; contentBase64: string; scope?: Scope; ocr?: OcrAdapter },
): Promise<IngestedDocument> {
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
  const sha256 = sha256Hex(text)
  // needs-ocr rows all hash the empty string: dedup those on filename so
  // two different unscanned images never alias each other.
  const duplicate = extraction.status === 'indexed'
    ? await db.query<{ id: string; filename: string; media_type: string; sha256: string; created_at: Date | string; status: string }>(
      `SELECT id, filename, media_type, sha256, created_at, status FROM sector_documents
       WHERE sector_id = $1 AND sha256 = $2 ORDER BY created_at ASC LIMIT 1`,
      [input.sectorId, sha256],
    )
    : await db.query<{ id: string; filename: string; media_type: string; sha256: string; created_at: Date | string; status: string }>(
      `SELECT id, filename, media_type, sha256, created_at, status FROM sector_documents
       WHERE sector_id = $1 AND filename = $2 AND status = 'needs-ocr' ORDER BY created_at ASC LIMIT 1`,
      [input.sectorId, input.filename],
    )
  const found = duplicate.rows[0]
  if (found) {
    return {
      id: found.id,
      sectorId: input.sectorId,
      filename: found.filename,
      mediaType: found.media_type,
      chars: text.length,
      sha256: found.sha256,
      createdAt: found.created_at instanceof Date ? found.created_at.toISOString() : String(found.created_at ?? ''),
      status: found.status === 'needs-ocr' ? 'needs-ocr' : 'indexed',
      ...(extraction.detail ? { detail: extraction.detail } : {}),
      unitCount: await countDocumentUnits(db, found.id),
    }
  }
  const id = `sdoc-${randomUUID()}`
  const { rows } = await db.query<{ created_at: Date | string }>(
    `INSERT INTO sector_documents (id, sector_id, filename, media_type, text, sha256, status, tenant_id, project_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING created_at`,
    [id, input.sectorId, input.filename, extraction.mediaType, text, sha256, extraction.status, input.scope?.tenantId ?? null, input.scope?.projectId ?? null],
  )
  await insertDocumentUnits(db, id, extraction.units)
  const created = rows[0]?.created_at
  return {
    id,
    sectorId: input.sectorId,
    filename: input.filename,
    mediaType: extraction.mediaType,
    chars: text.length,
    sha256,
    createdAt: created instanceof Date ? created.toISOString() : String(created ?? ''),
    status: extraction.status,
    ...(extraction.detail ? { detail: extraction.detail } : {}),
    unitCount: extraction.units.length,
  }
}

/** Context documents for one sector, newest last. Scope-filtered like
 * every other sector read. */
export async function listSectorDocuments(db: Db, sectorId: string, scope?: Scope): Promise<SectorDocument[]> {
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
  return rows.map((row) => ({
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
