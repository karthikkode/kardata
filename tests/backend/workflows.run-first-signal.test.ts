// Pre-entry state signals for sessionRun (B2a). Pause/cancel/resume that
// dispatch in a run's first workflow task arrive while the box is still
// IDLE; their RUNNING/PAUSED guards used to drop them and the run
// proceeded. Signals queue server-side, so starting the worker after
// signalling pins them into the first task deterministically. Gated by
// KARDATA_TEMPORAL_TEST=1 like the other workflow suites.
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker as WorkerType } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPartition } from '../../backend/src/db/index.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { ensureTestDb } from './db-helper.js'

describe.skipIf(process.env['KARDATA_TEMPORAL_TEST'] !== '1')('sessionRun pre-entry signals (B2a) [F:backend.workflow.run.sessionRun] [F:backend.workflow.run.pauseSignal] [F:backend.workflow.run.cancelSignal] [F:backend.workflow.run.sendSignal] [F:backend.workflow.run.resumeSignal] [F:backend.workflow.run.stateQuery]', () => {
  const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
  const WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'turn-bundle.ts')
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_run_firstsignal')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
  }, 120_000)

  afterAll(async () => {
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

  async function agentReplies(partition: string): Promise<number> {
    const pool = new Pool({ connectionString: url })
    try {
      const rows = await readPartition(pool, partition)
      return rows.filter((row) => row.type === 't.message.appended' && (row.payload as { message?: { role?: string } } | undefined)?.message?.role === 'agent').length
    } finally {
      await pool.end()
    }
  }

  it('holds a pause that lands before entry', async () => {
    const tag = randomUUID()
    const sessionId = `firstsignal-${tag}`
    const workflowId = `firstsignal-run-${tag}`
    const partition = `session:${sessionId}`
    const taskQueue = `kardata-test-firstsignal-${Date.now()}`
    const fresh = () => client.workflow.getHandle(workflowId)
    const handle = await client.workflow.start('sessionRun', {
      taskQueue,
      workflowId,
      args: [{ sessionId, fakeSteps: [{ text: 'firstsignal reply' }] }],
    })
    // No worker polls yet: both signals dispatch in the first task.
    await handle.signal('runPause')
    await handle.signal('runSend', 'hello')
    const { worker, run } = await startWorker(taskQueue)
    try {
      await waitFor(async () => ((await fresh().query('runState')) as { state: string }).state === 'PAUSED', 30_000, 'pre-entry pause to hold')
      const state = (await fresh().query('runState')) as { state: string; pending: number }
      expect(state.pending).toBe(1)
      // Parked ahead of the shift: no turn ever started.
      expect(await agentReplies(partition)).toBe(0)
      await fresh().signal('runResume')
      await waitFor(async () => (await agentReplies(partition)) === 1, 60_000, 'queued message after resume')
      await fresh().signal('runCancel')
    } finally {
      worker.shutdown()
      await run
    }
  }, 120_000)

  it('closes on a cancel that lands before entry', async () => {
    const tag = randomUUID()
    const sessionId = `firstsignal-cancel-${tag}`
    const workflowId = `firstsignal-cancel-run-${tag}`
    const taskQueue = `kardata-test-firstsignal-cancel-${Date.now()}`
    const fresh = () => client.workflow.getHandle(workflowId)
    const handle = await client.workflow.start('sessionRun', {
      taskQueue,
      workflowId,
      args: [{ sessionId, fakeSteps: [{ text: 'firstsignal reply' }] }],
    })
    await handle.signal('runCancel')
    const { worker, run } = await startWorker(taskQueue)
    try {
      await waitFor(
        async () => ['CANCELLING', 'FINISHED'].includes(((await fresh().query('runState')) as { state: string }).state),
        30_000,
        'pre-entry cancel to close',
      )
      expect(await handle.result()).toBe('cancelled')
    } finally {
      worker.shutdown()
      await run
    }
  }, 120_000)
})
