import { Client as WorkflowClient } from '@temporalio/client'
import { ApplicationFailure } from '@temporalio/activity'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPartition } from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import { getThread, rebuildFromEvents } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
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

async function queryState(handle: { query: (name: string) => Promise<unknown> }): Promise<string> {
  const state = (await handle.query('runState')) as { state: string }
  return state.state
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(200)
  }
}

describe.skipIf(!ENABLED)('session-run workflow (B2.2)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let run: Promise<void>
  const blocked = new Set<string>()

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    // Karbot turns resolve the fake provider with workflow-supplied steps;
    // no keys, no network.
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_workflows')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { karbotTurnActivity: async (input: Parameters<typeof karbotTurnActivity>[0]) => {
        if (['context-blocked-turn','operation-blocked-turn'].includes(input.text) && !blocked.has(input.sessionId)) {
          blocked.add(input.sessionId)
          throw ApplicationFailure.nonRetryable('Original operation was preserved.', input.text === 'operation-blocked-turn' ? 'OperationBlocked' : 'ContextBlocked')
        }
        return karbotTurnActivity(input)
      }, appendEventActivity },
      taskQueue: `kardata-test-run-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    await run
    await connection.close()
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_PROVIDER']
  }, 60_000)

  function db(): Pool {
    return new Pool({ connectionString: url })
  }

  it.each(['context-blocked-turn','operation-blocked-turn'])('parks %s and resumes the original turn without repeating its user message', async (request) => {
    const sessionId = `${request}-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', { taskQueue: (worker.options as { taskQueue: string }).taskQueue, workflowId: `session-run-${sessionId}`, args: [{ sessionId, fakeSteps: [{ text: 'Recovered answer' }] }] })
    try {
      await handle.signal('runSend', request)
      await waitFor(async () => await queryState(handle) === 'PAUSED', 30000, 'context pause')
      const pool = db()
      try {
        await projectNewEvents(pool)
        expect((await getThread(pool, sessionId))?.status).toBe('PAUSED')
      } finally { await pool.end() }
      await handle.signal('runResume')
      await waitFor(async () => (await texts(sessionId)).includes('Recovered answer'), 30000, 'context recovery')
      expect((await texts(sessionId)).filter((text) => text === request)).toHaveLength(1)
    } finally { await handle.signal('runCancel'); await handle.result() }
  }, 90000)

  async function texts(sessionId: string): Promise<string[]> {
    const pool = db()
    try {
      const events = await readPartition(pool, `session:${sessionId}`)
      return events
        .filter((event) => event.type === 't.message.appended')
        .map((event) => (event.payload as { message: { text?: string } }).message.text ?? '')
    } finally {
      await pool.end()
    }
  }

  async function outboxMessageTexts(sessionId: string): Promise<string[]> {
    const pool = db()
    try {
      const rows = await pool.query<{ type: string; payload: unknown }>(
        'SELECT type, payload FROM outbox WHERE thread_key = $1 ORDER BY seq',
        [sessionId],
      )
      const texts: string[] = []
      for (const row of rows.rows) {
        if (row.type !== 'message' || typeof row.payload !== 'object' || row.payload === null) continue
        const message = (row.payload as { message?: { text?: unknown } }).message
        if (message && typeof message.text === 'string') texts.push(message.text)
      }
      return texts
    } finally {
      await pool.end()
    }
  }

  it('runs turns, pauses and resumes, then cancels mid-tool without orphans', async () => {
    const sessionId = `run-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [
        {
          sessionId,
          fakeSteps: [{ text: 'fake hello' }],
        },
      ],
    })
    await waitFor(async () => await queryState(handle) === 'RUNNING', 30_000, 'run to start')

    await handle.signal('runSend', 'hello')
    await waitFor(
      async () => (await texts(sessionId)).some((text) => text === 'fake hello'),
      30_000,
      'first reply',
    )

    await handle.signal('runPause')
    await waitFor(async () => await queryState(handle) === 'PAUSED', 15_000, 'pause')
    await handle.signal('runSend', 'queued-while-paused')
    await sleep(4_000)
    // Paused: the turn never ran, so no reply exists yet.
    expect(await texts(sessionId)).not.toContain('queued-while-paused')

    await handle.signal('runResume')
    await waitFor(async () => await queryState(handle) === 'RUNNING', 15_000, 'resume')
    await waitFor(
      async () => (await texts(sessionId)).filter((text) => text === 'fake hello').length === 2,
      30_000,
      'resumed reply',
    )
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')

    // A separate delayed first turn gives cancellation a real activity
    // window. The user's request is recorded before execution, while no
    // cancelled provider reply is allowed to appear afterward.
    const cancelId = `cancel-${Date.now()}`
    const cancelling = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${cancelId}`,
      args: [{ sessionId: cancelId, fakeSteps: [{ text: 'doomed reply', delayMs: 15_000 }] }],
    })
    await waitFor(async () => await queryState(cancelling) === 'RUNNING', 30_000, 'cancel run to start')
    await cancelling.signal('runSend', 'doomed-turn')
    await waitFor(async () => (await texts(cancelId)).includes('doomed-turn'), 15_000, 'user message before turn')
    await sleep(1_000)
    await cancelling.signal('runCancel')
    expect(await cancelling.result()).toBe('cancelled')
    expect(await queryState(cancelling)).toBe('FINISHED')
    const final = await texts(cancelId)
    expect(final).toContain('run cancelled')
    expect(final).toContain('doomed-turn')
    expect(final).not.toContain('doomed reply')
  }, 120_000)

  it('an idle run with an empty inbox closes itself instead of persisting', async () => {
    const sessionId = `idle-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [{ sessionId, idleTimeoutMs: 3_000 }],
    })
    await waitFor(async () => await queryState(handle) === 'RUNNING', 30_000, 'run to start')
    // No send, steer, or state change: the idle timer owns the close.
    expect(await handle.result()).toBe('idle-timeout')
    expect(await queryState(handle)).toBe('FINISHED')
    const finished = (await texts(sessionId)).filter((text) => text === 'run closed after idle timeout')
    expect(finished).toHaveLength(1)
  }, 120_000)

  it('a replacement run appends fresh messages instead of replaying old keys', async () => {
    const sessionId = `rerun-${Date.now()}`
    const taskQueue = (worker.options as { taskQueue: string }).taskQueue
    const first = await client.workflow.start('sessionRun', {
      taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [{ sessionId, fakeSteps: [{ text: 'first reply' }] }],
    })
    await waitFor(async () => await queryState(first) === 'RUNNING', 30_000, 'first run to start')
    await first.signal('runSend', 'first')
    await waitFor(
      async () => (await texts(sessionId)).some((text) => text === 'first reply'),
      30_000,
      'first reply',
    )
    // Close the run; the next send starts a replacement run under the same
    // workflow id with the nonce restarted at zero.
    await first.signal('runCancel')
    expect(await first.result()).toBe('cancelled')

    const second = await client.workflow.signalWithStart('sessionRun', {
      taskQueue,
      workflowId: `session-run-${sessionId}`,
      signal: 'runSend',
      signalArgs: ['second'],
      args: [{ sessionId, fakeSteps: [{ text: 'second reply' }] }],
    })
    await waitFor(
      async () => (await texts(sessionId)).some((text) => text === 'second reply'),
      30_000,
      'second reply',
    )
    const all = await texts(sessionId)
    expect(all).toContain('first reply')
    expect(all).toContain('second reply')
    await second.signal('runCancel')
    expect(await second.result()).toBe('cancelled')
  }, 120_000)

  it('appends tools between the user message and the reply', async () => {
    const sessionId = `order-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [
        {
          sessionId,
          fakeSteps: [
            {
              text: 'tool round',
              toolCalls: [{ id: 'call-1', name: 'domain.scan', args: {} }],
            },
            { text: 'ordered reply' },
          ],
        },
      ],
    })
    await waitFor(async () => await queryState(handle) === 'RUNNING', 30_000, 'run to start')
    await handle.signal('runSend', 'ordered hello')
    await waitFor(
      async () => (await texts(sessionId)).some((text) => text === 'ordered reply'),
      30_000,
      'reply',
    )
    const pool = db()
    try {
      const events = await readPartition(pool, `session:${sessionId}`)
      const appended = events.filter((event) => event.type === 't.message.appended')
      const shape = appended.map((event) => {
        const message = (event.payload as { kind?: string; message?: { text?: string; name?: string } })
        if (message.kind === 'tool') return `tool:${message.message?.name ?? ''}`
        return `text:${message.message?.text ?? ''}`
      })
      expect(shape).toEqual(['text:ordered hello', 'tool:domain.scan', 'text:ordered reply'])
    } finally {
      await pool.end()
    }
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
  }, 120_000)

  it('publishes terminal message frames without waiting for a read', async () => {
    const sessionId = `live-frames-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [{ sessionId, fakeSteps: [{ text: 'live reply' }] }],
    })
    await waitFor(async () => await queryState(handle) === 'RUNNING', 30_000, 'run to start')
    await handle.signal('runSend', 'hello')
    await waitFor(
      async () => (await texts(sessionId)).some((text) => text === 'live reply'),
      30_000,
      'reply in events',
    )
    // No listMessages, no stream open, no further send: the terminal
    // frame must still reach the outbox the live tail reads, or the UI
    // wedges on Replying with the reply sitting invisible in events.
    await waitFor(
      async () =>
        (await outboxMessageTexts(sessionId)).some((text) => text === 'live reply'),
      30_000,
      'reply frame in outbox',
    )
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
  }, 120_000)

  it('replays the run from events alone', async () => {
    const sessionId = `replay-${Date.now()}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `session-run-${sessionId}`,
      args: [{ sessionId, fakeSteps: [{ text: 'fake replay' }] }],
    })
    await waitFor(async () => await queryState(handle) === 'RUNNING', 30_000, 'run to start')
    await handle.signal('runSend', 'replay me')
    await waitFor(
      async () => (await texts(sessionId)).some((text) => text === 'fake replay'),
      30_000,
      'reply',
    )
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')

    const pool = db()
    try {
      const events = await readPartition(pool, `session:${sessionId}`)
      expect(events.length).toBeGreaterThan(0)
      // Sanctioned projector, not a raw batch: the live run already
      // projected these events when it appended them, and only the
      // checkpointed path applies each event exactly once. A raw
      // projectBatch here would apply them a second time and duplicate
      // every row.
      await projectNewEvents(pool)
      const before = await getThread(pool, sessionId)
      await rebuildFromEvents(pool, events)
      expect(await getThread(pool, sessionId)).toEqual(before)
    } finally {
      await pool.end()
    }
  }, 120_000)
})
