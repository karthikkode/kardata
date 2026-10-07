// Pure unit tests for durable execution reconciliation: owner inspection,
// nudge/pause/stop/cancel ladders, orphan handling, and the activity entry.
// No database, no Temporal server.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { MockActivityEnvironment } from '@temporalio/testing'
import {
  inspectWorkflowOwner,
  reconcilePage,
  reconciliationPageActivity,
  type ReconciliationControl,
} from '../../backend/src/temporal/activities/reconciliation.js'

const db = vi.hoisted(() => ({
  pool: {},
  project: vi.fn(),
  candidates: vi.fn(),
  loopEvidence: vi.fn(),
  parents: vi.fn(),
  orphans: vi.fn(),
  nudgedAt: vi.fn(),
  recorded: vi.fn(),
  record: vi.fn(),
  recordOrphan: vi.fn(),
}))
vi.mock('../../backend/src/projector.js', () => ({ projectNewEvents: db.project }))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  workerPoolFromEnv: () => db.pool,
  listReconciliationCandidates: db.candidates,
  recentTurnLoopEvidence: db.loopEvidence,
  parentWorkflowsForChildren: db.parents,
  listOrphanedWorkflows: db.orphans,
  controlRecordedAt: db.nudgedAt,
  controlRecorded: db.recorded,
  recordReconciliation: db.record,
  recordOrphanWorkflow: db.recordOrphan,
}))
const net = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), describe: vi.fn(), signal: vi.fn(), cancel: vi.fn() }))
vi.mock('@temporalio/client', async (original) => {
  const mod = await original<typeof import('@temporalio/client')>()
  return {
    ...mod,
    Connection: { ...mod.Connection, connect: net.connect },
    Client: class FakeClient {
      options = { namespace: 'unit-test' }
      connection = { withDeadline: async (_d: number, work: () => Promise<unknown>) => work() }
      workflow = { getHandle: (_id: string) => ({ describe: net.describe, signal: net.signal, cancel: net.cancel }) }
      constructor(public readonly opts: unknown) {}
    },
  }
})
vi.mock('../../backend/src/temporal/connection.js', () => ({
  temporalAddress: () => 'localhost:7233',
  temporalNamespace: () => 'unit-test',
}))

afterEach(() => { vi.clearAllMocks() })

const MIN = 60_000
function candidate(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    threadKey: 'sess-1', sessionId: 'sess-1', workflowId: 'session-run-sess-1',
    status: 'RUNNING', queueDepth: 0, updatedAtMs: now,
    heartbeatAtMs: now, progressAtMs: now, activeRun: 'run-1', lease: 'lease-1',
    currentEpoch: null, activeEpoch: null, activeExecutionId: null,
    intentExecutionId: null, intentState: null, intentCreatedAtMs: null,
    runStartedAtMs: now, unresolvedStart: false, sessionDeleted: false,
    ...overrides,
  } as never
}
function setup(cands: unknown[]) {
  db.project.mockResolvedValue({ caughtUp: true })
  db.candidates.mockResolvedValue(cands)
  db.loopEvidence.mockResolvedValue(new Map())
  db.parents.mockResolvedValue(new Map())
  db.orphans.mockResolvedValue([])
  db.record.mockResolvedValue(true)
  db.recordOrphan.mockResolvedValue(true)
  db.recorded.mockResolvedValue(false)
  db.nudgedAt.mockResolvedValue(null)
}
function control(overrides: Partial<ReconciliationControl> = {}): ReconciliationControl & { signals: unknown[]; cancels: string[] } {
  const signals: unknown[] = []
  const cancels: string[] = []
  return {
    signals,
    cancels,
    describe: async () => ({ state: 'closed' as const }),
    signal: async (workflowId: string, signalName: 'runSteer' | 'runPause' | 'runCancel' | 'runStopTurn' | 'childMessage' | 'childPause' | 'childCancel', payload?: string) => { signals.push([workflowId, signalName, payload]) },
    cancel: async (workflowId: string) => { cancels.push(workflowId) },
    ...overrides,
  }
}

