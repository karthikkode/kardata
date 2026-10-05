// Knowledge-corpus repository (KB migration). kb_documents pins provenance
// (source path + SHA, ingest batch); kb_chunks carries a stored tsvector so
// searchKb ranks with plainto_tsquery, no extensions or embedding providers.
// Writes are versioned ingests: re-ingesting a source path supersedes the
// prior batch's row via superseded_by instead of deleting history.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

const KbChunkInput = z.object({
  section: z.string().max(200).default(''),
  text: z.string().min(1).max(8000),
})
type KbChunkInput = z.infer<typeof KbChunkInput>

export const KbDocumentInput = z.object({
  topic: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  sourcePath: z.string().min(1).max(500),
  sourceSha: z.string().min(1).max(128),
  chunks: KbChunkInput.array().min(1).max(200),
})
export type KbDocumentInput = z.infer<typeof KbDocumentInput>

export interface KbSearchHit {
  docId: string
  topic: string
  title: string
  sourcePath: string
  section: string
  text: string
  rank: number
}

interface KbSearchRow {
  doc_id: string
  topic: string
  title: string
  source_path: string
  section: string
  text: string
  rank: number
}

/** Records one ingest batch: inserts fresh doc rows + chunks, marks prior
 * rows for the same source paths superseded. Returns the batch id. */
export async function recordKbBatch(db: Db, batchId: string, docs: Array<z.input<typeof KbDocumentInput>>): Promise<string> {
  if (typeof batchId !== 'string' || batchId.length === 0) throw new DbContractError('batchId must be a non-empty string')
  const parsed = z.array(KbDocumentInput).min(1).safeParse(docs)
  if (!parsed.success) throw new DbContractError(`invalid kb documents: ${parsed.error.message}`)
  for (const doc of parsed.data) {
    const id = randomUUID()
    await db.query(
      `INSERT INTO kb_documents (id, topic, title, source_path, source_sha, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, doc.topic, doc.title, doc.sourcePath, doc.sourceSha, batchId],
    )
    for (const chunk of doc.chunks) {
      await db.query(`INSERT INTO kb_chunks (id, doc_id, section, text) VALUES ($1, $2, $3, $4)`, [
        randomUUID(),
        id,
        chunk.section,
        chunk.text,
      ])
    }
    await db.query(
      `UPDATE kb_documents SET superseded_by = $1
        WHERE source_path = $2 AND batch_id <> $3 AND superseded_by IS NULL`,
      [id, doc.sourcePath, batchId],
    )
  }
  return batchId
}

/** Full-text search over live (non-superseded) chunks, best rank first.
 * Recall-first OR matching (natural questions carry filler words an AND
 * would choke on); doc title + topic join the match with double weight so
 * tagged lookups ("pricing", "ideal customer") land on the right doc. */
export async function searchKb(db: Db, query: string, limit = 5): Promise<KbSearchHit[]> {
  if (typeof query !== 'string' || query.trim().length === 0) throw new DbContractError('query must be a non-empty string')
  const capped = Math.max(1, Math.min(20, Math.floor(limit)))
  const useOr = /[a-z0-9]{3,}/i.test(query)
  const { rows } = await db.query<KbSearchRow>(
    `WITH qq AS (
       SELECT ${
         useOr
           ? `COALESCE(
           (SELECT to_tsquery('english', string_agg('"' || w || '"', ' | '))
              FROM regexp_split_to_table(lower($1), '[^a-z0-9]+') AS w
             WHERE w <> '' AND length(w) > 2),
           plainto_tsquery('english', $1)
         )`
           : `plainto_tsquery('english', $1)`
       } AS q
     )
     SELECT c.doc_id AS doc_id, d.topic AS topic, d.title AS title,
            d.source_path AS source_path, c.section AS section, c.text AS text,
            ts_rank(c.tsv, qq.q)
              + 2 * ts_rank(to_tsvector('english', d.title || ' ' || d.topic), qq.q) AS rank
       FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id, qq
      WHERE d.superseded_by IS NULL
        AND (c.tsv @@ qq.q
          OR to_tsvector('english', d.title || ' ' || d.topic) @@ qq.q)
      ORDER BY rank DESC, d.topic ASC, c.section ASC, c.text ASC
      LIMIT $2`,
    [query, capped],
  )
  return rows.map((row) => ({
    docId: String(row.doc_id),
    topic: String(row.topic),
    title: String(row.title),
    sourcePath: String(row.source_path),
    section: String(row.section),
    text: String(row.text),
    rank: Number(row.rank),
  }))
}
