// Sector evaluation: the three P3.5 views plus GET
// /v1/sectors/:id/evaluation read quality, reliability and cost for one
// sector. Seeds companies, work evidence, rounds and supervision events,
// then asserts every counted field.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, createSector, readSectorEvaluation, registerApiKey, type KindReliability, type SectorCost, type SectorEvaluation, type SectorQuality } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('sector evaluation views and route [F:db.evaluation.readSectorEvaluation] [F:http.getSectorEvaluation] [F:db.index.appendEvent] [F:db.index.createSector] [F:db.index.registerApiKey] [F:db.keys.registerApiKey] [F:db.sectors.createSector] [F:db.events.appendEvent] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector]', () => {
  let pool: Pool, app: FastifyInstance
  const scope = { tenantId: 'TEST evaluation tenant', projectId: null }
  const token = 'TEST evaluation viewer credential'
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_evaluation'), max: 5 })
    await registerApiKey(pool, { keyId: 'TEST evaluation key', keyHash: hashKey(token), scope, role: 'viewer' })
    app = buildApp({ pool, auth: true })
  })
  afterAll(async () => { await app?.close(); await pool?.end() })

  let nonce = 0
  async function seed() {
    nonce += 1
    const tag = `TEST eval ${nonce}`
    const sectorId = (await createSector(pool, { name: `TEST evaluation sector ${nonce}`, topic: 'evaluation', scope })).sectorId
    await projectNewEvents(pool)
    await pool.query(
      `INSERT INTO companies(id, sector_id, name, stage, state) VALUES
       ($2, $1, 'Acme', 'Filter', 'complete'),
       ($3, $1, 'Acme', 'Filter', 'complete'),
       ($4, $1, 'Beta', 'Filter', 'failed'),
       ($5, $1, 'Gamma', 'Filter', 'running')`,
      [sectorId, `${tag} c1`, `${tag} c2`, `${tag} c3`, `${tag} c4`],
    )
    await pool.query(
      `INSERT INTO research_work(id, sector_id, plan_version, kind, title, state, evidence) VALUES
       ($2, $1, 1, 'company', 'Acme', 'complete', '["https://example.com/acme"]'),
       ($3, $1, 1, 'company', 'Beta', 'failed', '[]')`,
      [sectorId, `${tag} w1`, `${tag} w2`],
    )
    await pool.query(
      `INSERT INTO execution_rounds(run_id, thread_key, session_id, sector_id, kind, round, attempt, model, provider, started_at, finished_at, input_tokens, output_tokens, cached_tokens, outcome) VALUES
       ($2, $3, $4, $1, 'research', 1, 0, 'meta-test', 'meta', now(), now(), 100, 50, 0, 'ok'),
       ($2, $3, $4, $1, 'research', 2, 0, 'meta-test', 'meta', now(), now(), 100, 50, 0, 'ok'),
       ($5, $6, $4, $1, 'chat', 1, 0, 'meta-test', 'meta', now(), now(), 10, 0, 0, 'timeout'),
       ($5, $6, $4, $1, 'chat', 1, 1, 'meta-test', 'meta', now(), now(), 10, 0, 0, 'error')`,
      [sectorId, `${tag} r1`, `${tag} t1`, `${tag} s`, `${tag} r2`, `${tag} t2`],
    )
    await appendEvent(pool, { idempotencyKey: `${tag} loop`, partition: `thread:${tag} t1`, type: 't.loop.detected', payload: { threadKey: `${tag} t1`, reason: 'TEST loop' } })
    await appendEvent(pool, { idempotencyKey: `${tag} stall`, partition: `run:${tag} r2`, type: 't.stall.response', payload: { runId: `${tag} r2`, kind: 'no-progress', detail: 'TEST stall', response: 'nudge', reason: 'TEST', at: new Date().toISOString() } })
    return sectorId
  }

  it('reads quality, reliability and cost for the sector', async () => {
    const sectorId = await seed()
    const evaluation: SectorEvaluation = await readSectorEvaluation(pool, sectorId, scope)
    const quality: SectorQuality = { found: 4, accepted: 2, rejected: 1, duplicates: 1, sourceCoverage: 0.5, costPerAccepted: 160 }
    const reliability: KindReliability[] = [
      { kind: 'chat', runs: 1, rounds: 2, ok: 0, errors: 1, timeouts: 1, cancelled: 0, retries: 1, loops: 0, stalls: 1 },
      { kind: 'research', runs: 1, rounds: 2, ok: 2, errors: 0, timeouts: 0, cancelled: 0, retries: 0, loops: 1, stalls: 0 },
    ]
    const cost: SectorCost = { threads: 2, rounds: 4, inputTokens: 220, outputTokens: 100, cachedTokens: 0, errors: 2 }
    expect(evaluation.quality).toEqual(quality)
    expect(evaluation.reliability).toEqual(reliability)
    expect(evaluation.cost).toEqual(cost)
  })

  it('serves the evaluation over GET /v1/sectors/:id/evaluation', async () => {
    const sectorId = await seed()
    const response = await app.inject({ method: 'GET', url: `/v1/sectors/${sectorId}/evaluation`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { ok: boolean; data: { sectorId: string; quality: { found: number } } }
    expect(body.ok).toBe(true)
    expect(body.data.sectorId).toBe(sectorId)
    expect(body.data.quality.found).toBe(4)
    const missing = await app.inject({ method: 'GET', url: '/v1/sectors/TEST-eval-missing/evaluation', headers: { authorization: `Bearer ${token}` } })
    expect(missing.statusCode).toBe(404)
  })

  it('reads zeros for a sector without research', async () => {
    const sectorId = (await createSector(pool, { name: 'TEST empty evaluation sector', topic: 'empty', scope })).sectorId
    await projectNewEvents(pool)
    const evaluation = await readSectorEvaluation(pool, sectorId, scope)
    expect(evaluation.quality).toEqual({ found: 0, accepted: 0, rejected: 0, duplicates: 0, sourceCoverage: null, costPerAccepted: null })
    expect(evaluation.reliability).toEqual([])
    expect(evaluation.cost).toEqual({ threads: 0, rounds: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, errors: 0 })
  })
})
