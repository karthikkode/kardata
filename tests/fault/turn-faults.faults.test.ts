// F9 turn fault: /mcp down. The mock tool client throws (connection
// refused); the runner records an isError outcome and the turn continues,
// so round 2 sees the failure and says so. The drill proves the failure
// fed forward by reading round 2's archived request. F13/F14 join this
// file. Fault suite, skipped explicitly without KARDATA_TEMPORAL_TEST,
// TEST_DATABASE_URL, and KARDATA_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client as WorkflowClient, type WorkflowHandle } from '@temporalio/client'
import { Context } from '@temporalio/activity'
import type { NativeConnection, Worker } from '@temporalio/worker'
import {
  emptyUsage,
  type ProviderAdapter,
  type StreamEvent,
  type ToolDefinition,
  type TurnRunnerMcpClient,
} from '@kardata/agents'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveArchiveTarget, persistExecutionRecord } from '../../backend/src/archive/targets.js'
import { appendEventActivity, executeKarbotTurn } from '../../backend/src/temporal/activities/turn.js'
import { createRoundRecorder } from '../../backend/src/temporal/activities/turn-rounds.js'
import type { KarbotTurnDeps, KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { appendEvent as appendDbEvent, createSector, getThread } from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'
import { sleep } from './toxiproxy.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const RUN_WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'run.ts')

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (await condition()) return
    if (Date.now() - started > timeoutMs) throw new Error(`TEST timeout waiting for ${what}`)
    await sleep(500)
  }
}

