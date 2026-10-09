import { z } from 'zod'
import { DbContractError } from './errors.js'
// Per-file extraction index: a document's context is its units. Turns
// include units (cited document_id:ord), never raw file bytes. Pure SQL
// helpers; extraction itself lives in file-pipeline.ts.
import type { Db } from './events.js'
import { type ExtractedUnit } from './file-pipeline.js'

export interface DocumentUnit extends ExtractedUnit {
  documentId: string
  sha256: string
  page?: number
  imageId?: string
  imageOrdinal?: number
  imageRole?: 'embedded' | 'page-visual'
}

export async function listDocumentUnits(db: Db, documentId: string): Promise<DocumentUnit[]> {
  const { rows } = await db.query<{
    document_id: string
    ord: number
    kind: string
    text: string
    confidence: number | null
    uncertain: boolean
    sha256: string
    source_page: number | null
    source_image_id: string | null
    source_image_ordinal: number | null
    source_image_role: 'embedded' | 'page-visual' | null
  }>(
    `SELECT document_id, ord, kind, text, confidence, uncertain, sha256, source_page, source_image_id, source_image_ordinal, source_image_role
     FROM sector_document_units WHERE document_id = $1 ORDER BY ord ASC`,
    [documentId],
  )
  return rows.map((row) => ({
    documentId: row.document_id,
    ord: row.ord,
    kind: (row.kind === 'ocr' || row.kind === 'table' || row.kind === 'heading' ? row.kind : 'text') as DocumentUnit['kind'],
    text: row.text,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    uncertain: row.uncertain,
    sha256: row.sha256,
    ...(row.source_page == null ? {} : { page: row.source_page }),
    ...(row.source_image_id == null ? {} : { imageId: row.source_image_id }),
    ...(row.source_image_ordinal == null ? {} : { imageOrdinal: row.source_image_ordinal }),
    ...(row.source_image_role == null ? {} : { imageRole: row.source_image_role }),
  }))
}

export async function countDocumentUnits(db: Db, documentId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM sector_document_units WHERE document_id = $1',
    [documentId],
  )
  return Number(rows[0]?.count ?? 0)
}

/** Dependency validation needs unit identities, not repeated extracted bodies. */
export async function listDocumentUnitOrdinals(db: Db, documentId: string): Promise<number[]> {
  if (!z.string().min(1).safeParse(documentId).success) throw new DbContractError('documentId must be non-empty')
  const { rows } = await db.query<{ ord: number }>('SELECT ord FROM sector_document_units WHERE document_id=$1 ORDER BY ord', [documentId])
  return rows.map((row) => Number(row.ord))
}
