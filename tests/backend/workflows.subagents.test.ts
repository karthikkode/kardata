// Subagent child workflows (B2.4). Live proof against compose Temporal:
// launch/get/message/redirect/cancel/collect all execute as real child
// workflows, every launch writes an isolation record, and the parent
// partition holds only the delegation call plus completion entries — never
// child intermediates. Gated by KARDATA_TEMPORAL_TEST=1 like the B2.1-B2.3
// suites; without the flag every test skips explicitly.
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getThread, readPartition } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
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
  'subagents.ts',
)

interface Launched {
  childId: string
  parentSessionId: string
  parentWorkflowId: string
  depth: number
  mode: string
  goal: string
  queueCapacity: number
  canDelegate: boolean
}

interface Summary {
  id: string
  goal: string
  status: string
  depth: number
  mode: string
  threadLength: number
  missedSteer: string[]
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

describe.skipIf(!ENABLED)('subagent child workflows (B2.4)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let run: Promise<void>

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    // Karbot turns resolve the fake provider with delegate-supplied steps;
    // no keys, no network.
    process.env['KARDATA_PROVIDER'] = 'fake'
    url = await ensureTestDb('kardata_test_subagents')
    process.env['DATABASE_URL'] = url
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: { appendEventActivity, karbotTurnActivity },
      taskQueue: `kardata-test-subagents-${Date.now()}`,
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

  async function startParent(sessionId: string) {
    const workflowId = `subagents-parent-${sessionId}`
    const handle = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId,
      args: [{ sessionId }],
    })
    await waitFor(
      async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.session.created'),
      30_000,
      'parent to start',
    )
    return { handle, workflowId }
  }

  function delegate(childId: string, goal = 'research the question', extra: Record<string, unknown> = {}) {
    return { childId, goal, depth: 1, mode: 'empty', maxDepth: 1, queueCapacity: 8, ...extra }
  }

  async function launchedRecord(sessionId: string, childId: string): Promise<Launched> {
    let found: Launched | undefined
    await waitFor(
      async () => {
        const rows = await events(`session:${sessionId}`)
        const match = rows.find(
          (event) => event.type === 't.subagent.launched' && (event.payload['childId'] as string) === childId,
        )
        if (match) found = match.payload as unknown as Launched
        return found !== undefined
      },
      30_000,
      `launch record for ${childId}`,
    )
    if (!found) throw new Error(`missing launch record for ${childId}`)
    return found
  }

  async function childSummary(childId: string): Promise<Summary> {
    return (await client.workflow.getHandle(childId).query('childSummary')) as Summary
  }

  it('keeps fresh lifecycle and reply events when a closed child identity is reused', async () => {
    const sessionId = `reuse-${Date.now()}`, childId = `reuse-child-${Date.now()}`
    for (const label of ['first', 'second']) {
      const parent = await startParent(sessionId)
      try {
        await parent.handle.signal('parentDelegate', delegate(childId, `TEST ${label} goal`, { fakeSteps: [{ text: `${label} reply` }] }))
        const child = client.workflow.getHandle(childId)
        await waitFor(async () => (await events(`session:${sessionId}`)).filter((event) => event.type === 't.subagent.launched' && event.payload['childId'] === childId).length === (label === 'first' ? 1 : 2), 30000, 'fresh child launch')
        const pool = new Pool({ connectionString: url })
        try { await projectNewEvents(pool); expect((await getThread(pool, `agent:${childId}`))?.status).toBe('RUNNING') } finally { await pool.end() }
        await child.signal('childMessage', `${label} request`)
        await waitFor(async () => (await events(`child:${childId}`)).some((event) => (event.payload['message'] as { text?: string } | undefined)?.text === `${label} reply`), 30000, 'fresh child reply')
        await child.signal('childFinish')
        expect(await child.result()).toBe('finished')
      } finally { await parent.handle.cancel(); await parent.handle.result().catch(() => undefined) }
    }
    const rows = await events(`session:${sessionId}`)
    expect(rows.filter((event) => event.type === 't.subagent.completed' && (event.payload['summary'] as { id?: string } | undefined)?.id === childId)).toHaveLength(2)
  }, 120000)

  it('launches a child with a full isolation record', async () => {
    const sessionId = `iso-${Date.now()}`
    const parent = await startParent(sessionId)
    const childId = `sag-iso-${Date.now()}`
    await parent.handle.signal('parentDelegate', delegate(childId))

    const record = await launchedRecord(sessionId, childId)
    expect(record.parentSessionId).toBe(sessionId)
    expect(record.parentWorkflowId).toBe(parent.workflowId)
    expect(record.depth).toBe(1)
    expect(record.mode).toBe('empty')
    expect(record.goal).toBe('research the question')
    expect(record.queueCapacity).toBe(8)
    // Depth 1 of max 1 cannot nest further: isolation is a leaf.
    expect(record.canDelegate).toBe(false)

    const state = (await client.workflow.getHandle(childId).query('childState')) as {
      status: string
      acceptingSteer: boolean
    }
    expect(state.status).toBe('running')
    expect(state.acceptingSteer).toBe(true)

    await client.workflow.getHandle(childId).signal('childFinish')
    expect(await client.workflow.getHandle(childId).result()).toBe('finished')
    await parent.handle.signal('parentNoteDone', { childId, status: 'finished' })
    await parent.handle.signal('parentFinish')
    expect(await parent.handle.result()).toBe('done')
  }, 120_000)

  it('runs all six ops as children and keeps intermediates out of the parent', async () => {
    const sessionId = `ops-${Date.now()}`
    const parent = await startParent(sessionId)
    const childId = `sag-ops-${Date.now()}`
    const child = client.workflow.getHandle(childId)
    await parent.handle.signal(
      'parentDelegate',
      delegate(childId, 'research the question', {
        fakeSteps: [{ text: 'fake child reply' }, { text: 'fake correction' }],
      }),
    )
    await launchedRecord(sessionId, childId)

    // message: the child works the item in its own partition.
    await child.signal('childMessage', 'work item')
    await waitFor(
      async () => (await events(`child:${childId}`)).some((event) => event.type === 't.message.appended'),
      30_000,
      'child reply',
    )

    // get: live snapshot while running.
    const mid = (await child.query('childState')) as { status: string; queueDepth: number }
    expect(mid.status).toBe('running')
    expect(mid.queueDepth).toBe(0)

    // redirect: goal rewrite plus queued correction work.
    await child.signal('childRedirect', 'narrower goal')
    await waitFor(async () => (await childSummary(childId)).goal === 'narrower goal', 30_000, 'redirect')
    await waitFor(async () => (await childSummary(childId)).threadLength >= 2, 30_000, 'correction turn')

    // redirect with an empty goal rejects: the goal is untouched.
    await child.signal('childRedirect', '   ')
    await sleep(1_000)
    expect((await childSummary(childId)).goal).toBe('narrower goal')

    // collect: summary only, never intermediates.
    const summary = await childSummary(childId)
    expect(summary).toMatchObject({ id: childId, goal: 'narrower goal', status: 'running', depth: 1 })
    expect(summary.threadLength).toBeGreaterThanOrEqual(2)
    expect(summary.missedSteer).toEqual([])

    // finish: the completion entry lands in the parent partition.
    await child.signal('childFinish')
    expect(await child.result()).toBe('finished')
    let completed: Summary | undefined
    await waitFor(
      async () => {
        const rows = await events(`session:${sessionId}`)
        const match = rows.find((event) => event.type === 't.subagent.completed')
        if (match) completed = (match.payload as { summary: Summary }).summary
        return completed !== undefined
      },
      30_000,
      'completion entry',
    )
    expect(completed?.status).toBe('finished')
    expect(completed?.threadLength).toBeGreaterThanOrEqual(2)

    // Parent-thread contract: delegation call + launch + completion, and no
    // Karbot child reply anywhere in the parent partition.
    const parentRows = await events(`session:${sessionId}`)
    const types = parentRows.map((row) => row.type)
    expect(types).toContain('t.subagent.delegated')
    expect(types).toContain('t.subagent.launched')
    expect(types).toContain('t.subagent.completed')
    expect(JSON.stringify(parentRows)).not.toContain('fake child reply')
    expect(JSON.stringify(parentRows)).not.toContain('fake correction')
    // The child reply lands in the child's own partition instead.
    expect(JSON.stringify(await events(`child:${childId}`))).toContain('fake child reply')

    await parent.handle.signal('parentNoteDone', { childId, status: 'finished' })
    await parent.handle.signal('parentFinish')
    expect(await parent.handle.result()).toBe('done')
  }, 180_000)

  it('cancel mid-turn records a cancelled completion with zero orphans', async () => {
    const sessionId = `cx-${Date.now()}`
    const parent = await startParent(sessionId)
    const childId = `sag-cx-${Date.now()}`
    const child = client.workflow.getHandle(childId)
    await parent.handle.signal(
      'parentDelegate',
      delegate(childId, 'research the question', { fakeSteps: [{ text: 'fake doomed', delayMs: 15_000 }] }),
    )
    await launchedRecord(sessionId, childId)

    await child.signal('childMessage', 'doomed item')
    // The doomed fake step dwells 15 s: at 500 ms the activity is in
    // flight, so this cancel lands mid-turn, not pre-start.
    await waitFor(async () => ((await child.query('childState')) as { queueDepth: number }).queueDepth === 0, 30_000, 'turn start')
    await sleep(500)
    await child.signal('childCancel')
    await waitFor(async () => (await childSummary(childId)).status === 'cancelled', 30_000, 'cancelled')

    // Post-cancel steer lands as missed steer on the still-open child.
    await child.signal('childMessage', 'late steer')
    await waitFor(async () => (await childSummary(childId)).missedSteer.includes('late steer'), 30_000, 'missed steer')

    await child.signal('childFinish')
    expect(await child.result()).toBe('cancelled')
    const history = await child.fetchHistory()
    const canceled = (history.events ?? []).filter((event) => 'activityTaskCanceledEventAttributes' in event)
    expect(canceled.length).toBeGreaterThanOrEqual(1)

    let completed: Summary | undefined
    await waitFor(
      async () => {
        const rows = await events(`session:${sessionId}`)
        const match = rows.find((event) => event.type === 't.subagent.completed')
        if (match) completed = (match.payload as { summary: Summary }).summary
        return completed !== undefined
      },
      30_000,
      'cancelled completion',
    )
    expect(completed?.status).toBe('cancelled')
    expect(completed?.missedSteer).toContain('late steer')
    // No orphan: the cancelled turn left no reply in either partition.
    expect(JSON.stringify(await events(`session:${sessionId}`))).not.toContain('fake doomed')
    expect(JSON.stringify(await events(`child:${childId}`))).not.toContain('fake doomed')

    await parent.handle.signal('parentNoteDone', { childId, status: 'cancelled' })
    await parent.handle.signal('parentFinish')
    expect(await parent.handle.result()).toBe('done')
  }, 180_000)

  it('an idle parent with no finish closes itself instead of wedging', async () => {
    const sessionId = `idle-${Date.now()}`
    const handle = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId: `subagents-parent-${sessionId}`,
      args: [{ sessionId, parentIdleTimeoutMs: 3_000 }],
    })
    await waitFor(
      async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.session.created'),
      30_000,
      'parent to start',
    )
    // No delegation, steer, or finish: the idle timer owns the close.
    expect(await handle.result()).toBe('parent-idle-timeout')
    const rows = await events(`session:${sessionId}`)
    expect(rows.some((event) => event.type === 't.subagent.parent_expired')).toBe(true)
  }, 120_000)

  it('a duplicate delegation rejects as an event instead of failing the parent', async () => {
    const sessionId = `dup-${Date.now()}`
    const parent = await startParent(sessionId)
    const childId = `sag-dup-${Date.now()}`
    await parent.handle.signal('parentDelegate', delegate(childId))
    await launchedRecord(sessionId, childId)

    // Same id while the child runs: rejected, parent and child unaffected.
    await parent.handle.signal('parentDelegate', delegate(childId, 'a second goal'))
    let reasons: string[] = []
    await waitFor(
      async () => {
        reasons = (await events(`session:${sessionId}`))
          .filter((event) => event.type === 't.subagent.rejected')
          .map((event) => event.payload['reason'] as string)
        return reasons.length >= 1
      },
      30_000,
      'duplicate rejection',
    )
    expect(reasons).toContain('duplicate delegation for a running child')
    const launches = (await events(`session:${sessionId}`)).filter((event) => event.type === 't.subagent.launched')
    expect(launches).toHaveLength(1)

    await client.workflow.getHandle(childId).signal('childFinish')
    expect(await client.workflow.getHandle(childId).result()).toBe('finished')
    await parent.handle.signal('parentNoteDone', { childId, status: 'finished' })
    await parent.handle.signal('parentFinish')
    expect(await parent.handle.result()).toBe('done')
  }, 180_000)

  it('over-cap delegations queue durably and launch on promotion', async () => {
    const sessionId = `cap-${Date.now()}`
    const workflowId = `subagents-parent-${sessionId}`
    const parent = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId,
      args: [{ sessionId, maxInFlight: 2 }],
    })
    await waitFor(
      async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.session.created'),
      30_000,
      'parent to start',
    )
    const stamp = Date.now()
    const first = `sag-cap-a-${stamp}`
    const second = `sag-cap-b-${stamp}`
    const third = `sag-cap-c-${stamp}`
    const steps = (text: string) => ({ fakeSteps: [{ text }] })
    await parent.signal('parentDelegate', delegate(first, 'first goal', steps('first reply')))
    await parent.signal('parentDelegate', delegate(second, 'second goal', steps('second reply')))
    await launchedRecord(sessionId, first)
    await launchedRecord(sessionId, second)

    // Two running children fill the cap: the third queues (event plus
    // queryable position) instead of rejecting or starting.
    await parent.signal('parentDelegate', delegate(third, 'third goal', steps('third reply')))
    await waitFor(
      async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.subagent.queued' && event.payload['childId'] === third),
      30_000,
      'queue record',
    )
    const queued = ((await parent.query('parentState')) as { queued: string[] }).queued
    expect(queued).toContain(third)
    expect((await events(`session:${sessionId}`)).filter((event) => event.type === 't.subagent.launched')).toHaveLength(2)

    // Finishing the first child promotes the third: it launches with its
    // goal fed parent-side, so its partition carries the goal text.
    await client.workflow.getHandle(first).signal('childFinish')
    expect(await client.workflow.getHandle(first).result()).toBe('finished')
    await parent.signal('parentNoteDone', { childId: first, status: 'finished' })
    await launchedRecord(sessionId, third)
    await waitFor(
      async () => (await events(`child:${third}`)).some((event) => JSON.stringify(event.payload).includes('third goal')),
      30_000,
      'promoted goal feed',
    )

    for (const childId of [second, third]) {
      await client.workflow.getHandle(childId).signal('childFinish')
      expect(await client.workflow.getHandle(childId).result()).toBe('finished')
      await parent.signal('parentNoteDone', { childId, status: 'finished' })
    }
    await parent.signal('parentFinish')
    expect(await parent.result()).toBe('done')
  }, 180_000)

  it('delegations past the queue cap reject with the queue-full reason', async () => {
    const sessionId = `qfull-${Date.now()}`
    const workflowId = `subagents-parent-${sessionId}`
    const parent = await client.workflow.start('delegateParent', {
      taskQueue: taskQueue(),
      workflowId,
      args: [{ sessionId, maxInFlight: 1, maxQueued: 1 }],
    })
    await waitFor(
      async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.session.created'),
      30_000,
      'parent to start',
    )
    const stamp = Date.now()
    const first = `sag-qf-a-${stamp}`
    const second = `sag-qf-b-${stamp}`
    const third = `sag-qf-c-${stamp}`
    await parent.signal('parentDelegate', delegate(first, 'first goal', { fakeSteps: [{ text: 'first reply' }] }))
    await launchedRecord(sessionId, first)
    await parent.signal('parentDelegate', delegate(second, 'second goal', { fakeSteps: [{ text: 'second reply' }] }))
    await waitFor(
      async () => (await events(`session:${sessionId}`)).some((event) => event.type === 't.subagent.queued' && event.payload['childId'] === second),
      30_000,
      'queue record',
    )

    // One running plus one waiting fills both caps: the third rejects with
    // the queue-full reason, visible on the event and the query.
    await parent.signal('parentDelegate', delegate(third, 'third goal'))
    let reasons: string[] = []
    await waitFor(
      async () => {
        reasons = (await events(`session:${sessionId}`))
          .filter((event) => event.type === 't.subagent.rejected')
          .map((event) => event.payload['reason'] as string)
        return reasons.length >= 1
      },
      30_000,
      'queue-full rejection',
    )
    expect(reasons).toContain('child queue full (1 waiting)')
    const state = (await parent.query('parentState')) as { rejected: Array<{ childId: string; reason: string }> }
    expect(state.rejected).toContainEqual({ childId: third, reason: 'child queue full (1 waiting)' })

    await client.workflow.getHandle(first).signal('childFinish')
    expect(await client.workflow.getHandle(first).result()).toBe('finished')
    await parent.signal('parentNoteDone', { childId: first, status: 'finished' })
    await launchedRecord(sessionId, second)
    await client.workflow.getHandle(second).signal('childFinish')
    expect(await client.workflow.getHandle(second).result()).toBe('finished')
    await parent.signal('parentNoteDone', { childId: second, status: 'finished' })
    await parent.signal('parentFinish')
    expect(await parent.result()).toBe('done')
  }, 180_000)

  it('a cancelled child with no finish closes itself instead of waiting forever', async () => {
    const sessionId = `cf-${Date.now()}`
    const parent = await startParent(sessionId)
    const childId = `sag-cf-${Date.now()}`
    const child = client.workflow.getHandle(childId)
    await parent.handle.signal(
      'parentDelegate',
      delegate(childId, 'research the question', { childFinishTimeoutMs: 3_000 }),
    )
    await launchedRecord(sessionId, childId)

    await child.signal('childCancel')
    await waitFor(async () => (await childSummary(childId)).status === 'cancelled', 30_000, 'cancelled')
    // No childFinish ever arrives: the finish wait expires and the child
    // still records its cancelled completion.
    expect(await child.result()).toBe('cancelled')
    let completed: Summary | undefined
    await waitFor(
      async () => {
        const rows = await events(`session:${sessionId}`)
        const match = rows.find((event) => event.type === 't.subagent.completed')
        if (match) completed = (match.payload as { summary: Summary }).summary
        return completed !== undefined
      },
      30_000,
      'cancelled completion',
    )
    expect(completed?.status).toBe('cancelled')

    await parent.handle.signal('parentNoteDone', { childId, status: 'cancelled' })
    await parent.handle.signal('parentFinish')
    expect(await parent.handle.result()).toBe('done')
  }, 180_000)

  it('rejects bad launches and reports fork isolation honestly', async () => {
    const sessionId = `rej-${Date.now()}`
    const parent = await startParent(sessionId)

    await parent.handle.signal('parentDelegate', delegate(`sag-empty-${Date.now()}`, '   '))
    await parent.handle.signal('parentDelegate', delegate(`sag-deep-${Date.now()}`, 'too deep', { depth: 2 }))
    let rejected: Array<{ reason: string }> = []
    await waitFor(
      async () => {
        const rows = await events(`session:${sessionId}`)
        rejected = rows
          .filter((event) => event.type === 't.subagent.rejected')
          .map((event) => event.payload as { reason: string })
        return rejected.length >= 2
      },
      30_000,
      'rejections',
    )
    expect(rejected.map((entry) => entry.reason)).toContain('delegation needs a non-empty goal')
    expect(rejected.map((entry) => entry.reason)).toContain('depth exceeds max 1')
    // Rejected launches never start children: no launch records at all.
    expect((await events(`session:${sessionId}`)).some((event) => event.type === 't.subagent.launched')).toBe(false)

    // Fork children continue the parent conversation and must not delegate;
    // an empty child at the same depth with headroom may.
    const forkId = `sag-fork-${Date.now()}`
    const nestedId = `sag-nested-${Date.now()}`
    await parent.handle.signal('parentDelegate', delegate(forkId, 'forked work', { mode: 'fork', maxDepth: 2 }))
    await parent.handle.signal('parentDelegate', delegate(nestedId, 'nesting work', { maxDepth: 2 }))
    await launchedRecord(sessionId, forkId)
    await launchedRecord(sessionId, nestedId)
    expect(await client.workflow.getHandle(forkId).query('childCanDelegate')).toBe(false)
    expect(await client.workflow.getHandle(nestedId).query('childCanDelegate')).toBe(true)

    for (const childId of [forkId, nestedId]) {
      await client.workflow.getHandle(childId).signal('childFinish')
      expect(await client.workflow.getHandle(childId).result()).toBe('finished')
      await parent.handle.signal('parentNoteDone', { childId, status: 'finished' })
    }
    await parent.handle.signal('parentFinish')
    expect(await parent.handle.result()).toBe('done')
  }, 180_000)

  it('sends to a finished child land as missed steer, never a relaunch', async () => {
    const sessionId = `ms-${Date.now()}`
    const parent = await startParent(sessionId)
    const childId = `sag-ms-${Date.now()}`
    const child = client.workflow.getHandle(childId)
    await parent.handle.signal(
      'parentDelegate',
      // The turn needs one scripted step: without it the fake provider is
      // empty and the child can never reach threadLength 1 (out of steps
      // is a test bug per agents/src/fake.ts, never a fallback).
      delegate(childId, 'research the question', { fakeSteps: [{ text: 'only reply' }] }),
    )
    await launchedRecord(sessionId, childId)

    await child.signal('childMessage', 'only item')
    await waitFor(async () => (await childSummary(childId)).threadLength >= 1, 30_000, 'child work')
    await child.signal('childFinish')
    expect(await child.result()).toBe('finished')
    await parent.handle.signal('parentNoteDone', { childId, status: 'finished' })

    await parent.handle.signal('parentSteer', { childId, text: 'too late' })
    await waitFor(
      async () =>
        (await events(`session:${sessionId}`)).some(
          (event) => event.type === 't.subagent.missed_steer' && event.payload['text'] === 'too late',
        ),
      30_000,
      'missed steer',
    )
    // Exactly one launch: the steer never relaunched the child.
    const launches = (await events(`session:${sessionId}`)).filter((event) => event.type === 't.subagent.launched')
    expect(launches).toHaveLength(1)

    await parent.handle.signal('parentFinish')
    expect(await parent.handle.result()).toBe('done')
  }, 120_000)

  it('cancelling the parent propagates to the running child with its completion recorded', async () => {
    const sessionId = `pc-${Date.now()}`
    const parent = await startParent(sessionId)
    const childId = `sag-pc-${Date.now()}`
    const child = client.workflow.getHandle(childId)
    await parent.handle.signal('parentDelegate', delegate(childId))
    await launchedRecord(sessionId, childId)

    await child.signal('childMessage', 'interrupted item')
    await waitFor(async () => ((await child.query('childState')) as { queueDepth: number }).queueDepth === 0, 30_000, 'turn start')
    await sleep(500)
    await parent.handle.cancel()
    await expect(parent.handle.result()).rejects.toThrow()
    await expect(child.result()).rejects.toThrow()

    // The child's non-cancellable completion still landed in the parent
    // partition, so the thread shows the closed child instead of silence.
    await waitFor(
      async () =>
        (await events(`session:${sessionId}`)).some(
          (event) =>
            event.type === 't.subagent.completed' &&
            ((event.payload as { summary: Summary }).summary.status === 'cancelled'),
        ),
      30_000,
      'propagated completion',
    )
  }, 120_000)
})
