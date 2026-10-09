// F9/F10/F13/F14 turn faults: one in-process worker with per-test scripts
// (tool, adapter, persist, steering lease). F9: /mcp down becomes a
// reported source gap. F10: read-only archive retries then fails honestly.
// F13: steer at turn end is never lost. F14: pause parks at the turn
// boundary and resume keeps budgets. Fault suite, skipped explicitly
// without KARDATA_TEMPORAL_TEST, TEST_DATABASE_URL, and
// KARDATA_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
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
import { buildApp } from '../../backend/src/app.js'
import {
  appendEvent as appendDbEvent,
  beginThreadTurn,
  consumeSteering,
  createSector,
  finishSteering,
  getThread,
  readSteeringReceiptsPage,
} from '../../backend/src/db/index.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { SESSION_PREFIX } from '../../backend/src/temporal/runs-types.js'
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

describe.skipIf(!ENABLED || !TEST_DATABASE_URL)('turn faults F9-F10, F13-F14 [F:backend.workflow.run.sessionRun] [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.appendEventActivity] [F:http.steerThread] [F:http.pauseRun] [F:http.resumeRun] [F:db.workspace_threads.beginThreadTurn]', () => {
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
  let steeringImpl = false
  let toolsImpl: () => Promise<ToolDefinition[]> = async () => [
    { name: 'TEST_lookup', description: 'TEST lookup', parameters: { type: 'object', properties: {} } },
  ]
  let toolCalls = 0
  let toolStarted = false
  let adapterCalls = 0

  const mcp: TurnRunnerMcpClient = {
    async listTools(): Promise<ToolDefinition[]> {
      return toolsImpl()
    },
    async callTool(name: string, args: Record<string, unknown>, operationId?: string): Promise<{ content: string; isError?: boolean }> {
      return toolImpl(name, args, operationId)
    },
    // F9's lookup is read-only: its transport failure is a plain error
    // result, never a recovery halt. The other drills never throw.
    isReadOnlyTool: () => true,
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
          const lease = steeringImpl ? await beginThreadTurn(pool, input.threadKey, input.runKey) : undefined
          // Mirrors karbotTurnActivity's success path: receipt late
          // steering into the outcome so the workflow redelivers it as
          // one follow-up turn. Error/cancel paths release without
          // reporting, so no turn wakes for a dead run.
          let released = false
          try {
            const recorder = createRoundRecorder(pool, `session:${input.sessionId}`, () => undefined)
            const outcome = await executeKarbotTurn(input, {
              ...deps(input.sessionId),
              ...(lease === undefined
                ? {}
                : {
                    refreshContext: async (round: number) => ({
                      references: [],
                      notes: '',
                      steering: await consumeSteering(pool, input.threadKey, input.runKey, round, lease),
                    }),
                  }),
              attempt: context.info.attempt,
              recordRound: (fields) => recorder.recordRound(fields),
              recordToolCall: (fields) => recorder.recordToolCall(fields),
            })
            if (lease === undefined) return outcome
            const finished = await finishSteering(pool, input.threadKey, input.runKey, lease)
            released = true
            const missed = finished?.missed ?? []
            return missed.length ? { ...outcome, missedSteering: missed } : outcome
          } finally {
            settled = true
            // Fire-and-forget like production (void beating): awaiting
            // the loop would park up to 5 s in its in-flight heartbeat
            // sleep after every turn, hiding real turn-end latency.
            void beating
            if (lease !== undefined && !released) await finishSteering(pool, input.threadKey, input.runKey, lease)
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
    const handle = await client.workflow.start('sessionRun', { taskQueue, workflowId: `${SESSION_PREFIX}${sessionId}`, args: [{ sessionId }] })
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
    // Fresh dir, not the suite's: chmod 555 locks only the top dir, so an
    // earlier test's 755 execution-records/ subdir would stay writable and
    // the persists would succeed (turn ok, workflow idles, result hangs).
    const f10dir = mkdtempSync(join(tmpdir(), 'fault-archive-f10-'))
    const savedDir = process.env['KARDATA_ARCHIVE_DIR']
    process.env['KARDATA_ARCHIVE_DIR'] = f10dir
    chmodSync(f10dir, 0o555)
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
      chmodSync(f10dir, 0o700)
      if (savedDir === undefined) delete process.env['KARDATA_ARCHIVE_DIR']
      else process.env['KARDATA_ARCHIVE_DIR'] = savedDir
    }
  }, 180_000)

  it('F13: steers are applied once now or receipted; nothing is ever lost', async () => {
    // Rework semantics (no grace linger): a mid-turn steer is receipted
    // missed at turn end and redelivered as exactly one follow-up turn
    // carrying its text. Turn 1 runs a single round; turn 2 carries.
    steeringImpl = true
    toolImpl = async () => ({ content: 'TEST unused tool' })
    let turn = 0
    const seen: Array<{ turn: number; messages: unknown }> = []
    adapterImpl = () => {
      turn += 1
      const mine = turn
      return {
        providerName: 'TEST-steer',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (request: { messages: unknown }): AsyncIterable<StreamEvent> {
          seen.push({ turn: mine, messages: request.messages })
          if (mine === 1) await sleep(8000)
          yield { kind: 'text_delta', text: mine === 1 ? 'TEST one' : 'TEST two done' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        },
      }
    }
    persistImpl = async () => {}
    const { sessionId, handle } = await startTurn('F13 hello')
    const runIds = async (): Promise<string[]> => {
      await projectNewEvents(pool)
      const { rows } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id ORDER BY MIN(started_at) ASC',
        [sessionId],
      )
      return rows.map((row) => row.run_id)
    }
    const roundsForRun = async (runId: string): Promise<number> => {
      await projectNewEvents(pool)
      const { rows } = await pool.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM execution_rounds WHERE thread_key = $1 AND run_id = $2',
        [sessionId, runId],
      )
      return Number(rows[0]?.count ?? 0)
    }
    const app: FastifyInstance = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
    try {
      // Post mid-turn, not at round end: the round row commits when
      // the round's stream finishes (~8 s in), but the turn holds its
      // lease from activity start, so the steer lands mid-turn here.
      await waitFor(async () => {
        const { rows: lease } = await pool.query<{ active_run: string | null }>(
          'SELECT active_run FROM thread_context WHERE thread_key = $1',
          [sessionId],
        )
        return (lease[0]?.active_run ?? null) !== null
      }, 60_000, 'turn lease')
      const steer = await app.inject({ method: 'POST', url: '/v1/commands/steer', payload: { threadKey: sessionId, text: 'TEST steer now' } })
      expect(steer.statusCode).toBe(202)
      const first = steer.json() as { data: { commandId: string; state: string } }
      expect(first.data.state).toBe('accepted')
      await waitFor(async () => {
        await projectNewEvents(pool)
        const thread = await getThread(pool, sessionId)
        return (thread?.messages ?? []).some((message) =>
          message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === 'TEST one',
        )
      }, 120_000, 'turn 1 completion')
      // Turn 1's own run held exactly one round: no grace round kept
      // it open. (The redelivered turn 2 starts instantly, so its
      // round-1 record can land before turn 1's reply projects.)
      const firstRuns = await runIds()
      expect(firstRuns.length).toBeGreaterThanOrEqual(1)
      expect(await roundsForRun(firstRuns[0]!)).toBe(1)
      // The mid-turn steer missed turn 1 and was receipted as such.
      const { rows } = await pool.query<{ id: string; text: string; state: string }>(
        'SELECT id, text, state FROM thread_instructions WHERE thread_key = $1 ORDER BY id ASC',
        [sessionId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: first.data.commandId, text: 'TEST steer now', state: 'missed' })
      // Exactly one follow-up turn redelivers its text, then quiet.
      await waitFor(async () => {
        await projectNewEvents(pool)
        const thread = await getThread(pool, sessionId)
        return (thread?.messages ?? []).some((message) =>
          message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === 'TEST two done',
        )
      }, 120_000, 'turn 2 completion')
      const secondRuns = await runIds()
      expect(secondRuns).toHaveLength(2)
      expect(JSON.stringify(seen.find((entry) => entry.turn === 2)?.messages ?? [])).toContain('TEST steer now')
      await sleep(5000)
      expect(await runIds()).toHaveLength(2)
      const receipts = await readSteeringReceiptsPage(pool, sessionId)
      expect(receipts.items.map((item) => item.id)).toEqual([first.data.commandId])
      console.log('[fault F13] instructions=1 missed=1 redelivered-turns=1')
    } finally {
      await app.close()
      // Cancel even on assertion failure: a live workflow's next turn
      // would otherwise steal the following test's adapter scripts.
      steeringImpl = false
      await handle.signal('runCancel').catch(() => undefined)
    }
    expect(await handle.result()).toBe('cancelled')
  }, 180_000)

  it('F13-idle: a steer just after quiet completion wakes exactly one turn with no linger', async () => {
    // The 0-1 s idle window: turn 1 ends with no 5 s linger (pinned
    // by the latency bound below), the steer is accepted, and exactly
    // one follow-up turn consumes its row (run 2, round 1). A lingering
    // turn would either blow the latency bound or consume in-turn.
    steeringImpl = true
    toolImpl = async () => ({ content: 'TEST unused tool' })
    let turn = 0
    adapterImpl = () => {
      turn += 1
      const mine = turn
      return {
        providerName: 'TEST-steer-idle',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (): AsyncIterable<StreamEvent> {
          yield { kind: 'text_delta', text: mine === 1 ? 'TEST idle one' : 'TEST idle two' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        },
      }
    }
    persistImpl = async () => {}
    const { sessionId, handle } = await startTurn('F13 idle hello')
    const app: FastifyInstance = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
    try {
      await waitFor(async () => {
        await projectNewEvents(pool)
        const { rows } = await pool.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM execution_rounds WHERE thread_key = $1 AND round = 1',
          [sessionId],
        )
        return Number(rows[0]?.count ?? 0) > 0
      }, 60_000, 'round 1')
      const quietStart = Date.now()
      await waitFor(async () => {
        await projectNewEvents(pool)
        const thread = await getThread(pool, sessionId)
        return (thread?.messages ?? []).some((message) =>
          message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === 'TEST idle one',
        )
      }, 120_000, 'turn 1 completion')
      // Instant scripts: the 5 s grace/harness linger this rework
      // removes would land at ~4.5-5 s; the bare path takes ~0.5 s.
      expect(Date.now() - quietStart).toBeLessThan(4000)
      await sleep(500)
      const steer = await app.inject({ method: 'POST', url: '/v1/commands/steer', payload: { threadKey: sessionId, text: 'TEST idle steer' } })
      expect(steer.statusCode).toBe(202)
      const only = steer.json() as { data: { commandId: string; state: string } }
      expect(only.data.state).toBe('accepted')
      await waitFor(async () => {
        await projectNewEvents(pool)
        const thread = await getThread(pool, sessionId)
        return (thread?.messages ?? []).some((message) =>
          message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === 'TEST idle two',
        )
      }, 120_000, 'turn 2 completion')
      await projectNewEvents(pool)
      const { rows: runs } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id ORDER BY MIN(started_at) ASC',
        [sessionId],
      )
      expect(runs).toHaveLength(2)
      const { rows } = await pool.query<{ id: string; state: string; run_key: string | null; round: number | null }>(
        'SELECT id, state, run_key, round FROM thread_instructions WHERE thread_key = $1',
        [sessionId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.state).toBe('consumed')
      expect(rows[0]?.run_key).toBe(runs[1]?.run_id)
      expect(Number(rows[0]?.round)).toBe(1)
      await sleep(5000)
      await projectNewEvents(pool)
      const { rows: settled } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id',
        [sessionId],
      )
      expect(settled).toHaveLength(2)
      const receipts = await readSteeringReceiptsPage(pool, sessionId)
      expect(receipts.items.map((item) => item.id)).toEqual([only.data.commandId])
      console.log('[fault F13-idle] instructions=1 consumed=1 redelivered-turns=1')
    } finally {
      await app.close()
      // Cancel even on assertion failure: a live workflow's next turn
      // would otherwise steal the following test's adapter scripts.
      steeringImpl = false
      await handle.signal('runCancel').catch(() => undefined)
    }
    expect(await handle.result()).toBe('cancelled')
  }, 180_000)

  it('F14: pause during a tool call parks at the turn boundary; resume keeps budgets', async () => {
    steeringImpl = false
    toolCalls = 0
    toolStarted = false
    adapterCalls = 0
    toolsImpl = async () => [
      { name: 'TEST_slow', description: 'TEST slow', parameters: { type: 'object', properties: {} } },
    ]
    toolImpl = async () => {
      toolCalls += 1
      toolStarted = true
      await sleep(10_000)
      return { content: 'TEST slow done' }
    }
    adapterImpl = () => {
      adapterCalls += 1
      if (adapterCalls > 1) {
        return {
          providerName: 'TEST-pause-2',
          chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
          chatStream: async function* (): AsyncIterable<StreamEvent> {
            yield { kind: 'text_delta', text: 'TEST second reply' }
            yield { kind: 'done', usage: { ...emptyUsage(), inputTokens: 7, outputTokens: 2 }, completion: 'complete' }
          },
        }
      }
      let round = 0
      return {
        providerName: 'TEST-pause',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (): AsyncIterable<StreamEvent> {
          round += 1
          if (round === 1) {
            yield { kind: 'text_delta', text: 'TEST calling slow' }
            yield { kind: 'toolcall_start', index: 0, key: 'TEST-call-0' }
            yield { kind: 'toolcall_delta', index: 0, textAppend: '{}' }
            yield { kind: 'toolcall_end', index: 0, call: { id: 'TEST-call-0', name: 'TEST_slow', args: {} } }
            yield { kind: 'done', usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 4 }, completion: 'complete' }
            return
          }
          yield { kind: 'text_delta', text: 'TEST resumed reply' }
          yield { kind: 'done', usage: { ...emptyUsage(), inputTokens: 5, outputTokens: 3 }, completion: 'complete' }
        },
      }
    }
    persistImpl = async (sessionId, _round, _kind, record) => {
      await persistExecutionRecord(resolveArchiveTarget(), sessionId, record)
    }
    const { sessionId, handle } = await startTurn('F14 hello')
    await waitFor(async () => toolStarted, 60_000, 'tool dispatch')
    const app: FastifyInstance = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
    try {
      const runId = `${SESSION_PREFIX}${sessionId}`
      const pause = await app.inject({ method: 'POST', url: '/v1/commands/pause', payload: { runId } })
      expect(pause.statusCode).toBe(202)
      await waitFor(async () => ((await handle.query('runState')) as { state: string }).state === 'PAUSED', 90_000, 'parked')
      expect(toolCalls).toBe(1)
      // PAUSED flips at signal time while the 10 s tool still runs: await
      // its recorded outcome (boundary semantics) instead of asserting
      // instantly. Abandonment still fails: the row never lands.
      await waitFor(async () => {
        await projectNewEvents(pool)
        const { rows } = await pool.query<{ outcome: string }>(
          'SELECT outcome FROM tool_calls WHERE thread_key = $1',
          [sessionId],
        )
        return rows.length === 1 && rows[0]?.outcome === 'ok'
      }, 60_000, 'tool outcome')
      const { rows: tools } = await pool.query<{ outcome: string }>(
        'SELECT outcome FROM tool_calls WHERE thread_key = $1',
        [sessionId],
      )
      expect(tools.map((row) => row.outcome)).toEqual(['ok'])
      const resume = await app.inject({ method: 'POST', url: '/v1/commands/resume', payload: { runId } })
      expect(resume.statusCode).toBe(202)
      await waitFor(async () => ((await handle.query('runState')) as { state: string }).state === 'RUNNING', 30_000, 'resumed')
      await handle.signal('runSend', 'F14 again')
      await waitFor(async () => {
        await projectNewEvents(pool)
        const thread = await getThread(pool, sessionId)
        return (thread?.messages ?? []).some((message) =>
          message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === 'TEST second reply',
        )
      }, 120_000, 'post-resume reply')
      expect(toolCalls).toBe(1)
      await projectNewEvents(pool)
      const { rows: attempts } = await pool.query<{ attempt: number }>(
        'SELECT DISTINCT attempt FROM execution_rounds WHERE thread_key = $1 ORDER BY attempt ASC',
        [sessionId],
      )
      expect(attempts.map((row) => row.attempt)).toEqual([1])
      const { rows: usage } = await pool.query<{ input_tokens: number | null; output_tokens: number | null }>(
        'SELECT input_tokens, output_tokens FROM execution_rounds WHERE thread_key = $1',
        [sessionId],
      )
      expect(usage.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0)).toBe(22)
      expect(usage.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0)).toBe(9)
      console.log('[fault F14] tool-calls=1 attempts=1 usage-in=22 usage-out=9')
    } finally {
      await app.close()
    }
    await handle.signal('runCancel')
    expect(await handle.result()).toBe('cancelled')
  }, 300_000)
})
