// DB concurrency stress (deep-check Phase 2). Gated on TEST_DATABASE_URL like
// every other live-DB suite: without it these skip explicitly. Proves the
// three properties 100 contending agents depend on: exactly one twin wins an
// idempotency claim, rate counters stay exact under contention, and a small
// pool queues instead of failing (with statement timeout killing runaways).
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  appendEvent,
  checkRate,
  claimIdempotency,
  completeIdempotency,
  createDbPool,
  poolStats,
  readPartition,
} from '../../backend/src/db/index.js'
import type { IdempotencyOutcome } from '../../backend/src/db/quotas.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

describe.skipIf(!ENABLED)('db concurrency under contention', () => {
  let pool: Pool
  let url: string

  beforeAll(async () => {
    url = await ensureTestDb('kardata_test_concurrency')
    pool = new Pool({ connectionString: url })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('exactly one of 20 twin claims proceeds, the rest conflict', async () => {
    const key = `twin-${Date.now()}`
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => claimIdempotency(pool, key, 'fp-1')),
    )
    const proceeds = outcomes.filter((o: IdempotencyOutcome) => o.kind === 'proceed')
    expect(proceeds).toHaveLength(1)
    for (const outcome of outcomes) {
      if (outcome.kind !== 'proceed') expect(outcome.kind).toBe('conflict')
    }
    // Completing the winner turns the next identical claim into a replay.
    await completeIdempotency(pool, key, 200, { ok: true })
    const replay = await claimIdempotency(pool, key, 'fp-1')
    expect(replay).toMatchObject({ kind: 'replay', status: 200 })
    const clash = await claimIdempotency(pool, key, 'fp-2')
    expect(clash.kind).toBe('conflict')
  })

  it('50 concurrent rate increments count exactly once each', async () => {
    const bucket = `race-${Date.now()}`
    const decisions = await Promise.all(
      Array.from({ length: 50 }, () => checkRate(pool, bucket, 1000, Date.now())),
    )
    expect(decisions.every((d) => d.allowed)).toBe(true)
    const counts = decisions.map((d) => d.count).sort((a, b) => a - b)
    expect(counts).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  })

  it('a max-2 pool queues 10 slow queries instead of failing', async () => {
    const small = createDbPool(url, { max: 2, statementTimeoutMs: 30_000 }, 'concurrency-probe')
    try {
      const started = Date.now()
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          small.query('SELECT pg_sleep(0.2)').then((r) => r.rowCount),
        ),
      )
      expect(results).toHaveLength(10)
      // 10 x 200ms over 2 lanes queues to about a second; far above that
      // means the pool serialized pathologically, far below means the
      // sleep never ran.
      expect(Date.now() - started).toBeGreaterThan(500)
      const stats = poolStats().filter((s) => s.name === 'concurrency-probe')
      expect(stats).toHaveLength(1)
    } finally {
      await small.end()
    }
  })

  it('statement timeout kills a runaway query', async () => {
    const strict = createDbPool(url, { max: 1, statementTimeoutMs: 200 }, 'concurrency-strict')
    try {
      await expect(strict.query('SELECT pg_sleep(5)')).rejects.toThrow(/statement timeout/i)
    } finally {
      await strict.end()
    }
  })

  it('100 twin appends elect one row and share its seq', async () => {
    const key = `storm-${Date.now()}`
    const outcomes = await Promise.all(
      Array.from({ length: 100 }, () =>
        appendEvent(pool, { idempotencyKey: key, partition: 'storm', type: 't.test.storm', payload: {} }),
      ),
    )
    const seqs = new Set(outcomes.map((o) => o.seq))
    expect(seqs.size).toBe(1)
    expect(outcomes.filter((o) => !o.duplicate)).toHaveLength(1)
    // Scoped to this run's key: the database is reused across runs, so
    // the partition carries prior storms too.
    const rows = (await readPartition(pool, 'storm')).filter((row) => row.idempotencyKey === key)
    expect(rows).toHaveLength(1)
  })
})
