// Controlled compatibility histories come from the exact unchanged main baseline.
// Scripted activities are fixture evidence, not production provider/DB execution.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { msToTs } from '@temporalio/common/lib/time.js'
import { Client, type Connection } from '@temporalio/client'
import { bundleWorkflowCode, Worker, type NativeConnection, type WorkflowBundle } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connectClient, connectWorker } from '../../backend/src/temporal/connection.js'
import { laneConfig } from '../../backend/src/temporal/lanes.js'
import type { WorkItem } from '../../backend/src/temporal/research-plan.js'

const BASELINE = 'e454d44e1625c28b117a227c0650a891532cd39f'
const ROOT = resolve(import.meta.dirname, '../..')
const ENABLED = process.env['KARDATA_BASELINE_REPLAY'] === '1'
const TYPES = ['sessionRun', 'subagentRun', 'companyResearch', 'sectorPlan', 'sectorSweep', 'sectorCoordinator'] as const

describe.skipIf(!ENABLED)('controlled baseline workflow replay', () => {
  let connection: Connection, native: NativeConnection, client: Client
  let baselineTurn: WorkflowBundle, baselineResearch: WorkflowBundle, currentTurn: WorkflowBundle, currentResearch: WorkflowBundle
  const workers: Worker[] = [], runs: Promise<void>[] = []
  const namespace = `test-baseline-${randomUUID()}`
  const records: Array<{ type: string; workflowId: string; runId: string; path: string; sha256: string; events: number; outcome: string }> = []
  const handles: Array<ReturnType<Client['workflow']['getHandle']>> = []
  const directory = join(ROOT, 'backend/test-results', namespace)
  const items = new Map<string, WorkItem>()
  const replies = new Set<string>()
  const outcome = { reply: 'TEST baseline reply', toolCalls: [], sources: [] }
  beforeAll(async () => {
    const baseline = process.env['KARDATA_BASELINE_ROOT']
    expect(baseline, 'Provide an unchanged isolated checkout of the pinned baseline.').toBeTruthy()
    expect(execFileSync('git', ['-C', baseline!, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(BASELINE)
    expect(execFileSync('git', ['-C', baseline!, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()).toBe('')
    baselineTurn = await bundleWorkflowCode({ workflowsPath: join(baseline!, 'backend/src/temporal/workflows/turn-bundle.ts') })
    baselineResearch = await bundleWorkflowCode({ workflowsPath: join(baseline!, 'backend/src/temporal/workflows/research-bundle.ts') })
    currentTurn = await bundleWorkflowCode({ workflowsPath: join(ROOT, 'backend/src/temporal/workflows/turn-bundle.ts') })
    currentResearch = await bundleWorkflowCode({ workflowsPath: join(ROOT, 'backend/src/temporal/workflows/research-bundle.ts') })
    connection = await connectClient()
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86400000) })
    client = new Client({ connection, namespace })
    native = await connectWorker()
    const fixtures = {
      appendEventActivity: async () => undefined,
      karbotTurnActivity: async (input: { threadKey: string }) => { replies.add(input.threadKey); return outcome },
      loadSweepContextActivity: async (input: { sectorId: string }) => ({ sectorId: input.sectorId, name: 'TEST baseline widgets', topic: 'TEST widgets', state: 'running', docChars: 0, docText: '' }),
      searchWebPageActivity: async () => [],
      setSweepStateActivity: async () => undefined,
      setPlanStateActivity: async () => undefined,
      writePlanArtifactActivity: async () => undefined,
      loadCoordinatorActivity: async (input: { sectorId: string }) => ({
        sector: { id: input.sectorId, state: 'running' }, sessionId: input.sectorId,
        context: { sections: { scope: 'TEST baseline scope' } },
        plan: { version: 1, executable: { discovery: [{ id: 'baseline', title: 'TEST baseline', queries: ['TEST baseline'], maxPages: 1 }], companyBrief: 'TEST fixture research', budgets: { maxCompanies: 10, maxWallMinutes: 5, concurrency: 2 }, acceptance: ['TEST fixture criterion'] } },
        progress: { items: [...items.values()].filter((item) => item.id.startsWith(input.sectorId)) },
      }),
      researchSearchActivity: async () => [],
      researchCheckpointActivity: async (input: { item: WorkItem }) => { items.set(input.item.id, input.item) },
      researchDiscoveryClosedActivity: async () => undefined,
      researchLifecycleActivity: async () => undefined,
      researchVerdictActivity: async () => undefined,
    }
    for (const [lane, bundle] of [['turn', baselineTurn], ['research', baselineResearch]] as const) {
      const worker = await Worker.create({ connection: native, namespace, taskQueue: laneConfig(lane).taskQueue, workflowBundle: bundle, activities: fixtures, maxConcurrentActivityTaskExecutions: 2, maxConcurrentWorkflowTaskExecutions: 2 })
      workers.push(worker); runs.push(worker.run())
    }
    mkdirSync(directory, { recursive: true })
  }, 120000)
  afterAll(async () => {
    for (const handle of handles) {
      if ((await handle.describe()).status.name === 'RUNNING') { await handle.cancel(); await handle.result().catch(() => undefined) }
    }
    for (const worker of workers) worker.shutdown()
    await Promise.all(runs)
    await native?.close(); await connection?.close()
    if (records.length) writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: 1, origin: 'controlled_baseline', baselineCommit: BASELINE, namespace, at: new Date().toISOString(), bundleHashes: { turn: createHash('sha256').update(baselineTurn.code).digest('hex'), research: createHash('sha256').update(baselineResearch.code).digest('hex') }, histories: records }, null, 2))
    // The namespace/history is retained; never purge shared Temporal resources.
  }, 60000)
  it.each(TYPES)('captures and replays baseline %s against current code', async (type) => {
    const id = `TEST-baseline-${type}-${randomUUID()}`
    const item: WorkItem = { id: `${id}:company`, kind: 'company', title: 'TEST baseline company', state: 'pending', attempts: 0, childId: `TEST-company-${randomUUID()}`, evidence: [], detail: '', sourceUrl: 'https://widgets.example.test/' }
    if (type === 'sectorCoordinator') items.set(item.id, item)
    const input = type === 'sessionRun' ? { sessionId: id, idleTimeoutMs: 250 }
      : type === 'subagentRun' ? { childId: id, parentSessionId: id, parentPartition: `session:${id}`, goal: 'TEST baseline task', depth: 0, mode: 'empty', maxDepth: 0, queueCapacity: 10 }
      : type === 'companyResearch' ? { sectorId: id, version: 1, sessionId: id, item, brief: 'TEST baseline task', acceptance: ['TEST criterion'] }
      : { sectorId: id, sessionId: id, maxPagesPerTemplate: 1 }
    const handle = await client.workflow.start(type, { workflowId: id, taskQueue: laneConfig(['sessionRun', 'subagentRun', 'companyResearch'].includes(type) ? 'turn' : 'research').taskQueue, args: [input] })
    handles.push(handle)
    if (type === 'sessionRun') await handle.signal('runSend', 'TEST baseline message')
    if (type === 'subagentRun') {
      await handle.signal('childMessage', 'TEST baseline message')
      await vi.waitFor(() => { expect(replies.has(`agent:${id}`)).toBe(true) }, { timeout: 10000 })
      await handle.signal('childFinish')
    }
    await handle.result()
    const history = await handle.fetchHistory()
    const serialized = JSON.stringify(history)
    const record = { type, workflowId: id, runId: (await handle.describe()).runId, path: `${type}.json`, sha256: createHash('sha256').update(serialized).digest('hex'), events: history.events?.length ?? 0, outcome: 'pending' }
    records.push(record)
    writeFileSync(join(directory, record.path), serialized)
    await Worker.runReplayHistory({ workflowBundle: ['sessionRun', 'subagentRun', 'companyResearch'].includes(type) ? currentTurn : currentResearch }, history, id)
    record.outcome = 'replayed'
    expect(record.events).toBeGreaterThan(5)
  }, 120000)
})
