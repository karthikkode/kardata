import { Pool } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  appendEvent,
  getThread,
  listThreadHeaders,
  listThreads,
  projectBatch,
  readPartition,
  rebuildFromEvents,
  type StoredEvent,
} from '../../backend/src/db/index.js'
import { routeSend } from '../../backend/src/threads/project.js'
import { toApiMessage } from '../../backend/src/threads/views.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe('message view thinking trace', () => {
  it('passes agent reasoning through, never on user rows', () => {
    expect(
      toApiMessage({
        seq: 1,
        kind: 'text',
        payload: { role: 'agent', text: 'done', reasoning: 'why' },
        at: '',
      }),
    ).toMatchObject({ role: 'agent', text: 'done', reasoning: 'why' })
    expect(
      toApiMessage({
        seq: 2,
        kind: 'text',
        payload: { role: 'user', text: 'hi', reasoning: 'why' },
        at: '',
      }),
    ).toEqual({ seq: 2, kind: 'text', at: '', role: 'user', text: 'hi' })
    expect(
      toApiMessage({ seq: 3, kind: 'text', payload: { role: 'agent', text: 'plain' }, at: '' }),
    ).not.toHaveProperty('reasoning')
  })
})

describe('thread routing (B1.2)', () => {
  const children = [
    { name: 'Scout', threadKey: 'agent:c1' },
    { name: 'Scribe', threadKey: 'agent:c2' },
  ]

  it('routes @name to that subagent thread and plain sends to the parent', () => {
    expect(routeSend('s1', '@Scout dig deeper', children)).toBe('agent:c1')
    expect(routeSend('s1', 'hello parent', children)).toBe('s1')
    expect(routeSend('s1', '@Nobody hi', children)).toBe('s1')
  })

  it('matches mentions case-insensitively in launch order', () => {
    expect(routeSend('s1', '@scout go', children)).toBe('agent:c1')
    expect(routeSend('s1', '@Scribe write it', children)).toBe('agent:c2')
  })
})