describe('inspectWorkflowOwner [F:backend.activity.reconciliation.inspectWorkflowOwner] [F:backend.activity.reconciliation.reconcilePage] [F:backend.activity.reconciliation.reconciliationPageActivity]', () => {
  it('reports no workflow id as unavailable without describing', async () => {
    const describe = vi.fn()
    const connection = { withDeadline: async (_d: number, work: () => Promise<unknown>) => work() }
    const client = { workflow: { getHandle: () => ({ describe }) } }
    await expect(inspectWorkflowOwner(connection as never, client as never, candidate({ workflowId: null }))).resolves.toEqual({ state: 'unavailable' })
    expect(describe).not.toHaveBeenCalled()
  })
  it('maps running and closed owners with their execution', async () => {
    const connection = { withDeadline: async (_d: number, work: () => Promise<unknown>) => work() }
    const running = { workflow: { getHandle: () => ({ describe: async () => ({ status: { name: 'RUNNING' }, runId: 'e1' }) }) } }
    await expect(inspectWorkflowOwner(connection as never, running as never, candidate())).resolves.toEqual({ state: 'running', executionId: 'e1' })
    const closed = { workflow: { getHandle: () => ({ describe: async () => ({ status: { name: 'COMPLETED' }, runId: 'e1' }) }) } }
    await expect(inspectWorkflowOwner(connection as never, closed as never, candidate())).resolves.toEqual({ state: 'closed', executionId: 'e1' })
  })
  it('maps describe failures to unavailable', async () => {
    const connection = { withDeadline: async (_d: number, work: () => Promise<unknown>) => work() }
    const down = { workflow: { getHandle: () => ({ describe: async () => { throw new Error('cut') } }) } }
    await expect(inspectWorkflowOwner(connection as never, down as never, candidate())).resolves.toEqual({ state: 'unavailable' })
  })
})

describe('reconcilePage findings', () => {
  it('defers while the projector lags', async () => {
    db.project.mockResolvedValue({ caughtUp: false })
    await expect(reconcilePage(db.pool as never, 'c0', async () => ({ state: 'running' as const }))).resolves.toEqual({ cursor: 'c0', inspected: 0, findings: 0, deferred: 'projector-lag' })
    expect(db.candidates).not.toHaveBeenCalled()
  })
  it('nudges a stalled turn once, then stays silent inside the window', async () => {
    const stale = candidate({ progressAtMs: Date.now() - 16 * MIN })
    setup([stale])
    const ctl = control()
    const first = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(first).toMatchObject({ inspected: 1, findings: 1 })
    expect(ctl.signals).toEqual([['session-run-sess-1', 'runSteer', expect.stringContaining('Supervisor: no agent progress')]])
    setup([stale])
    db.nudgedAt.mockResolvedValue(Date.now() - MIN)
    const ctl2 = control()
    const second = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl2)
    expect(second.findings).toBe(0)
    expect(ctl2.signals).toEqual([])
  })
  it('escalates to pause when a nudge went out over a full window ago', async () => {
    setup([candidate({ progressAtMs: Date.now() - 16 * MIN })])
    db.nudgedAt.mockResolvedValue(Date.now() - 16 * MIN)
    const ctl = control()
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(result.findings).toBe(1)
    expect(ctl.signals).toEqual([['session-run-sess-1', 'runPause', undefined]])
  })
  it('nudges children over childMessage and pauses over childPause', async () => {
    setup([candidate({ threadKey: 'agent:child-1', workflowId: 'child-1', progressAtMs: Date.now() - 16 * MIN })])
    const ctl = control()
    await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(ctl.signals).toEqual([['child-1', 'childMessage', expect.any(String)]])
  })
  it('skips an already-acted control and tolerates control failure', async () => {
    setup([candidate({ progressAtMs: Date.now() - 16 * MIN })])
    db.recorded.mockResolvedValue(true)
    const ctl = control()
    const skipped = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(skipped.findings).toBe(0)
    expect(ctl.signals).toEqual([])
    setup([candidate({ progressAtMs: Date.now() - 16 * MIN })])
    const failing = control({ signal: async () => { throw new Error('signal cut') } })
    const failed = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, failing)
    expect(failed.findings).toBe(0)
  })
  it('fails the candidate honestly without acting when control is missing', async () => {
    setup([candidate({ progressAtMs: Date.now() - 16 * MIN })])
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }))
    expect(result).toMatchObject({ inspected: 1, findings: 0 })
  })
  it('stops a repeated tool loop', async () => {
    const now = Date.now()
    setup([candidate({ progressAtMs: now, heartbeatAtMs: now })])
    db.loopEvidence.mockResolvedValue(new Map([['sess-1', { tools: [{ name: 't', args: { a: 1 } }, { name: 't', args: { a: 1 } }, { name: 't', args: { a: 1 } }], texts: [] }]]))
    const ctl = control()
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), now, () => undefined, ctl)
    expect(result.findings).toBe(1)
    expect(ctl.signals).toEqual([['session-run-sess-1', 'runStopTurn', undefined]])
  })
  it('cancels a turn past the wall clock', async () => {
    const now = Date.now()
    setup([candidate({ intentState: 'bound', runStartedAtMs: now - 25 * MIN, progressAtMs: now, heartbeatAtMs: now })])
    const ctl = control()
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), now, () => undefined, ctl)
    expect(result.findings).toBe(1)
    expect(ctl.cancels).toEqual(['session-run-sess-1'])
  })
  it('records a fenced closed owner as failed without signalling', async () => {
    const now = Date.now()
    setup([candidate({
      currentEpoch: 'e1', activeEpoch: 'e1', intentState: 'bound',
      activeExecutionId: 'exec-1', intentExecutionId: 'exec-1',
    })])
    const ctl = control()
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'closed' as const, executionId: 'exec-1' }), now, () => undefined, ctl)
    expect(result.findings).toBe(1)
    expect(ctl.signals).toEqual([])
    expect(ctl.cancels).toEqual([])
    expect(db.record).toHaveBeenCalledWith(db.pool, expect.anything(), expect.objectContaining({ kind: 'closed-owner', response: 'fail' }), 0)
  })
  it('observes an unfenced closed owner and an unreachable one', async () => {
    setup([candidate({})])
    const ctl = control()
    const closed = await reconcilePage(db.pool as never, '', async () => ({ state: 'closed' as const, executionId: 'exec-9' }), Date.now(), () => undefined, ctl)
    expect(closed.findings).toBe(1)
    expect(db.record).toHaveBeenCalledWith(db.pool, expect.anything(), expect.objectContaining({ kind: 'closed-owner', response: 'observe' }), expect.any(Number))
    setup([candidate({})])
    const missing = await reconcilePage(db.pool as never, '', async () => ({ state: 'unavailable' as const }), Date.now(), () => undefined, ctl)
    expect(missing.findings).toBe(1)
    expect(db.record).toHaveBeenCalledWith(db.pool, expect.anything(), expect.objectContaining({ kind: 'owner-unavailable', response: 'observe' }), expect.any(Number))
  })
  it('fails a turn whose heartbeats stopped past the wall while the owner is dark', async () => {
    const now = Date.now()
    setup([candidate({ heartbeatAtMs: now - 25 * MIN })])
    const ctl = control()
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'unavailable' as const }), now, () => undefined, ctl)
    expect(result.findings).toBe(1)
    expect(db.record).toHaveBeenCalledWith(db.pool, expect.anything(), expect.objectContaining({ kind: 'missing-heartbeat', response: 'fail' }), 0)
  })
  it('alerts on starved queues without a lease', async () => {
    const now = Date.now()
    setup([candidate({ lease: null, queueDepth: 3, updatedAtMs: now - 6 * MIN })])
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), now)
    expect(result.findings).toBe(1)
    expect(db.record).toHaveBeenCalledWith(db.pool, expect.anything(), expect.objectContaining({ kind: 'queue-starvation', response: 'alert' }), expect.any(Number))
  })
  it('heartbeats each candidate and advances the cursor on a full page', async () => {
    const heartbeat = vi.fn()
    const full = Array.from({ length: 200 }, (_, i) => candidate({ threadKey: `t-${i}` }))
    setup(full)
    const result = await reconcilePage(db.pool as never, 'c0', async () => ({ state: 'running' as const }), Date.now(), heartbeat, control())
    expect(result).toMatchObject({ inspected: 200, cursor: 't-199' })
    expect(heartbeat).toHaveBeenCalledTimes(200)
    setup([candidate({ threadKey: 't-0' })])
    const short = await reconcilePage(db.pool as never, 'c0', async () => ({ state: 'running' as const }), Date.now(), () => undefined, control())
    expect(short.cursor).toBe('')
  })
})

