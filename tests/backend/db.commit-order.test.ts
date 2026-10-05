import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, createSession, getThread, latestOutboxSeq, publishOutboxFrame, readOutboxBacklog, type Db } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('durable cursor commit ordering [F:db.index.appendEvent] [F:db.index.createSession] [F:db.index.publishOutboxFrame] [F:db.index.getThread] [F:db.index.latestOutboxSeq] [F:db.index.readOutboxBacklog] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.outbox.publishOutboxFrame] [F:db.threads.getThread] [F:db.outbox.latestOutboxSeq] [F:db.outbox.readOutboxBacklog] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.index.OutboxRow]', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_commit_order'), max: 5 }) })
  afterAll(async () => { await pool?.end() })

  it('does not advance the projector past an earlier uncommitted event', async () => {
    const session = await createSession(pool, 'TEST commit ordering')
    await projectNewEvents(pool)
    const client = await pool.connect()
    const tx: Db = { query: async <R>(text: string, params?: unknown[]) => { const result = await client.query(text, params); return { rows: result.rows as R[], rowCount: result.rowCount } } }
    let fast: Promise<unknown> | undefined
    try {
      await client.query('BEGIN')
      await appendEvent(tx, { idempotencyKey: 'slow-commit', partition: `session:${session.id}`, type: 't.message.appended', payload: { threadKey: session.id, kind: 'text', message: { role: 'agent', text: 'TEST earlier commit' } } })
      fast = appendEvent(pool, { idempotencyKey: 'fast-commit', partition: `session:${session.id}`, type: 't.message.appended', payload: { threadKey: session.id, kind: 'text', message: { role: 'agent', text: 'TEST later commit' } } })
      await pool.query('SELECT pg_sleep(0.05)')
      await projectNewEvents(pool)
      expect((await getThread(pool, session.id))?.messages).toHaveLength(0)
    } finally { await client.query('COMMIT'); client.release(); await fast }
    await projectNewEvents(pool)
    expect((await getThread(pool, session.id))?.messages.map((row) => (row.payload as { text?: string }).text)).toEqual(['TEST earlier commit', 'TEST later commit'])
  })

  it('does not let an SSE cursor skip an earlier uncommitted outbox frame', async () => {
    const session = await createSession(pool, 'TEST outbox ordering')
    await projectNewEvents(pool)
    const basis = await latestOutboxSeq(pool, session.id)
    const client = await pool.connect()
    const tx: Db = { query: async <R>(text: string, params?: unknown[]) => { const result = await client.query(text, params); return { rows: result.rows as R[], rowCount: result.rowCount } } }
    let fast: Promise<unknown> | undefined
    try {
      await client.query('BEGIN')
      await publishOutboxFrame(tx, session.id, 'context-version', { version: 1 })
      fast = publishOutboxFrame(pool, session.id, 'context-version', { version: 2 })
      await pool.query('SELECT pg_sleep(0.05)')
      expect(await readOutboxBacklog(pool, session.id, basis)).toEqual([])
    } finally { await client.query('COMMIT'); client.release(); await fast }
    expect((await readOutboxBacklog(pool, session.id, basis)).map((row) => row.payload)).toEqual([{ version: 1 }, { version: 2 }])
  })
})
