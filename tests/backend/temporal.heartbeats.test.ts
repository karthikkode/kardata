import { Client as WorkflowClient } from '@temporalio/client'
import { Context } from '@temporalio/activity'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { laneTimeouts } from '../../backend/src/temporal/timeouts.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { appendEventActivity } from '../../backend/src/temporal/activities/turn.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const RUN_WORKFLOWS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'backend',
  'src',
  'temporal',
  'workflows',
  'run.ts',
)

interface Attempt {
  attempt: number
  at: number
}

const attempts: Attempt[] = []

// When true the probe activity heartbeats continuously (cancel is delivered
// promptly and the attempt ends CANCELED); when false it beats twice then
// goes silent (the server must heartbeat-timeout it and redeliver).
let continuousBeats = false

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(100)
  }
}

describe('timeout table (B2.3) [F:backend.activity.turn.appendEventActivity] [F:backend.activity.turn.karbotTurnActivity] [F:backend.workflow.run.sessionRun] [F:backend.workflow.inbox_queue.normalizeQueueItem] [F:backend.workflow.inbox_queue.queueItemsQuery] [F:backend.workflow.inbox_queue.queueRemoveUpdate] [F:backend.workflow.inbox_queue.queueReorderUpdate] [F:backend.workflow.resumable_turn.resumableTurn] [F:backend.workflow.run.DEFAULT_IDLE_TIMEOUT_MS] [F:backend.workflow.run.cancelSignal] [F:backend.workflow.run.pauseSignal] [F:backend.workflow.run.resumeSignal] [F:backend.workflow.run.sendSignal] [F:backend.workflow.run.skillSignal] [F:backend.workflow.run.stateQuery] [F:backend.workflow.run.steerSignal] [F:backend.workflow.inbox_queue.registerQueueHandlers]', () => {
  it('every lane sets heartbeat, start-to-close, schedule-to-close, and retry', () => {
    for (const lane of ['turn', 'tool', 'research', 'sweep'] as const) {
      const timeouts = laneTimeouts(lane)
      expect(timeouts.heartbeatTimeout).toBeTruthy()
      expect(timeouts.startToCloseTimeout).toBeTruthy()
      expect(timeouts.scheduleToCloseTimeout).toBeTruthy()
      expect(timeouts.retry.maximumAttempts).toBeGreaterThan(1)
    }
    // Interactive lanes retry faster than batch lanes.
    expect(laneTimeouts('turn').heartbeatTimeout).not.toBe(laneTimeouts('research').heartbeatTimeout)
  })
})

describe.skipIf(!ENABLED || !TEST_DATABASE_URL)('heartbeat and cancellation policy (B2.3)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let run: Promise<void>
  let taskQueue = ''

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    url = await ensureTestDb('kardata_test_heartbeats')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    taskQueue = `kardata-test-hb-${Date.now()}`
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: RUN_WORKFLOWS_PATH,
      activities: {
        appendEventActivity,
        karbotTurnActivity: async () => {
          const attempt = Context.current().info.attempt
          attempts.push({ attempt, at: Date.now() })
          if (attempt === 1 && !continuousBeats) {
            // Crash signature: two beats, then silence. The silence ends
            // only on worker shutdown (cleanup), long after redelivery.
            Context.current().heartbeat('beat-1')
            await sleep(200)
            Context.current().heartbeat('beat-2')
            await Promise.race([new Promise<void>(() => undefined), Context.current().cancelled])
          } else if (continuousBeats) {
            for (;;) {
              Context.current().heartbeat({ attempt, at: Date.now() })
              await Promise.race([sleep(200), Context.current().cancelled])
            }
          }
          return { reply: 'recovered', toolCalls: [] as Array<{ name: string; detail: string; state: 'done' }> }
        },
      },
      taskQueue,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    await run
    await connection.close()
    delete process.env['DATABASE_URL']
  }, 60_000)

  it('a silent attempt retries on heartbeats, far inside start-to-close', async () => {
    attempts.length = 0
    const sessionId = `hb-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue,
      workflowId: `hb-retry-${Date.now()}`,
      args: [{ sessionId }],
    })
    await waitFor(async () => (await handle.query('runState') as { state: string }).state === 'RUNNING', 30_000, 'run')
    await handle.signal('runSend', 'stall me')

    // Attempt 2 (the redelivery) must start on heartbeat timeout, not at
    // start-to-close (15 m for the turn lane). The floor is already ~20 s
    // (20 s timeout past the last beat), so a real server with scheduling
    // slack needs headroom: 45 s still proves the heartbeat path while
    // staying far inside start-to-close.
    await waitFor(() => attempts.filter((attempt) => attempt.attempt >= 2).length >= 1, 90_000, 'redelivery')
    const first = attempts.find((attempt) => attempt.attempt === 1)
    const second = attempts.find((attempt) => attempt.attempt >= 2)
    if (!first || !second) throw new Error('missing attempts')
    const silenceStartedAt = first.at + 500
    expect(second.at - silenceStartedAt).toBeLessThan(45_000)

    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
  }, 120_000)

  it('cancel during the turn marks the attempt cancelled, never orphaned', async () => {
    attempts.length = 0
    continuousBeats = true
    const sessionId = `hbc-${Date.now()}`
    const workflowId = `hb-cancel-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue,
      workflowId,
      args: [{ sessionId }],
    })
    await waitFor(async () => (await handle.query('runState') as { state: string }).state === 'RUNNING', 30_000, 'run')
    await handle.signal('runSend', 'cancel me')
    await waitFor(() => attempts.length >= 1, 30_000, 'turn to start')
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')

    const history = await handle.fetchHistory()
    const canceled = (history.events ?? []).filter((event) => 'activityTaskCanceledEventAttributes' in event)
    expect(canceled.length).toBeGreaterThan(0)
  }, 120_000)
})
