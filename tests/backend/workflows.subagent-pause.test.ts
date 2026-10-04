// A16 subagent pause workflow: the inbox gate parks while paused and the
// mid-turn park keeps the checkpoint resumable. Live worker, stubbed
// turn/event activities, no database.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApplicationFailure, Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'turn-bundle.ts')

interface AppendedEvent { type: string; payload: Record<string, unknown> }

describe.skipIf(!ENABLED)('subagent pause workflow (A16)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let worker: Worker
  let run: Promise<void>
  const appended: AppendedEvent[] = []
  let turnCalls = 0
  let turnBehavior: () => Promise<{ reply: string }> = async () => ({ reply: 'TEST canned reply' })

  beforeAll(async () => {
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: {
        appendEventActivity: async (event: { type: string; payload: Record<string, unknown> }) => {
          appended.push({ type: event.type, payload: event.payload })
        },
        karbotTurnActivity: async () => {
          turnCalls += 1
          return turnBehavior()
        },
      },
      taskQueue: `kardata-test-subagent-pause-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    await run
    await connection.close()
  }, 60_000)

  async function waitFor(condition: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  function childInput(childId: string) {
    return {
      childId,
      goal: 'TEST goal',
      depth: 0,
      mode: 'empty' as const,
      maxDepth: 0,
      queueCapacity: 8,
      parentSessionId: 'TEST-parent',
      parentPartition: 'session:TEST-parent',
    }
  }

  async function startChild(childId: string) {
    turnBehavior = async () => ({ reply: 'TEST canned reply' })
    const before = appended.length
    const handle = await client.workflow.start('subagentRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: childId,
      args: [childInput(childId)],
    })
    await waitFor(() => appended.length > before && appended.slice(before).some((event) => event.type === 't.subagent.launched'), 'child launch')
    return handle
  }

  it('blocks the next inbox item while paused and continues on resume', async () => {
    const childId = `TEST-pause-gate-${Date.now()}`
    const callsBefore = turnCalls
    const handle = await startChild(childId)
    const mine = (event: AppendedEvent) => event.payload['threadKey'] === `agent:${childId}`
    await handle.signal('childMessage', 'job one')
    await waitFor(() => turnCalls === callsBefore + 1, 'first turn')
    await waitFor(() => appended.some((event) => mine(event) && event.type === 't.message.appended' && (event.payload['message'] as { role?: string })?.role === 'agent'), 'first reply')

    await handle.signal('childPause')
    await handle.signal('childMessage', 'job two')
    await waitFor(() => appended.some((event) => mine(event) && event.type === 't.thread.state' && event.payload['status'] === 'PAUSED'), 'paused state')
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(turnCalls).toBe(callsBefore + 1)

    await handle.signal('childResume')
    await waitFor(() => turnCalls === callsBefore + 2, 'resumed turn')
    await waitFor(() => appended.some((event) => mine(event) && event.type === 't.thread.state' && event.payload['status'] === 'RUNNING'), 'running state')
    await handle.signal('childFinish')
    expect(await handle.result()).toBe('finished')
  }, 120_000)

  it('parks a mid-turn pause at the boundary and retries from the checkpoint', async () => {
    const childId = `TEST-pause-midturn-${Date.now()}`
    const callsBefore = turnCalls
    const handle = await startChild(childId)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let attempts = 0
    turnBehavior = async () => {
      attempts += 1
      if (attempts === 1) {
        await gate
        throw ApplicationFailure.nonRetryable('Research paused at a safe provider boundary.', 'ResearchPaused')
      }
      return { reply: 'TEST resumed reply' }
    }
    const mine = (event: AppendedEvent) => event.payload['threadKey'] === `agent:${childId}`
    await handle.signal('childMessage', 'long job')
    await waitFor(() => turnCalls === callsBefore + 1, 'turn attempt starts')
    await handle.signal('childPause')
    release()
    await waitFor(() => appended.some((event) => mine(event) && event.type === 't.thread.state' && event.payload['status'] === 'PAUSED'), 'parked state')
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(turnCalls).toBe(callsBefore + 1)
    expect(attempts).toBe(1)

    await handle.signal('childResume')
    await waitFor(() => turnCalls === callsBefore + 2, 'turn retry')
    await waitFor(() => appended.some((event) => mine(event) && event.type === 't.message.appended' && (event.payload['message'] as { text?: string })?.text === 'TEST resumed reply'), 'resumed reply')
    await handle.signal('childFinish')
    expect(await handle.result()).toBe('finished')
  }, 120_000)
})
