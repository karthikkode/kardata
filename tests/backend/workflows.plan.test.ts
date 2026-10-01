// Sector plan end to end (P2). Gated on KARDATA_TEMPORAL_TEST like the
// other workflow suites: live Temporal + live database. The planning turn
// answers from delegate-supplied fake steps (no keys, no network): the
// full path — context load, turn, versioned artifact, terminal
// transition — is proven, including the empty-reply failure branch.
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSector, ensureResearchSession, getThread, listSectorCompanies } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { loadSweepContextActivity } from '../../backend/src/temporal/activities/sweep.js'
import {
  readSectorPlanActivity,
  setPlanStateActivity,
  writePlanArtifactActivity,
} from '../../backend/src/temporal/activities/plan.js'
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
  'plan.ts',
)

describe.skipIf(!ENABLED)('sector plan workflow (P2)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let turnWorker: Worker
  let turnRun: Promise<void>
  let run: Promise<void>

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_plan')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'research',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: {
        loadSweepContextActivity,
        readSectorPlanActivity,
        setPlanStateActivity,
        writePlanArtifactActivity,
      },
      taskQueue: `kardata-test-plan-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
    turnWorker = await createLaneWorker({ lane: 'turn', connection, namespace: temporalNamespace(), workflowsPath: WORKFLOWS_PATH, taskQueue: `${(worker.options as { taskQueue: string }).taskQueue}-turn`, activities: { appendEventActivity, karbotTurnActivity } })
    turnRun = turnWorker.run()
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    turnWorker.shutdown()
    await Promise.all([run, turnRun])
    await connection.close()
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_PROVIDER']
  }, 60_000)

  function taskQueue(): string {
    return (worker.options as { taskQueue: string }).taskQueue
  }

  it('plans with evidence into a versioned artifact and lands planned', async () => {
    const pool = new Pool({ connectionString: url })
    const sectorId = `sec-plan-${Date.now()}`
    try {
      await createSector(pool, {
        name: 'Speciality foods plan',
        topic: 'Artisanal packaged foods',
        scope: { tenantId: 'tenant-plan', projectId: null },
        sectorId,
        initialState: 'planning',
      })
      await projectNewEvents(pool)
      const handle = await client.workflow.start('sectorPlan', {
        taskQueue: taskQueue(),
        workflowId: `sector-plan-${sectorId}`,
        args: [{
          sectorId,
          sessionId: (await ensureResearchSession(pool, sectorId, { tenantId: 'tenant-plan', projectId: null })).id,
          turnTaskQueue: `${taskQueue()}-turn`,
          scope: { tenantId: 'tenant-plan', projectId: null },
          fakeSteps: [{ text: `## scope\nTEST Foods.\n## direction shards\nTwo.\n## query shapes\nSome.\n## budgets\nLow.\n## risks\nFew.\n## open questions\nNone.\n\n\`\`\`research-plan\n${JSON.stringify({ researchDepth: 'discovery', discoveryTarget: 1, discovery: [{ id: 'foods', title: 'TEST Foods', queries: ['Australian food manufacturers'], maxPages: 1 }], companyBrief: 'Verify company identities', budgets: { maxCompanies: 10, maxWallMinutes: 5, concurrency: 2 }, acceptance: ['Evidence-backed identities'] })}\n\`\`\`` }],
        }],
      })
      expect(await handle.result()).toBe('planned')
      const plan = await readSectorPlanActivity({ sectorId })
      expect(plan?.versions).toHaveLength(1)
      expect(plan?.latest?.markdown).toContain('direction shards')
      expect(plan?.latest?.version).toBe(1)
      const session = await ensureResearchSession(pool, sectorId, { tenantId: 'tenant-plan', projectId: null })
      await projectNewEvents(pool)
      const history = (await getThread(pool, session.id))?.messages.map((message) => (message.payload as { text?: string }).text)
      expect(history?.some((text) => text?.includes('Prepare the research plan'))).toBe(true)
      expect(history?.some((text) => text?.includes('TEST Foods.'))).toBe(true)
      expect(history?.some((text) => text?.includes('```research-plan'))).toBe(false)
      const companies = await listSectorCompanies(pool, sectorId, { tenantId: 'tenant-plan', projectId: null })
      expect(companies.total).toBe(0)
    } finally {
      await pool.end()
    }
  }, 180_000)

  it('fails honestly on an empty planning reply', async () => {
    const pool = new Pool({ connectionString: url })
    const sectorId = `sec-plan-empty-${Date.now()}`
    try {
      await createSector(pool, {
        name: 'Empty plan',
        topic: 'Nothing evidenced',
        scope: { tenantId: 'tenant-plan', projectId: null },
        sectorId,
        initialState: 'planning',
      })
      await projectNewEvents(pool)
      const handle = await client.workflow.start('sectorPlan', {
        taskQueue: taskQueue(),
        workflowId: `sector-plan-${sectorId}`,
        args: [{
          sectorId,
          sessionId: (await ensureResearchSession(pool, sectorId, { tenantId: 'tenant-plan', projectId: null })).id,
          turnTaskQueue: `${taskQueue()}-turn`,
          scope: { tenantId: 'tenant-plan', projectId: null },
          fakeSteps: [{ text: '   ' }],
        }],
      })
      expect(await handle.result()).toBe('failed')
      const plan = await readSectorPlanActivity({ sectorId })
      expect(plan?.versions).toHaveLength(0)
      expect(plan?.latest).toBeNull()
    } finally {
      await pool.end()
    }
  }, 180_000)
})
