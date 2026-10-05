// A17 queue view and edit: waiting inbox items list with stable ids and
// survive remove/reorder; the running item is never listed. Live worker,
// stubbed turn/event activities, no database.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@temporalio/activity'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'turn-bundle.ts')

interface QueueItem { id: string; text: string; queuedAt: number }

describe.skipIf(!ENABLED)('inbox queue view and edit (A17)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let worker: Worker
  let run: Promise<void>
  let taskQueue = ''
  const turnTexts: string[] = []
  let turnReleased = true
  let gateTurn = false

  beforeAll(async () => {
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    taskQueue = `kardata-test-inbox-queue-${Date.now()}`
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: {
        appendEventActivity: async () => undefined,
        karbotTurnActivity: async (input: { text: string }) => {
          turnTexts.push(input.text)
          // The turn lane heartbeats every 20 s: a gagged stub that never
          // beats times out and retries, so the gate beats at the 5 s
          // production cadence while it holds the turn open.
          if (gateTurn) {
            const started = Date.now()
            while (!turnReleased && Date.now() - started < 120_000) {
              Context.current().heartbeat()
              await new Promise((resolve) => setTimeout(resolve, 5000))
            }
          }
          // Full outcome shape: the session loop iterates
          // outcome.toolCalls and ends the run on any turn error.
          return { reply: `TEST reply to ${input.text}`, toolCalls: [] }
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
  }, 60_000)

  async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  async function queueOf(handle: { query: (name: string) => Promise<QueueItem[]> }): Promise<QueueItem[]> {
    return handle.query('queueItems')
  }

  it('lists, removes and reorders a session queue; order follows', async () => {
    gateTurn = true
    turnReleased = false
    const seen = turnTexts.length
    const handle = await client.workflow.start('sessionRun', {
      taskQueue,
      workflowId: `TEST-queue-session-${Date.now()}`,
      args: [{ sessionId: 'TEST-queue-session', idleTimeoutMs: 600_000 }],
    })
    try {
      await handle.signal('runSend', 'ONE')
      await waitFor(() => turnTexts.length >= seen + 1, 'first turn starts')
      await handle.signal('runSend', 'TWO')
      await handle.signal('runSend', 'THREE')
      await waitFor(async () => (await queueOf(handle)).length === 2, 'two queued')
      let items = await queueOf(handle)
      expect(items.map((item) => item.text)).toEqual(['TWO', 'THREE'])
      for (const item of items) {
        expect(typeof item.id).toBe('string')
        expect(item.id.length).toBeGreaterThan(0)
        expect(typeof item.queuedAt).toBe('number')
      }
      expect(items[0]?.queuedAt ?? 0).toBeLessThanOrEqual(items[1]?.queuedAt ?? 0)

      const reordered = await handle.executeUpdate('queueReorder', { args: [[items[1]?.id, items[0]?.id]] })
      expect(reordered).toBe(true)
      items = await queueOf(handle)
      expect(items.map((item) => item.text)).toEqual(['THREE', 'TWO'])

      const removed = await handle.executeUpdate('queueRemove', { args: [items[1]?.id] })
      expect(removed).toBe(true)
      expect(await handle.executeUpdate('queueRemove', { args: ['no-such-id'] })).toBe(false)
      await expect(handle.executeUpdate('queueReorder', { args: [['bogus']] })).rejects.toThrow()
      items = await queueOf(handle)
      expect(items.map((item) => item.text)).toEqual(['THREE'])

      turnReleased = true
      // >= : after release the stub answers instantly, so the last turns
      // can all land between two 200 ms polls and === would miss them.
      await waitFor(() => turnTexts.length >= seen + 2, 'next turn starts')
      expect(turnTexts[seen + 1]).toBe('THREE')
    } finally {
      gateTurn = false
      turnReleased = true
      await handle.terminate().catch(() => undefined)
    }
  }, 120_000)

  it('lists, removes and reorders a subagent queue', async () => {
    gateTurn = true
    turnReleased = false
    const seen = turnTexts.length
    const childId = `TEST-queue-child-${Date.now()}`
    const handle = await client.workflow.start('subagentRun', {
      taskQueue,
      workflowId: childId,
      args: [{ childId, goal: 'TEST goal', depth: 0, mode: 'empty', maxDepth: 0, queueCapacity: 8, parentSessionId: 'TEST-parent', parentPartition: 'session:TEST-parent' }],
    })
    try {
      await handle.signal('childMessage', 'ONE')
      await waitFor(() => turnTexts.length >= seen + 1, 'first turn starts')
      await handle.signal('childMessage', 'TWO')
      await handle.signal('childMessage', 'THREE')
      await waitFor(async () => (await queueOf(handle)).length === 2, 'two queued')
      const items = await queueOf(handle)
      expect(items.map((item) => item.text)).toEqual(['TWO', 'THREE'])

      expect(await handle.executeUpdate('queueReorder', { args: [[items[1]?.id, items[0]?.id]] })).toBe(true)
      expect((await queueOf(handle)).map((item) => item.text)).toEqual(['THREE', 'TWO'])
      await expect(handle.executeUpdate('queueReorder', { args: [[items[0]?.id]] })).rejects.toThrow()

      turnReleased = true
      await waitFor(() => turnTexts.length >= seen + 3, 'queued turns drain')
      expect(turnTexts[seen + 1]).toBe('THREE')
      expect(turnTexts[seen + 2]).toBe('TWO')
      await handle.signal('childFinish')
      expect(await handle.result()).toBe('finished')
    } finally {
      gateTurn = false
      turnReleased = true
      // A failed test must not orphan a running child: terminate it.
      await handle.terminate().catch(() => undefined)
    }
  }, 120_000)
})