describe('reconcilePage orphans', () => {
  it('cancels a running workflow whose session is deleted', async () => {
    setup([candidate({ sessionDeleted: true })])
    const ctl = control({ describe: async () => ({ state: 'running' as const, executionId: 'e1' }) })
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(result.findings).toBe(1)
    expect(ctl.cancels).toEqual(['session-run-sess-1'])
    expect(db.recordOrphan).toHaveBeenCalled()
  })
  it('skips an unknown deleted-session owner and tolerates cancel failure', async () => {
    setup([candidate({ sessionDeleted: true })])
    const unknown = control({ describe: async () => ({ state: 'unknown' as const }) })
    const skipped = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, unknown)
    expect(skipped.findings).toBe(0)
    setup([candidate({ sessionDeleted: true })])
    const failing = control({ describe: async () => ({ state: 'running' as const }), cancel: async () => { throw new Error('cancel cut') } })
    const failed = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, failing)
    expect(failed.findings).toBe(0)
  })
  it('skips an already-recorded deleted-session cancel', async () => {
    setup([candidate({ sessionDeleted: true })])
    db.recorded.mockResolvedValue(true)
    const ctl = control({ describe: async () => ({ state: 'running' as const }) })
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(result.findings).toBe(0)
    expect(ctl.cancels).toEqual([])
  })
  it('cancels a running child whose parent workflow ended', async () => {
    setup([candidate({ threadKey: 'agent:child-1', workflowId: 'child-1' })])
    db.parents.mockResolvedValue(new Map([['agent:child-1', 'delegation-sess-1']]))
    const ctl = control({ describe: async (id: string) => (id === 'delegation-sess-1' ? { state: 'closed' as const } : { state: 'running' as const }) })
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(result.findings).toBe(1)
    expect(ctl.cancels).toEqual(['child-1'])
  })
  it('leaves parentless or live-parent children alone', async () => {
    setup([candidate({ threadKey: 'agent:child-1', workflowId: 'child-1' })])
    const ctl = control()
    const orphan = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(orphan.findings).toBe(0)
    setup([candidate({ threadKey: 'agent:child-1', workflowId: 'child-1' })])
    db.parents.mockResolvedValue(new Map([['agent:child-1', 'delegation-sess-1']]))
    const live = control({ describe: async () => ({ state: 'running' as const }) })
    const kept = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, live)
    expect(kept.findings).toBe(0)
    expect(live.cancels).toEqual([])
  })
  it('tolerates orphan-child cancel failure', async () => {
    setup([candidate({ threadKey: 'agent:child-1', workflowId: 'child-1' })])
    db.parents.mockResolvedValue(new Map([['agent:child-1', 'delegation-sess-1']]))
    const ctl = control({
      describe: async (id: string) => (id === 'delegation-sess-1' ? { state: 'closed' as const } : { state: 'running' as const }),
      cancel: async () => { throw new Error('cancel cut') },
    })
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(result.findings).toBe(0)
  })
  it('sweeps recorded orphans: cancels running ones, records closed ones, skips unknown ones', async () => {
    setup([])
    db.orphans.mockResolvedValue([
      { threadKey: 't-run', sessionId: 's', workflowId: 'w-run', lease: 'l1' },
      { threadKey: 't-closed', sessionId: 's', workflowId: 'w-closed', lease: 'l2' },
      { threadKey: 't-unknown', sessionId: 's', workflowId: 'w-unknown', lease: 'l3' },
    ])
    const ctl = control({
      describe: async (id: string) => (id === 'w-run' ? { state: 'running' as const } : id === 'w-closed' ? { state: 'closed' as const } : { state: 'unknown' as const }),
    })
    const result = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, ctl)
    expect(result).toMatchObject({ inspected: 0, findings: 2 })
    expect(ctl.cancels).toEqual(['w-run'])
  })
  it('tolerates orphan-sweep cancel failure and missing control', async () => {
    setup([])
    db.orphans.mockResolvedValue([{ threadKey: 't-run', sessionId: 's', workflowId: 'w-run', lease: 'l1' }])
    const failing = control({ describe: async () => ({ state: 'running' as const }), cancel: async () => { throw new Error('cancel cut') } })
    const failed = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }), Date.now(), () => undefined, failing)
    expect(failed.findings).toBe(0)
    setup([])
    db.orphans.mockResolvedValue([{ threadKey: 't-run', sessionId: 's', workflowId: 'w-run', lease: 'l1' }])
    const uncontrolled = await reconcilePage(db.pool as never, '', async () => ({ state: 'running' as const }))
    expect(uncontrolled.findings).toBe(0)
  })
})

