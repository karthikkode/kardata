// Deep-research pipeline workflow (B2.5). Live proof against compose
// Temporal: the evidence model is indexed before presentation (the reported
// report equals the agents assembler run over event-sourced findings), the
// refusal fixture takes the refusal branch with a logged reason, and
// pause-then-resume continues at the next incomplete stage with zero
// re-executed activities (stage_started markers never outnumber questions).
// Gated by KARDATA_TEMPORAL_TEST=1; without the flag every test skips.
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
import { runResearchStageActivity } from '../../backend/src/temporal/activities/research.js'
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
  'research.ts',
)

interface StoredEvent {
  type: string
  payload: Record<string, unknown>
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

describe.skipIf(!ENABLED)('deep-research pipeline workflow (B2.5)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let run: Promise<void>

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    url = await ensureTestDb('kardata_test_research')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'research',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { appendEventActivity, runResearchStageActivity },
      taskQueue: `kardata-test-research-${Date.now()}`,
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

  async function startRun(runId: string, scope: string, questions: string[]) {
    return client.workflow.start('researchRun', {
      taskQueue: (worker.options as { taskQueue: string }).taskQueue,
      workflowId: `research-run-${runId}`,
      args: [{ runId, scope, questions }],
    })
  }

  it('indexes evidence before presenting: the report equals the assembler over logged findings', async () => {
    const runId = `pipe-${Date.now()}`
    const questions = ['what powers the grid?', 'who maintains the relays?', 'where are the spares?']
    const handle = await startRun(runId, 'grid reliability', questions)
    expect(await handle.result()).toBe('reported')

    const rows = await events(runId)
    // Every stage executed exactly once and completed with its findings.
    expect(ofType(rows, 't.research.stage_started')).toHaveLength(3)
    const completed = ofType(rows, 't.research.stage_completed')
    expect(completed).toHaveLength(3)
    expect(completed.map((row) => (row.payload['question'] as string))).toEqual(questions)

    // Index-before-presentation: replay the report from the logged stage
    // completions with the REAL agents assembler and demand equality with
    // what the workflow presented.
    const logged = completed.flatMap((row) => (row.payload['findings'] as Finding[]))
    expect(logged).toHaveLength(3)
    const [reported] = ofType(rows, 't.research.reported')
    if (!reported) throw new Error('missing reported event')
    expect(reported.payload['report']).toBe(assembleReport(logged))
    expect(reported.payload['findingsCount']).toBe(3)
  }, 120_000)

  it('the refusal fixture takes the refusal branch with the reason logged', async () => {
    const runId = `ref-${Date.now()}`
    const handle = await startRun(runId, 'empty topic', ['refuse: classified', 'refuse: redacted'])
    expect(await handle.result()).toBe('refused')

    const rows = await events(runId)
    // The stages ran (started markers prove it) but captured nothing.
    expect(ofType(rows, 't.research.stage_started')).toHaveLength(2)
    for (const row of ofType(rows, 't.research.stage_completed')) {
      expect(row.payload['findings']).toEqual([])
    }
    const [refused] = ofType(rows, 't.research.refused')
    if (!refused) throw new Error('missing refused event')
    expect(refused.payload['reason']).toContain('zero evidence')
    expect(ofType(rows, 't.research.reported')).toHaveLength(0)
  }, 120_000)

  it('pause-then-resume continues at the next incomplete stage with zero re-executed activities', async () => {
    const runId = `pz-${Date.now()}`
    const questions = ['first question', 'second question', 'third question', 'fourth question']
    const handle = await startRun(runId, 'pause drill', questions)

    // Let exactly one stage complete, then pause mid-second-stage.
    await waitFor(async () => ofType(await events(runId), 't.research.stage_completed').length >= 1, 30_000, 'first stage')
    await handle.signal('researchPause')
    await waitFor(
      async () => ((await handle.query('researchState')) as { status: string }).status === 'paused',
      15_000,
      'paused',
    )
    // The in-flight stage finishes, but no new stage starts while paused:
    // started markers freeze for longer than a stage takes.
    await sleep(3_000)
    const frozen = ofType(await events(runId), 't.research.stage_started').length
    expect(frozen).toBeLessThanOrEqual(2)
    await sleep(2_000)
    expect(ofType(await events(runId), 't.research.stage_started')).toHaveLength(frozen)
    const cursorWhilePaused = ((await handle.query('researchState')) as { cursor: number }).cursor
    expect(cursorWhilePaused).toBeLessThan(questions.length)

    await handle.signal('researchResume')
    expect(await handle.result()).toBe('reported')

    const rows = await events(runId)
    // Zero re-execution: one started marker per question, one completion each.
    expect(ofType(rows, 't.research.stage_started')).toHaveLength(4)
    expect(ofType(rows, 't.research.stage_completed')).toHaveLength(4)
    // The pre-pause stage's findings survived the resume and reached the report.
    const logged = ofType(rows, 't.research.stage_completed').flatMap((row) => row.payload['findings'] as Finding[])
    const [reported] = ofType(rows, 't.research.reported')
    if (!reported) throw new Error('missing reported event')
    expect(reported.payload['report']).toBe(assembleReport(logged))
    expect(logged.map((finding) => finding.claim)).toEqual(questions)
  }, 180_000)
})