describe.skipIf(!TEST_DATABASE_URL)('transcript projection (B1.2) [F:db.index.appendEvent] [F:db.index.readPartition] [F:db.index.getThread] [F:db.index.listThreads] [F:db.index.projectBatch] [F:db.index.rebuildFromEvents] [F:db.index.listThreadHeaders] [F:db.events.readPartition] [F:db.events.appendEvent] [F:db.threads.getThread] [F:db.threads.listThreads] [F:db.threads.projectBatch] [F:db.threads.rebuildFromEvents] [F:db.threads.listThreadHeaders] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.index.SectorSweepRunner] [F:db.index.StoredEvent]', () => {
  let url = ''

  beforeAll(async () => {
    url = await ensureTestDb('kardata_test_threads')
  }, 30_000)

  function pool(): Pool {
    return new Pool({ connectionString: url })
  }

  async function append(
    db: Pool,
    type: string,
    payload: Record<string, unknown>,
    key: string,
  ): Promise<void> {
    await appendEvent(db, { idempotencyKey: key, partition: 'session:s1', type, payload })
  }

  async function fixture(db: Pool): Promise<StoredEvent[]> {
    await db.query("DELETE FROM events WHERE partition = 'session:s1'")
    await db.query('TRUNCATE thread_messages, threads')
    await append(db, 't.session.created', { sessionId: 's1', title: 'Scan' }, 'f-session')
    await append(db, 't.subagent.launched', { sessionId: 's1', childId: 'c1', name: 'Scout' }, 'f-launch')
    await append(
      db,
      't.message.appended',
      { threadKey: 'agent:c1', kind: 'tool', message: { name: 'Rank', detail: 'd', state: 'done' } },
      'f-tool',
    )
    await append(db, 't.send.received', { sessionId: 's1', text: '@Scout dig deeper' }, 'f-mention')
    await append(db, 't.send.received', { sessionId: 's1', text: 'hello parent' }, 'f-parent')
    await append(db, 't.queue.enqueued', { threadKey: 'agent:c1', text: 'queued note' }, 'f-enqueue')
    return readPartition(db, 'session:s1')
  }

  it('projects threads, routing, and per-thread queues per the contract', async () => {
    const db = pool()
    try {
      const events = await fixture(db)
      const result = await projectBatch(db, events)
      expect(result).toEqual({ applied: 6, ignored: [] })

      const threads = await listThreads(db, 's1')
      expect(threads.map((thread) => thread.key).sort()).toEqual(['agent:c1', 's1'])

      const parent = await getThread(db, 's1')
      expect(parent?.messages.map((message) => (message.payload as { text?: string }).text)).toEqual([
        'hello parent',
      ])

      const child = await getThread(db, 'agent:c1')
      expect(child?.kind).toBe('subagent')
      expect(child?.acceptingSteer).toBe(true)
      expect(child?.queueDepth).toBe(1)
      const texts = child?.messages.map((message) => message.payload) as Array<Record<string, unknown>>
      expect(texts.some((payload) => payload['text'] === '@Scout dig deeper')).toBe(true)
      const queued = texts.find((payload) => payload['text'] === 'queued note')
      expect(queued?.['queued']).toBe(true)
    } finally {
      await db.end()
    }
  })

  it('releases queues, finishes threads, and lands late sends as missed_steer', async () => {
    const db = pool()
    try {
      const events = await fixture(db)
      await projectBatch(db, events)
      const childBefore = await getThread(db, 'agent:c1')
      const queuedSeq = childBefore?.messages.find(
        (message) => (message.payload as { text?: string }).text === 'queued note',
      )?.seq
      if (!queuedSeq) throw new Error('queued message missing')

      await append(db, 't.queue.released', { threadKey: 'agent:c1', seq: queuedSeq }, 'f-release')
      await append(db, 't.thread.finished', { threadKey: 'agent:c1' }, 'f-finish')
      await append(db, 't.send.received', { sessionId: 's1', text: '@Scout are you there' }, 'f-late')
      const lastSeq = events[events.length - 1]?.seq ?? 0
      const tail = await readPartition(db, 'session:s1', lastSeq)
      const result = await projectBatch(db, tail)
      expect(result).toEqual({ applied: 3, ignored: [] })

      const child = await getThread(db, 'agent:c1')
      expect(child?.status).toBe('FINISHED')
      expect(child?.acceptingSteer).toBe(false)
      expect(child?.queueDepth).toBe(0)
      const released = child?.messages.find(
        (message) => (message.payload as { text?: string }).text === 'queued note',
      )
      expect((released?.payload as { queued?: boolean }).queued).toBe(false)
      // The late send never relaunched the child: it sits on the session
      // thread flagged missed_steer.
      expect(child?.messages.some((message) => (message.payload as { text?: string }).text === '@Scout are you there')).toBe(
        false,
      )
      const parent = await getThread(db, 's1')
      const missed = parent?.messages.find(
        (message) => (message.payload as { text?: string }).text === '@Scout are you there',
      )
      expect((missed?.payload as { missedSteer?: boolean }).missedSteer).toBe(true)
    } finally {
      await db.end()
    }
  })

  it('full rebuild reproduces the incremental views exactly', async () => {
    const db = pool()
    try {
      const events = await fixture(db)
      await projectBatch(db, events)
      const incremental = await listThreads(db, 's1')
      const result = await rebuildFromEvents(db, events)
      expect(result).toEqual({ applied: 6, ignored: [] })
      expect(await listThreads(db, 's1')).toEqual(incremental)
    } finally {
      await db.end()
    }
  })

  it('keeps the V2 launch display name on the child header', async () => {
    const db = pool()
    try {
      await db.query("DELETE FROM events WHERE partition = 'session:s1'")
      await db.query('TRUNCATE thread_messages, threads')
      await append(db, 't.session.created', { sessionId: 's1', title: 'Scan' }, 'n-session')
      await append(db, 't.subagent.launched', { childId: 'c9', parentSessionId: 's1', name: 'Pricer', goal: 'g', depth: 0, mode: 'empty', queueCapacity: 8, canDelegate: false }, 'n-launch')
      await append(db, 't.subagent.launched', { childId: 'c10', parentSessionId: 's1', goal: 'g', depth: 0, mode: 'empty', queueCapacity: 8, canDelegate: false }, 'n-launch-anon')
      await projectBatch(db, await readPartition(db, 'session:s1'))
      const headers = await listThreadHeaders(db, 's1')
      expect(headers.find((header) => header.key === 'agent:c9')?.name).toBe('Pricer')
      expect(headers.find((header) => header.key === 'agent:c10')?.name).toBeUndefined()
    } finally {
      await db.end()
    }
  })

  it('ignores unknown event types without failing the batch', async () => {
    const db = pool()
    try {
      await fixture(db)
      const before = await readPartition(db, 'session:s1')
      const lastSeq = before[before.length - 1]?.seq ?? 0
      await append(db, 't.future.something', { hello: 'world' }, 'f-future')
      const tail = await readPartition(db, 'session:s1', lastSeq)
      const result = await projectBatch(db, tail)
      expect(result).toEqual({ applied: 0, ignored: ['t.future.something'] })
    } finally {
      await db.end()
    }
  })
})
