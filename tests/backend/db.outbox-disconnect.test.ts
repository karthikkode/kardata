import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openThreadStream } from '../../backend/src/streams/outbox.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import type { ConnectableDb } from '../../backend/src/db/outbox.js'

// Failure drills kill only the inventoried LISTEN backend in this fresh DB.
describe.skipIf(!TEST_DATABASE_URL)('isolated outbox disconnect recovery', () => {
  let pool: Pool
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_outbox_disconnect'), max: 3 })
  }, 120_000)
  afterAll(async () => { await pool?.end() })

  it('wakes an idle stream on DB disconnect without an unhandled client error', async () => {
    let listenerPid: number | undefined
    let leasedClient: PoolClient | undefined
    const db: ConnectableDb = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect()
        const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        listenerPid = result.rows[0]?.pid
        leasedClient = client
        return client
      },
    }
    const controller = new AbortController()
    const stream = openThreadStream(db, 'TEST-empty-disconnect-thread', 0, controller.signal)
    const pending = stream.next()
    // Attach the rejection oracle before disrupting the owned connection.
    const rejection = expect(pending).rejects.toThrow(/terminat|connection/i)
    try {
      await vi.waitFor(() => {
        expect(listenerPid).toBeTypeOf('number')
        expect(leasedClient?.listenerCount('notification')).toBe(1)
      })
      const result = await pool.query<{ terminated: boolean }>(
        'SELECT pg_terminate_backend($1) AS terminated', [listenerPid],
      )
      expect(result.rows[0]?.terminated).toBe(true)
      await rejection
      expect(leasedClient?.listenerCount('notification')).toBe(0)
      expect(pool.totalCount).toBe(pool.idleCount)
      expect((await pool.query('SELECT 1 AS healthy')).rows).toEqual([{ healthy: 1 }])
    } finally {
      controller.abort()
      await stream.return(undefined)
    }
  }, 10_000)
})
