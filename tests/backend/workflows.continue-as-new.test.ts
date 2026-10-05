// Continue-as-new for session, parent, and child runs (P4.2.4). Small
// historyEventLimit values trip a continue after nearly every turn, so the
// carry-over (inbox, queue, children map, goals, pause flags) is exercised
// repeatedly; production keeps the 10k events / 10 MB defaults. Each
// first-run history is walked link by link (continuedExecutionRunId) and
// replayed through the current bundle. Gated by KARDATA_TEMPORAL_TEST=1
// like the other workflow suites; the trigger matrix runs ungated.
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as WorkflowClient } from '@temporalio/client'
import { temporal } from '@temporalio/proto'
import { bundleWorkflowCode, Worker, type NativeConnection, type Worker as WorkerType } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPartition } from '../../backend/src/db/index.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { CAN_DEFAULT_BYTE_LIMIT, CAN_DEFAULT_EVENT_LIMIT, shouldContinueAsNew } from '../../backend/src/temporal/workflows/can.js'
import { ensureTestDb } from './db-helper.js'

describe('shouldContinueAsNew trigger matrix', () => {
  it('keeps the 10k events / 10 MB production defaults', () => {
    expect(CAN_DEFAULT_EVENT_LIMIT).toBe(10_000)
    expect(CAN_DEFAULT_BYTE_LIMIT).toBe(10 * 1024 * 1024)
  })
  const cases: Array<[number, number, boolean, number | undefined, number | undefined, boolean]> = [
    [9999, 1, false, undefined, undefined, false],
    [10_000, 1, false, undefined, undefined, true],
    [100, 10 * 1024 * 1024, false, undefined, undefined, true],
    [100, 10 * 1024 * 1024 - 1, false, undefined, undefined, false],
    [100, 1, true, undefined, undefined, true],
    [50, 1, false, 40, undefined, true],
    [30, 1, false, 40, undefined, false],
    [30, 200, false, undefined, 100, true],
    [30, 50, false, undefined, 100, false],
  ]
  it.each(cases)('length=%i size=%i suggested=%s eventLimit=%s byteLimit=%s -> %s', (length, size, suggested, eventLimit, byteLimit, expected) => {
    expect(shouldContinueAsNew(length, size, suggested, eventLimit, byteLimit)).toBe(expected)
  })
})

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
  'turn-bundle.ts',
)
const CONTINUED = temporal.api.enums.v1.EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW

interface LooseHistory {
  events?: Array<{
    eventType?: unknown
    workflowExecutionStartedEventAttributes?: { continuedExecutionRunId?: string; firstExecutionRunId?: string } | null
  }> | null
}

function startedOf(history: LooseHistory): { continued?: string; first?: string } {
  const started = (history.events ?? []).find((event) => event.workflowExecutionStartedEventAttributes !== undefined && event.workflowExecutionStartedEventAttributes !== null)
  const attrs = started?.workflowExecutionStartedEventAttributes
  return {
    continued: attrs?.continuedExecutionRunId || undefined,
    first: attrs?.firstExecutionRunId || undefined,
  }
}

