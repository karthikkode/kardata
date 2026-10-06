// Queued-child controls at the workflow level (C6/2). With one slot in
// flight, extra delegations wait on the durable queue: pause parks them
// past promotion, resume releases them, cancel completes them as
// cancelled without ever starting them. Gated by KARDATA_TEMPORAL_TEST=1
// like the sibling workflow suites; without the flag every test skips.
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPartition } from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
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

interface ParentState {
  children: Array<{ childId: string }>
  queued?: string[]
  pausedQueued?: string[]
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

describe.skipIf(!ENABLED)(
  'queued child controls (C6/2) [F:backend.workflow.subagents.delegateParent] [F:backend.workflow.subagents.parentStateQuery] [F:backend.activity.turn.appendEventActivity] [F:backend.workflow.child_controls.applyChildControl] [F:backend.workflow.child_controls.parentChildControlSignal] [F:backend.workflow.child_controls.shiftUnpaused]',
  () => {
    let connection: NativeConnection
    let client: WorkflowClient
    let url = ''
    let worker: Worker
    let run: Promise<void>

    beforeAll(async () => {
      process.env['TEMPORAL_ADDRESS'] = ADDRESS
      process.env['KARDATA_PROVIDER'] = 'fake'
      url = await ensureTestDb('kardata_test_queued_workflows')
      process.env['DATABASE_URL'] = url
      connection = await connectWorker()
      client = new WorkflowClient({ connection: await connectClient() })
      worker = await createLaneWorker({
        lane: 'turn',
        connection,
        namespace: temporalNamespace(),
        workflowsPath: WORKFLOWS_PATH,
        activities: { appendEventActivity, karbotTurnActivity },
        taskQueue: `kardata-test-queued-controls-${Date.now()}`,
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

    function taskQueue(): string {
      return (worker.options as { taskQueue: string }).taskQueue
    }

    async function events(partition: string): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
      const pool = new Pool({ connectionString: url })
      try {
        const rows = await readPartition(pool, partition)
        return rows.map((row) => ({ type: row.type, payload: row.payload as Record<string, unknown> }))
      } finally {
        await pool.end()
      }
    }

    async function startParent(sessionId: string) {
      const workflowId = `queued-controls-parent-${sessionId}`
      const handle = await client.workflow.start('delegateParent', {
        taskQueue: taskQueue(),
        workflowId,
        args: [{ sessionId, maxInFlight: 1 }],
      })
      await waitFor(
        async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.session.created'),
        30_000,
        'parent to start',
      )
      return { handle, workflowId }
    }

    function delegate(childId: string, goal = 'queued control goal') {
      // Promoted children are goal-fed on promotion: one scripted turn each.
      return { childId, goal, depth: 1, mode: 'empty', maxDepth: 1, queueCapacity: 8, fakeSteps: [{ text: 'queued control reply' }] }
    }

    async function parentState(sessionId: string): Promise<ParentState> {
      return (await client.workflow.getHandle(`queued-controls-parent-${sessionId}`).query('parentState')) as ParentState
    }

    async function launchedRecord(sessionId: string, childId: string): Promise<void> {
      await waitFor(
        async () =>
          (await events(`session:${sessionId}`)).some(
            (event) => event.type === 't.subagent.launched' && event.payload['childId'] === childId,
          ),
        30_000,
        `launch record for ${childId}`,
      )
    }

    it('pauses, resumes and cancels queued children without starting them', async () => {
      const sessionId = `qc-${Date.now()}`
      const parent = await startParent(sessionId)
      try {
        const running = `qc-run-${Date.now()}`
        const paused = `qc-paused-${Date.now()}`
        const cancelled = `qc-cancelled-${Date.now()}`
        await parent.handle.signal('parentDelegate', delegate(running))
        await launchedRecord(sessionId, running)
        await parent.handle.signal('parentDelegate', delegate(paused))
        await parent.handle.signal('parentDelegate', delegate(cancelled))
        await waitFor(async () => {
          const queued = (await parentState(sessionId)).queued ?? []
          return queued.includes(paused) && queued.includes(cancelled)
        }, 30_000, 'children to queue')

        await parent.handle.signal('parentChildControl', { childId: paused, action: 'pause' })
        await waitFor(async () => ((await parentState(sessionId)).pausedQueued ?? []).includes(paused), 30_000, 'queued pause')
        await parent.handle.signal('parentChildControl', { childId: paused, action: 'resume' })
        await waitFor(async () => !((await parentState(sessionId)).pausedQueued ?? []).includes(paused), 30_000, 'queued resume')

        await parent.handle.signal('parentChildControl', { childId: cancelled, action: 'cancel' })
        await waitFor(async () => !((await parentState(sessionId)).queued ?? []).includes(cancelled), 30_000, 'queued cancel')
        const rows = await events(`session:${sessionId}`)
        expect(
          rows.some(
            (event) =>
              event.type === 't.subagent.completed' &&
              (event.payload['summary'] as { id?: string }).id === cancelled &&
              (event.payload['summary'] as { status?: string }).status === 'cancelled',
          ),
        ).toBe(true)
        // Cancelled while queued: never launched, never ran.
        expect(
          rows.some((event) => event.type === 't.subagent.launched' && event.payload['childId'] === cancelled),
        ).toBe(false)

        await client.workflow.getHandle(running).signal('childFinish')
        expect(await client.workflow.getHandle(running).result()).toBe('finished')
      } finally {
        await parent.handle.cancel()
        await parent.handle.result().catch(() => undefined)
      }
    }, 120_000)

    it('promotes past paused-queued children in order', async () => {
      const sessionId = `qo-${Date.now()}`
      const parent = await startParent(sessionId)
      try {
        const first = `qo-first-${Date.now()}`
        const held = `qo-held-${Date.now()}`
        const next = `qo-next-${Date.now()}`
        await parent.handle.signal('parentDelegate', delegate(first))
        await launchedRecord(sessionId, first)
        await parent.handle.signal('parentDelegate', delegate(held))
        await parent.handle.signal('parentDelegate', delegate(next))
        await waitFor(async () => {
          const queued = (await parentState(sessionId)).queued ?? []
          return queued.includes(held) && queued.includes(next)
        }, 30_000, 'children to queue')

        await parent.handle.signal('parentChildControl', { childId: held, action: 'pause' })
        await waitFor(async () => ((await parentState(sessionId)).pausedQueued ?? []).includes(held), 30_000, 'queued pause')

        await client.workflow.getHandle(first).signal('childFinish')
        expect(await client.workflow.getHandle(first).result()).toBe('finished')
        // The paused head stays queued; the next unpaused child promotes.
        await launchedRecord(sessionId, next)
        expect(((await parentState(sessionId)).queued ?? []).includes(held)).toBe(true)

        await parent.handle.signal('parentChildControl', { childId: held, action: 'resume' })
        await client.workflow.getHandle(next).signal('childFinish')
        expect(await client.workflow.getHandle(next).result()).toBe('finished')
        await launchedRecord(sessionId, held)

        await client.workflow.getHandle(held).signal('childFinish')
        expect(await client.workflow.getHandle(held).result()).toBe('finished')
      } finally {
        await parent.handle.cancel()
        await parent.handle.result().catch(() => undefined)
      }
    }, 180_000)
  },
)
