// P3.6 writer-contention tier (stress): concurrent writers (appendEvent +
// tool writes + MCP reads) against the real server pool size (10). Full:
// 100 writers for 5 minutes; reduced (KARDATA_STRESS_SCALE=reduced, CI):
// 10 writers for 60 s. Asserts 0 deadlocks, 0 statement timeouts and
// pool-wait p95 under 50 ms. Gated on KARDATA_STRESS.
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, getThreadHeader, readResearchProgress, recordHeartbeat } from '../../backend/src/db/index.js'
import { ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'

const STRESS = Boolean(process.env['KARDATA_STRESS'])
const REDUCED_SCALE = process.env['KARDATA_STRESS_SCALE'] === 'reduced'
const WRITERS = REDUCED_SCALE ? 10 : 100
const RUN_MS = REDUCED_SCALE ? 60_000 : 5 * 60_000
const POOL_MAX = 10
const POOL_WAIT_P95_BUDGET_MS = 50

describe.skipIf(!TEST_DATABASE_URL || !STRESS)('stress writer contention [F:db.index.appendEvent] [F:db.index.recordHeartbeat] [F:db.index.getThreadHeader] [F:db.heartbeats.recordHeartbeat] [F:db.workspace_research.readResearchProgress] [F:db.events.appendEvent] [F:db.threads.getThreadHeader] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db]', () => {
  let pool: Pool
  const sectorId = 'TEST stress writer sector'
  const threadKey = 'TEST stress writer thread'
  const sessionId = 'TEST stress writer session'

  beforeAll(async () => {
    pool = new Pool({
      connectionString: await ensureTestDb('kardata_test_stress_writers'),
      max: POOL_MAX,
      statement_timeout: 5000,
    })
    await pool.query(
      `INSERT INTO sectors(id, name, topic, state, tenant_id) VALUES ($1, 'TEST stress writer sector', 'stress', 'running', 'TEST stress tenant') ON CONFLICT(id) DO NOTHING`,
      [sectorId],
    )
    await pool.query(
      `INSERT INTO sector_workspace(sector_id, research_session_id, sections) VALUES ($1, $2, '{}') ON CONFLICT(sector_id) DO NOTHING`,
      [sectorId, sessionId],
    )
    await pool.query(
      `INSERT INTO threads(key, session_id, kind, status) VALUES ($1, $2, 'session', 'idle') ON CONFLICT(key) DO NOTHING`,
      [threadKey, sessionId],
    )
  }, 120_000)

  afterAll(async () => { await pool?.end() })

  it(`runs ${WRITERS} writers with no deadlocks, no timeouts, fast pool waits`, async () => {
    const waits: number[] = []
    let ops = 0
    let deadlocks = 0
    let statementTimeouts = 0
    const otherErrors: string[] = []
    const endAt = Date.now() + RUN_MS
    const scope = { tenantId: 'TEST stress tenant', projectId: null }

    async function write(client: PoolClient, worker: number, seq: number): Promise<void> {
      const op = seq % 4
      if (op === 0) {
        await appendEvent(client, {
          idempotencyKey: `TEST stress writer ${worker} ${seq}`,
          partition: `session:${sessionId}`,
          type: 't.message.appended',
          payload: { threadKey, seq, note: 'TEST stress writer filler' },
        })
      } else if (op === 1) {
        await recordHeartbeat(client, `TEST stress writer run ${worker}`, 'stress-write', true)
      } else if (op === 2) {
        await readResearchProgress(client, sectorId, scope)
      } else {
        await getThreadHeader(client, threadKey)
      }
    }

    await Promise.all(Array.from({ length: WRITERS }, async (_, worker) => {
      let seq = 0
      while (Date.now() < endAt) {
        seq += 1
        const waitStart = performance.now()
        const client = await pool.connect()
        waits.push(performance.now() - waitStart)
        try {
          await write(client, worker, seq)
          ops += 1
        } catch (error) {
          const code = (error as { code?: string }).code
          if (code === '40P01') deadlocks += 1
          else if (code === '57014') statementTimeouts += 1
          else if (otherErrors.length < 10) otherErrors.push(`${code ?? 'unknown'}: ${(error as Error).message}`)
        } finally {
          client.release()
        }
      }
    }))

    waits.sort((a, b) => a - b)
    const p50 = waits[Math.ceil(0.5 * waits.length) - 1] as number
    const p95 = waits[Math.ceil(0.95 * waits.length) - 1] as number
    process.stdout.write(`stress writers: ops=${ops} deadlocks=${deadlocks} timeouts=${statementTimeouts} pool_wait_p50=${p50.toFixed(1)}ms pool_wait_p95=${p95.toFixed(1)}ms\n`)
    expect(otherErrors).toEqual([])
    expect(deadlocks).toBe(0)
    expect(statementTimeouts).toBe(0)
    expect(p95).toBeLessThan(POOL_WAIT_P95_BUDGET_MS)
  }, 420_000)
})
