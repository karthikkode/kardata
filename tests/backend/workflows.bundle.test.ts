// Production-bundle sandbox guard (fv4 L-PLAN, 259fb1d). Bundles the turn
// + research workflow bundles with bundleWorkflowCode — the artifact path
// production workers load — and starts one workflow per bundle WITHOUT the
// harness queue override. An env read in the queue default fails the first
// workflow task (ReferenceError: process is not defined), so the progress
// query never answers and this fails. Gated on KARDATA_TEMPORAL_TEST like
// the other workflow suites; no database or provider needed (queries
// answer before any activity runs, and the pended activities die with the
// terminated workflow).
import { Client as WorkflowClient } from '@temporalio/client'
import { bundleWorkflowCode, Worker, type NativeConnection, type WorkflowBundle } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import type { WorkItem } from '../../backend/src/research-plan.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const WORKFLOWS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'backend',
  'src',
  'temporal',
  'workflows',
)

async function querySoon(handle: { query: (name: string) => Promise<unknown> }, name: string): Promise<unknown> {
  let result: unknown = null
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      result = await handle.query(name)
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  return result
}

describe.skipIf(!ENABLED)('workflow production bundles answer past the queue default [F:backend.workflow.plan.sectorPlan] [F:backend.workflow.coordinator.companyResearch]', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  const workers: Worker[] = []
  const runs: Array<Promise<void>> = []
  const queue = `kardata-test-bundle-${Date.now()}`
  const bundles = new Map<string, WorkflowBundle>()

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    bundles.set('turn', await bundleWorkflowCode({ workflowsPath: join(WORKFLOWS_DIR, 'turn-bundle.ts') }))
    bundles.set('research', await bundleWorkflowCode({ workflowsPath: join(WORKFLOWS_DIR, 'research-bundle.ts') }))
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    for (const [suffix, bundle] of bundles) {
      const worker = await Worker.create({
        connection,
        namespace: temporalNamespace(),
        taskQueue: `${queue}-${suffix}`,
        workflowBundle: bundle,
        activities: {},
      })
      workers.push(worker)
      const run = worker.run()
      run.catch(() => undefined)
      runs.push(run)
    }
  }, 180_000)

  afterAll(async () => {
    for (const worker of workers) worker.shutdown()
    await Promise.all(runs)
    await connection.close()
    delete process.env['TEMPORAL_ADDRESS']
  }, 60_000)

  it('sectorPlan starts without the queue override on the research bundle', async () => {
    const handle = await client.workflow.start('sectorPlan', {
      taskQueue: `${queue}-research`,
      workflowId: `bundle-plan-${Date.now()}`,
      args: [{ sectorId: 'sec-bundle', sessionId: 'session-bundle', scope: { tenantId: 'tenant-bundle', projectId: null } }],
    })
    try {
      expect(await querySoon(handle, 'planProgress')).toMatchObject({ sectorId: 'sec-bundle', status: 'planning' })
    } finally {
      await handle.terminate()
    }
  }, 120_000)

  it('companyResearch starts without the queue override on the turn bundle', async () => {
    const item: WorkItem = { id: 'bundle-item', kind: 'company', title: 'TEST bundle company', state: 'pending', attempts: 0, childId: null, evidence: [], detail: '' }
    const handle = await client.workflow.start('companyResearch', {
      taskQueue: `${queue}-turn`,
      workflowId: `bundle-child-${Date.now()}`,
      args: [{ sectorId: 'sec-bundle', sessionId: 'session-bundle', version: 1, item, brief: 'TEST bundle brief', acceptance: ['TEST bundle criterion'] }],
    })
    try {
      expect(await querySoon(handle, 'childState')).toMatchObject({ status: 'running' })
    } finally {
      await handle.terminate()
    }
  }, 120_000)
})
