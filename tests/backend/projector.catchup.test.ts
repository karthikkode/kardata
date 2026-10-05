// Projector catch-up: a backlog past one 500-row batch converges in a
// single projectNewEvents call. Gated on TEST_DATABASE_URL.
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { appendEvent, createSession, getThread } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('projector multi-batch catch-up [F:db.index.appendEvent] [F:db.index.createSession] [F:db.index.getThread] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.threads.getThread] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db]', () => {
  let url = ''
  let pool: Pool

  afterAll(async () => {
    await pool?.end()
  })

  it('projects a >1000-event backlog in one call and reports caught up', async () => {
    url = await ensureTestDb('kardata_test_projector')
    pool = new Pool({ connectionString: url })
    const first = await createSession(pool, 'catchup one')
    const second = await createSession(pool, 'catchup two')
    // Noise past two full batches: unknown types are ignored by the
    // projection but still advance the checkpoint.
    for (let i = 0; i < 1100; i += 1) {
      await appendEvent(pool, {
        idempotencyKey: `catchup-noise:${i}`,
        partition: 'noise',
        type: 't.test.noise',
        payload: {},
      })
    }
    // Pre-fix this returned caughtUp false with ~500 applied: every read
    // path serves projections missing whole batches.
    const result = await projectNewEvents(pool)
    expect(result.caughtUp).toBe(true)
    expect(await getThread(pool, first.id)).toMatchObject({ sessionId: first.id })
    expect(await getThread(pool, second.id)).toMatchObject({ sessionId: second.id })
    const again = await projectNewEvents(pool)
    expect(again).toEqual({ applied: 0, caughtUp: true })
  }, 120_000)
})
