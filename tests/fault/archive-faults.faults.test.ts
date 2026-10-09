// F16 archive-full drill: the turn worker runs out-of-process under
// RLIMIT_FSIZE=1 (prlimit), so every archive write fails EFBIG — the
// closest unprivileged proxy for ENOSPC. The turn must fail honestly with
// an intact DB, and the worker must survive (SIGXFSZ ignored). A stub
// parity test proves ENOSPC/EACCES/EFBIG all surface identically through
// persistExecutionRecord. Fault suite, skipped explicitly without
// KARDATA_TEMPORAL_TEST, TEST_DATABASE_URL, and KARDATA_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client as WorkflowClient, Connection, type WorkflowHandle } from '@temporalio/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { persistExecutionRecord, resolveArchiveTarget, type ArchiveTarget } from '../../backend/src/archive/targets.js'
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
  'backend/dist/archive/targets.js',
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

describe.skipIf(!ENABLED || !TEST_DATABASE_URL)('archive full F16 [F:backend.workflow.run.sessionRun] [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.appendEventActivity]', () => {
  let pool: Pool
  let client: WorkflowClient
  let connection: Connection
  let databaseUrl = ''
  let effectsDir = ''
  let savedArchive: string | undefined
  const children: ChildProcess[] = []

  beforeAll(async () => {
    for (const rel of DIST_NEEDS) {
      if (!existsSync(join(ROOT, rel))) throw new Error(`TEST fault archive drills need ${rel}: run npm run build -w backend first`)
    }
    try {
      execFileSync('prlimit', ['--version'], { stdio: 'ignore' })
    } catch {
      throw new Error('TEST F16 needs prlimit (util-linux) to cap the worker with RLIMIT_FSIZE')
    }
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    databaseUrl = await ensureTestDb('kardata_test_fault_archive')
    process.env['DATABASE_URL'] = databaseUrl
    pool = new Pool({ connectionString: databaseUrl })
    connection = await connectClient()
    client = new WorkflowClient({ connection })
    effectsDir = mkdtempSync(join(tmpdir(), 'fault-archive-full-'))
    savedArchive = process.env['KARDATA_ARCHIVE_DIR']
  }, 120_000)

  afterAll(async () => {
    if (savedArchive === undefined) delete process.env['KARDATA_ARCHIVE_DIR']
    else process.env['KARDATA_ARCHIVE_DIR'] = savedArchive
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await once(child, 'exit').catch(() => undefined)
      }
    }
    await pool?.end()
    await connection?.close()
  })

  async function startTurn(text: string, taskQueue: string, worker: { child: ChildProcess; stderr: { text: string } }): Promise<{ sessionId: string; handle: WorkflowHandle }> {
    const sessionId = `TEST-full-${randomUUID()}`
    const sectorId = `sector-${randomUUID()}`
    await createSector(pool, { name: `TEST full ${sectorId}`, sectorId, idempotencyKey: `fault-full-sector:${sectorId}` })
    await appendDbEvent(pool, {
      idempotencyKey: `fault-full-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST full ${sessionId}`, sectorId, tenantId: 'TEST archive full', projectId: null },
    })
    await projectNewEvents(pool)
    const handle = await client.workflow.start('sessionRun', { taskQueue, workflowId: `TEST-full-${sessionId}`, args: [{ sessionId }] })
    await waitForChild(async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING', worker.child, worker.stderr, 60_000, 'run')
    await handle.signal('runSend', text)
    return { sessionId, handle }
  }

  it('F16: storage-full archive fails the turn honestly with an intact DB', async () => {
    const taskQueue = `kardata-test-fault-full-${Date.now()}`
    const effectsFile = join(effectsDir, `f16-${randomUUID()}.log`)
    const archiveDir = join(effectsDir, `f16-${randomUUID()}-archive`)
    process.env['KARDATA_ARCHIVE_DIR'] = archiveDir
    const stderr = { text: '' }
    const child = spawn(process.execPath, [KILL_WORKER_PATH], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TEMPORAL_ADDRESS: ADDRESS,
        FAULT_TASK_QUEUE: taskQueue,
        FAULT_SCRIPT: 'f16',
        FAULT_EFFECTS: effectsFile,
        FAULT_MARKER: '',
        FAULT_ARCHIVE_DIR: archiveDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.text = `${stderr.text}${chunk.toString()}`.slice(-20000)
    })
    children.push(child)
    execFileSync('prlimit', ['--fsize=1', '--pid', String(child.pid)])
    const { sessionId, handle } = await startTurn('F16 hello', taskQueue, { child, stderr })
    expect(await handle.result()).toBe('error')
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()
    await projectNewEvents(pool)
    const thread = await getThread(pool, sessionId)
    const failed = (thread?.messages ?? []).find((message) =>
      (message.payload as Record<string, unknown>)['failed'] === true,
    )
    expect((failed?.payload as Record<string, unknown> | undefined)?.['text']).toBe('I could not complete that reply. Please try again.')
    const { rows: attempts } = await pool.query<{ attempt: number }>(
      'SELECT DISTINCT attempt FROM execution_rounds WHERE thread_key = $1 ORDER BY attempt ASC',
      [sessionId],
    )
    expect(attempts.map((row) => row.attempt)).toEqual([1, 2, 3])
    const { rows: refs } = await pool.query<{ request_ref: string | null; response_ref: string | null }>(
      'SELECT request_ref, response_ref FROM execution_rounds WHERE thread_key = $1',
      [sessionId],
    )
    expect(refs.length).toBeGreaterThan(0)
    for (const row of refs) {
      expect(row.request_ref).toBeNull()
      expect(row.response_ref).toBeNull()
    }
    expect(await resolveArchiveTarget().list('execution-records')).toEqual([])
    console.log('[fault F16] result=error honest=true worker=alive refs=null archive=empty')
  }, 180_000)

  it('F16 parity: ENOSPC, EACCES, and EFBIG surface identically', async () => {
    for (const code of ['ENOSPC', 'EACCES', 'EFBIG']) {
      const stub: ArchiveTarget = {
        write: async () => { throw Object.assign(new Error(`TEST ${code}`), { code }) },
        read: async () => undefined,
        list: async () => [],
      }
      const failure = await persistExecutionRecord(stub, 'TEST-f16', { hello: 'world' }).then(
        () => undefined,
        (error: unknown) => error as { code?: string },
      )
      expect(failure?.code).toBe(code)
    }
    console.log('[fault F16] parity=ENOSPC-EACCES-EFBIG')
  }, 30_000)
})
