// Outbox snapshot path: a backlog past the threshold opens with one state
// frame instead of replaying history — and the initial read stays bounded.
// Gated on TEST_DATABASE_URL.
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { createSession, publishOutboxFrame } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { openThreadStream, SNAPSHOT_THRESHOLD } from '../../backend/src/streams/outbox.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('outbox snapshot overflow [F:db.index.createSession] [F:db.index.publishOutboxFrame] [F:db.sessions.createSession] [F:db.outbox.publishOutboxFrame] [F:db.events.DURABLE_STREAM_LOCK_SQL]', () => {
  let url = ''
  let pool: Pool

  afterAll(async () => {
    await pool?.end()
  })

  it('opens with a state snapshot instead of replaying a huge backlog', async () => {
    url = await ensureTestDb('kardata_test_outbox_snapshot')
    pool = new Pool({ connectionString: url })
    const session = await createSession(pool, 'snapshot chat')
    await projectNewEvents(pool)
    for (let i = 0; i < SNAPSHOT_THRESHOLD + 50; i += 1) {
      await publishOutboxFrame(pool, session.id, 'message', {
        seq: i + 1,
        kind: 'text',
        message: { role: 'agent', text: `reply ${i}` },
        at: new Date().toISOString(),
      })
    }
    const controller = new AbortController()
    const seen: Array<{ type: string; payload: unknown }> = []
    try {
      for await (const frame of openThreadStream(pool, session.id, 0, controller.signal)) {
        seen.push({ type: frame.type, payload: frame.payload })
        controller.abort()
      }
    } catch {
      // Aborting mid-iteration surfaces here; the first frame is recorded.
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]?.type).toBe('state')
    expect(seen[0]?.payload).toMatchObject({ key: session.id, historyRefresh: true })
  }, 120_000)
})
