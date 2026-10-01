// Read-only legacy history compatibility gate: no workflows/activities are started.
// Only counts/hashes are retained; research payloads stay out of test reports/logs.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { temporal } from '@temporalio/proto'
import { Client, type Connection } from '@temporalio/client'
import { bundleWorkflowCode, Runtime, Worker, type WorkflowBundle } from '@temporalio/worker'
import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectClient, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createWorkerLogger } from '../../backend/src/observability/logging.js'

const ROOT = join(import.meta.dirname, '..', '..')
const ENABLED = process.env['KARDATA_LEGACY_REPLAY'] === '1'
// Main baseline e454d44 was committed at this instant, before this hardening branch.
const PINNED_CUTOFF = '2026-09-30T16:44:46Z'
const CUTOFF = process.env['KARDATA_REPLAY_CUTOFF'] ?? PINNED_CUTOFF
function checkedCutoff(raw = PINNED_CUTOFF): string {
  if (Date.parse(raw) !== Date.parse(PINNED_CUTOFF)) throw new TypeError('Historical replay cutoff must equal the pinned baseline instant.')
  return raw
}
const BASELINE = 'e454d44e1625c28b117a227c0650a891532cd39f'
const ControlledManifest = z.object({ version: z.literal(1), origin: z.literal('controlled_baseline'), baselineCommit: z.literal(BASELINE), namespace: z.string().startsWith('test-baseline-'), at: z.string().datetime(), bundleHashes: z.object({ turn: z.string().regex(/^[a-f0-9]{64}$/), research: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), histories: z.array(z.object({ type: z.string(), workflowId: z.string().startsWith('TEST-baseline-'), runId: z.string().uuid(), path: z.string().regex(/^[a-zA-Z]+\.json$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), events: z.number().int().positive(), outcome: z.literal('replayed') }).strict()) }).strict()
const TYPES = ['sessionRun', 'subagentRun', 'companyResearch', 'sectorPlan', 'sectorSweep', 'sectorCoordinator'] as const

describe('pinned historical replay cutoff', () => {
  it('accepts only the baseline instant', () => {
    expect(checkedCutoff()).toBe(PINNED_CUTOFF)
    expect(checkedCutoff('2026-09-30T16:44:46+00:00')).toBe('2026-09-30T16:44:46+00:00')
  })
  it.each(['2000-01-01T00:00:00Z', '2026-10-01T00:00:00Z', 'invalid'])('rejects cutoff movement: %s', (raw) => {
    expect(() => checkedCutoff(raw)).toThrow('pinned baseline')
  })
})

describe.skipIf(!ENABLED)('legacy workflow history replay', () => {
  let connection: Connection
  let client: Client
  let turn: WorkflowBundle
  let research: WorkflowBundle
  const coverage: Array<{ type: string; histories: number; outcome: string; origin: 'historical' | 'controlled_baseline' }> = []
  let controlled: z.infer<typeof ControlledManifest> | undefined
  let controlledDirectory = ''
  const evidence: Array<{ type: string; workflowId: string; runId: string; events: number; sha256: string; outcome: string }> = []
  beforeAll(async () => {
    checkedCutoff(CUTOFF)
    Runtime.install({ logger: createWorkerLogger() })
    connection = await connectClient()
    client = new Client({ connection, namespace: temporalNamespace() })
    turn = await bundleWorkflowCode({ workflowsPath: join(ROOT, 'backend/src/temporal/workflows/turn-bundle.ts') })
    research = await bundleWorkflowCode({ workflowsPath: join(ROOT, 'backend/src/temporal/workflows/research-bundle.ts') })
    if (process.env['KARDATA_BASELINE_REPLAY_REPORT']) {
      const path = resolve(process.env['KARDATA_BASELINE_REPLAY_REPORT'])
      expect(path.startsWith(resolve(ROOT, 'backend/test-results') + sep)).toBe(true)
      controlled = ControlledManifest.parse(JSON.parse(readFileSync(path, 'utf8')))
      controlledDirectory = dirname(path)
      const baseline = process.env['KARDATA_BASELINE_ROOT']
      expect(baseline, 'Controlled fallback requires the exact baseline checkout.').toBeTruthy()
      expect(execFileSync('git', ['-C', baseline!, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(BASELINE)
      expect(execFileSync('git', ['-C', baseline!, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()).toBe('')
      for (const kind of ['turn', 'research'] as const) {
        const bundle = await bundleWorkflowCode({ workflowsPath: join(baseline!, `backend/src/temporal/workflows/${kind}-bundle.ts`) })
        expect(createHash('sha256').update(bundle.code).digest('hex')).toBe(controlled.bundleHashes[kind])
      }
    }
  }, 60_000)
  afterAll(async () => {
    await connection?.close()
    if (coverage.length) {
      const dir = join(ROOT, 'backend/test-results')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'legacy-replay.report.json'), JSON.stringify({ cutoff: CUTOFF, namespace: temporalNamespace(), coverage, histories: evidence }, null, 2))
    }
  })
  it.each(TYPES)('replays pre-hardening %s histories with current code', async (type) => {
    let count = 0
    const result: (typeof coverage)[number] = { type, histories: 0, outcome: 'no_history', origin: 'historical' }
    coverage.push(result)
    for await (const info of client.workflow.list({ query: `WorkflowType = '${type}' AND StartTime < '${CUTOFF}'`, pageSize: 3 })) {
      const history = await client.workflow.getHandle(info.workflowId, info.runId).fetchHistory()
      const record = { type, workflowId: info.workflowId, runId: info.runId, events: history.events?.length ?? 0, sha256: createHash('sha256').update(JSON.stringify(history)).digest('hex'), outcome: 'pending' }
      evidence.push(record)
      try {
        await Worker.runReplayHistory({ workflowBundle: ['sessionRun', 'subagentRun', 'companyResearch'].includes(type) ? turn : research }, history, info.workflowId)
        record.outcome = 'replayed'
      } catch (error) { result.outcome = 'replay_failed'; record.outcome = error instanceof Error ? error.constructor.name : 'replay_failed'; throw error }
      count += 1
      result.histories = count; result.outcome = 'replayed'
      if (count === 3) break
    }
    if (count === 0 && controlled) {
      const matches = controlled.histories.filter((record) => record.type === type)
      expect(matches).toHaveLength(1)
      const fixture = matches[0]!
      expect(fixture.path).toBe(`${type}.json`)
      const bytes = readFileSync(join(controlledDirectory, fixture.path))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256)
      const history = JSON.parse(bytes.toString('utf8')) as { events?: Array<{ workflowExecutionStartedEventAttributes?: { workflowType?: { name?: string } } }> }
      expect(history.events?.length).toBe(fixture.events)
      expect(history.events?.[0]?.workflowExecutionStartedEventAttributes?.workflowType?.name).toBe(type)
      await Worker.runReplayHistory({ workflowBundle: ['sessionRun', 'subagentRun', 'companyResearch'].includes(type) ? turn : research }, temporal.api.history.v1.History.fromObject(history), fixture.workflowId)
      count = 1
      result.histories = 1; result.outcome = 'replayed'; result.origin = 'controlled_baseline'
      evidence.push({ type, workflowId: fixture.workflowId, runId: fixture.runId, events: fixture.events, sha256: fixture.sha256, outcome: 'controlled_baseline_replayed' })
    }
    // Missing histories are an explicit acceptance gap, not a silently passing test.
    expect(count, `No pre-hardening ${type} history was available; replay remains unverified.`).toBeGreaterThan(0)
  }, 120_000)
})
