// Per-file extraction index: a document's context is its units. Turns
// include units (cited document_id:ord), never raw file bytes. Pure SQL
// helpers; extraction itself lives in file-pipeline.ts.
import type { Db } from './events.js'
import { sha256Hex, type ExtractedUnit } from './file-pipeline.js'

export interface DocumentUnit extends ExtractedUnit {
  documentId: string
  sha256: string
}

export async function insertDocumentUnits(db: Db, documentId: string, units: ExtractedUnit[]): Promise<void> {
  for (const unit of units) {
    await db.query(
      `INSERT INTO sector_document_units (document_id, ord, kind, text, confidence, uncertain, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (document_id, ord) DO UPDATE
       SET kind = EXCLUDED.kind, text = EXCLUDED.text, confidence = EXCLUDED.confidence,
           uncertain = EXCLUDED.uncertain, sha256 = EXCLUDED.sha256`,
      [
        documentId,
        unit.ord,
        unit.kind,
        unit.text,
        unit.confidence ?? null,
        unit.uncertain,
        sha256Hex(unit.text),
      ],
    )
  }
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
  }>(
    `SELECT document_id, ord, kind, text, confidence, uncertain, sha256
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
  }))
}

export async function countDocumentUnits(db: Db, documentId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM sector_document_units WHERE document_id = $1',
    [documentId],
  )
  return Number(rows[0]?.count ?? 0)
}
