// Global Meta limiter: fleet permits converge, cap simultaneous holders,
// expire crashed holders by lease, shrink without touching held slots,
// and time out waiters instead of queueing forever.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { acquireMetaPermit, DbContractError, ensureMetaPermits, MetaPermitTimeout, resolveMetaMax, withMetaPermit } from '../../backend/src/db/index.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('meta permit limiter [F:backend.activity.turn.sleep] [F:db.index.DbContractError] [F:db.index.acquireMetaPermit] [F:db.index.ensureMetaPermits] [F:db.index.MetaPermitTimeout] [F:db.index.resolveMetaMax] [F:db.index.withMetaPermit] [F:db.errors.DbContractError] [F:db.meta_limiter.acquireMetaPermit] [F:db.meta_limiter.ensureMetaPermits] [F:db.meta_limiter.MetaPermitTimeout] [F:db.meta_limiter.resolveMetaMax] [F:db.meta_limiter.withMetaPermit] [F:db.index.Db]', () => {
  let pool: Pool
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_meta_limiter'), max: 5 })
  })
  afterAll(async () => { await pool?.end() })

  async function held(): Promise<number> {
    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM meta_permits WHERE holder IS NOT NULL')
    return Number(rows[0]?.n ?? 0)
  }

  it('acquires and releases one permit', async () => {
    const release = await acquireMetaPermit(pool, 'TEST limiter happy', { max: 2 })
    expect(await held()).toBe(1)
    await release()
    expect(await held()).toBe(0)
    await release()
    expect(await held()).toBe(0)
  })

  it('resolves the fleet max from the environment', () => {
    expect(resolveMetaMax(undefined)).toBe(4)
    expect(resolveMetaMax('')).toBe(4)
    expect(resolveMetaMax('12')).toBe(12)
    for (const raw of ['0', '-3', '2.5', 'many']) {
      expect(() => resolveMetaMax(raw)).toThrow(DbContractError)
    }
  })

  it('rejects invalid max and holder', async () => {
    await expect(ensureMetaPermits(pool, 0)).rejects.toBeInstanceOf(DbContractError)
    await expect(acquireMetaPermit(pool, '', { max: 1 })).rejects.toBeInstanceOf(DbContractError)
    await expect(acquireMetaPermit(pool, 'TEST limiter bad max', { max: 0 })).rejects.toBeInstanceOf(DbContractError)
  })

  it('caps simultaneous holders at max', async () => {
    const max = 3
    let inside = 0
    let peak = 0
    await Promise.all(Array.from({ length: 10 }, async (_, worker) =>
      withMetaPermit(pool, `TEST limiter worker ${worker}`, async () => {
        inside += 1
        peak = Math.max(peak, inside)
        await new Promise((resolve) => setTimeout(resolve, 50))
        inside -= 1
      }, { max }),
    ))
    expect(peak).toBeLessThanOrEqual(max)
    expect(peak).toBeGreaterThan(1)
    expect(await held()).toBe(0)
  })

  it('steals crashed holders past the lease', async () => {
    await ensureMetaPermits(pool, 1)
    await pool.query(`UPDATE meta_permits SET holder = 'TEST limiter crashed', held_at = now() - make_interval(secs => 100) WHERE slot = 0`)
    const release = await acquireMetaPermit(pool, 'TEST limiter heir', { max: 1, leaseMs: 1000 })
    expect(await held()).toBe(1)
    await release()
  })

  it('shrinks only unheld slots and regrows on demand', async () => {
    const release = await acquireMetaPermit(pool, 'TEST limiter pinned', { max: 3 })
    await ensureMetaPermits(pool, 1)
    const { rows } = await pool.query<{ slots: string }>('SELECT COUNT(*) AS slots FROM meta_permits')
    expect(Number(rows[0]?.slots)).toBeGreaterThanOrEqual(1)
    expect(await held()).toBe(1)
    await release()
    await ensureMetaPermits(pool, 1)
    const shrunk = await pool.query<{ slots: string }>('SELECT COUNT(*) AS slots FROM meta_permits')
    expect(Number(shrunk.rows[0]?.slots)).toBe(1)
    await ensureMetaPermits(pool, 3)
    const grown = await pool.query<{ slots: string }>('SELECT COUNT(*) AS slots FROM meta_permits')
    expect(Number(grown.rows[0]?.slots)).toBe(3)
  })

  it('times out waiters instead of queueing forever', async () => {
    const release = await acquireMetaPermit(pool, 'TEST limiter hog', { max: 1 })
    try {
      await expect(acquireMetaPermit(pool, 'TEST limiter waiter', { max: 1, waitMs: 300 })).rejects.toBeInstanceOf(MetaPermitTimeout)
    } finally {
      await release()
    }
  })

  it('aborts the poll on signal instead of waiting out the bound', async () => {
    const release = await acquireMetaPermit(pool, 'TEST limiter abort hog', { max: 1 })
    try {
      const abort = new AbortController()
      const pending = acquireMetaPermit(pool, 'TEST limiter abort waiter', { max: 1, waitMs: 60_000, signal: abort.signal })
      abort.abort(new Error('TEST cancelled'))
      await expect(pending).rejects.toThrow('TEST cancelled')
    } finally {
      await release()
    }
  })

  it('heartbeats while polling for a permit', async () => {
    const release = await acquireMetaPermit(pool, 'TEST limiter heartbeat hog', { max: 1 })
    try {
      let beats = 0
      await expect(acquireMetaPermit(pool, 'TEST limiter heartbeat waiter', { max: 1, waitMs: 500, heartbeat: () => { beats += 1 } })).rejects.toBeInstanceOf(MetaPermitTimeout)
      expect(beats).toBeGreaterThan(0)
    } finally {
      await release()
    }
  })

  it('retries a flapping release and frees the slot', async () => {
    let flaps = 0
    const flaky = {
      query: async <T>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> => {
        if (text.includes('holder = NULL') && flaps++ < 2) throw new Error('TEST release flap')
        const result = await pool.query(text, params)
        return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 }
      },
    }
    const guarded = await acquireMetaPermit(flaky, 'TEST limiter flap guarded', { max: 1 })
    await guarded()
    expect(flaps).toBeGreaterThanOrEqual(2)
    expect(await held()).toBe(0)
  })

  it('never throws release even when the database stays down', async () => {
    const down = {
      query: async <T>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> => {
        if (text.includes('holder = NULL')) throw new Error('TEST database down')
        const result = await pool.query(text, params)
        return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 }
      },
    }
    const guarded = await acquireMetaPermit(down, 'TEST limiter doomed guarded', { max: 1 })
    try {
      await expect(guarded()).resolves.toBeUndefined()
    } finally {
      await pool.query(`UPDATE meta_permits SET holder = NULL, held_at = NULL WHERE holder = 'TEST limiter doomed guarded'`)
    }
  })

  it('renews a live holder past the lease instead of letting it steal', async () => {
    await ensureMetaPermits(pool, 1)
    const release = await acquireMetaPermit(pool, 'TEST limiter renewed', { max: 1, leaseMs: 300 })
    try {
      // Two full leases pass; renewal keeps the hold, so no heir can steal.
      await new Promise((resolve) => setTimeout(resolve, 700))
      await expect(acquireMetaPermit(pool, 'TEST limiter heir denied', { max: 1, leaseMs: 300, waitMs: 300 })).rejects.toBeInstanceOf(MetaPermitTimeout)
      expect(await held()).toBe(1)
    } finally {
      await release()
    }
  })

  it('a small-max replica never steals expired slots past its max', async () => {
    await ensureMetaPermits(pool, 8)
    const releases: Array<() => Promise<void>> = []
    for (let i = 0; i < 4; i++) {
      releases.push(await acquireMetaPermit(pool, `TEST limiter small ${i}`, { max: 8 }))
    }
    try {
      await pool.query('UPDATE meta_permits SET holder = $1, held_at = now() - make_interval(secs => 100000) WHERE slot >= 4', ['TEST limiter crashed'])
      await expect(acquireMetaPermit(pool, 'TEST limiter small waiter', { max: 4, leaseMs: 1000, waitMs: 500 })).rejects.toBeInstanceOf(MetaPermitTimeout)
    } finally {
      await pool.query('UPDATE meta_permits SET holder = NULL, held_at = NULL WHERE holder = $1', ['TEST limiter crashed'])
      for (const release of releases) await release()
    }
  })
})
