// F1-F3 provider fault drills: hanging, flapping, and truncated providers
// against real sessionRun workflows with scripted turn deps. The worker
// registers the real appendEventActivity plus a karbotTurnActivity wrapper
// that runs executeKarbotTurn with the drill's adapter, so Temporal retry,
// timeout, and heartbeat semantics are real while the provider is scripted.
// Fault suite, skipped explicitly without KARDATA_TEMPORAL_TEST,
// TEST_DATABASE_URL, and KARDATA_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client as WorkflowClient, type WorkflowHandle } from '@temporalio/client'
import { Context } from '@temporalio/activity'
import type { NativeConnection, Worker } from '@temporalio/worker'
import {
  emptyUsage,
  FakeProvider,
  ProviderError,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
  type StreamEvent,
  type ToolDefinition,
  type TurnRunnerMcpClient,
  type Usage,
} from '@kardata/agents'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
const SCOPE = { tenantId: 'TEST provider faults', projectId: null }

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (await condition()) return
    if (Date.now() - started > timeoutMs) throw new Error(`TEST timeout waiting for ${what}`)
    await sleep(500)
  }
}

describe.skipIf(!ENABLED || !TEST_DATABASE_URL)('provider fault drills F1-F3 [F:backend.workflow.run.sessionRun] [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.appendEventActivity]', () => {
  let pool: Pool
  let connection: NativeConnection
  let client: WorkflowClient
  let worker: Worker
  let run: Promise<void>
  let taskQueue = ''
  let savedProvider: string | undefined
  const attempts: Array<{ attempt: number; at: number }> = []
  let script: () => ProviderAdapter = () => new FakeProvider([{ text: 'TEST unset script' }])

  function deps(): KarbotTurnDeps {
    const mcp: TurnRunnerMcpClient = {
      async listTools(): Promise<ToolDefinition[]> { return [] },
      async callTool(name: string): Promise<{ content: string; isError?: boolean }> { return { content: `TEST unexpected tool ${name}`, isError: true } },
    }
    return {
      async loadSessionModel() { return undefined },
      async loadHistory() { return [] },
      resolveTurnAdapter: () => script(),
      mcp,
      async publishDelta(): Promise<void> {},
      async publishReasoning(): Promise<void> {},
      async publishTool(): Promise<void> {},
      log(): void {},
    }
  }

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    const url = await ensureTestDb('kardata_test_fault_provider')
    process.env['DATABASE_URL'] = url
    pool = new Pool({ connectionString: url })
    savedProvider = process.env['KARDATA_PROVIDER']
    process.env['KARDATA_PROVIDER'] = 'fake'
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    taskQueue = `kardata-test-fault-provider-${Date.now()}`
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: RUN_WORKFLOWS_PATH,
      activities: {
        appendEventActivity,
        karbotTurnActivity: async (input: KarbotTurnInput) => {
          const context = Context.current()
          attempts.push({ attempt: context.info.attempt, at: Date.now() })
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
              ...deps(),
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
    await worker?.shutdown()
    await run?.catch(() => undefined)
    await pool?.end()
    await connection?.close()
  })

  async function startTurn(text: string): Promise<{ sessionId: string; handle: WorkflowHandle }> {
    const sessionId = `TEST-fault-${randomUUID()}`
    const sectorId = `sector-${randomUUID()}`
    await createSector(pool, { name: `TEST fault ${sectorId}`, sectorId, idempotencyKey: `fault-sector:${sectorId}` })
    await appendDbEvent(pool, {
      idempotencyKey: `fault-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST fault ${sessionId}`, sectorId, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId },
    })
    await projectNewEvents(pool)
    const handle = await client.workflow.start('sessionRun', { taskQueue, workflowId: `TEST-fault-${sessionId}`, args: [{ sessionId }] })
    await waitFor(async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING', 30_000, 'run')
    await handle.signal('runSend', text)
    return { sessionId, handle }
  }

  async function messages(sessionId: string): Promise<Array<{ kind: string; payload: Record<string, unknown> }>> {
    await projectNewEvents(pool)
    const thread = await getThread(pool, sessionId)
    return (thread?.messages ?? []).map((message) => ({ kind: message.kind, payload: message.payload as Record<string, unknown> }))
  }

  async function rounds(sessionId: string): Promise<Array<{ outcome: string; errorCode: string | null; inputTokens: number | null; outputTokens: number | null; attempt: number }>> {
    await projectNewEvents(pool)
    const { rows } = await pool.query<{ outcome: string; error_code: string | null; input_tokens: number | null; output_tokens: number | null; attempt: number }>(
      'SELECT outcome, error_code, input_tokens, output_tokens, attempt FROM execution_rounds WHERE thread_key = $1 ORDER BY attempt ASC, round ASC',
      [sessionId],
    )
    return rows.map((row) => ({ outcome: row.outcome, errorCode: row.error_code, inputTokens: row.input_tokens, outputTokens: row.output_tokens, attempt: row.attempt }))
  }

  function benignChat(): ProviderResponse {
    return { text: 'TEST benign', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }
  }

  it('F1: hanging provider times out at 60 s, retries, then fails honestly with no zombie', async () => {
    attempts.length = 0
    let calls = 0
    script = () => ({
      providerName: 'TEST-hang',
      chat: async () => benignChat(),
      chatStream: async function* (): AsyncIterable<StreamEvent> {
        calls += 1
        if (calls === 1) {
          await new Promise(() => undefined)
          yield { kind: 'text_delta', text: '' }
        }
        throw new ProviderError('TEST fast failure', true)
      },
    })
    const started = Date.now()
    const { sessionId, handle } = await startTurn('F1 hello')
    const result = await handle.result()
    const recoveredAt = Date.now()
    expect(result).toBe('error')
    expect(attempts.map((entry) => entry.attempt)).toEqual([1, 2, 3])
    const [first, second] = [attempts[0]!, attempts[1]!]
    const detectionMs = second.at - first.at
    expect(detectionMs).toBeGreaterThanOrEqual(50_000)
    expect(detectionMs).toBeLessThan(90_000)
    expect(recoveredAt - started).toBeLessThan(150_000)
    const posted = await messages(sessionId)
    expect(posted.some((message) => message.kind === 'text' && (message.payload['text'] as string) === 'F1 hello')).toBe(true)
    const failed = posted.find((message) => message.payload['failed'] === true)
    expect(failed?.payload['text']).toBe('I could not complete that reply. Please try again.')
    const journal = await rounds(sessionId)
    expect(journal.length).toBeGreaterThan(0)
    for (const row of journal) {
      expect(['timeout', 'error']).toContain(row.outcome)
      expect(row.inputTokens).toBeNull()
      expect(row.errorCode).toBeTruthy()
    }
    console.log(`[fault F1] detectionMs=${detectionMs} recoveryMs=${recoveredAt - started} attempts=3`)
  }, 240_000)

  it('F2: flapping provider backs off, succeeds, and counts usage once', async () => {
    attempts.length = 0
    const usage: Usage = { ...emptyUsage(), inputTokens: 11, outputTokens: 7 }
    // One provider across attempts: the adapter resolves per attempt, so a
    // factory would replay 429 forever. Attempt-persistent state lives in
    // the test body (like F1's calls counter), never in the factory.
    const flap = new FakeProvider([
      { error: 'TEST 429 rate limited', retryable: true },
      { error: 'TEST 500 upstream', retryable: true },
      { text: 'recovered', usage },
      { text: 'recovered', usage },
      { text: 'recovered', usage },
    ])
    script = () => flap
    const { sessionId, handle } = await startTurn('F2 hello')
    await waitFor(async () => (await messages(sessionId)).some((message) => (message.payload['text'] as string) === 'recovered'), 120_000, 'recovery reply')
    expect(attempts.map((entry) => entry.attempt)).toEqual([1, 2, 3])
    const [first, second, third] = [attempts[0]!, attempts[1]!, attempts[2]!]
    expect(second.at - first.at).toBeGreaterThanOrEqual(900)
    expect(third.at - second.at).toBeGreaterThanOrEqual(1800)
    const journal = await rounds(sessionId)
    const ok = journal.filter((row) => row.outcome === 'ok')
    expect(ok.length).toBe(1)
    expect(journal.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0)).toBe(11)
    expect(journal.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0)).toBe(7)
    for (const row of journal.filter((row) => row.outcome !== 'ok')) expect(row.inputTokens).toBeNull()
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
    console.log(`[fault F2] attempts=3 backoffMs=${second.at - first.at}/${third.at - second.at}`)
  }, 180_000)

  it('F3: truncated stream records an error, retries clean, and leaves the transcript intact', async () => {
    attempts.length = 0
    const clean = new FakeProvider([{ text: 'TEST clean reply' }, { text: 'TEST clean reply' }, { text: 'TEST clean reply' }])
    script = () => ({
      providerName: 'TEST-truncate',
      chat: async () => benignChat(),
      chatStream: async function* (request: ProviderRequest): AsyncIterable<StreamEvent> {
        if (Context.current().info.attempt === 1) {
          yield { kind: 'text_delta', text: 'TEST partial garbage' }
          throw new Error('TEST truncated stream')
        }
        yield* clean.chatStream(request)
      },
    })
    const { sessionId, handle } = await startTurn('F3 hello')
    await waitFor(async () => (await messages(sessionId)).some((message) => (message.payload['text'] as string) === 'TEST clean reply'), 120_000, 'clean reply')
    expect(attempts.map((entry) => entry.attempt)).toEqual([1, 2])
    const journal = await rounds(sessionId)
    expect(journal.some((row) => row.outcome !== 'ok' && row.attempt === 1)).toBe(true)
    const posted = await messages(sessionId)
    const texts = posted.filter((message) => message.kind === 'text').map((message) => message.payload['text'] as string)
    expect(texts).toContain('F3 hello')
    expect(texts).toContain('TEST clean reply')
    expect(texts.some((text) => text.includes('partial'))).toBe(false)
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
    console.log('[fault F3] attempts=2 transcript clean')
  }, 180_000)
})
