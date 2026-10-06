// P3.6 hot-query tier (stress): at 1M events / 200k messages / 100k
// rounds / 20k companies / 5k documents, the top-20 owner reads hold
// p95 under 100 ms. Gated on KARDATA_STRESS so the default suite never
// pays for the seed. pg_stat_statements contributes the server-side
// picture when the role can install it; EXPLAIN pins index usage on the
// three heaviest single-statement reads.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  findEventByKey,
  getSession,
  getThread,
  getThreadHeader,
  listArtifacts,
  listSectorCompanies,
  listSectorDocuments,
  listSectorLibrary,
  listSessions,
  listSupervisionAlerts,
  listThreadExecutionRecords,
  listThreads,
  readGlobalContext,
  readOutboxBacklog,
  readPartition,
  readResearchProgress,
  readSectorEvaluation,
} from '../../backend/src/db/index.js'
import { seedStressVolume, type StressSeed } from '../backend/fleet-seed.js'
import { dropTestDb, ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'

const STRESS = Boolean(process.env['KARDATA_STRESS'])
const ITERATIONS = 25
const P95_BUDGET_MS = 100

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((fraction * sorted.length) / 1) - 1)] as number
}

describe.skipIf(!TEST_DATABASE_URL || !STRESS)('stress hot queries at volume [F:db.index.findEventByKey] [F:db.workspace_global_context.readGlobalContext] [F:db.index.getSession] [F:db.index.readPartition] [F:db.index.getThread] [F:db.index.listSectorDocuments] [F:db.index.listArtifacts] [F:db.index.readOutboxBacklog] [F:db.index.listThreads] [F:db.index.listSectorCompanies] [F:db.index.getThreadHeader] [F:db.index.listThreadExecutionRecords] [F:db.sectors.listSectorCompanies] [F:db.sector_documents.listSectorDocuments] [F:db.index.listSessions] [F:db.events.readPartition] [F:db.workspace_research.readResearchProgress] [F:db.index.listSupervisionAlerts] [F:db.events.findEventByKey] [F:db.sessions.getSession] [F:db.threads.getThread] [F:db.event_artifacts.listArtifacts] [F:db.outbox.readOutboxBacklog] [F:db.threads.listThreads] [F:db.threads.getThreadHeader] [F:db.sessions.listSessions] [F:db.workspace.ContextFileRef] [F:db.context_files.listContextFileBlocks] [F:db.errors.WorkspaceError] [F:db.sessions.SessionModelSelection] [F:db.index.Db] [F:db.index.OutboxRow] [F:db.index.SECTOR_DOCUMENT_MAX_BYTES] [F:db.index.SessionModelSelection] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.sector_documents.hiddenFileIds] [F:db.errors.Id] [F:db.errors.checked] [F:db.workspace.globalContextUsageFrom] [F:db.file_jobs.visible] [F:db.events.KeySchema]', () => {
  let pool: Pool
  let dbUrl = ''
  let seed: StressSeed
  let statStatements = false
  const scope = { tenantId: 'TEST stress tenant', projectId: null }

  beforeAll(async () => {
    dbUrl = await ensureTestDb('kardata_test_stress_volume')
    pool = new Pool({ connectionString: dbUrl, max: 5 })
    seed = await seedStressVolume(pool)
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements')
      await pool.query('SELECT * FROM pg_stat_statements LIMIT 1')
      statStatements = true
    } catch {
      statStatements = false
    }
  }, 1_800_000)

  afterAll(async () => {
    await pool?.end()
    if (dbUrl) await dropTestDb(dbUrl)
  })

  async function measure(name: string, run: () => Promise<unknown>): Promise<{ p50: number; p95: number }> {
    await run()
    await run()
    const samples: number[] = []
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const start = performance.now()
      await run()
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    const p50 = percentile(samples, 0.5)
    const p95 = percentile(samples, 0.95)
    process.stdout.write(`stress ${name}: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms\n`)
    return { p50, p95 }
  }

  it('holds p95 under 100 ms across the top-20 reads', async () => {
    const queries: Array<[string, () => Promise<unknown>]> = [
      ['thread.page', () => getThread(pool, seed.threadKey)],
      ['thread.header', () => getThreadHeader(pool, seed.threadKey)],
      ['thread.directory', () => listThreads(pool, seed.sessionId)],
      ['session.get', () => getSession(pool, seed.sessionId, scope)],
      ['session.list', () => listSessions(pool, scope, seed.sectorId)],
      ['research.progress', () => readResearchProgress(pool, seed.sectorId, scope)],
      ['companies.page', () => listSectorCompanies(pool, seed.sectorId, scope, {}, { limit: 50 })],
      ['context.global', () => readGlobalContext(pool, seed.sectorId, scope)],
      ['events.partition', () => readPartition(pool, `session:${seed.sessionId}`)],
      ['outbox.backlog', () => readOutboxBacklog(pool, seed.threadKey, 0, 50)],
      ['evaluation.sector', () => readSectorEvaluation(pool, seed.sectorId, scope)],
      ['view.thread_cost', () => pool.query('SELECT * FROM v_thread_cost WHERE thread_key = $1', [seed.threadKey])],
      ['view.research_quality', () => pool.query('SELECT * FROM v_research_quality WHERE sector_id = $1', [seed.sectorId])],
      ['view.agent_reliability', () => pool.query('SELECT * FROM v_agent_reliability WHERE sector_id = $1', [seed.sectorId])],
      ['documents.list', () => listSectorDocuments(pool, seed.sectorId, scope)],
      ['library.list', () => listSectorLibrary(pool, seed.sectorId, scope)],
      ['artifacts.list', () => listArtifacts(pool, seed.sessionId)],
      ['events.by_key', () => findEventByKey(pool, seed.eventKey)],
      ['execution.records', () => listThreadExecutionRecords(pool, seed.threadKey, scope)],
      ['alerts.list', () => listSupervisionAlerts(pool, scope)],
    ]
    expect(queries).toHaveLength(20)
    const failures: string[] = []
    for (const [name, run] of queries) {
      const { p95 } = await measure(name, run)
      if (p95 >= P95_BUDGET_MS) failures.push(`${name} p95=${p95.toFixed(1)}ms`)
    }
    if (statStatements) {
      const { rows } = await pool.query<{ query: string; calls: string; mean_ms: number }>(
        `SELECT LEFT(query, 80) AS query, calls, round(mean_exec_time::numeric, 2) AS mean_ms
         FROM pg_stat_statements WHERE query NOT LIKE '%pg_stat_statements%' ORDER BY total_exec_time DESC LIMIT 10`,
      )
      for (const row of rows) process.stdout.write(`stress pg_stat: calls=${row.calls} mean=${row.mean_ms}ms ${row.query}\n`)
    }
    expect(failures).toEqual([])
  }, 600_000)

  it('uses indexes on the heaviest single-statement reads', async () => {
    for (const [name, sql, params] of [
      ['events.partition', 'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM events WHERE partition = $1 ORDER BY seq ASC LIMIT 100', [`session:${seed.sessionId}`]],
      ['thread.messages', 'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM thread_messages WHERE thread_key = $1 ORDER BY seq DESC LIMIT 100', [seed.threadKey]],
      ['companies.page', 'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM companies WHERE sector_id = $1 ORDER BY created_at DESC LIMIT 50', [seed.sectorId]],
    ] as Array<[string, string, unknown[]]>) {
      const { rows } = await pool.query<{ [key: string]: string }>(sql, params)
      const plan = rows.map((row) => Object.values(row)[0]).join('\n')
      expect(plan, `${name} plan:\n${plan}`).toContain('Index')
      expect(plan, `${name} plan:\n${plan}`).not.toMatch(/Seq Scan on (events|thread_messages|companies)/)
    }
  })
})
