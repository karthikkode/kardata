// Queued-child run commands over HTTP (pilot item 3). A QUEUED child has
// no workflow yet, so the run check cannot require a described run: the
// routes must accept queued (and paused-queued) children by their thread
// row and let the gateway drive them through the live parent. Steer
// already rode the thread path; pause/resume/cancel 404'd. Uses the REAL
// gateway + a live delegation parent: no fakes between inject and
// Temporal. Gated by KARDATA_TEMPORAL_TEST=1 with TEST_DATABASE_URL.
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, getThread, readPartition } from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import { ensureTestDb } from './db-helper.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const WORKFLOWS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'backend',
  'src',
  'temporal',
  'workflows',
  'subagents.ts',
)

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(200)
  }
}

describe.skipIf(!ENABLED)(
  'queued run commands over HTTP [F:http.pauseRun] [F:http.resumeRun] [F:http.cancelRun] [F:http.steerThread] [F:backend.workflow.subagents.delegateParent]',
  () => {
    let connection: NativeConnection
    let client: WorkflowClient
    let pool: Pool
    let app: FastifyInstance
    let worker: Worker
    let run: Promise<void>

    beforeAll(async () => {
      process.env['TEMPORAL_ADDRESS'] = ADDRESS
      process.env['KARDATA_PROVIDER'] = 'fake'
      const url = await ensureTestDb('kardata_test_queued_routes')
      process.env['DATABASE_URL'] = url
      pool = new Pool({ connectionString: url })
      connection = await connectWorker()
      client = new WorkflowClient({ connection: await connectClient() })
      worker = await createLaneWorker({
        lane: 'turn',
        connection,
        namespace: temporalNamespace(),
        workflowsPath: WORKFLOWS_PATH,
        activities: { appendEventActivity, karbotTurnActivity },
        taskQueue: `kardata-test-queued-routes-${Date.now()}`,
      })
      run = worker.run()
      run.catch(() => undefined)
      app = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
    }, 120_000)

    afterAll(async () => {
      await app.close()
      await pool.end()
      worker.shutdown()
      await run
      await connection.close()
      delete process.env['DATABASE_URL']
      delete process.env['KARDATA_PROVIDER']
    }, 60_000)

    function taskQueue(): string {
      return (worker.options as { taskQueue: string }).taskQueue
    }

    async function events(partition: string): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
      const rows = await readPartition(pool, partition)
      return rows.map((row) => ({ type: row.type, payload: row.payload as Record<string, unknown> }))
    }

    /** One parent with a single slot: the first delegate runs, the rest
     * queue. Returns the session plus the queued child id. */
    async function parentWithQueuedChild(tag: string): Promise<{ sessionId: string; queuedChildId: string }> {
      const sessionId = `q-route-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
      const handle = await client.workflow.start('delegateParent', {
        taskQueue: taskQueue(),
        workflowId: `delegation-${sessionId}`,
        args: [{ sessionId, maxInFlight: 1 }],
      })
      await waitFor(
        async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.session.created'),
        30_000,
        'parent to start',
      )
      const runningChildId = `q-route-run-${tag}-${Date.now()}`
      const queuedChildId = `q-route-queued-${tag}-${Date.now()}`
      for (const childId of [runningChildId, queuedChildId]) {
        await handle.signal('parentDelegate', {
          childId,
          goal: `TEST queued route goal ${childId}`,
          depth: 1,
          mode: 'empty',
          maxDepth: 1,
          queueCapacity: 8,
          fakeSteps: [{ text: 'queued route reply' }],
        })
      }
      await waitFor(
        async () =>
          (await events(`session:${sessionId}`)).some(
            (event) => event.type === 't.subagent.queued' && event.payload['childId'] === queuedChildId,
          ),
        60_000,
        'child to queue',
      )
      return { sessionId, queuedChildId }
    }

    async function parentState(sessionId: string): Promise<{ queued?: string[]; pausedQueued?: string[] }> {
      return (await client.workflow.getHandle(`delegation-${sessionId}`).query('parentState')) as {
        queued?: string[]
        pausedQueued?: string[]
      }
    }

    it('pauses a queued child by run id', async () => {
      const { sessionId, queuedChildId } = await parentWithQueuedChild('pause')
      const pause = await app.inject({
        method: 'POST',
        url: '/v1/commands/pause',
        payload: { runId: queuedChildId },
      })
      expect(pause.statusCode).toBe(202)
      await waitFor(
        async () => ((await parentState(sessionId)).pausedQueued ?? []).includes(queuedChildId),
        30_000,
        'parent to park the queued child',
      )
      expect((await getThread(pool, `agent:${queuedChildId}`))?.status).toBe('PAUSED')
    }, 120_000)

    it('resumes a paused-queued child by run id', async () => {
      const { sessionId, queuedChildId } = await parentWithQueuedChild('resume')
      expect((await app.inject({ method: 'POST', url: '/v1/commands/pause', payload: { runId: queuedChildId } })).statusCode).toBe(202)
      const resume = await app.inject({
        method: 'POST',
        url: '/v1/commands/resume',
        payload: { runId: queuedChildId },
      })
      expect(resume.statusCode).toBe(202)
      await waitFor(
        async () => !((await parentState(sessionId)).pausedQueued ?? []).includes(queuedChildId),
        30_000,
        'parent to release the queued child',
      )
      expect((await getThread(pool, `agent:${queuedChildId}`))?.status).toBe('QUEUED')
    }, 120_000)

    it('cancels a queued child by run id without starting it', async () => {
      const { sessionId, queuedChildId } = await parentWithQueuedChild('cancel')
      const cancel = await app.inject({
        method: 'POST',
        url: '/v1/commands/cancel',
        payload: { runId: queuedChildId },
      })
      expect(cancel.statusCode).toBe(202)
      await waitFor(
        async () =>
          (await events(`session:${sessionId}`)).some(
            (event) =>
              event.type === 't.subagent.completed' &&
              ((event.payload['summary'] as Record<string, unknown> | undefined)?.['id'] === queuedChildId),
          ),
        30_000,
        'queued child to complete cancelled',
      )
      expect((await getThread(pool, `agent:${queuedChildId}`))?.status).toBe('FINISHED')
      // Never launched: no launch record for the cancelled waiter.
      expect(
        (await events(`session:${sessionId}`)).some(
          (event) => event.type === 't.subagent.launched' && event.payload['childId'] === queuedChildId,
        ),
      ).toBe(false)
    }, 120_000)

    it('steers a queued child as pending instead of missed', async () => {
      const { queuedChildId } = await parentWithQueuedChild('steer')
      const steer = await app.inject({
        method: 'POST',
        url: '/v1/commands/steer',
        payload: { threadKey: `agent:${queuedChildId}`, text: 'Prefer primary sources' },
      })
      expect(steer.statusCode).toBe(202)
      expect((steer.json() as { data: { state: string } }).data.state).toBe('accepted')
    }, 120_000)

    it('still 404s unknown and finished run ids', async () => {
      const missing = await app.inject({
        method: 'POST',
        url: '/v1/commands/pause',
        payload: { runId: 'child-never-existed' },
      })
      expect(missing.statusCode).toBe(404)
      // A finished child has a thread row but no live queue slot: the
      // queued fallback must not accept it.
      await appendEvent(pool, {
        idempotencyKey: 'seed:q-finished:created',
        partition: 'session:s-q-finished',
        type: 't.session.created',
        payload: { sessionId: 's-q-finished', title: 'Finished' },
      })
      await appendEvent(pool, {
        idempotencyKey: 'seed:q-finished:launched',
        partition: 'session:s-q-finished',
        type: 't.subagent.launched',
        payload: {
          childId: 'q-finished-c1',
          parentSessionId: 's-q-finished',
          parentWorkflowId: 'parent-wf',
          depth: 1,
          mode: 'empty',
          goal: 'done',
          queueCapacity: 8,
          canDelegate: false,
        },
      })
      await appendEvent(pool, {
        idempotencyKey: 'seed:q-finished:completed',
        partition: 'session:s-q-finished',
        type: 't.subagent.completed',
        payload: { summary: { id: 'q-finished-c1', status: 'finished' } },
      })
      const finished = await app.inject({
        method: 'POST',
        url: '/v1/commands/pause',
        payload: { runId: 'q-finished-c1' },
      })
      expect(finished.statusCode).toBe(404)
    }, 120_000)
  },
)
