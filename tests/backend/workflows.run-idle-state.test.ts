// Owner pause/resume of an idle session thread (F6a/R0-10). The loop-top
// pause gate used to wait silently: no t.thread.state, so the projected
// thread status (what the UI binds) never flipped on pause or resume.
// Gated by KARDATA_TEMPORAL_TEST=1 like the other workflow suites.
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker as WorkerType } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getThread, readPartition } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { ensureTestDb } from './db-helper.js'

describe.skipIf(process.env['KARDATA_TEMPORAL_TEST'] !== '1')('sessionRun idle pause/resume emits thread state (F6a) [F:backend.workflow.run.sessionRun] [F:db.threads.getThread]', () => {
  const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
  const WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'turn-bundle.ts')
  let connection: NativeConnection
  let client: WorkflowClient
  let pool: Pool
  let url = ''

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_run_idlestate')
    process.env['DATABASE_URL'] = url
    pool = new Pool({ connectionString: url })
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
    await connection.close()
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_PROVIDER']
  }, 60_000)

  async function startWorker(taskQueue: string): Promise<{ worker: WorkerType; run: Promise<void> }> {
    const worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { appendEventActivity, karbotTurnActivity },
      taskQueue,
    })
    const run = worker.run()
    run.catch(() => undefined)
    return { worker, run }
  }

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

  async function stateEvents(partition: string): Promise<string[]> {
    const rows = await readPartition(pool, partition)
    return rows
      .filter((row) => row.type === 't.thread.state')
      .map((row) => (row.payload as { status?: string } | undefined)?.status ?? '')
  }

  it('pause then resume of an idle thread flips the projected status', async () => {
    const tag = randomUUID()
    const sessionId = `idlestate-${tag}`
    const workflowId = `idlestate-run-${tag}`
    const partition = `session:${sessionId}`
    const taskQueue = `kardata-test-idlestate-${Date.now()}`
    const fresh = () => client.workflow.getHandle(workflowId)
    const handle = await client.workflow.start('sessionRun', {
      taskQueue,
      workflowId,
      args: [{ sessionId }],
    })
    const { worker, run } = await startWorker(taskQueue)
    try {
      await waitFor(async () => ((await fresh().query('runState')) as { state: string }).state === 'RUNNING', 30_000, 'run to reach RUNNING')
      // Idle: no inbox, no live turn. Pause must still move the UI's status.
      await handle.signal('runPause')
      await waitFor(async () => (await stateEvents(partition)).includes('PAUSED'), 30_000, 'PAUSED state event')
      await projectNewEvents(pool)
      expect((await getThread(pool, sessionId))?.status).toBe('PAUSED')
      await handle.signal('runResume')
      await waitFor(async () => (await stateEvents(partition)).includes('RUNNING'), 30_000, 'RUNNING state event')
      await projectNewEvents(pool)
      expect((await getThread(pool, sessionId))?.status).toBe('RUNNING')
      await fresh().signal('runCancel')
    } finally {
      worker.shutdown()
      await run
    }
  }, 180_000)
})
