// F4-F5 worker SIGKILL drills: the turn worker runs out-of-process
// (kill-worker.mjs on backend dist) so the parent can SIGKILL it mid-turn,
// then spawn a replacement on the same task queue. Activity retries re-run
// every round with stable (run,round,index) operationIds (P4.2.7) against
// the REAL in-process /mcp (app.inject, open mode) over the real DB: the
// drills prove the server executed the delegate once (one result receipt,
// one launched child) and replayed the recorded response on retry, plus
// an unduplicated transcript. Each drill runs in a throwaway Temporal
// namespace, so the turn-queue worker never sees owner turns.
// Fault suite, skipped explicitly without KARDATA_TEMPORAL_TEST,
// TEST_DATABASE_URL, and KARDATA_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client as WorkflowClient, Connection, type WorkflowHandle } from '@temporalio/client'
import { msToTs } from '@temporalio/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent as appendDbEvent, createSector, getThread } from '../../backend/src/db/index.js'
import { connectClient } from '../../backend/src/temporal/connection.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'
import { sleep } from './toxiproxy.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const KILL_WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'kill-worker.mjs')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIST_NEEDS = [
  'backend/dist/temporal/activities/turn.js',
  'backend/dist/temporal/activities/turn-rounds.js',
  'backend/dist/temporal/activities/turn-palettes.js',
  'backend/dist/temporal/activities/execution-epochs.js',
  'backend/dist/temporal/connection.js',
  'backend/dist/temporal/runs-gateway.js',
  'backend/dist/temporal/worker.js',
  'backend/dist/app.js',
  'agents/dist/index.js',
]

async function waitForChild(condition: () => Promise<boolean>, child: ChildProcess, stderr: { text: string }, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (await condition()) return
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`TEST child worker exited early (code=${child.exitCode} signal=${child.signalCode}) waiting for ${what}: ${stderr.text.slice(-2000)}`)
    }
    if (Date.now() - started > timeoutMs) throw new Error(`TEST timeout waiting for ${what}: ${stderr.text.slice(-2000)}`)
    await sleep(250)
  }
}

