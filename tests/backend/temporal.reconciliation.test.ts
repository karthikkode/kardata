import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@temporalio/client'
import { Context } from '@temporalio/activity'
import { Runtime, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { inspectWorkflowOwner, reconcilePage } from '../../backend/src/temporal/activities/reconciliation.js'
import { beginThreadTurn, createSession, getThreadHeader, listReconciliationCandidates } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { createWorkerLogger } from '../../backend/src/observability/logging.js'

const enabled = process.env['KARDATA_TEMPORAL_TEST'] === '1' && !!TEST_DATABASE_URL
const workflows = join(dirname(fileURLToPath(import.meta.url)), '../../backend/src/temporal/workflows/reconciliation.ts')
const probes = join(dirname(fileURLToPath(import.meta.url)), 'temporal/probe-workflows.ts')

describe.skipIf(!enabled)('durable execution reconciliation over real Temporal and isolated Postgres', () => {
  beforeAll(() => { Runtime.install({ logger: createWorkerLogger() }) })
  it('recovers after exhausted page retries, retains the cursor, and never parks a running owner', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_temporal') })
    const native = await connectWorker()
    const connection = await connectClient()
    const client = new Client({ connection,namespace: temporalNamespace() })
    const queue = `reconcile-${randomUUID()}`
    let attempts = 0
    let successfulPages = 0
    const cursors: string[] = []
    const worker = await Worker.create({ connection: native,namespace: temporalNamespace(),taskQueue: queue,workflowsPath: workflows,activities: {
      reconciliationPageActivity: async (cursor: string) => {
        attempts += 1
        cursors.push(cursor)
        Context.current().heartbeat('TEST bounded page')
        if (attempts <= 3) throw new Error('TEST disconnected DB exhausts this page')
        const result = await reconcilePage(pool,cursor,async () => ({ state: 'running' }))
        successfulPages += 1
        return result
      },
    } })
    try {
      const session = await createSession(pool,'TEST healthy provider ownership')
      await projectNewEvents(pool)
      const lease = await beginThreadTurn(pool,session.id,'TEST durable turn')
      await worker.runUntil(async () => {
        const handle = await client.workflow.start('executionReconciliation',{ workflowId: `test-supervisor-${randomUUID()}`,taskQueue: queue,args: [{ cursor: '' }] })
        try {
          const deadline = Date.now() + 50_000
          while (successfulPages === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve,100))
          expect(successfulPages).toBe(1)
          expect(attempts).toBe(4)
          expect(cursors).toEqual(['','','',''])
          expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
          expect((await listReconciliationCandidates(pool))[0]?.lease).toBe(lease)
          expect((await handle.describe()).status.name).toBe('RUNNING')
        } finally { await handle.cancel(); await expect(handle.result()).rejects.toThrow() }
      })
    } finally { await connection.close(); await native.close(); await pool.end() }
  },60_000)

  it('uses actual workflow descriptions; absent/terminal owners never mutate execution state', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_owners') })
    const native = await connectWorker()
    const connection = await connectClient()
    const client = new Client({ connection,namespace: temporalNamespace() })
    const queue = `reconcile-owner-${randomUUID()}`
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const worker = await Worker.create({ connection: native,namespace: temporalNamespace(),taskQueue: queue,workflowsPath: probes,activities: { quick: async () => 'TEST done',rendezvous: async () => { Context.current().heartbeat('TEST healthy restarted owner'); await held; return 'TEST restarted done' } } })
    try {
      const session = await createSession(pool,'TEST terminal workflow owner')
      await projectNewEvents(pool)
      await beginThreadTurn(pool,session.id,'TEST stale lease')
      const candidate = (await listReconciliationCandidates(pool))[0]!
      expect(await inspectWorkflowOwner(connection,client,candidate)).toEqual({ state: 'unavailable' })
      await worker.runUntil(async () => {
        await client.workflow.execute('quickWorkflow',{ workflowId: candidate.workflowId!,taskQueue: queue,args: [] })
        const oldDescription = await inspectWorkflowOwner(connection,client,candidate)
        expect(oldDescription).toMatchObject({ state: 'closed',executionId: expect.any(String) })
        // Exact cross-system race: same ID restarts after the status read,
        // before the new execution can acquire a replacement local lease.
        const restarted = await client.workflow.start('blockingWorkflow',{ workflowId: candidate.workflowId!,taskQueue: queue,args: [] })
        try {
          const newDescription = await inspectWorkflowOwner(connection,client,candidate)
          expect(newDescription).toMatchObject({ state: 'running',executionId: expect.any(String) })
          expect(newDescription.executionId).not.toBe(oldDescription.executionId)
          expect(await reconcilePage(pool,'',async () => oldDescription)).toMatchObject({ findings: 1 })
          expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
          expect((await listReconciliationCandidates(pool))[0]?.activeRun).toBe('TEST stale lease')
          expect((await restarted.describe()).status.name).toBe('RUNNING')
        } finally { release() }
        expect(await restarted.result()).toBe('TEST restarted done')
      })
    } finally { release(); await connection.close(); await native.close(); await pool.end() }
  },30_000)
})
