// KB ingest over a real pool: synthetic fixtures only (never repo docs).
// Live-app suite, skipped explicitly without TEST_DATABASE_URL.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { runKbIngest } from '../../backend/src/db/kb-ingest.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

function doc(topic: string, title: string, body: string): string {
  return `---\ntopic: ${topic}\nsources:\n  - TEST/nonexistent.md\n---\n\n# ${title}\n\n${body}\n\n## Section A\n\nSection body text.\n`
}

describe.skipIf(!ENABLED)('kb ingest over real db [F:db.kb_ingest.runKbIngest]', () => {
  let pool: Pool | undefined

  afterAll(async () => { await pool?.end() })

  async function db(): Promise<Pool> {
    pool ??= new Pool({ connectionString: await ensureTestDb('kardata_test_kb_ingest') })
    return pool
  }

  it('ingests curated markdown batches, skipping unparseable files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kardata-test-kb-'))
    writeFileSync(join(dir, 'one.md'), doc('TEST topic one', 'TEST doc one', 'Preamble one.'))
    writeFileSync(join(dir, 'two.md'), doc('TEST topic two', 'TEST doc two', 'Preamble two.'))
    writeFileSync(join(dir, 'plain.md'), '# No front matter here\n\nSkipped.\n')
    writeFileSync(join(dir, '_draft.md'), doc('TEST draft', 'TEST draft', 'Skipped by prefix.'))
    const database = await db()
    const batchId = `TEST-batch-${randomUUID()}`
    const result = await runKbIngest(database, dir, batchId)
    expect(result).toEqual({ batchId, docs: 2 })
    const { rows } = await database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM kb_documents WHERE batch_id=$1', [batchId])
    expect(rows[0]?.count).toBe('2')
  })

  it('rejects directories without ingestible docs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kardata-test-kb-empty-'))
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'note.txt'), 'not markdown')
    await expect(runKbIngest(await db(), dir, `TEST-batch-${randomUUID()}`)).rejects.toThrow('no ingestible kb docs')
  })
})
