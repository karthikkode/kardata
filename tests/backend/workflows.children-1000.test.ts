// 1000 queued children: the fleet-load thousand leg runs maxInFlight over
// the child count, so it never touches the durable queue. This test pins
// the queue instead: 50 in flight plus 950 queued, a small history cap so
// continue-as-new chains several times, and exact end-state counts. Text-only
// scripted turns (zero tokens); the queue, the can chain, and the stored
// results are what is proven, not turn machinery. Gated by
// KARDATA_TEMPORAL_TEST=1 AND TEST_DATABASE_URL; without both it skips.
import { dirname, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client as WorkflowClient } from '@temporalio/client'
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
import { persistExecutionRecord, resolveArchiveTarget } from '../../backend/src/archive/targets.js'
import { appendEvent, createSector, readPartition } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { appendEventActivity, executeKarbotTurn } from '../../backend/src/temporal/activities/turn.js'
import { createRoundRecorder } from '../../backend/src/temporal/activities/turn-rounds.js'
import type { KarbotTurnDeps, KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const TEMPORAL = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const LIVE = TEMPORAL && TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const WORKFLOWS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'backend',
  'src',
  'temporal',
  'workflows',
  'subagents.ts',
)
const CHILDREN = 1000
const IN_FLIGHT = 50
const HISTORY_EVENT_LIMIT = 1500

interface TestParentState {
  children: Array<{ childId: string; status: string; goalFed: boolean }>
  queued: string[]
  rejected: Array<{ childId: string; reason: string }>
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Bounded-parallel map. Per-item order is the caller's; items are
 * independent (distinct workflows), so parallelism only removes serial
 * RPC latency. A rejection fails fast, same as the serial loop. */
async function mapLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) await task(queue.pop()!)
  })
  await Promise.all(runners)
}

