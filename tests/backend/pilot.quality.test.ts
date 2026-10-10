// Phase 8 B8: quality counts flag planted defects and the sampler
// returns machine-readable companies with sources. One isolated
// database, one sector; P8-B1 moved the B5 company checks here (the
// accepted-count gate, child attribution, plan filter 6).
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runPilotQuality } from '../../scripts/pilot-quality-lib.mjs'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const SINCE = '2026-01-01T00:00:00.000Z'

async function plantCompany(
  pool: Pool,
  sectorId: string,
  id: string,
  extra: { sourceUrl?: string | null; evidence?: string[]; title?: string; childId?: string | null } = {},
) {
  await pool.query(
    `INSERT INTO research_work(id, sector_id, plan_version, kind, title, state, child_id, evidence, source_url, at)
     VALUES($1, $2, 1, 'company', $3, 'complete', $4, $5, $6, now())`,
    [
      id,
      sectorId,
      extra.title ?? `TEST Quality Co ${id}`,
      extra.childId === null ? null : (extra.childId ?? `t-${id}`),
      JSON.stringify(extra.evidence ?? ['https://test.invalid/1', 'https://test.invalid/2', 'https://test.invalid/3']),
      extra.sourceUrl === null ? null : (extra.sourceUrl ?? `https://${id}.test.invalid`),
    ],
  )
}

async function plantChild(
  pool: Pool,
  sectorId: string,
  childKey: string,
  opts: { kind?: 'session' | 'subagent'; round?: 'healthy' | null } = {},
) {
  await pool.query('INSERT INTO threads(key, session_id, kind, status) VALUES($1, $2, $3, $4)', [
    childKey,
    'sess-q',
    opts.kind ?? 'subagent',
    'running',
  ])
  if (opts.round === 'healthy') {
    await pool.query(
      `INSERT INTO execution_rounds(run_id, thread_key, kind, round, attempt, model, provider, started_at, finished_at, outcome, session_id, sector_id)
       VALUES($1, $2, 'turn', 1, 1, 'TEST-model', 'TEST', now() - make_interval(mins => 60), now() - make_interval(mins => 50), 'ok', 'sess-q', $3)`,
      [`run-${childKey}`, childKey, sectorId],
    )
  }
}

describe.skipIf(!TEST_DATABASE_URL)('pilot quality [F:pilot.quality]', () => {
  let pool: Pool
  let sectorId: string

  beforeAll(async () => {
    const connectionString = await ensureTestDb('kardata_test_pilot_quality')
    pool = new Pool({ connectionString })
    sectorId = 'sec-quality'
    await pool.query(
      `INSERT INTO sectors(id, name, topic, state, tenant_id) VALUES($1, 'TEST quality', 'TEST', 'running', 'TEST')`,
      [sectorId],
    )
    for (const id of ['q-dup-a', 'q-dup-b', 'q-nosrc', 'q-thin', 'q-franchise']) {
      await plantChild(pool, sectorId, `t-${id}`, { round: 'healthy' })
    }
    await plantCompany(pool, sectorId, 'q-dup-a', { sourceUrl: 'https://dup.test.invalid/a' })
    await plantCompany(pool, sectorId, 'q-dup-b', { sourceUrl: 'https://dup.test.invalid/b' })
    await plantCompany(pool, sectorId, 'q-nosrc', { sourceUrl: null })
    await plantCompany(pool, sectorId, 'q-thin', { evidence: ['https://test.invalid/1'] })
    await plantCompany(pool, sectorId, 'q-franchise', { title: 'TEST Franchise Directory Co' })
    await plantCompany(pool, sectorId, 'q-stuck-child', {})
    await pool.query(`INSERT INTO threads(key, session_id, kind, status) VALUES('t-q-stuck-child', 'sess-1', 'subagent', 'running')`)
    await pool.query(
      `INSERT INTO execution_rounds(run_id, thread_key, kind, round, attempt, model, provider, started_at, outcome, sector_id)
       VALUES('run-stuck', 't-q-stuck-child', 'turn', 1, 1, 'TEST-model', 'TEST', now() - make_interval(mins => 45), 'running', $1)`,
      [sectorId],
    )
    await plantCompany(pool, sectorId, 'q-nochild', { childId: null })
    await plantCompany(pool, sectorId, 'q-nonsub', {})
    await plantChild(pool, sectorId, 't-q-nonsub', { kind: 'session' })
    await plantCompany(pool, sectorId, 'q-noround', {})
    await plantChild(pool, sectorId, 't-q-noround', {})
    await plantCompany(pool, sectorId, 'q-empty', { evidence: [] })
  }, 120000)
  afterAll(async () => {
    await pool?.end()
  })

  it('counts every defect class', async () => {
    const result = await runPilotQuality(pool, { sectorId, since: SINCE, minAccepted: 10 })
    expect(result.ok).toBe(false)
    expect(result.counts).toMatchObject({
      acceptedCompanies: 10,
      duplicatesByDomain: 1,
      noSourceUrl: 1,
      // q-thin (1 URL) passes filter 6; only q-empty (no URLs) fails it.
      filter6Failures: 1,
      offIcpKeywords: 1,
      stuckSubagents: 1,
      nullChildId: 1,
      // q-nonsub (session thread) + q-empty (no thread at all).
      nonSubagentChild: 2,
      // q-stuck-child (sessionless round) + q-nonsub + q-noround + q-empty.
      childWithoutRound: 4,
    })
    expect(result.violations).toHaveLength(8)
  })

  it('gates the accepted count by tier', async () => {
    const short = await runPilotQuality(pool, { sectorId, since: SINCE, minAccepted: 11 })
    expect(short.ok).toBe(false)
    expect(short.violations[0]).toMatch(/fewer than 11 accepted companies \(10/)
    const met = await runPilotQuality(pool, { sectorId, since: SINCE, minAccepted: 10 })
    expect(met.violations.filter((v: string) => v.includes('fewer than'))).toHaveLength(0)
  })

  it('samples companies with sources as JSON', async () => {
    const result = await runPilotQuality(pool, { sectorId, since: SINCE })
    expect(result.sample.length).toBeLessThanOrEqual(30)
    expect(result.sample.length).toBeGreaterThan(0)
    for (const row of result.sample as Array<{ id: string; title: string }>) {
      expect(row.id).toBeTruthy()
      expect(row.title).toBeTruthy()
    }
    expect(() => JSON.stringify(result.sample)).not.toThrow()
  })
})
