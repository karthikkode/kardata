// Fleet load runs: N subagents with real outputs, in-app (Phase 5).
// A throwaway database plus an in-process backend (real HTTP MCP) keep
// every write out of real data. Children run scripted provider steps
// (zero tokens) with REAL tool execution: each child reads the sector
// and advances its companies' stages, so completions mean DB rows, not
// echoes. Gated by KARDATA_TEMPORAL_TEST=1 AND TEST_DATABASE_URL;
// without both every test skips explicitly.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import {
  createSector,
  listSectorCompanies,
  markCompanyFound,
  readPartition,
  setCompanyStage,
} from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'
import { generateFleet } from './fleet-seed.js'

const TEMPORAL = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const LIVE = TEMPORAL && TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
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
const SCOPE = { tenantId: 'test-fleet', projectId: null }
// Test-only key, committed like every other suite key (api.sectors KEYS):
// it unlocks a throwaway database and nothing else.
const OPERATOR_KEY = 'key-fleet-load-operator'

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe.skipIf(!LIVE)('fleet load runs (N subagents, real outputs)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let pool: Pool
  let app: FastifyInstance
  let mcpUrl = ''
  let worker: Worker
  let run: Promise<void>

  const LEGS = [
    { leg: 'ten', children: 10, stage: 'Deep research', timeoutMs: 600_000, testTimeoutMs: 660_000 },
    { leg: 'fifty', children: 50, stage: 'Problem found', timeoutMs: 1_500_000, testTimeoutMs: 1_560_000 },
    { leg: 'hundred', children: 100, stage: 'Final validation', timeoutMs: 2_700_000, testTimeoutMs: 2_760_000 },
  ] as const

  function sectorFor(leg: string): string {
    return `sec-fleet-load-${leg}`
  }

  function companyFor(leg: string, index: number): string {
    return `fleet-load-${leg}-com-${index}`
  }

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_fleet_load')
    process.env['DATABASE_URL'] = url
    pool = new Pool({ connectionString: url, max: 20 })
    await pool.query(
      `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash, tenant_id = EXCLUDED.tenant_id,
         project_id = EXCLUDED.project_id, roles = EXCLUDED.roles`,
      ['fleet-load-operator', hashKey(OPERATOR_KEY), 'test-fleet', null, 'operator'],
    )
    const runsGateway = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs: runsGateway, auth: true })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('app did not bind a port')
    mcpUrl = `http://127.0.0.1:${address.port}/mcp`
    process.env['KARDATA_MCP_URL'] = mcpUrl
    process.env['KARDATA_MCP_TOKEN'] = OPERATOR_KEY

    // One sector per leg with fixed company ids: legs stay disjoint in
    // one process, and reruns replay to identical rows (idempotent keys).
    const fleet = generateFleet(7, 100, 4)
    for (const spec of LEGS) {
      const legSector = sectorFor(spec.leg)
      await createSector(pool, { name: `TEST Fleet Load ${spec.leg}`, topic: 'TEST DATA: subagent load runs', scope: SCOPE, sectorId: legSector })
    }
    await projectNewEvents(pool)
    for (const spec of LEGS) {
      const legSector = sectorFor(spec.leg)
      for (let i = 0; i < spec.children; i++) {
        const company = fleet.companies[i % fleet.companies.length] as { name: string }
        await markCompanyFound(pool, {
          sectorId: legSector,
          name: `${company.name} ${spec.leg}`,
          scope: SCOPE,
          companyId: companyFor(spec.leg, i),
          idempotencyKey: `fleet-load:${spec.leg}:company:${i}`,
        })
      }
    }
    await projectNewEvents(pool)

    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { appendEventActivity, karbotTurnActivity },
      taskQueue: `kardata-test-fleet-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 300_000)

  afterAll(async () => {
    await app?.close().catch(() => undefined)
    await pool?.end().catch(() => undefined)
    try {
      worker.shutdown()
      await run
    } catch {
      // Shutdown races are test-harness noise, never product signal.
    }
    await connection?.close().catch(() => undefined)
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_PROVIDER']
    delete process.env['KARDATA_MCP_URL']
    delete process.env['KARDATA_MCP_TOKEN']
  }, 120_000)

  function taskQueue(): string {
    return (worker.options as { taskQueue: string }).taskQueue
  }

  async function events(partition: string): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
    const rows = await readPartition(pool, partition)
    return rows.map((row) => ({ type: row.type, payload: row.payload as Record<string, unknown> }))
  }

  async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await sleep(500)
    }
  }

  async function stageCount(leg: string, stage: string): Promise<number> {
    const page = await listSectorCompanies(pool, sectorFor(leg), SCOPE, {}, { limit: 500, offset: 0 })
    return page.companies.filter((company) => company.stage === stage).length
  }

  async function runLeg(options: { leg: string; children: number; stage: string; timeoutMs: number }): Promise<void> {
    const sectorId = sectorFor(options.leg)
    // Reset to Filter first: reruns start from the same baseline, so the
    // negative control below and the final count hold on every run.
    for (let i = 0; i < options.children; i++) {
      await setCompanyStage(pool, companyFor(options.leg, i), 'Filter', { scope: SCOPE })
    }
    await projectNewEvents(pool)
    expect(await stageCount(options.leg, options.stage)).toBe(0)

    const sessionId = `fleet-${options.leg}-${Date.now()}`
    // Child ids derive from the run-unique session: reruns never collide
    // with still-running children from an earlier aborted run (which would
    // correctly reject as duplicates and wedge the launch count).
    const childIds = Array.from({ length: options.children }, (_, i) => `${sessionId}-child-${i}`)
    const started = Date.now()
    const parent = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId: `fleet-parent-${sessionId}`,
      args: [{ sessionId, maxInFlight: options.children + 20 }],
    })
    await waitFor(
      async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.session.created'),
      60_000,
      'parent to start',
    )
    for (let i = 0; i < options.children; i++) {
      const childId = childIds[i] as string
      const companyId = companyFor(options.leg, i)
      await parent.signal('parentDelegate', {
        childId,
        goal: `verify TEST company ${companyId}`,
        depth: 1,
        mode: 'empty',
        maxDepth: 1,
        queueCapacity: 8,
        fakeSteps: [
          {
            text: 'reading the sector',
            toolCalls: [{ id: `r${i}`, name: 'db.list_sector_companies', args: { sectorId } }],
          },
          {
            text: 'verifying',
            toolCalls: [{ id: `v${i}`, name: 'db.set_company_stage', args: { companyId, stage: options.stage } }],
          },
          { text: 'done' },
        ],
      })
    }
    const launchedMs = Date.now() - started
    const launched = async (): Promise<number> =>
      (await events(`session:${sessionId}`)).filter((event) => event.type === 't.subagent.launched').length
    await waitFor(async () => (await launched()) >= options.children, options.timeoutMs, `${options.children} launches`)
    for (let i = 0; i < options.children; i++) {
      await parent.signal('parentSteer', { childId: childIds[i] as string, text: `verify TEST company ${companyFor(options.leg, i)}` })
    }
    await waitFor(async () => (await stageCount(options.leg, options.stage)) >= options.children, options.timeoutMs, 'real outputs')
    const outputsMs = Date.now() - started
    for (let i = 0; i < options.children; i++) {
      const childId = childIds[i] as string
      await client.workflow.getHandle(childId).signal('childFinish')
      expect(await client.workflow.getHandle(childId).result()).toBe('finished')
      await parent.signal('parentNoteDone', { childId, status: 'finished' })
    }
    await parent.signal('parentFinish')
    expect(await parent.result()).toBe('done')
    const rows = await events(`session:${sessionId}`)
    const completed = rows.filter((event) => event.type === 't.subagent.completed').length
    const rejected = rows.filter((event) => event.type === 't.subagent.rejected')
    const missed = rows.filter((event) => event.type === 't.subagent.missed_steer')
    console.log(
      `[fleet-load] leg=${options.leg} children=${options.children} launchedMs=${launchedMs} outputsMs=${outputsMs} ` +
        `completed=${completed} rejected=${rejected.length} missed=${missed.length} totalMs=${Date.now() - started}`,
    )
    expect(completed).toBe(options.children)
    expect(rejected).toEqual([])
    expect(missed).toEqual([])
  }

  it('runs 10 subagents to real company outputs', async () => {
    await runLeg({ leg: 'ten', children: 10, stage: 'Deep research', timeoutMs: 600_000 })
  }, 660_000)

  it('runs 50 subagents to real company outputs', async () => {
    await runLeg({ leg: 'fifty', children: 50, stage: 'Problem found', timeoutMs: 1_500_000 })
  }, 1_560_000)

  it('runs 100 subagents to real company outputs', async () => {
    await runLeg({ leg: 'hundred', children: 100, stage: 'Final validation', timeoutMs: 2_700_000 })
  }, 2_760_000)
})
