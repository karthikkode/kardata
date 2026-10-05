// Live API proof (B3.1). The app runs via inject with the REAL Temporal runs
// gateway against a live sessionRun workflow: commands sent over HTTP land
// in the workflow, and run reads reflect workflow state. Gated by
// KARDATA_TEMPORAL_TEST=1 with the compose stack up.
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../../backend/src/app.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
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
  'run.ts',
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

describe.skipIf(!ENABLED)('live API over Temporal (B3.1) [F:http.sendMessage] [F:http.listMessages] [F:http.getRun] [F:http.pauseRun]', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let pool: Pool
  let app: FastifyInstance
  let worker: Worker
  let run: Promise<void>

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    // Karbot turns resolve the fake provider with workflow-supplied steps;
    // no keys, no network.
    process.env['KARDATA_PROVIDER'] = 'fake'
    const url = await ensureTestDb('kardata_test_api_live')
    process.env['DATABASE_URL'] = url
    pool = new Pool({ connectionString: url })
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { karbotTurnActivity, appendEventActivity },
      taskQueue: `kardata-test-api-live-${Date.now()}`,
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

  it('HTTP send flows into the live run and reads reflect it', async () => {
    const sessionId = `live-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [{ sessionId, fakeSteps: [{ text: 'fake live hello' }] }],
    })
    await waitFor(
      async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING',
      30_000,
      'run to start',
    )

    const send = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      payload: { threadKey: sessionId, text: 'live hello' },
    })
    expect(send.statusCode).toBe(202)

    await waitFor(
      async () => {
        const response = await app.inject({ method: 'GET', url: `/v1/threads/${sessionId}/messages` })
        const body = response.json() as { data: Array<{ text?: string }> }
        return body.data.some((message) => message.text === 'fake live hello')
      },
      30_000,
      'live reply over HTTP',
    )

    const run = await app.inject({ method: 'GET', url: `/v1/runs/session-run-${sessionId}` })
    expect(run.statusCode).toBe(200)
    expect((run.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: `session-run-${sessionId}`,
      sessionId,
      state: 'RUNNING',
    })

    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
  }, 120_000)

  it('HTTP pause flips the live run state', async () => {
    const sessionId = `livepause-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [{ sessionId }],
    })
    await waitFor(
      async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING',
      30_000,
      'run to start',
    )

    const pause = await app.inject({
      method: 'POST',
      url: '/v1/commands/pause',
      payload: { runId: `session-run-${sessionId}` },
    })
    expect(pause.statusCode).toBe(202)
    await waitFor(
      async () => {
        const response = await app.inject({ method: 'GET', url: `/v1/runs/session-run-${sessionId}` })
        return ((response.json() as { data: { state: string } }).data.state as string) === 'PAUSED'
      },
      15_000,
      'paused over HTTP',
    )

    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
  }, 120_000)
})
