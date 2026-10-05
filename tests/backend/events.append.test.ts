import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, Pool } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  appendEvent,
  DbContractError,
  EventEnvelope,
  findEventByKey,
  readPartition,
} from '../../backend/src/db/index.js'
import { migrate } from '../../backend/src/db/migrate.js'
import { runWithEventClient } from '../../backend/src/observability/ambient.js'
import {
  spanContextFromTrace,
  withSpanContext,
} from '../../backend/src/observability/tracing.js'

const DB = process.env['TEST_DATABASE_URL']
// This file owns a separate database from the migrations suite so the two
// stay parallel-safe and order-independent: a down/up round-trip elsewhere
// can never drop tables under these tests.
const APPEND_DB = 'kardata_test_append'
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

function appendUrl(): string {
  const url = new URL(DB as string)
  url.pathname = `/${APPEND_DB}`
  return url.toString()
}

describe('event envelope (B1.1) [F:db.index.appendEvent] [F:db.index.findEventByKey] [F:db.index.readPartition] [F:db.index.DbContractError] [F:db.migrate.migrate] [F:db.index.EventEnvelope] [F:db.events.readPartition] [F:db.events.appendEvent] [F:db.events.findEventByKey] [F:db.errors.DbContractError] [F:db.events.EventEnvelope] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.events.KeySchema]', () => {
  it('rejects invalid envelopes without touching the database', () => {
    expect(() => EventEnvelope.parse({ partition: 'p', type: 't' })).toThrow()
    expect(() => EventEnvelope.parse({ idempotencyKey: '', partition: 'p', type: 't' })).toThrow()
    expect(() => EventEnvelope.parse({ idempotencyKey: 'k', partition: '', type: 't' })).toThrow()
    expect(() =>
      EventEnvelope.parse({ idempotencyKey: 'k', partition: 'p', type: 't', payload: { ok: true } }),
    ).not.toThrow()
  })

  it('accepts explicit trace and client, rejects malformed ones (P3.2.6)', () => {
    expect(() =>
      EventEnvelope.parse({ idempotencyKey: 'k', partition: 'p', type: 't', traceId: 'a'.repeat(32), client: 'ui' }),
    ).not.toThrow()
    expect(() => EventEnvelope.parse({ idempotencyKey: 'k', partition: 'p', type: 't', traceId: 'short' })).toThrow()
    expect(() => EventEnvelope.parse({ idempotencyKey: 'k', partition: 'p', type: 't', traceId: 'A'.repeat(32) })).toThrow()
    expect(() => EventEnvelope.parse({ idempotencyKey: 'k', partition: 'p', type: 't', client: 'browser' })).toThrow()
  })

  it('rejects invalid appends before any SQL runs', async () => {
    let queried = false
    const db = {
      query: async () => {
        queried = true
        return { rowCount: 0, rows: [] }
      },
    }
    await expect(appendEvent(db, { partition: 'p', type: 't' })).rejects.toThrow()
    expect(queried).toBe(false)
  })

  it('rejects misaligned reads with DbContractError before any SQL runs', async () => {
    let queried = false
    const db = {
      query: async () => {
        queried = true
        return { rowCount: 0, rows: [] }
      },
    }
    await expect(findEventByKey(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(readPartition(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(readPartition(db, 'p', -1)).rejects.toBeInstanceOf(DbContractError)
    await expect(readPartition(db, 'p', 1.5)).rejects.toBeInstanceOf(DbContractError)
    expect(queried).toBe(false)
  })

  it('DbContractError carries the db_contract code', async () => {
    const db = { query: async () => ({ rowCount: 0, rows: [] }) }
    const error = await readPartition(db, '', 0).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DbContractError)
    expect((error as DbContractError).code).toBe('db_contract')
  })

  describe.skipIf(!DB)('against Postgres', () => {
    beforeAll(async () => {
      const admin = new URL(DB as string)
      admin.pathname = '/postgres'
      const client = new Client({ connectionString: admin.toString() })
      await client.connect()
      try {
        await client.query(`CREATE DATABASE ${APPEND_DB}`)
      } catch (error) {
        if (!/already exists/i.test((error as Error).message)) throw error
      } finally {
        await client.end()
      }
      await migrate(appendUrl(), DIR, 'up')
    }, 30_000)

    async function cleanPartition(partition: string): Promise<Pool> {
      const pool = new Pool({ connectionString: appendUrl() })
      await pool.query('DELETE FROM events WHERE partition = $1', [partition])
      return pool
    }

    it('concurrent duplicate appends land one row and replay the seq', async () => {
      const pool = await cleanPartition('test-dupe')
      try {
        const results = await Promise.all([
          appendEvent(pool, { idempotencyKey: 'dupe-1', partition: 'test-dupe', type: 't.run.started' }),
          appendEvent(pool, { idempotencyKey: 'dupe-1', partition: 'test-dupe', type: 't.run.started' }),
        ])
        expect(results[0].seq).toBe(results[1].seq)
        expect(results.filter((result) => result.duplicate)).toHaveLength(1)
        const { rows } = await pool.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM events WHERE idempotency_key = $1',
          ['dupe-1'],
        )
        expect(rows[0]?.count).toBe('1')
      } finally {
        await pool.end()
      }
    })

    it('redacted payloads store scrubbed and read back flagged, never plaintext', async () => {
      const pool = await cleanPartition('test-redact')
      try {
        const secret = 'sk-live-probe-secret'
        const appended = await appendEvent(pool, {
          idempotencyKey: 'red-1',
          partition: 'test-redact',
          type: 't.provider.called',
          payload: { providerApiKey: secret, model: 'm1' },
          redacted: true,
        })
        expect(appended.duplicate).toBe(false)
        const events = await readPartition(pool, 'test-redact')
        expect(events).toHaveLength(1)
        expect(events[0]?.redacted).toBe(true)
        expect(JSON.stringify(events[0]?.payload)).not.toContain(secret)
        expect(JSON.stringify(events[0]?.payload)).toContain('[Redacted]')
        const { rows } = await pool.query<{ payload: unknown }>(
          'SELECT payload FROM events WHERE idempotency_key = $1',
          ['red-1'],
        )
        expect(JSON.stringify(rows[0]?.payload)).not.toContain(secret)
      } finally {
        await pool.end()
      }
    })

    it('reads a partition back in seq order', async () => {
      const pool = await cleanPartition('test-order')
      try {
        const first = await appendEvent(pool, { idempotencyKey: 'o-1', partition: 'test-order', type: 'a' })
        const second = await appendEvent(pool, { idempotencyKey: 'o-2', partition: 'test-order', type: 'b' })
        expect(second.seq).toBeGreaterThan(first.seq)
        const events = await readPartition(pool, 'test-order')
        expect(events.map((event) => event.type)).toEqual(['a', 'b'])
        expect(await readPartition(pool, 'test-order', first.seq)).toHaveLength(1)
      } finally {
        await pool.end()
      }
    })

    it('stores explicit trace and client and reads them back (P3.2.6)', async () => {
      const pool = await cleanPartition('test-trace-explicit')
      try {
        await appendEvent(pool, {
          idempotencyKey: 'trace-1',
          partition: 'test-trace-explicit',
          type: 't.trace.probe',
          traceId: 'b'.repeat(32),
          client: 'agent-mcp',
        })
        const stored = await findEventByKey(pool, 'trace-1')
        expect(stored?.traceId).toBe('b'.repeat(32))
        expect(stored?.client).toBe('agent-mcp')
      } finally {
        await pool.end()
      }
    })

    it('defaults to the ambient trace and route client, else system (P3.2.6)', async () => {
      const pool = await cleanPartition('test-trace-ambient')
      try {
        await withSpanContext(spanContextFromTrace('c'.repeat(32)), () =>
          runWithEventClient('ui', () =>
            appendEvent(pool, { idempotencyKey: 'trace-2', partition: 'test-trace-ambient', type: 't.trace.probe' }),
          ),
        )
        expect((await findEventByKey(pool, 'trace-2'))?.traceId).toBe('c'.repeat(32))
        expect((await findEventByKey(pool, 'trace-2'))?.client).toBe('ui')
        await appendEvent(pool, { idempotencyKey: 'trace-3', partition: 'test-trace-ambient', type: 't.trace.probe' })
        expect((await findEventByKey(pool, 'trace-3'))?.traceId).toBeNull()
        expect((await findEventByKey(pool, 'trace-3'))?.client).toBe('system')
      } finally {
        await pool.end()
      }
    })
  })

  if (!DB) {
    it('notes the live-DB gate', () => {
      expect(DB).toBeUndefined()
    })
  }
})
