// F4-F5 worker SIGKILL drills: the turn worker runs out-of-process
// (kill-worker.mjs on backend dist) so the parent can SIGKILL it mid-turn,
// then spawn a replacement on the same task queue. Activity retries re-run
// every round with stable (run,round,index) operationIds (P4.2.7); the
// file-backed mock MCP dedupes by key like the real server (F12), so the
// drills prove exactly-once effects plus an unduplicated transcript.
// Fault suite, skipped explicitly without KARDATA_TEMPORAL_TEST,
// TEST_DATABASE_URL, and KARDATA_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client as WorkflowClient, Connection, type WorkflowHandle } from '@temporalio/client'
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
  'backend/dist/temporal/connection.js',
  'backend/dist/temporal/worker.js',
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
  let client: WorkflowClient
  let connection: Connection
  let databaseUrl = ''
  let effectsDir = ''
  const children: ChildProcess[] = []

  beforeAll(async () => {
    for (const rel of DIST_NEEDS) {
      if (!existsSync(join(ROOT, rel))) throw new Error(`TEST fault kill drills need ${rel}: run npm run build -w backend first`)
    }
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    databaseUrl = await ensureTestDb('kardata_test_fault_kill')
    process.env['DATABASE_URL'] = databaseUrl
    pool = new Pool({ connectionString: databaseUrl })
    connection = await connectClient()
    client = new WorkflowClient({ connection })
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

  function spawnWorker(script: 'f4' | 'f5', taskQueue: string, effectsFile: string, markerFile: string, archiveDir: string): { child: ChildProcess; stderr: { text: string } } {
    const stderr = { text: '' }
    const child = spawn(process.execPath, [KILL_WORKER_PATH], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TEMPORAL_ADDRESS: ADDRESS,
        FAULT_TASK_QUEUE: taskQueue,
        FAULT_SCRIPT: script,
        FAULT_EFFECTS: effectsFile,
        FAULT_MARKER: markerFile,
        FAULT_ARCHIVE_DIR: archiveDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.text = `${stderr.text}${chunk.toString()}`.slice(-20000)
    })
    children.push(child)
    return { child, stderr }
  }

  async function startTurn(text: string, taskQueue: string, worker: { child: ChildProcess; stderr: { text: string } }): Promise<{ sessionId: string; handle: WorkflowHandle }> {
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
    const handle = await client.workflow.start('sessionRun', { taskQueue, workflowId: `TEST-kill-${sessionId}`, args: [{ sessionId }] })
    await waitForChild(async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING', worker.child, worker.stderr, 60_000, 'run')
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

  function effectLines(effectsFile: string): { calls: string[]; effects: string[] } {
    const lines = existsSync(effectsFile) ? readFileSync(effectsFile, 'utf8').split('\n').filter(Boolean) : []
    return {
      calls: lines.filter((line) => line.startsWith('call ')),
      effects: lines.filter((line) => line.startsWith('effect ')),
    }
  }

  it('F4: SIGKILL in round 2 resumes on a new worker with exactly-once effects', async () => {
    const taskQueue = `kardata-test-fault-kill-f4-${Date.now()}`
    const effectsFile = join(effectsDir, `f4-${randomUUID()}.log`)
    const archiveDir = join(effectsDir, `f4-${randomUUID()}-archive`)
    const first = spawnWorker('f4', taskQueue, effectsFile, '', archiveDir)
    const { sessionId, handle } = await startTurn('F4 hello', taskQueue, first)
    await waitForChild(async () => roundOneOk(sessionId), first.child, first.stderr, 180_000, 'round 1 ok (round 2 hanging)')
    const killAt = Date.now()
    first.child.kill('SIGKILL')
    await once(first.child, 'exit')
    expect(first.child.signalCode).toBe('SIGKILL')
    const second = spawnWorker('f4', taskQueue, effectsFile, '', archiveDir)
    await waitForChild(async () => (await texts(sessionId)).includes('TEST round two done'), second.child, second.stderr, 180_000, 'resumed reply')
    const recoveredAt = Date.now()
    expect(await attemptSet(sessionId)).toEqual([1, 2])
    const { calls, effects } = effectLines(effectsFile)
    expect(calls.length).toBe(2)
    const keys = calls.map((line) => line.split(' ')[2])
    expect(keys[0]?.endsWith(':1:0')).toBe(true)
    expect(keys[0]).toBe(keys[1])
    expect(effects).toEqual([`effect ${keys[0]}`])
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
    console.log(`[fault F4] detectionMs=${detectionMs} recoveryMs=${recoveredAt - killAt} effects=1 calls=2 same-key`)
  }, 300_000)

  it('F5: SIGKILL right after delegate yields exactly 1 child', async () => {
    const taskQueue = `kardata-test-fault-kill-f5-${Date.now()}`
    const effectsFile = join(effectsDir, `f5-${randomUUID()}.log`)
    const markerFile = join(effectsDir, `f5-${randomUUID()}.marker`)
    const archiveDir = join(effectsDir, `f5-${randomUUID()}-archive`)
    const first = spawnWorker('f5', taskQueue, effectsFile, markerFile, archiveDir)
    const { sessionId, handle } = await startTurn('F5 hello', taskQueue, first)
    await waitForChild(async () => existsSync(markerFile), first.child, first.stderr, 180_000, 'delegate marker')
    first.child.kill('SIGKILL')
    await once(first.child, 'exit')
    expect(first.child.signalCode).toBe('SIGKILL')
    const second = spawnWorker('f5', taskQueue, effectsFile, markerFile, archiveDir)
    await waitForChild(async () => (await texts(sessionId)).includes('TEST round two done'), second.child, second.stderr, 180_000, 'resumed reply')
    expect(await attemptSet(sessionId)).toEqual([1, 2])
    const { calls, effects } = effectLines(effectsFile)
    expect(calls.length).toBe(2)
    const keys = calls.map((line) => line.split(' ')[2])
    expect(keys[0]?.endsWith(':1:0')).toBe(true)
    expect(keys[0]).toBe(keys[1])
    expect(effects).toEqual([`effect ${keys[0]}`])
    const posted = await texts(sessionId)
    expect(posted.filter((text) => text === 'TEST round two done').length).toBe(1)
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
    console.log('[fault F5] children=1 calls=2 same-key')
  }, 300_000)
})