describe('reconciliationPageActivity', () => {
  it('reconciles one page over a live control and closes its connection', async () => {
    setup([candidate({ progressAtMs: Date.now() - 16 * MIN })])
    net.connect.mockResolvedValueOnce({ withDeadline: async (_d: number, work: () => Promise<unknown>) => work(), close: net.close })
    net.describe.mockResolvedValue({ status: { name: 'RUNNING' }, runId: 'e1' })
    const result = await new MockActivityEnvironment().run(reconciliationPageActivity, '')
    expect(result).toMatchObject({ inspected: 1, findings: 1 })
    expect(net.signal).toHaveBeenCalledWith('runSteer', expect.stringContaining('Supervisor: no agent progress'))
    expect(net.close).toHaveBeenCalledOnce()
  })
  it('treats an undescribable owner as unknown and still closes', async () => {
    setup([candidate({ sessionDeleted: true })])
    const connection = { withDeadline: async (_d: number, work: () => Promise<unknown>) => work(), close: net.close }
    net.connect.mockResolvedValueOnce(connection)
    // Owner inspect fails (unavailable), orphan describe fails (unknown): nothing acts.
    net.describe.mockRejectedValue(new Error('describe cut'))
    const result = await new MockActivityEnvironment().run(reconciliationPageActivity, '')
    expect(result).toMatchObject({ inspected: 1, findings: 0 })
    expect(net.cancel).not.toHaveBeenCalled()
    expect(net.close).toHaveBeenCalledOnce()
  })
})
