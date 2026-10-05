// Fleet load runs: N subagents with real outputs, in-app (Phase 5).
// A throwaway database plus an in-process backend (real HTTP MCP) keep
// every write out of real data. Children run scripted provider steps
// (zero tokens) with REAL tool execution: each child reads the sector
// and creates indexed discovery artifacts, so completions mean DB rows, not
// echoes. Gated by KARDATA_TEMPORAL_TEST=1 AND TEST_DATABASE_URL;
// without both every test skips explicitly.
import { dirname, join } from 'node:path'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { tmpdir } from 'node:os'
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
  appendEvent,
  createSector,
  listSectorLibrary,
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

describe.skipIf(!LIVE)('fleet load runs (N subagents, real outputs) [F:backend.activity.turn.appendEventActivity] [F:backend.activity.turn.karbotTurnActivity] [F:backend.workflow.subagents.delegateParent] [F:backend.activity.coordinator.prepareExecutionIntentActivity] [F:backend.activity.coordinator.settlePreparedExecutionIntentActivity] [F:backend.activity.execution_epochs.originalRecoveryReadyActivity] [F:backend.activity.execution_epochs.prepareExecutionIntentActivity] [F:backend.activity.execution_epochs.settlePreparedExecutionIntentActivity] [F:backend.workflow.epoch_start.withPreparedExecution] [F:backend.workflow.subagents.DEFAULT_CHILD_FINISH_TIMEOUT_MS] [F:backend.workflow.subagents.DEFAULT_MAX_IN_FLIGHT_CHILDREN] [F:backend.workflow.subagents.DEFAULT_PARENT_IDLE_TIMEOUT_MS] [F:backend.workflow.subagents.childCanDelegateQuery] [F:backend.workflow.subagents.childCancelSignal] [F:backend.workflow.subagents.childFinishSignal] [F:backend.workflow.subagents.childMessageSignal] [F:backend.workflow.subagents.childRedirectSignal] [F:backend.workflow.subagents.childStateQuery] [F:backend.workflow.subagents.childSummaryQuery] [F:backend.workflow.subagents.parentDelegateSignal] [F:backend.workflow.subagents.parentFinishSignal] [F:backend.workflow.subagents.parentNoteDoneSignal] [F:backend.workflow.subagents.parentRecoverSignal] [F:backend.workflow.subagents.parentStateQuery] [F:backend.workflow.subagents.parentSteerSignal] [F:backend.workflow.subagents.DEFAULT_MAX_QUEUED_CHILDREN]', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let pool: Pool
  let app: FastifyInstance
  let mcpUrl = ''
  let worker: Worker
  let run: Promise<void>
  const failedTools = new Set<string>()
  const ownedWorkflows = new Set<string>()
  const measurements: Array<Record<string, unknown>> = []

  const LEGS = [
    { leg: 'ten', children: 10, stage: 'Deep research', timeoutMs: 600_000, testTimeoutMs: 660_000 },
    { leg: 'fifty', children: 50, stage: 'Problem found', timeoutMs: 1_500_000, testTimeoutMs: 1_560_000 },
    { leg: 'hundred', children: 100, stage: 'Final validation', timeoutMs: 2_700_000, testTimeoutMs: 2_760_000 },
    { leg: 'thousand', children: 1000, stage: 'Deep research', timeoutMs: 1_500_000, testTimeoutMs: 1_560_000 },
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
    process.env['KARDATA_ARCHIVE_DIR'] = mkdtempSync(join(tmpdir(), 'kardata-fleet-archive-'))
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
    // The thousand leg gets its own seed so all 1000 names stay distinct.
    const fleets = new Map<string, { name: string }[]>()
    for (const spec of LEGS) {
      const legSector = sectorFor(spec.leg)
      await createSector(pool, { name: `TEST Fleet Load ${spec.leg}`, topic: 'TEST DATA: subagent load runs', scope: SCOPE, sectorId: legSector })
      fleets.set(spec.leg, generateFleet(spec.leg === 'thousand' ? 9 : 7, spec.children, 0).companies)
    }
    await projectNewEvents(pool)
    for (const spec of LEGS) {
      const legSector = sectorFor(spec.leg)
      const names = fleets.get(spec.leg) as { name: string }[]
      for (let i = 0; i < spec.children; i++) {
        const company = names[i % names.length] as { name: string }
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
      activities: { appendEventActivity, karbotTurnActivity: async (input: Parameters<typeof karbotTurnActivity>[0]) => {
        const outcome = await karbotTurnActivity(input)
        if (outcome.toolCalls.some((tool) => tool.state === 'failed')) failedTools.add(input.threadKey)
        return outcome
      } },
      taskQueue: `kardata-test-fleet-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 300_000)

  afterAll(async () => {
    for (const id of ownedWorkflows) {
      try {
        const handle = client.workflow.getHandle(id)
        const description = await handle.describe()
        if (description.status.name === 'RUNNING' && description.taskQueue === taskQueue()) await handle.terminate('Isolated fleet test cleanup after incomplete execution.')
      } catch (error) {
        if (!(error instanceof Error && error.name === 'WorkflowNotFoundError')) throw error
      }
    }
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
    delete process.env['KARDATA_ARCHIVE_DIR']
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
      if (failedTools.size) throw new Error(`Fleet tool execution failed for ${[...failedTools].join(', ')}; provider text is not output proof.`)
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await sleep(500)
    }
  }

  async function artifactCount(sectorId: string, sessionId: string): Promise<number> {
    return (await listSectorLibrary(pool, sectorId, SCOPE)).filter((file) => file.kind === 'artifact' && file.sessionId === sessionId && file.status === 'indexed').length
  }

  async function runLeg(options: { leg: string; children: number; stage: string; timeoutMs: number }): Promise<void> {
    const sectorId = sectorFor(options.leg)
    // Reset to Filter first: reruns start from the same baseline, so the
    // negative control below and the final count hold on every run.
    for (let i = 0; i < options.children; i++) {
      await setCompanyStage(pool, companyFor(options.leg, i), 'Filter', { scope: SCOPE })
    }
    await projectNewEvents(pool)

    const sessionId = `fleet-${options.leg}-${Date.now()}`
    // Production sessions are created through scoped routes before the
    // workflow starts. Seed that same ownership contract in the harness.
    await appendEvent(pool, { idempotencyKey: `fleet-session:${sessionId}`, partition: `session:${sessionId}`, type: 't.session.created', payload: { sessionId, title: `TEST fleet ${options.leg}`, sectorId, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId } })
    await projectNewEvents(pool)
    // Child ids derive from the run-unique session: reruns never collide
    // with still-running children from an earlier aborted run (which would
    // correctly reject as duplicates and wedge the launch count).
    const childIds = Array.from({ length: options.children }, (_, i) => `${sessionId}-child-${i}`)
    ownedWorkflows.add(`fleet-parent-${sessionId}`)
    for (const id of childIds) ownedWorkflows.add(id)
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
            text: 'indexing TEST discovery evidence',
            toolCalls: [{ id: `v${i}`, name: 'db.create_artifact', args: { sessionId, name: `TEST discovery ${i}.md`, content: `# TEST DATA discovery evidence\n\nSynthetic company ${companyId}.`, reason: 'report' } }],
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
    await waitFor(async () => (await artifactCount(sectorId, sessionId)) >= options.children, options.timeoutMs, 'indexed discovery artifacts')
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
    measurements.push({ tier: options.leg, logicalChildren: options.children, launchedMs, outputsMs, completed, rejected: rejected.length, missed: missed.length, totalMs: Date.now() - started, runnerRssBytes: process.memoryUsage().rss, poolClients: pool.totalCount, poolWaiting: pool.waitingCount })
    const evidenceDir = join(import.meta.dirname, '..', '..', 'backend', 'test-results')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, 'fleet.hardening.report.json'), JSON.stringify({ recordedAt: new Date().toISOString(), provider: 'scripted', externalServices: 'real HTTP MCP, Postgres, Temporal', hardware: { logicalCpus: cpus().length, hostMemoryBytes: totalmem() }, limitations: 'RSS/pool observations are end-of-tier samples, not peaks. External container CPU/memory and provider capacity are not measured here.', measurements }, null, 2))
    console.log(
      `[fleet-load] leg=${options.leg} children=${options.children} launchedMs=${launchedMs} outputsMs=${outputsMs} ` +
        `completed=${completed} rejected=${rejected.length} missed=${missed.length} totalMs=${Date.now() - started}`,
    )
    expect(completed).toBe(options.children)
    expect(rejected).toEqual([])
    expect(missed).toEqual([])
  }

  it('runs 10 subagents to indexed discovery artifacts', async () => {
    await runLeg({ leg: 'ten', children: 10, stage: 'Deep research', timeoutMs: 600_000 })
  }, 660_000)

  it('runs 50 subagents to indexed discovery artifacts', async () => {
    await runLeg({ leg: 'fifty', children: 50, stage: 'Problem found', timeoutMs: 1_500_000 })
  }, 1_560_000)

  it('runs 100 subagents to indexed discovery artifacts', async () => {
    await runLeg({ leg: 'hundred', children: 100, stage: 'Final validation', timeoutMs: 2_700_000 })
  }, 2_760_000)

  it('runs 1000 subagents to indexed discovery artifacts', async () => {
    await runLeg({ leg: 'thousand', children: 1000, stage: 'Deep research', timeoutMs: 1_500_000 })
  }, 1_560_000)
})
