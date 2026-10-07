// F13-child subagent steer faults: one in-process worker running
// subagentRun with per-test scripts (tool, adapter, steering lease).
// F13-child-idle: a steer on an idle child starts exactly one turn.
// F13-child-finished: a steer on a finished child is receipted
// missed_steer with a surfaced event, never a relaunch. Fault suite,
// skipped explicitly without KARDATA_TEMPORAL_TEST,
// TEST_DATABASE_URL, and KARDATA_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
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
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'
import { sleep } from './toxiproxy.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const CHILD_WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'subagent-child.ts')

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (await condition()) return
    if (Date.now() - started > timeoutMs) throw new Error(`TEST timeout waiting for ${what}`)
    await sleep(500)
  }
}

describe.skipIf(!ENABLED || !TEST_DATABASE_URL)('subagent steer faults F13-child [F:backend.workflow.subagent_child.subagentRun] [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.appendEventActivity] [F:http.steerThread] [F:backend.workflow.subagents.childMessageSignal] [F:backend.workflow.subagents.childFinishSignal] [F:db.workspace_threads.beginThreadTurn]', () => {
  let pool: Pool
  let connection: NativeConnection
  let client: WorkflowClient
  let worker: Worker
  let run: Promise<void>
  let taskQueue = ''
  let archiveDir = ''
  let savedArchive: string | undefined
  let savedProvider: string | undefined

  let toolImpl: (name: string, args: Record<string, unknown>, operationId?: string) => Promise<{ content: string; isError?: boolean }> = async () => {
    throw new Error('TEST tool script unset')
  }
  let adapterImpl: () => ProviderAdapter = () => {
    throw new Error('TEST adapter script unset')
  }
  let steeringImpl = false
  const toolsImpl: () => Promise<ToolDefinition[]> = async () => [
    { name: 'TEST_lookup', description: 'TEST lookup', parameters: { type: 'object', properties: {} } },
  ]

  const mcp: TurnRunnerMcpClient = {
    async listTools(): Promise<ToolDefinition[]> {
      return toolsImpl()
    },
    async callTool(name: string, args: Record<string, unknown>, operationId?: string): Promise<{ content: string; isError?: boolean }> {
      return toolImpl(name, args, operationId)
    },
    isReadOnlyTool: () => true,
  }

  function deps(): KarbotTurnDeps {
    return {
      loadSessionModel: async () => undefined,
      loadHistory: async () => [],
      resolveTurnAdapter: () => adapterImpl(),
      mcp,
      publishDelta: async () => {},
      publishReasoning: async () => {},
      publishTool: async () => {},
      log: () => {},
      persistExecution: async () => {},
    }
  }

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    const url = await ensureTestDb('kardata_test_fault_child_steer')
    process.env['DATABASE_URL'] = url
    pool = new Pool({ connectionString: url })
    savedProvider = process.env['KARDATA_PROVIDER']
    process.env['KARDATA_PROVIDER'] = 'fake'
    archiveDir = mkdtempSync(join(tmpdir(), 'fault-archive-'))
    savedArchive = process.env['KARDATA_ARCHIVE_DIR']
    process.env['KARDATA_ARCHIVE_DIR'] = archiveDir
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    taskQueue = `kardata-test-fault-child-${Date.now()}`
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: CHILD_WORKFLOWS_PATH,
      activities: {
        appendEventActivity,
        karbotTurnActivity: async (input: KarbotTurnInput) => {
          const context = Context.current()
          const lease = steeringImpl ? await beginThreadTurn(pool, input.threadKey, input.runKey) : undefined
          // Mirrors karbotTurnActivity's success path: receipt late
          // steering into the outcome so the workflow redelivers it as
          // one follow-up turn. Error/cancel paths release without
          // reporting, so no turn wakes for a dead run.
          let released = false
          try {
            const recorder = createRoundRecorder(pool, `session:${input.sessionId}`, () => undefined)
            const outcome = await executeKarbotTurn(input, {
              ...deps(),
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

  async function startChild(goal: string): Promise<{ sessionId: string; childId: string; threadKey: string; handle: WorkflowHandle }> {
    const sessionId = `TEST-child-${randomUUID()}`
    const sectorId = `sector-${randomUUID()}`
    const childId = `TEST-child-${randomUUID()}`
    await createSector(pool, { name: `TEST child ${sectorId}`, sectorId, idempotencyKey: `fault-child-sector:${sectorId}` })
    await appendDbEvent(pool, {
      idempotencyKey: `fault-child-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST child ${sessionId}`, sectorId, tenantId: 'TEST child steer faults', projectId: null },
    })
    await projectNewEvents(pool)
    const handle = await client.workflow.start('subagentRun', {
      taskQueue,
      workflowId: childId,
      args: [{
        childId, goal, depth: 1, mode: 'empty', maxDepth: 3, queueCapacity: 10,
        parentSessionId: sessionId, parentPartition: `session:${sessionId}`,
      }],
    })
    const threadKey = `agent:${childId}`
    await waitFor(async () => {
      await projectNewEvents(pool)
      return (await getThread(pool, threadKey)) !== undefined
    }, 60_000, 'child thread')
    return { sessionId, childId, threadKey, handle }
  }

  async function childSays(threadKey: string, text: string): Promise<boolean> {
    await projectNewEvents(pool)
    const thread = await getThread(pool, threadKey)
    return (thread?.messages ?? []).some((message) =>
      message.kind === 'text' && (message.payload as Record<string, unknown>)['text'] === text,
    )
  }

  it('F13-child-idle: a steer on an idle child starts exactly one turn', async () => {
    steeringImpl = true
    toolImpl = async () => ({ content: 'TEST unused tool' })
    let turn = 0
    adapterImpl = () => {
      turn += 1
      const mine = turn
      return {
        providerName: 'TEST-child-steer',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (): AsyncIterable<StreamEvent> {
          yield { kind: 'text_delta', text: mine === 1 ? 'TEST child one' : 'TEST child two' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        },
      }
    }
    const { threadKey, handle } = await startChild('F13 child goal')
    const app: FastifyInstance = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
    try {
      await handle.signal('childMessage', 'F13 child hello')
      await waitFor(async () => childSays(threadKey, 'TEST child one'), 120_000, 'child turn 1')
      // Steer 0-1 s after the quiet completion, like F13-idle.
      await sleep(500)
      const steer = await app.inject({ method: 'POST', url: '/v1/commands/steer', payload: { threadKey, text: 'TEST child steer' } })
      expect(steer.statusCode).toBe(202)
      const only = steer.json() as { data: { commandId: string; state: string } }
      expect(only.data.state).toBe('accepted')
      await waitFor(async () => childSays(threadKey, 'TEST child two'), 120_000, 'child turn 2')
      await projectNewEvents(pool)
      const { rows: runs } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id ORDER BY MIN(started_at) ASC',
        [threadKey],
      )
      expect(runs).toHaveLength(2)
      const { rows } = await pool.query<{ id: string; state: string; run_key: string | null; round: number | null }>(
        'SELECT id, state, run_key, round FROM thread_instructions WHERE thread_key = $1',
        [threadKey],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.state).toBe('consumed')
      expect(rows[0]?.run_key).toBe(runs[1]?.run_id)
      expect(Number(rows[0]?.round)).toBe(1)
      await sleep(5000)
      await projectNewEvents(pool)
      const { rows: settled } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id',
        [threadKey],
      )
      expect(settled).toHaveLength(2)
      const receipts = await readSteeringReceiptsPage(pool, threadKey)
      expect(receipts.items.map((item) => item.id)).toEqual([only.data.commandId])
      console.log('[fault F13-child-idle] instructions=1 consumed=1 child-turns=1')
    } finally {
      await app.close()
      steeringImpl = false
      await handle.signal('childFinish').catch(() => undefined)
    }
    expect(await handle.result()).toBe('finished')
  }, 180_000)

  it('F13-child-midturn: a mid-turn steer is receipted missed and redelivered once', async () => {
    // Mirror F13-main on a child: turn 1 runs a single round; the steer
    // lands mid-turn (lease held), misses, and one follow-up turn
    // carries its text. Proves the child redelivery mirror.
    steeringImpl = true
    toolImpl = async () => ({ content: 'TEST unused tool' })
    let turn = 0
    const seen: Array<{ turn: number; messages: unknown }> = []
    adapterImpl = () => {
      turn += 1
      const mine = turn
      return {
        providerName: 'TEST-child-midturn',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (request: { messages: unknown }): AsyncIterable<StreamEvent> {
          seen.push({ turn: mine, messages: request.messages })
          if (mine === 1) await sleep(8000)
          yield { kind: 'text_delta', text: mine === 1 ? 'TEST child mid one' : 'TEST child mid two' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        },
      }
    }
    const { threadKey, handle } = await startChild('F13 child midturn goal')
    const app: FastifyInstance = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
    try {
      await handle.signal('childMessage', 'F13 child midturn hello')
      await waitFor(async () => {
        const { rows: lease } = await pool.query<{ active_run: string | null }>(
          'SELECT active_run FROM thread_context WHERE thread_key = $1',
          [threadKey],
        )
        return (lease[0]?.active_run ?? null) !== null
      }, 60_000, 'child turn lease')
      const steer = await app.inject({ method: 'POST', url: '/v1/commands/steer', payload: { threadKey, text: 'TEST child mid steer' } })
      expect(steer.statusCode).toBe(202)
      const first = steer.json() as { data: { commandId: string; state: string } }
      expect(first.data.state).toBe('accepted')
      await waitFor(async () => childSays(threadKey, 'TEST child mid one'), 120_000, 'child turn 1 completion')
      const { rows } = await pool.query<{ id: string; text: string; state: string }>(
        'SELECT id, text, state FROM thread_instructions WHERE thread_key = $1 ORDER BY id ASC',
        [threadKey],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: first.data.commandId, text: 'TEST child mid steer', state: 'missed' })
      await waitFor(async () => childSays(threadKey, 'TEST child mid two'), 120_000, 'child turn 2 completion')
      await projectNewEvents(pool)
      const { rows: runs } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id ORDER BY MIN(started_at) ASC',
        [threadKey],
      )
      expect(runs).toHaveLength(2)
      expect(JSON.stringify(seen.find((entry) => entry.turn === 2)?.messages ?? [])).toContain('TEST child mid steer')
      await sleep(5000)
      await projectNewEvents(pool)
      const { rows: settled } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id',
        [threadKey],
      )
      expect(settled).toHaveLength(2)
      const receipts = await readSteeringReceiptsPage(pool, threadKey)
      expect(receipts.items.map((item) => item.id)).toEqual([first.data.commandId])
      console.log('[fault F13-child-midturn] instructions=1 missed=1 redelivered-turns=1')
    } finally {
      await app.close()
      steeringImpl = false
      await handle.signal('childFinish').catch(() => undefined)
    }
    expect(await handle.result()).toBe('finished')
  }, 180_000)

  it('F13-child-finished: a steer on a finished child is receipted missed, never relaunched', async () => {
    steeringImpl = true
    toolImpl = async () => ({ content: 'TEST unused tool' })
    adapterImpl = () => ({
      providerName: 'TEST-child-done',
      chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
      chatStream: async function* (): AsyncIterable<StreamEvent> {
        yield { kind: 'text_delta', text: 'TEST child done' }
        yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
      },
    })
    const { sessionId, childId, threadKey, handle } = await startChild('F13 finished goal')
    const app: FastifyInstance = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
    try {
      await handle.signal('childMessage', 'F13 child work')
      await waitFor(async () => childSays(threadKey, 'TEST child done'), 120_000, 'child turn 1')
      await handle.signal('childFinish')
      expect(await handle.result()).toBe('finished')
      await projectNewEvents(pool)
      expect((await getThread(pool, threadKey))?.status).toBe('FINISHED')
      const steer = await app.inject({ method: 'POST', url: '/v1/commands/steer', payload: { threadKey, text: 'TEST late steer' } })
      expect(steer.statusCode).toBe(202)
      expect((steer.json() as { data: { state: string } }).data.state).toBe('missed_steer')
      await projectNewEvents(pool)
      const { rows: events } = await pool.query<{ type: string; payload: Record<string, unknown> }>(
        'SELECT type, payload FROM events WHERE partition = $1 AND type = $2',
        [`session:${sessionId}`, 't.subagent.missed_steer'],
      )
      expect(events).toHaveLength(1)
      expect(events[0]?.payload).toMatchObject({ childId, text: 'TEST late steer' })
      const { rows: instructions } = await pool.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM thread_instructions WHERE thread_key = $1',
        [threadKey],
      )
      expect(Number(instructions[0]?.count ?? 0)).toBe(0)
      await sleep(3000)
      await projectNewEvents(pool)
      const { rows: runs } = await pool.query<{ run_id: string }>(
        'SELECT run_id FROM execution_rounds WHERE thread_key = $1 GROUP BY run_id',
        [threadKey],
      )
      expect(runs).toHaveLength(1)
      console.log('[fault F13-child-finished] missed_steer=1 relaunched=0')
    } finally {
      await app.close()
      steeringImpl = false
      await handle.signal('childFinish').catch(() => undefined)
    }
  }, 180_000)
})
