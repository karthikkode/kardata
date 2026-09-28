// Knowledge corpus + company master-ledger repo contract (KB migration).
// Misaligned calls throw before SQL (no database needed); the lifecycle
// suite runs against live Postgres and skips explicitly without
// TEST_DATABASE_URL. Eval grounding (corpus accuracy) lives in
// kb.eval.test.ts and reuses these live fixtures.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DbContractError,
  getLedgerCompany,
  listLedgerCompanies,
  listLedgerProblems,
  recordKbBatch,
  recordLedgerProblem,
  searchKb,
  upsertLedgerCompany,
} from '../../backend/src/db/index.js'
import { collectKbDocs, parseKbFile } from '../../backend/src/db/kb-ingest.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

function untouchedDb(): { db: { query: () => Promise<never> }; wasQueried: () => boolean } {
  let queried = false
  return {
    db: {
      query: async (): Promise<never> => {
        queried = true
        throw new Error('must not touch the database')
      },
    },
    wasQueried: () => queried,
  }
}

describe('knowledge + master ledger contract', () => {
  it('rejects misaligned calls before any SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(searchKb(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(recordKbBatch(db, '', [])).rejects.toBeInstanceOf(DbContractError)
    await expect(recordKbBatch(db, 'b', [])).rejects.toBeInstanceOf(DbContractError)
    await expect(upsertLedgerCompany(db, { domain: '', name: '' })).rejects.toBeInstanceOf(DbContractError)
    await expect(getLedgerCompany(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(listLedgerCompanies(db, { qualification: 'bogus' as never })).rejects.toBeInstanceOf(
      DbContractError,
    )
    await expect(
      recordLedgerProblem(db, { companyId: 'c', problem: '' }),
    ).rejects.toBeInstanceOf(DbContractError)
    await expect(listLedgerProblems(db, '')).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('parses curated markdown into section chunks', () => {
    const parsed = parseKbFile(
      'offer.md',
      '---\ntopic: offer\nsources:\n  - a/b.md\n---\n# Offer\n\nIntro line.\n\n## Wedge\n\nFree first.\n',
    )
    expect(parsed?.topic).toBe('offer')
    expect(parsed?.title).toBe('Offer')
    expect(parsed?.sources).toEqual(['a/b.md'])
    expect(parsed?.chunks.map((chunk) => chunk.section)).toEqual(['overview', 'Wedge'])
  })

  it('skips migration-map and front-matter-less files', () => {
    expect(parseKbFile('_migration_map.md', '---\ntopic: x\n---\n# T\n\n## S\n\ntext\n')).toBeUndefined()
    expect(parseKbFile('plain.md', '# No front matter\n')).toBeUndefined()
  })

  it('collects the shipped corpus docs', () => {
    const docs = collectKbDocs(new URL('../../knowledge_base', import.meta.url).pathname)
    const topics = docs.map((doc) => doc.topic).sort()
    expect(topics).toEqual(['funnel', 'icp', 'offer', 'pricing', 'problems', 'qualification', 'voice'])
    for (const doc of docs) expect(doc.sourceSha.length).toBeGreaterThan(16)
  })
})

describe.skipIf(!ENABLED)('knowledge + ledger lifecycle against Postgres', () => {
  let pool: Pool
  const stamp = randomUUID().slice(0, 8)

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_knowledge')
    pool = new Pool({ connectionString: url })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('ingests a batch and ranks FTS search', async () => {
    const batch = `kb-test-${stamp}`
    await recordKbBatch(pool, batch, [
      {
        topic: 'pricing',
        title: 'Pricing',
        sourcePath: `knowledge_base/pricing.md#${stamp}`,
        sourceSha: `sha-${stamp}`,
        chunks: [{ section: 'band', text: `The targeting band is three to six thousand USD per month, never quoted, marker-${stamp}.` }],
      },
    ])
    const hits = await searchKb(pool, `targeting band marker-${stamp}`)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.topic).toBe('pricing')
    expect(hits[0]?.sourcePath).toContain(stamp)
  })

  it('supersedes prior batches without deleting history', async () => {
    const path = `knowledge_base/offer.md#${stamp}`
    await recordKbBatch(pool, `kb-old-${stamp}`, [
      { topic: 'offer', title: 'Offer', sourcePath: path, sourceSha: 'old', chunks: [{ section: '', text: 'Old wedge text qualifier.' }] },
    ])
    await recordKbBatch(pool, `kb-new-${stamp}`, [
      { topic: 'offer', title: 'Offer', sourcePath: path, sourceSha: 'new', chunks: [{ section: '', text: 'New wedge text qualifier.' }] },
    ])
    const { rows } = await pool.query<{ source_sha: string }>(
      'SELECT source_sha FROM kb_documents WHERE source_path = $1 ORDER BY created_at ASC',
      [path],
    )
    expect(rows.map((row) => row.source_sha)).toEqual(['old', 'new'])
    const hits = await searchKb(pool, 'wedge qualifier')
    expect(hits.every((hit) => hit.sourcePath !== path || hit.text.includes('New'))).toBe(true)
  })

  it('upserts companies idempotently and records every problem', async () => {
    const domain = `example-${stamp}.com`
    const first = await upsertLedgerCompany(pool, { domain, name: 'Example', sector: 'D2C pets' })
    expect(first.qualification).toBe('unresearched')
    const second = await upsertLedgerCompany(pool, {
      domain,
      name: 'Example Inc',
      sector: 'D2C pets',
      qualification: 'qualified',
      qualificationReason: 'mechanism evidenced',
      scaleSignal: '120 staff',
    })
    expect(second.id).toBe(first.id)
    expect(second.name).toBe('Example Inc')
    await recordLedgerProblem(pool, {
      companyId: second.id,
      problem: 'Ads point at out-of-stock products',
      mechanism: 'feed mismatch',
      costEvidence: 'wasted spend',
      sourceUrl: 'https://example.com/ads',
      headroom: '10x',
      status: 'candidate',
    })
    await recordLedgerProblem(pool, {
      companyId: second.id,
      problem: 'Manual reconciliation every Monday',
      mechanism: 'csv handoffs',
      status: 'worthy',
    })
    const fetched = await getLedgerCompany(pool, second.id)
    expect(fetched?.problemCount).toBe(2)
    const problems = await listLedgerProblems(pool, second.id)
    expect(problems.map((problem) => problem.status)).toEqual(['candidate', 'worthy'])
    const qualified = await listLedgerCompanies(pool, { qualification: 'qualified', query: domain })
    expect(qualified.map((company) => company.domain)).toContain(domain)
  })

  it('rejects problems for unknown companies', async () => {
    await expect(
      recordLedgerProblem(pool, { companyId: randomUUID(), problem: 'orphan problem' }),
    ).rejects.toBeInstanceOf(DbContractError)
  })
})
