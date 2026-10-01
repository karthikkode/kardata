// Read-only legacy history compatibility gate: no workflows/activities are started.
// Only counts/hashes are retained; research payloads stay out of test reports/logs.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client, type Connection } from '@temporalio/client'
import { bundleWorkflowCode, Runtime, Worker, type WorkflowBundle } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectClient, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createWorkerLogger } from '../../backend/src/observability/logging.js'

const ROOT = join(import.meta.dirname, '..', '..')
const ENABLED = process.env['KARDATA_LEGACY_REPLAY'] === '1'
// Main baseline e454d44 was committed at this instant, before this hardening branch.
const CUTOFF = process.env['KARDATA_REPLAY_CUTOFF'] ?? '2026-09-30T16:44:46Z'
const TYPES = ['sessionRun', 'subagentRun', 'companyResearch', 'sectorPlan', 'sectorSweep', 'sectorCoordinator'] as const

describe.skipIf(!ENABLED)('legacy workflow history replay', () => {
  let connection: Connection
  let client: Client
  let turn: WorkflowBundle
  let research: WorkflowBundle
  const coverage: Array<{ type: string; histories: number; outcome: string }> = []
  const evidence: Array<{ type: string; workflowId: string; runId: string; events: number; sha256: string; outcome: string }> = []
  beforeAll(async () => {
    expect(Number.isFinite(Date.parse(CUTOFF))).toBe(true)
    Runtime.install({ logger: createWorkerLogger() })
    connection = await connectClient()
    client = new Client({ connection, namespace: temporalNamespace() })
    turn = await bundleWorkflowCode({ workflowsPath: join(ROOT, 'backend/src/temporal/workflows/turn-bundle.ts') })
    research = await bundleWorkflowCode({ workflowsPath: join(ROOT, 'backend/src/temporal/workflows/research-bundle.ts') })
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
    const result = { type, histories: 0, outcome: 'no_history' }
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
    // Missing histories are an explicit acceptance gap, not a silently passing test.
    expect(count, `No pre-hardening ${type} history was available; replay remains unverified.`).toBeGreaterThan(0)
  }, 120_000)
})
