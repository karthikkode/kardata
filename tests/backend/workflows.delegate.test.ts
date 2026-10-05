// Delegation door end to end. Gated on KARDATA_TEMPORAL_TEST like the
// other workflow suites: live Temporal + live database, fake provider
// (KARDATA_PROVIDER=fake) with delegate-supplied steps — no keys, no
// network. Proves the gateway door (signal-with-start parent, queued
// child, turn, completion) that the db.delegate_subagent tool drives.
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Client as WorkflowClient } from '@temporalio/client'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPartition } from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { delegationWorkflowId } from '../../backend/src/temporal/runs-helpers.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import * as epochActivities from '../../backend/src/temporal/activities/execution-epochs.js'
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

async function waitFor(what: () => Promise<boolean>, timeoutMs: number, name: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await what()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${name}`)
    await sleep(200)
  }
}

describe.skipIf(!ENABLED)('delegation door (db.delegate_subagent gateway)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let run: Promise<void>
  let gateway: TemporalRunsGateway
  let gatewayPool: Pool

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_delegate')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    gatewayPool = new Pool({ connectionString: url })
    gateway = new TemporalRunsGateway(gatewayPool, await connectClient())
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { appendEventActivity, karbotTurnActivity,...epochActivities },
      taskQueue: `kardata-test-delegate-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    await run
    await connection.close()
    await gatewayPool.end()
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_PROVIDER']
  }, 60_000)

  function taskQueue(): string {
    return (worker.options as { taskQueue: string }).taskQueue
  }

  it('launches a leaf child through the gateway door and collects its reply', async () => {
    const pool = new Pool({ connectionString: url })
    try {
      const sessionId = `door-${Date.now()}`
      const { childId, commandId } = await gateway.delegateSubagent({
        sessionId,
        goal: 'research the question',
        mode: 'empty',
        queueCapacity: 8,
        fakeSteps: [{ text: 'door reply' }],
        taskQueue: taskQueue(),
      })
      expect(childId).toMatch(/^child-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(commandId.startsWith('cmd-')).toBe(true)
      const parentHandle = client.workflow.getHandle(delegationWorkflowId(sessionId))
      await waitFor(async () => {
        const state = (await parentHandle.query('parentState')) as {
          children: Array<{ childId: string; status: string }>
        }
        return state.children.some((child) => child.childId === childId)
      }, 30_000, 'child to appear in parent state')
      await waitFor(async () => {
        const summary = (await client.workflow.getHandle(childId).query('childSummary')) as { status: string }
        return summary.status === 'running'
      }, 30_000, 'child to run')
      const messages = async () => {
        const pool = new Pool({ connectionString: url })
        try {
          return await readPartition(pool, `child:${childId}`)
        } finally {
          await pool.end()
        }
      }
      await waitFor(async () => {
        const texts = (await messages()).map((message) => JSON.stringify(message.payload))
        return texts.some((text) => text.includes('door reply'))
      }, 60_000, 'child reply')
      const texts = (await messages()).map((message) => JSON.stringify(message.payload))
      expect(texts.some((text) => text.includes('door reply'))).toBe(true)
      // Children idle after their turn by design: finish closes them, and
      // the completion entry lands in the parent partition.
      await client.workflow.getHandle(childId).signal('childFinish')
      await waitFor(async () => {
        const summary = (await client.workflow.getHandle(childId).query('childSummary')) as { status: string }
        return summary.status === 'finished'
      }, 60_000, 'child to finish')
    } finally {
      await pool.end()
    }
  }, 180_000)
})