describe.skipIf(!LIVE)('1000 queued children drain exactly once [F:backend.activity.turn.appendEventActivity] [F:backend.workflow.subagents.delegateParent] [F:backend.workflow.subagents.subagentRun] [F:backend.workflow.subagents.parentDelegateSignal] [F:backend.workflow.subagents.parentNoteDoneSignal] [F:backend.workflow.subagents.parentFinishSignal] [F:backend.workflow.subagents.parentStateQuery] [F:backend.workflow.subagents.childMessageSignal] [F:backend.workflow.subagents.childFinishSignal] [F:db.index.appendEvent] [F:db.events.appendEvent] [F:db.index.readPartition] [F:db.events.readPartition]', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let pool: Pool
  let worker: Worker
  let run: Promise<void>
  const ownedWorkflows = new Set<string>()

  const mcp: TurnRunnerMcpClient = {
    async listTools(): Promise<ToolDefinition[]> { return [] },
    async callTool(name: string): Promise<{ content: string; isError?: boolean }> { return { content: `TEST unexpected tool ${name}`, isError: true } },
  }

  function deps(sessionId: string): KarbotTurnDeps {
    return {
      loadSessionModel: async () => undefined,
      loadHistory: async () => [],
      resolveTurnAdapter: (): ProviderAdapter => ({
        providerName: 'TEST-children',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (): AsyncIterable<StreamEvent> {
          yield { kind: 'text_delta', text: 'TEST child done' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        },
      }),
      mcp,
      publishDelta: async () => {},
      publishReasoning: async () => {},
      publishTool: async () => {},
      log: () => {},
      persistExecution: async (_round, _kind, record) => {
        await persistExecutionRecord(resolveArchiveTarget(), sessionId, record)
      },
    }
  }

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    process.env['KARDATA_PROVIDER'] = 'fake'
    const url = await ensureTestDb('kardata_test_children_1000')
    process.env['DATABASE_URL'] = url
    process.env['KARDATA_ARCHIVE_DIR'] = mkdtempSync(join(tmpdir(), 'kardata-children-archive-'))
    pool = new Pool({ connectionString: url, max: 20 })
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
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
      taskQueue: `kardata-test-children-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 300_000)

  afterAll(async () => {
    for (const id of ownedWorkflows) {
      try {
        const handle = client.workflow.getHandle(id)
        const description = await handle.describe()
        if (description.status.name === 'RUNNING') await handle.terminate('Isolated children test cleanup after incomplete execution.')
      } catch (error) {
        if (!(error instanceof Error && error.name === 'WorkflowNotFoundError')) throw error
      }
    }
    await pool?.end().catch(() => undefined)
    try {
      worker.shutdown()
      await run
    } catch {
      // Shutdown races are test-harness noise, never product signal.
    }
    await connection?.close().catch(() => undefined)
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_PROVIDER']
    delete process.env['KARDATA_ARCHIVE_DIR']
  }, 120_000)

  function taskQueue(): string {
    return (worker.options as { taskQueue: string }).taskQueue
  }

  async function parentState(parentId: string): Promise<TestParentState> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await client.workflow.getHandle(parentId).query('parentState') as TestParentState
      } catch {
        await sleep(1000)
      }
    }
    throw new Error('TEST parentState query never settled (can chain churning?)')
  }

  it('drains 50 in flight plus 950 queued with 1000 stored results', async () => {
    const runTag = String(Date.now())
    const sessionId = `TEST-kids-${runTag}`
    const sectorId = `sector-kids-${runTag}`
    await createSector(pool, { name: `TEST kids ${runTag}`, sectorId, idempotencyKey: `fault-kids-sector:${runTag}` })
    await appendEvent(pool, {
      idempotencyKey: `fault-kids-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST kids ${sessionId}`, sectorId, tenantId: 'TEST children 1000', projectId: null },
    })
    await projectNewEvents(pool)
    const childIds = Array.from({ length: CHILDREN }, (_, index) => `TEST-kid-${runTag}-${index}`)
    const goals = new Map(childIds.map((childId, index) => [childId, `TEST goal ${index}`]))
    const parentId = `TEST-parent-${runTag}`
    ownedWorkflows.add(parentId)
    for (const childId of childIds) ownedWorkflows.add(childId)
    const started = Date.now()
    const parent = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId: parentId,
      args: [{ sessionId, maxInFlight: IN_FLIGHT, maxQueued: 2000, historyEventLimit: HISTORY_EVENT_LIMIT }],
    })
    for (let index = 0; index < CHILDREN; index += 1) {
      const childId = childIds[index]!
      await client.workflow.getHandle(parentId).signal('parentDelegate', {
        childId,
        goal: goals.get(childId)!,
        depth: 0,
        mode: 'empty',
        maxDepth: 0,
        queueCapacity: 8,
      })
    }
    console.log(`[children-1000] signalled ${CHILDREN} delegates in ${Date.now() - started}ms`)
    const processedBy = Date.now() + 300_000
    for (;;) {
      const state = await parentState(parentId)
      if (state.children.length + state.queued.length >= CHILDREN) break
      if (Date.now() > processedBy) throw new Error('TEST timed out waiting for delegations to process')
      await sleep(1000)
    }
    const queued = await parentState(parentId)
    expect(queued.children.length).toBe(IN_FLIGHT)
    expect(queued.queued.length).toBe(CHILDREN - IN_FLIGHT)
    expect(queued.rejected).toEqual([])
    const launched = (await readPartition(pool, `session:${sessionId}`)).filter((event) => event.type === 't.subagent.launched').length
    expect(launched).toBe(IN_FLIGHT)
    console.log(`[children-1000] queued ${queued.queued.length} behind ${queued.children.length} running`)
    const fed = new Set<string>()
    const finished = new Set<string>()
    // Measured floor: the parent launches serially at ~0.77/s (delegated
    // activity + startChild per child), so 1000 launches need ~1300s.
    const pumpBy = Date.now() + 1_650_000
    for (;;) {
      if (finished.size >= CHILDREN) break
      if (Date.now() > pumpBy) throw new Error(`TEST pump stalled at ${finished.size}/${CHILDREN} finished`)
      const state = await parentState(parentId)
      const unfed = state.children.filter((child) => child.status === 'running' && !child.goalFed && !fed.has(child.childId))
      await mapLimit(unfed, 20, async (child) => {
        try {
          await client.workflow.getHandle(child.childId).signal('childMessage', goals.get(child.childId)!)
        } catch (error) {
          if (!(error instanceof Error && error.name === 'WorkflowNotFoundError')) throw error
        }
        fed.add(child.childId)
      })
      await projectNewEvents(pool)
      const { rows } = await pool.query<{ thread_key: string }>(
        "SELECT DISTINCT thread_key FROM thread_messages WHERE thread_key LIKE 'agent:TEST-kid-' || $1 || '-%' AND payload::text LIKE '%TEST child done%'",
        [runTag],
      )
      const replied = new Set(rows.map((row) => row.thread_key.slice('agent:'.length)))
      const toReap = state.children.filter(
        (child) => child.status === 'running' && replied.has(child.childId) && !finished.has(child.childId),
      )
      await mapLimit(toReap, 20, async (child) => {
        await client.workflow.getHandle(child.childId).signal('childFinish')
        expect(await client.workflow.getHandle(child.childId).result()).toBe('finished')
        await client.workflow.getHandle(parentId).signal('parentNoteDone', { childId: child.childId, status: 'finished' })
        finished.add(child.childId)
      })
      const doneThisRound = toReap.length
      console.log(`[children-1000] finished=${finished.size} fed=${fed.size} queued=${state.queued.length}`)
      if (doneThisRound === 0) await sleep(2000)
    }
    const final = await parentState(parentId)
    expect(final.children.length).toBe(CHILDREN)
    expect(final.children.every((child) => child.status === 'finished')).toBe(true)
    expect(final.queued).toEqual([])
    expect(final.rejected).toEqual([])
    await client.workflow.getHandle(parentId).signal('parentFinish')
    expect(await parent.result()).toBe('done')
    const rows = await readPartition(pool, `session:${sessionId}`)
    const completed = rows.filter((event) => event.type === 't.subagent.completed')
    expect(completed.length).toBe(CHILDREN)
    const completedIds = completed.map((event) => ((event.payload as Record<string, unknown>)['summary'] as Record<string, unknown>)['id'] as string).sort()
    expect(completedIds).toEqual([...childIds].sort())
    const rejected = rows.filter((event) => event.type === 't.subagent.rejected')
    expect(rejected).toEqual([])
    const { rows: replyRows } = await pool.query<{ count: string }>(
      "SELECT COUNT(DISTINCT thread_key) AS count FROM thread_messages WHERE thread_key LIKE 'agent:TEST-kid-' || $1 || '-%' AND payload::text LIKE '%TEST child done%'",
      [runTag],
    )
    expect(Number(replyRows[0]?.count ?? 0)).toBe(CHILDREN)
    const chainBy = Date.now() + 60_000
    for (;;) {
      let executions = 0
      for await (const _execution of client.workflow.list({ query: `WorkflowId = '${parentId}'` })) executions += 1
      if (executions >= 2) break
      if (Date.now() > chainBy) throw new Error('TEST continue-as-new never chained (threshold too high?)')
      await sleep(2000)
    }
    console.log(`[children-1000] done in ${Date.now() - started}ms: completed=${completed.length} rejected=0 replies=${CHILDREN}`)
  }, 1_800_000)
})
