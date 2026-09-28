// Research loop + time guards (B2.6). Live proof against compose Temporal:
// a synthetic A→B→A-without-progress route suspends within its attempt bound
// with the reason logged, an over-budget run suspends instead of running on,
// and an unauthorized resume is denied and logged while the run stays
// suspended. Gated by KARDATA_TEMPORAL_TEST=1; without it every test skips.
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { assembleReport, type Finding } from '@kardata/agents'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPartition } from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { appendEventActivity } from '../../backend/src/temporal/activities/turn.js'
import {
  detectLoopActivity,
  runGuardedStageActivity,
} from '../../backend/src/temporal/activities/loopguards.js'
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
  'loopguards.ts',
)

interface StoredEvent {
  type: string
  payload: Record<string, unknown>
}

interface GuardState {
  status: string
  cursor: number
  suspendKind?: string
  suspendReason?: string
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

describe.skipIf(!ENABLED)('research loop and time guards (B2.6)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let run: Promise<void>

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    url = await ensureTestDb('kardata_test_loopguards')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'research',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { appendEventActivity, runGuardedStageActivity, detectLoopActivity },
      taskQueue: `kardata-test-loopguards-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    await run
    await connection.close()
    delete process.env['DATABASE_URL']
  }, 60_000)

  async function events(runId: string): Promise<StoredEvent[]> {
    const pool = new Pool({ connectionString: url })
    try {
      const rows = await readPartition(pool, `research:${runId}`)
      return rows.map((row) => ({ type: row.type, payload: row.payload as Record<string, unknown> }))
    } finally {
      await pool.end()
    }
  }

  function ofType(rows: StoredEvent[], type: string): StoredEvent[] {
    return rows.filter((row) => row.type === type)
  }

  async function startGuarded(
    runId: string,
    route: string[],
    budgets: { unitBudgetMs: number; runBudgetMs: number; maxFruitlessRevisits: number; suspendTimeoutMs?: number },
  ) {
    const handle = await client.workflow.start('guardedResearchRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `guarded-run-${runId}`,
      args: [{ runId, scope: 'guard drill', route, ...budgets }],
    })
    await waitFor(
      async () => (await events(runId)).some((event) => event.type === 't.research.started'),
      30_000,
      'guarded run to start',
    )
    return handle
  }

  async function waitSuspended(handle: { query: (name: string) => Promise<unknown> }): Promise<GuardState> {
    let state = (await handle.query('guardState')) as GuardState
    await waitFor(
      async () => {
        state = (await handle.query('guardState')) as GuardState
        return state.status === 'suspended'
      },
      60_000,
      'suspend',
    )
    return state
  }

  it('a synthetic A→B→A-without-progress loop suspends within its attempt bound', async () => {
    const runId = `loop-${Date.now()}`
    const handle = await startGuarded(runId, ['A', 'B', 'A'], {
      unitBudgetMs: 30_000,
      runBudgetMs: 120_000,
      maxFruitlessRevisits: 1,
    })

    const state = await waitSuspended(handle)
    expect(state.suspendKind).toBe('loop')
    expect(state.suspendReason).toContain("'A'")
    // The loop died on the third visit: cursor never advanced past it.
    expect(state.cursor).toBe(2)

    const rows = await events(runId)
    // Per-run stage-attempt counters: one execution row per visit.
    const attempts = ofType(rows, 't.research.stage_attempt')
    expect(attempts.map((row) => row.payload['visitIndex'])).toEqual([0, 1, 2])
    for (const row of attempts) expect(row.payload['attempt']).toBeGreaterThanOrEqual(1)
    // The detector logged its finding with the reason.
    const [finding] = ofType(rows, 't.research.loop_finding')
    if (!finding) throw new Error('missing loop finding')
    expect(finding.payload['kind']).toBe('repeated-calls')
    const [suspended] = ofType(rows, 't.research.suspended')
    if (!suspended) throw new Error('missing suspended event')
    expect(suspended.payload['kind']).toBe('loop')

    // Approved operator resume clears the detector window and finishes.
    await handle.signal('guardResume', { approved: true })
    expect(await handle.result()).toBe('reported')
    const done = await events(runId)
    const logged = ofType(done, 't.research.stage_completed').flatMap((row) => row.payload['findings'] as Finding[])
    const [reported] = ofType(done, 't.research.reported')
    if (!reported) throw new Error('missing reported event')
    expect(reported.payload['report']).toBe(assembleReport(logged))
  }, 180_000)

  it('an over-budget run suspends and resumes only on an approved extended budget', async () => {
    const runId = `budget-${Date.now()}`
    // Stages need 1.2 s of scripted work: a 700 ms unit budget always trips.
    const handle = await startGuarded(runId, ['S1', 'S2'], {
      unitBudgetMs: 700,
      runBudgetMs: 120_000,
      maxFruitlessRevisits: 5,
    })

    const state = await waitSuspended(handle)
    expect(state.suspendKind).toBe('unit-budget')
    expect(state.suspendReason).toContain("'S1'")
    expect(state.cursor).toBe(0)

    const rows = await events(runId)
    // The interrupted visit executed (attempt row) but never completed.
    expect(ofType(rows, 't.research.stage_attempt')).toHaveLength(1)
    expect(ofType(rows, 't.research.stage_completed')).toHaveLength(0)
    const child = client.workflow.getHandle(`guarded-run-${runId}`)
    const history = await child.fetchHistory()
    const canceled = (history.events ?? []).filter((event) => 'activityTaskCanceledEventAttributes' in event)
    expect(canceled.length).toBeGreaterThanOrEqual(1)

    // Approved resume with an extended budget retries the visit and finishes.
    await handle.signal('guardResume', { approved: true, extendUnitMs: 30_000 })
    expect(await handle.result()).toBe('reported')
    const done = await events(runId)
    expect(ofType(done, 't.research.stage_completed')).toHaveLength(2)
    expect(ofType(done, 't.research.resumed')).toHaveLength(1)
  }, 180_000)

  it('an unauthorized resume is denied and the run stays suspended', async () => {
    const runId = `deny-${Date.now()}`
    const handle = await startGuarded(runId, ['X', 'Y', 'X'], {
      unitBudgetMs: 30_000,
      runBudgetMs: 120_000,
      maxFruitlessRevisits: 1,
    })
    await waitSuspended(handle)

    await handle.signal('guardResume', { approved: false })
    await waitFor(
      async () => ofType(await events(runId), 't.research.resume_denied').length >= 1,
      30_000,
      'denial',
    )
    // Denied: still suspended, no new visit started.
    const state = (await handle.query('guardState')) as GuardState
    expect(state.status).toBe('suspended')
    expect(ofType(await events(runId), 't.research.stage_attempt')).toHaveLength(3)

    await handle.signal('guardResume', { approved: true })
    expect(await handle.result()).toBe('reported')
  }, 180_000)

  it('a suspended run with no operator verdict expires instead of wedging', async () => {
    const runId = `expire-${Date.now()}`
    const handle = await startGuarded(runId, ['X', 'Y', 'X'], {
      unitBudgetMs: 30_000,
      runBudgetMs: 120_000,
      maxFruitlessRevisits: 1,
      suspendTimeoutMs: 5_000,
    })
    await waitSuspended(handle)
    // No resume ever arrives: the suspend wait expires to the terminal tail.
    expect(await handle.result()).toBe('reported')
    const done = await events(runId)
    const [expired] = ofType(done, 't.research.suspend_expired')
    if (!expired) throw new Error('missing suspend_expired event')
    expect(expired.payload['kind']).toBe('loop')
    expect(ofType(done, 't.research.resumed')).toHaveLength(0)
  }, 180_000)
})