describe.skipIf(!ENABLED || !TEST_DATABASE_URL)('worker SIGKILL drills F4-F5 [F:backend.workflow.run.sessionRun] [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.appendEventActivity] [F:agents.turnRunner.toolOperationId]', () => {
  let pool: Pool
  let connection: Connection
  let databaseUrl = ''
  let effectsDir = ''
  let mcpToken = ''
  const children: ChildProcess[] = []

  beforeAll(async () => {
    for (const rel of DIST_NEEDS) {
      if (!existsSync(join(ROOT, rel))) throw new Error(`TEST fault kill drills need ${rel}: run npm run build -w backend and -w @kardata/agents first`)
    }
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    databaseUrl = await ensureTestDb('kardata_test_fault_kill')
    process.env['DATABASE_URL'] = databaseUrl
    pool = new Pool({ connectionString: databaseUrl })
    connection = await connectClient()
    mcpToken = randomUUID()
    effectsDir = mkdtempSync(join(tmpdir(), 'fault-kill-'))
  }, 120_000)

  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await once(child, 'exit').catch(() => undefined)
      }
    }
    await pool?.end()
    await connection?.close()
  })

  function spawnWorker(script: 'f4' | 'f5', taskQueue: string, markerFile: string, archiveDir: string, namespace: string): { child: ChildProcess; stderr: { text: string } } {
    const stderr = { text: '' }
    const child = spawn(process.execPath, [KILL_WORKER_PATH], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TEMPORAL_ADDRESS: ADDRESS,
        TEMPORAL_NAMESPACE: namespace,
        FAULT_TASK_QUEUE: taskQueue,
        FAULT_SCRIPT: script,
        FAULT_MARKER: markerFile,
        FAULT_ARCHIVE_DIR: archiveDir,
        FAULT_MCP_TOKEN: mcpToken,
        KARDATA_PROVIDER: 'fake',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.text = `${stderr.text}${chunk.toString()}`.slice(-20000)
    })
    children.push(child)
    return { child, stderr }
  }

  async function drillNamespace(tag: string): Promise<{ namespace: string; client: WorkflowClient }> {
    const namespace = `kardata-test-fault-kill-${tag}-${Date.now()}-${randomUUID().slice(0, 8)}`
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86_400_000) })
    return { namespace, client: new WorkflowClient({ connection, namespace }) }
  }

  async function startTurn(text: string, taskQueue: string, worker: { child: ChildProcess; stderr: { text: string } }, nsClient: WorkflowClient): Promise<{ sessionId: string; handle: WorkflowHandle }> {
    const sessionId = `TEST-kill-${randomUUID()}`
    const sectorId = `sector-${randomUUID()}`
    await createSector(pool, { name: `TEST kill ${sectorId}`, sectorId, idempotencyKey: `fault-kill-sector:${sectorId}` })
    await appendDbEvent(pool, {
      idempotencyKey: `fault-kill-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST kill ${sessionId}`, sectorId, tenantId: 'TEST worker kill', projectId: null },
    })
    await projectNewEvents(pool)
    const handle = await nsClient.workflow.start('sessionRun', { taskQueue, workflowId: `TEST-kill-${sessionId}`, args: [{ sessionId }] })
    await waitForChild(async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING', worker.child, worker.stderr, 120_000, 'run')
    await handle.signal('runSend', text)
    return { sessionId, handle }
  }

  async function texts(sessionId: string): Promise<string[]> {
    await projectNewEvents(pool)
    const thread = await getThread(pool, sessionId)
    return (thread?.messages ?? [])
      .filter((message) => message.kind === 'text')
      .map((message) => (message.payload as Record<string, unknown>)['text'] as string)
  }

  async function attemptSet(sessionId: string): Promise<number[]> {
    await projectNewEvents(pool)
    const { rows } = await pool.query<{ attempt: number }>(
      'SELECT DISTINCT attempt FROM execution_rounds WHERE thread_key = $1 ORDER BY attempt ASC',
      [sessionId],
    )
    return rows.map((row) => row.attempt)
  }

  async function roundOneOk(sessionId: string): Promise<boolean> {
    await projectNewEvents(pool)
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM execution_rounds WHERE thread_key = $1 AND attempt = 1 AND outcome = 'ok'",
      [sessionId],
    )
    return Number(rows[0]?.count ?? 0) > 0
  }

  async function attemptStartedAt(sessionId: string, attempt: number): Promise<number | undefined> {
    await projectNewEvents(pool)
    const { rows } = await pool.query<{ at: Date }>(
      'SELECT MIN(started_at) AS at FROM execution_rounds WHERE thread_key = $1 AND attempt = $2',
      [sessionId, attempt],
    )
    const at = rows[0]?.at
    return at ? at.getTime() : undefined
  }

  async function childCount(sessionId: string): Promise<number> {
    await projectNewEvents(pool)
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM threads WHERE session_id = $1 AND kind = 'subagent'`,
      [sessionId],
    )
    return Number(rows[0]?.count ?? 0)
  }

  async function delegateReceipts(sessionId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM events WHERE partition = $1 AND type = 't.operation.result' AND payload->>'toolName' = 'db.delegate_subagent'`,
      [sessionId],
    )
    return Number(rows[0]?.count ?? 0)
  }

  it('F4: SIGKILL in round 2 resumes on a new worker with exactly-once effects', async () => {
    const taskQueue = `kardata-test-fault-kill-f4-${Date.now()}`
    const { namespace, client: nsClient } = await drillNamespace('f4')
    const archiveDir = join(effectsDir, `f4-${randomUUID()}-archive`)
    const first = spawnWorker('f4', taskQueue, '', archiveDir, namespace)
    const { sessionId, handle } = await startTurn('F4 hello', taskQueue, first, nsClient)
    await waitForChild(async () => roundOneOk(sessionId), first.child, first.stderr, 180_000, 'round 1 ok (round 2 hanging)')
    const killAt = Date.now()
    first.child.kill('SIGKILL')
    await once(first.child, 'exit')
    expect(first.child.signalCode).toBe('SIGKILL')
    const second = spawnWorker('f4', taskQueue, '', archiveDir, namespace)
    await waitForChild(async () => (await texts(sessionId)).includes('TEST round two done'), second.child, second.stderr, 180_000, 'resumed reply')
    const recoveredAt = Date.now()
    expect(await attemptSet(sessionId)).toEqual([1, 2])
    // The delegate executed once (one result receipt) and launched one
    // child; the retry replayed the recorded response.
    expect(await delegateReceipts(sessionId)).toBe(1)
    expect(await childCount(sessionId)).toBe(1)
    const posted = await texts(sessionId)
    expect(posted.filter((text) => text === 'F4 hello').length).toBe(1)
    expect(posted.filter((text) => text === 'TEST round two done').length).toBe(1)
    const attemptTwoAt = await attemptStartedAt(sessionId, 2)
    expect(attemptTwoAt).toBeDefined()
    const detectionMs = attemptTwoAt! - killAt
    expect(detectionMs).toBeGreaterThanOrEqual(15_000)
    expect(detectionMs).toBeLessThan(120_000)
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
    console.log(`[fault F4] detectionMs=${detectionMs} recoveryMs=${recoveredAt - killAt} children=1 receipts=1`)
  }, 300_000)

  it('F5: SIGKILL right after delegate yields exactly 1 child', async () => {
    const taskQueue = `kardata-test-fault-kill-f5-${Date.now()}`
    const { namespace, client: nsClient } = await drillNamespace('f5')
    const markerFile = join(effectsDir, `f5-${randomUUID()}.marker`)
    const archiveDir = join(effectsDir, `f5-${randomUUID()}-archive`)
    const first = spawnWorker('f5', taskQueue, markerFile, archiveDir, namespace)
    const { sessionId, handle } = await startTurn('F5 hello', taskQueue, first, nsClient)
    await waitForChild(async () => existsSync(markerFile), first.child, first.stderr, 180_000, 'delegate marker')
    first.child.kill('SIGKILL')
    await once(first.child, 'exit')
    expect(first.child.signalCode).toBe('SIGKILL')
    const second = spawnWorker('f5', taskQueue, markerFile, archiveDir, namespace)
    await waitForChild(async () => (await texts(sessionId)).includes('TEST round two done'), second.child, second.stderr, 180_000, 'resumed reply')
    expect(await attemptSet(sessionId)).toEqual([1, 2])
    expect(await delegateReceipts(sessionId)).toBe(1)
    expect(await childCount(sessionId)).toBe(1)
    const posted = await texts(sessionId)
    expect(posted.filter((text) => text === 'TEST round two done').length).toBe(1)
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
    console.log('[fault F5] children=1 receipts=1')
  }, 300_000)
})