describe.skipIf(!ENABLED || !TEST_DATABASE_URL)('turn faults F9-F10', () => {
  let pool: Pool
  let connection: NativeConnection
  let client: WorkflowClient
  let worker: Worker
  let run: Promise<void>
  let taskQueue = ''
  let archiveDir = ''
  let savedArchive: string | undefined
  let savedProvider: string | undefined
  const recordKeys = new Map<string, string>()

  let toolImpl: (name: string, args: Record<string, unknown>, operationId?: string) => Promise<{ content: string; isError?: boolean }> = async () => {
    throw new Error('TEST tool script unset')
  }
  let adapterImpl: () => ProviderAdapter = () => {
    throw new Error('TEST adapter script unset')
  }
  let persistImpl: (sessionId: string, round: number, kind: 'request' | 'response' | 'tool-result', record: Record<string, unknown>) => Promise<void> = async () => {
    throw new Error('TEST persist script unset')
  }

  const mcp: TurnRunnerMcpClient = {
    async listTools(): Promise<ToolDefinition[]> {
      return [{ name: 'TEST_lookup', description: 'TEST lookup', parameters: { type: 'object', properties: {} } }]
    },
    async callTool(name: string, args: Record<string, unknown>, operationId?: string): Promise<{ content: string; isError?: boolean }> {
      return toolImpl(name, args, operationId)
    },
  }

  function deps(sessionId: string): KarbotTurnDeps {
    return {
      loadSessionModel: async () => undefined,
      loadHistory: async () => [],
      resolveTurnAdapter: () => adapterImpl(),
      mcp,
      publishDelta: async () => {},
      publishReasoning: async () => {},
      publishTool: async () => {},
      log: () => {},
      persistExecution: async (round, kind, record) => {
        await persistImpl(sessionId, round, kind, record)
      },
    }
  }

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    const url = await ensureTestDb('kardata_test_fault_turn')
    process.env['DATABASE_URL'] = url
    pool = new Pool({ connectionString: url })
    savedProvider = process.env['KARDATA_PROVIDER']
    process.env['KARDATA_PROVIDER'] = 'fake'
    archiveDir = mkdtempSync(join(tmpdir(), 'fault-archive-'))
    savedArchive = process.env['KARDATA_ARCHIVE_DIR']
    process.env['KARDATA_ARCHIVE_DIR'] = archiveDir
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    taskQueue = `kardata-test-fault-turn-${Date.now()}`
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: RUN_WORKFLOWS_PATH,
      activities: {
        appendEventActivity,
        karbotTurnActivity: async (input: KarbotTurnInput) => {
          const context = Context.current()
          let settled = false
          const beating = (async () => {
            while (!settled) {
              try { context.heartbeat({ at: Date.now() }) } catch { break }
              await sleep(5000)
            }
          })()
          try {
            const recorder = createRoundRecorder(pool, `session:${input.sessionId}`, () => undefined)
            return await executeKarbotTurn(input, {
              ...deps(input.sessionId),
              attempt: context.info.attempt,
              recordRound: (fields) => recorder.recordRound(fields),
              recordToolCall: (fields) => recorder.recordToolCall(fields),
            })
          } finally {
            settled = true
            await beating
          }
        },
      },
      taskQueue,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    if (savedProvider === undefined) delete process.env['KARDATA_PROVIDER']
    else process.env['KARDATA_PROVIDER'] = savedProvider
    if (savedArchive === undefined) delete process.env['KARDATA_ARCHIVE_DIR']
    else process.env['KARDATA_ARCHIVE_DIR'] = savedArchive
    await worker?.shutdown()
    await run?.catch(() => undefined)
    await pool?.end()
    await connection?.close()
  })

  async function startTurn(text: string): Promise<{ sessionId: string; handle: WorkflowHandle }> {
    const sessionId = `TEST-turn-${randomUUID()}`
    const sectorId = `sector-${randomUUID()}`
    await createSector(pool, { name: `TEST turn ${sectorId}`, sectorId, idempotencyKey: `fault-turn-sector:${sectorId}` })
    await appendDbEvent(pool, {
      idempotencyKey: `fault-turn-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST turn ${sessionId}`, sectorId, tenantId: 'TEST turn faults', projectId: null },
    })
    await projectNewEvents(pool)
    const handle = await client.workflow.start('sessionRun', { taskQueue, workflowId: `TEST-turn-${sessionId}`, args: [{ sessionId }] })
    await waitFor(async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING', 30_000, 'run')
    await handle.signal('runSend', text)
    return { sessionId, handle }
  }

  it('F9: /mcp down becomes a source gap the agent reports; the turn completes', async () => {
    toolImpl = async () => {
      throw new Error('TEST connect ECONNREFUSED 127.0.0.1:3001')
    }
    adapterImpl = () => {
      let round = 0
      return {
        providerName: 'TEST-mcp-down',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (): AsyncIterable<StreamEvent> {
          round += 1
          if (round === 1) {
            yield { kind: 'text_delta', text: 'TEST trying lookup' }
            yield { kind: 'toolcall_start', index: 0, key: 'TEST-call-0' }
            yield { kind: 'toolcall_delta', index: 0, textAppend: JSON.stringify({ q: 'TEST' }) }
            yield { kind: 'toolcall_end', index: 0, call: { id: 'TEST-call-0', name: 'TEST_lookup', args: { q: 'TEST' } } }
            yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
            return
          }
          yield { kind: 'text_delta', text: 'The lookup tool is down (connection refused), so I cannot fetch that right now.' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        },
      }
    }
    persistImpl = async (sessionId, round, kind, record) => {
      const ref = await persistExecutionRecord(resolveArchiveTarget(), sessionId, record)
      recordKeys.set(`${sessionId}:${round}:${kind}`, ref.key)
    }
    const { sessionId, handle } = await startTurn('F9 hello')
    const reply = 'The lookup tool is down (connection refused), so I cannot fetch that right now.'
    await waitFor(async () => {
      await projectNewEvents(pool)
      const thread = await getThread(pool, sessionId)
      return (thread?.messages ?? []).some((message) =>
        message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === reply,
      )
    }, 120_000, 'gap-reporting reply')
    await projectNewEvents(pool)
    const { rows: attempts } = await pool.query<{ attempt: number }>(
      'SELECT DISTINCT attempt FROM execution_rounds WHERE thread_key = $1 ORDER BY attempt ASC',
      [sessionId],
    )
    expect(attempts.map((row) => row.attempt)).toEqual([1])
    const { rows: tools } = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM tool_calls WHERE thread_key = $1',
      [sessionId],
    )
    expect(tools.map((row) => row.outcome)).toEqual(['error'])
    const archive = resolveArchiveTarget()
    const request1 = recordKeys.get(`${sessionId}:1:request`)
    const request2 = recordKeys.get(`${sessionId}:2:request`)
    expect(request1).toBeDefined()
    expect(request2).toBeDefined()
    const body1 = await archive.read(request1!, 16 * 1024 * 1024)
    const body2 = await archive.read(request2!, 16 * 1024 * 1024)
    expect(body1?.includes('TEST connect ECONNREFUSED')).toBe(false)
    expect(body2?.includes('TEST connect ECONNREFUSED')).toBe(true)
    const thread = await getThread(pool, sessionId)
    const replies = (thread?.messages ?? []).filter((message) =>
      message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === reply,
    )
    expect(replies.length).toBe(1)
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
    console.log('[fault F9] attempts=1 tool-outcome=error gap-reported=true')
  }, 180_000)

  it('F10: read-only archive retries the record, then fails honestly without crashing', async () => {
    const pairs: string[] = []
    toolImpl = async () => ({ content: 'TEST unused tool' })
    adapterImpl = () => ({
      providerName: 'TEST-ro',
      chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
      chatStream: async function* (): AsyncIterable<StreamEvent> {
        yield { kind: 'text_delta', text: 'TEST ro reply' }
        yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
      },
    })
    persistImpl = async (sessionId, round, kind, record) => {
      pairs.push(`${round}:${kind}`)
      await persistExecutionRecord(resolveArchiveTarget(), sessionId, record)
    }
    chmodSync(archiveDir, 0o555)
    try {
      const { sessionId, handle } = await startTurn('F10 hello')
      expect(await handle.result()).toBe('error')
      expect(pairs).toEqual(['1:request', '1:request', '1:request'])
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
      const { rows: refs } = await pool.query<{ request_ref: string | null }>(
        'SELECT request_ref FROM execution_rounds WHERE thread_key = $1',
        [sessionId],
      )
      expect(refs.length).toBeGreaterThan(0)
      for (const row of refs) expect(row.request_ref).toBeNull()
      expect(await resolveArchiveTarget().list('execution-records')).toEqual([])
      console.log('[fault F10] persist-tries=3 result=error honest=true archive=empty refs=null')
    } finally {
      chmodSync(archiveDir, 0o700)
    }
  }, 180_000)
})