function hasContinued(history: LooseHistory): boolean {
  return (history.events ?? []).some((event) => event.eventType === CONTINUED)
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

describe.skipIf(!ENABLED)('continue-as-new (P4.2.4)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: WorkerType
  let run: Promise<void>
  const replayTargets: Array<{ workflowId: string; runId?: string }> = []

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_can')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { appendEventActivity, karbotTurnActivity },
      taskQueue: `kardata-test-can-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    await run
    await connection.close()
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_PROVIDER']
  }, 60_000)

  function taskQueue(): string {
    return (worker.options as { taskQueue: string }).taskQueue
  }

  async function events(partition: string): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
    const pool = new Pool({ connectionString: url })
    try {
      const rows = await readPartition(pool, partition)
      return rows.map((row) => ({ type: row.type, payload: row.payload as Record<string, unknown> }))
    } finally {
      await pool.end()
    }
  }

  async function agentReplies(partition: string): Promise<number> {
    const rows = await events(partition)
    return rows.filter((row) => row.type === 't.message.appended' && (row.payload['message'] as { role?: string } | undefined)?.role === 'agent').length
  }

  // Walks the continue-as-new chain link by link: every run's
  // continuedExecutionRunId resolves to its predecessor, every link shares
  // the first execution id, and the first run's history holds the
  // ContinueAsNew event. Returns the first run id for the replay test.
  async function expectContinuedChain(workflowId: string): Promise<string> {
    let continued: string | undefined
    let first: string | undefined
    await waitFor(async () => {
      const current = (await client.workflow.getHandle(workflowId).fetchHistory()) as LooseHistory
      const started = startedOf(current)
      continued = started.continued
      first = started.first
      return continued !== undefined
    }, 60_000, `${workflowId} to continue`)
    let previous = continued as string
    for (let links = 0; links < 50; links += 1) {
      const history = (await client.workflow.getHandle(workflowId, previous).fetchHistory()) as LooseHistory
      const started = startedOf(history)
      expect(started.first).toBe(first)
      if (started.continued === undefined) {
        expect(hasContinued(history)).toBe(true)
        return previous
      }
      previous = started.continued
    }
    throw new Error(`chain walk for ${workflowId} exceeded 50 links`)
  }

  it('sessionRun continues and carries the inbox plus the pause', async () => {
    const tag = randomUUID()
    const sessionId = `can-session-${tag}`
    const workflowId = `can-session-run-${tag}`
    const partition = `session:${sessionId}`
    const handle = await client.workflow.start('sessionRun', {
      taskQueue: taskQueue(),
      workflowId,
      args: [{ sessionId, fakeSteps: [{ text: 'can reply', delayMs: 2000 }], historyEventLimit: 10 }],
    })
    await waitFor(
      async () => (await events(partition)).some((event) => event.type === 't.session.created'),
      30_000,
      'session to start',
    )
    await handle.signal('runSend', 'one')
    await waitFor(async () => (await agentReplies(partition)) === 1, 60_000, 'first reply')
    const firstRunId = await expectContinuedChain(workflowId)
    replayTargets.push({ workflowId, runId: firstRunId })
    // Pause lands mid-turn (the 2 s dwell guarantees the turn is still in
    // flight): the turn completes, then the run continues while paused with
    // the fresh message still queued.
    await handle.signal('runSend', 'two')
    await sleep(300)
    await client.workflow.getHandle(workflowId).signal('runPause')
    await client.workflow.getHandle(workflowId).signal('runSend', 'three')
    await waitFor(async () => {
      const state = (await client.workflow.getHandle(workflowId).query('runState')) as { state: string; pending: number }
      return state.state === 'PAUSED' && state.pending === 1
    }, 60_000, 'continued run to hold paused with one queued')
    expect(await agentReplies(partition)).toBe(2)
    await client.workflow.getHandle(workflowId).signal('runResume')
    await waitFor(async () => (await agentReplies(partition)) === 3, 60_000, 'queued message after resume')
    const state = (await client.workflow.getHandle(workflowId).query('runState')) as { state: string; pending: number }
    expect(state.pending).toBe(0)
    await client.workflow.getHandle(workflowId).signal('runCancel')
  }, 120_000)

  it('delegateParent continues and carries the queue plus the children map', async () => {
    const tag = randomUUID()
    const sessionId = `can-parent-${tag}`
    const workflowId = `can-parent-run-${tag}`
    const partition = `session:${sessionId}`
    const handle = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId,
      args: [{ sessionId, maxInFlight: 2, historyEventLimit: 10 }],
    })
    await waitFor(
      async () => (await events(partition)).some((event) => event.type === 't.session.created'),
      30_000,
      'parent to start',
    )
    const childIds = [0, 1, 2, 3, 4, 5].map((index) => `can-child-b-${index}-${tag}`)
    for (const childId of childIds) {
      await handle.signal('parentDelegate', {
        childId,
        goal: `TEST can goal ${childId}`,
        depth: 1,
        mode: 'empty',
        maxDepth: 1,
        queueCapacity: 8,
        fakeSteps: [{ text: 'child reply' }],
      })
    }
    await waitFor(async () => {
      const rows = await events(partition)
      const launched = rows.filter((row) => row.type === 't.subagent.launched').length
      const queued = rows.filter((row) => row.type === 't.subagent.queued').length
      return launched === 2 && queued === 4
    }, 60_000, 'two launches plus four queued')
    const firstRunId = await expectContinuedChain(workflowId)
    replayTargets.push({ workflowId, runId: firstRunId })
    const fresh = () => client.workflow.getHandle(workflowId)
    const state = (await fresh().query('parentState')) as {
      children: Array<{ childId: string; status: string }>
      queued: string[]
    }
    expect(state.children.filter((child) => child.status === 'running')).toHaveLength(2)
    expect(state.queued).toHaveLength(4)
    // Direct launches leave the first feed to the caller: both running
    // children get their goal and turn it into a reply.
    const running = state.children.filter((child) => child.status === 'running').map((child) => child.childId)
    for (const childId of running) {
      await client.workflow.getHandle(childId).signal('childMessage', `TEST can goal ${childId}`)
    }
    for (const childId of running) {
      await waitFor(async () => (await agentReplies(`child:${childId}`)) >= 1, 60_000, `${childId} first reply`)
    }
    // A steer through the continued parent routes through the re-derived
    // external handle, not a stale pre-chain stub.
    await fresh().signal('parentSteer', { childId: running[0], text: 'skip franchises' })
    await waitFor(async () => (await agentReplies(`child:${running[0]}`)) === 2, 60_000, 'steered second reply')
    // Closing one child frees a slot: the head of the carried queue
    // promotes, launches, and gets its goal fed parent-side.
    await client.workflow.getHandle(running[0]).signal('childCancel')
    await client.workflow.getHandle(running[0]).signal('childFinish')
    await waitFor(
      async () =>
        (await events(partition)).some(
          (event) => event.type === 't.subagent.completed' && ((event.payload['summary'] as { id?: string } | undefined)?.id === running[0]),
        ),
      60_000,
      'completion entry',
    )
    await fresh().signal('parentNoteDone', { childId: running[0], status: 'cancelled' })
    await waitFor(async () => (await events(partition)).filter((event) => event.type === 't.subagent.launched').length === 3, 60_000, 'promoted launch')
    const promoted = (await fresh().query('parentState')) as { children: Array<{ childId: string; status: string }> }
    const promotedId = promoted.children.find((child) => !running.includes(child.childId) && child.status === 'running')?.childId
    expect(promotedId).toBeDefined()
    await waitFor(async () => (await agentReplies(`child:${promotedId as string}`)) >= 1, 60_000, 'promoted child fed reply')
    await fresh().signal('parentFinish')
    for (const childId of [...running.slice(1), promotedId as string]) {
      await client.workflow.getHandle(childId).signal('childCancel')
      await client.workflow.getHandle(childId).signal('childFinish')
    }
  }, 120_000)

  it('subagentRun continues and carries the goal, inbox, and pause', async () => {
    const tag = randomUUID()
    const sessionId = `can-child-session-${tag}`
    const workflowId = `can-child-parent-${tag}`
    const childId = `can-child-c-${tag}`
    const partition = `session:${sessionId}`
    const childPartition = `child:${childId}`
    const parent = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId,
      args: [{ sessionId, maxInFlight: 10 }],
    })
    await waitFor(
      async () => (await events(partition)).some((event) => event.type === 't.session.created'),
      30_000,
      'parent to start',
    )
    await parent.signal('parentDelegate', {
      childId,
      goal: 'TEST original can goal',
      depth: 1,
      mode: 'empty',
      maxDepth: 1,
      queueCapacity: 8,
      fakeSteps: [{ text: 'can child reply', delayMs: 1500 }],
      historyEventLimit: 10,
    })
    await waitFor(
      async () => (await events(partition)).some((event) => event.type === 't.subagent.launched'),
      30_000,
      'child to launch',
    )
    const child = () => client.workflow.getHandle(childId)
    await child().signal('childMessage', 'm1')
    await waitFor(async () => (await agentReplies(childPartition)) === 1, 60_000, 'child first reply')
    const firstRunId = await expectContinuedChain(childId)
    replayTargets.push({ workflowId: childId, runId: firstRunId })
    // The redirect lands before the next continue: the new goal must
    // survive the chain, not revert to the delegation goal.
    await child().signal('childRedirect', 'TEST new can goal')
    await child().signal('childMessage', 'm2')
    await waitFor(async () => (await agentReplies(childPartition)) === 3, 60_000, 'correction plus m2 replies')
    const summary = (await child().query('childSummary')) as { goal: string }
    expect(summary.goal).toBe('TEST new can goal')
    // Pause lands mid-turn: the run continues while paused with the fresh
    // message queued, and the gate holds until resume.
    const before = startedOf((await child().fetchHistory()) as LooseHistory).continued
    await child().signal('childMessage', 'm3')
    await sleep(300)
    await child().signal('childPause')
    await child().signal('childMessage', 'm4')
    await waitFor(async () => {
      const snapshot = (await child().query('childState')) as { queueDepth: number }
      return snapshot.queueDepth === 1 && (await agentReplies(childPartition)) === 4
    }, 60_000, 'paused run to hold one queued')
    const after = startedOf((await child().fetchHistory()) as LooseHistory).continued
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
    await child().signal('childResume')
    await waitFor(async () => (await agentReplies(childPartition)) === 5, 60_000, 'queued message after resume')
    const final = (await child().query('childSummary')) as { goal: string; threadLength: number }
    expect(final.goal).toBe('TEST new can goal')
    // Five turns (m1, correction, m2, m3, m4) carried the counter across.
    expect(final.threadLength).toBe(10)
    replayTargets.push({ workflowId: childId })
    await child().signal('childCancel')
    await child().signal('childFinish')
    await parent.signal('parentNoteDone', { childId, status: 'cancelled' })
    await parent.signal('parentFinish')
  }, 120_000)

  it('first-run histories replay cleanly through the current bundle', async () => {
    // Session run 1, parent run 1, child run 1, plus the child's resumed
    // current run: proves the can-v1 markers and carried state replay.
    expect(replayTargets).toHaveLength(4)
    const workflowBundle = await bundleWorkflowCode({ workflowsPath: WORKFLOWS_PATH })
    for (const target of replayTargets) {
      const history =
        target.runId === undefined
          ? await client.workflow.getHandle(target.workflowId).fetchHistory()
          : await client.workflow.getHandle(target.workflowId, target.runId).fetchHistory()
      await Worker.runReplayHistory({ workflowBundle }, history, target.workflowId)
    }
  }, 120_000)
})
