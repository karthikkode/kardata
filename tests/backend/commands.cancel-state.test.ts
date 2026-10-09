// Cancel projects its CANCELLING state before answering (pilot item 1).
// The gateway appends t.thread.state/CANCELLING ahead of the signal so the
// UI releases the thinking indicator without waiting for the unwind — but
// the event only reaches the stream when something projects it. The cancel
// route must project after the gateway call; otherwise a slow or stalled
// unwind leaves the indicator spinning on a RUNNING thread.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, getThread, readOutboxBacklog } from '../../backend/src/db/index.js'
import { appendCancelState } from '../../backend/src/temporal/runs-helpers.js'
import type { CommandResult, RunInfo } from '../../backend/src/temporal/runs-types.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

/** Fake that mirrors production cancelRun's DB effect: the real
 * appendCancelState ahead of the signal (the Temporal signal itself has
 * no projection effect, so the in-memory record stands in for it). */
class CancellingFake extends FakeRunsGateway {
  constructor(private readonly db: Pool) {
    super(db)
  }

  override async cancelRun(runId: string): Promise<CommandResult> {
    await appendCancelState(this.db, runId, 'sessionRun')
    return super.cancelRun(runId)
  }
}

describe.skipIf(!ENABLED)('cancel projects CANCELLING promptly [F:http.cancelRun] [F:db.events.appendEvent]', () => {
  let app: FastifyInstance
  let pool: Pool

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_cancel_state')
    pool = new Pool({ connectionString: url })
    const runs = new CancellingFake(pool)
    runs.addRun({
      id: 'session-run-s-x',
      sessionId: 's-x',
      threadKey: 's-x',
      state: 'RUNNING',
      budgetUsedRatio: 0,
      contextUsedRatio: 0,
      updatedAt: new Date().toISOString(),
    } satisfies RunInfo)
    app = buildApp({ pool, runs })
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-x:created',
      partition: 'session:s-x',
      type: 't.session.created',
      payload: { sessionId: 's-x', title: 'Xray' },
    })
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('streams a CANCELLING state frame the moment cancel answers', async () => {
    const cancel = await app.inject({
      method: 'POST',
      url: '/v1/commands/cancel',
      payload: { runId: 'session-run-s-x' },
    })
    expect(cancel.statusCode).toBe(202)
    // Direct pool reads only: any HTTP read in between would project and
    // mask a route that forgot to.
    const frames = await readOutboxBacklog(pool, 's-x', 0)
    const states = frames.filter((frame) => frame.type === 'state')
    expect(states.map((frame) => (frame.payload as { status?: string }).status)).toContain('CANCELLING')
    expect((await getThread(pool, 's-x'))?.status).toBe('CANCELLING')
  })
})
