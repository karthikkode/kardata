// SSE streaming contract tests (B3.2). The stream core (async iterable over
// the outbox with LISTEN/NOTIFY wakeups) runs against the live database;
// socket framing is thin Fastify piping, so inject covers only the
// pre-stream envelopes (404/400) while the iterable proves frames, resume,
// the snapshot-overflow rule, and exactly-once publishing.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, publishOutboxFrame } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import {
  openThreadStream,
  SNAPSHOT_THRESHOLD,
  type StreamFrame,
} from '../../backend/src/streams/outbox.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

async function seedMessage(
  pool: Pool,
  key: string,
  partition: string,
  text: string,
  role: 'user' | 'agent',
): Promise<void> {
  await appendEvent(pool, {
    idempotencyKey: `${partition}:${text}`,
    partition,
    type: 't.message.appended',
    payload: { threadKey: key, kind: 'text', message: { text, role } },
  })
}

async function seedSession(pool: Pool, sessionId: string): Promise<void> {
  await appendEvent(pool, {
    idempotencyKey: `sse:${sessionId}:created`,
    partition: `session:${sessionId}`,
    type: 't.session.created',
    payload: { sessionId, title: sessionId },
  })
  await projectNewEvents(pool)
}

/** Reads up to n frames, then breaks (cleanup runs). Fails on timeout. */
async function take(
  pool: Pool,
  threadKey: string,
  fromSeq: number,
  n: number,
  timeoutMs = 20_000,
): Promise<StreamFrame[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const frames: StreamFrame[] = []
    for await (const frame of openThreadStream(pool, threadKey, fromSeq, controller.signal)) {
      frames.push(frame)
      if (frames.length >= n) break
    }
    return frames
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

describe.skipIf(!ENABLED)('SSE streaming contract (B3.2) [F:http.streamThread] [F:db.index.appendEvent] [F:db.index.publishOutboxFrame] [F:db.events.appendEvent] [F:db.outbox.publishOutboxFrame] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db]', () => {
  let app: FastifyInstance
  let pool: Pool

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_sse')
    pool = new Pool({ connectionString: url })
    app = buildApp({ pool })
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('streams live frames and resumes from a dropped connection without gap or duplex', async () => {
    const sessionId = `sse-live-${Date.now()}`
    await seedSession(pool, sessionId)
    await seedMessage(pool, sessionId, `session:${sessionId}`, 'one', 'user')
    await seedMessage(pool, sessionId, `session:${sessionId}`, 'two', 'agent')
    await projectNewEvents(pool)

    // Backlog from zero: creation state plus both messages, in order.
    const backlog = await take(pool, sessionId, 0, 3)
    expect(backlog.map((frame) => frame.type)).toEqual(['state', 'message', 'message'])
    expect(backlog[1]?.payload).toMatchObject({ text: 'one', role: 'user' })
    expect(backlog[2]?.payload).toMatchObject({ text: 'two', role: 'agent' })
    const token = backlog[backlog.length - 1]?.seq
    if (token === undefined) throw new Error('missing token')

    // Drop (break) and resume: the next frame is strictly newer, never a dup.
    await seedMessage(pool, sessionId, `session:${sessionId}`, 'three', 'agent')
    await projectNewEvents(pool)
    const resumed = await take(pool, sessionId, token, 1)
    expect(resumed).toHaveLength(1)
    expect(resumed[0]?.seq).toBeGreaterThan(token)
    expect(resumed[0]?.payload).toMatchObject({ text: 'three' })
  }, 120_000)

  it('wakes a waiting stream when a new frame lands', async () => {
    const sessionId = `sse-wake-${Date.now()}`
    await seedSession(pool, sessionId)
    await projectNewEvents(pool)

    const frames: StreamFrame[] = []
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const stream = openThreadStream(pool, sessionId, 0, controller.signal)
      // First frame is the creation state; the stream then waits.
      const first = await stream.next()
      expect(first.done).toBe(false)
      frames.push(first.value as StreamFrame)
      // Land a message while the stream waits on LISTEN.
      await seedMessage(pool, sessionId, `session:${sessionId}`, 'wake up', 'agent')
      await projectNewEvents(pool)
      const second = await stream.next()
      expect(second.done).toBe(false)
      frames.push(second.value as StreamFrame)
      await stream.return(undefined)
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
    expect(frames.map((frame) => frame.type)).toEqual(['state', 'message'])
    expect(frames[1]?.payload).toMatchObject({ text: 'wake up' })
  }, 120_000)

  it('streams ephemeral deltas in order, superseded by the terminal message', async () => {
    const sessionId = `sse-delta-${Date.now()}`
    await seedSession(pool, sessionId)
    await projectNewEvents(pool)

    // Deltas publish straight to the outbox (no event, no projection).
    await publishOutboxFrame(pool, sessionId, 'delta', { runKey: 'run-9', text: 'he' })
    await publishOutboxFrame(pool, sessionId, 'delta', { runKey: 'run-9', text: 'llo' })
    const deltas = (await take(pool, sessionId, 0, 3)).filter((frame) => frame.type === 'delta')
    expect(deltas.map((frame) => frame.payload)).toEqual([
      { runKey: 'run-9', text: 'he' },
      { runKey: 'run-9', text: 'llo' },
    ])

    // The terminal message lands as an event; a reconnect from its token
    // sees the persisted message, never a delta replay.
    await seedMessage(pool, sessionId, `session:${sessionId}`, 'hello', 'agent')
    await projectNewEvents(pool)
    const token = deltas[deltas.length - 1]?.seq
    if (token === undefined) throw new Error('missing token')
    const resumed = await take(pool, sessionId, token, 1)
    expect(resumed).toHaveLength(1)
    expect(resumed[0]?.type).toBe('message')
    expect(resumed[0]?.payload).toMatchObject({ text: 'hello', role: 'agent' })
  }, 120_000)

  it('streams tool status before the persisted tool row', async () => {
    const sessionId = `sse-tool-${Date.now()}`
    await seedSession(pool, sessionId)
    await projectNewEvents(pool)
    await publishOutboxFrame(pool, sessionId, 'tool', { runKey: 'run-1:1', id: 'c1', name: 'db.list_sectors', state: 'running' })
    await publishOutboxFrame(pool, sessionId, 'tool', { runKey: 'run-1:1', id: 'c1', name: 'db.list_sectors', state: 'done' })
    const tools = (await take(pool, sessionId, 0, 3)).filter((frame) => frame.type === 'tool')
    expect(tools.map((frame) => frame.payload)).toEqual([
      { runKey: 'run-1:1', id: 'c1', name: 'db.list_sectors', state: 'running' },
      { runKey: 'run-1:1', id: 'c1', name: 'db.list_sectors', state: 'done' },
    ])
  }, 120_000)

  it('applies the snapshot-overflow rule past the backlog threshold', async () => {
    const sessionId = `sse-snap-${Date.now()}`
    await seedSession(pool, sessionId)
    for (let i = 0; i < SNAPSHOT_THRESHOLD + 1; i++) {
      await seedMessage(pool, sessionId, `session:${sessionId}`, `bulk ${i}`, 'agent')
    }
    await projectNewEvents(pool)

    // History is skipped: the first frame is the live thread plus the
    // latest token, not 200 replays.
    const [first] = await take(pool, sessionId, 0, 1)
    if (!first) throw new Error('missing snapshot frame')
    expect(first.type).toBe('state')
    expect(first.payload).toMatchObject({ key: sessionId, kind: 'session' })
    const { rows } = await pool.query<{ max: string }>(
      'SELECT MAX(seq) AS max FROM outbox WHERE thread_key = $1',
      [sessionId],
    )
    expect(first.seq).toBe(Number(rows[0]?.max))

    // The tail continues live from the snapshot token.
    await seedMessage(pool, sessionId, `session:${sessionId}`, 'after snapshot', 'agent')
    await projectNewEvents(pool)
    const [next] = await take(pool, sessionId, first.seq, 1)
    expect(next?.type).toBe('message')
    expect(next?.payload).toMatchObject({ text: 'after snapshot' })
  }, 180_000)

  it('serves SSE message payloads identical to the REST page', async () => {
    const sessionId = `sse-parity-${Date.now()}`
    await seedSession(pool, sessionId)
    await seedMessage(pool, sessionId, `session:${sessionId}`, 'parity check', 'user')
    await projectNewEvents(pool)

    const [frame] = (await take(pool, sessionId, 0, 2)).filter((item) => item.type === 'message')
    const response = await app.inject({ method: 'GET', url: `/v1/threads/${sessionId}/messages` })
    const body = response.json() as { data: Array<Record<string, unknown>> }
    expect(frame?.payload).toEqual(body.data[0])
  }, 120_000)

  it('projects each event once: re-projection publishes nothing new', async () => {
    const sessionId = `sse-once-${Date.now()}`
    await seedSession(pool, sessionId)
    await seedMessage(pool, sessionId, `session:${sessionId}`, 'once', 'user')
    const first = await projectNewEvents(pool)
    expect(first.applied).toBeGreaterThan(0)
    const { rows: before } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM outbox WHERE thread_key = $1',
      [sessionId],
    )
    const second = await projectNewEvents(pool)
    expect(second).toEqual({ applied: 0, caughtUp: true })
    const { rows: after } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM outbox WHERE thread_key = $1',
      [sessionId],
    )
    expect(after[0]?.count).toBe(before[0]?.count)
  }, 120_000)

  it('answers unknown threads and bad tokens with envelopes', async () => {
    const missing = await app.inject({ method: 'GET', url: '/v1/threads/nope/events' })
    expect(missing.statusCode).toBe(404)
    expect((missing.json() as { error: { code: string } }).error.code).toBe('not_found')

    const bad = await app.inject({ method: 'GET', url: '/v1/threads/nope/events?lastSeq=-1' })
    expect(bad.statusCode).toBe(400)
    expect((bad.json() as { error: { code: string } }).error.code).toBe('validation_failed')
  })
})
