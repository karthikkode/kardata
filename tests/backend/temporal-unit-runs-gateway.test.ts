// Pure unit tests for TemporalRunsGateway: file dispatch, run reads,
// send routing, sweep/plan lifecycle, and delegation acceptance.
// No database, no Temporal server: db and the client module are mocked.
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from '@temporalio/client'
import { defaultPayloadConverter } from '@temporalio/common'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { ChildQueueFull, RunNotFound, TemporalUnavailableError } from '../../backend/src/temporal/runs-types.js'

const db = vi.hoisted(() => ({
  pool: {},
  project: vi.fn(),
  recovery: vi.fn(),
  enqueueSteering: vi.fn(),
  readSectorPlan: vi.fn(),
  append: vi.fn(),
  reserveIntent: vi.fn(),
  confirmIntent: vi.fn(),
  markIntent: vi.fn(),
  reserveDispatch: vi.fn(),
  markDispatch: vi.fn(),
  readJob: vi.fn(),
  getThread: vi.fn(),
  listThreads: vi.fn(),
  listHeaders: vi.fn(),
  requireThread: vi.fn(),
  setPaused: vi.fn(),
  enqueueQueued: vi.fn(),
}))
vi.mock('../../backend/src/projector.js', () => ({ projectNewEvents: db.project }))
vi.mock('../../backend/src/temporal/turn-recovery.js', () => ({ loadOriginalTurnRecovery: db.recovery }))
vi.mock('../../backend/src/temporal/connection.js', () => ({ connectClient: vi.fn(), temporalNamespace: () => 'unit-test' }))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  enqueueSteering: db.enqueueSteering,
  readSectorPlan: db.readSectorPlan,
  appendEvent: db.append,
  reserveExecutionIntent: db.reserveIntent,
  confirmExecutionIntent: db.confirmIntent,
  markExecutionIntent: db.markIntent,
  reserveFileProcessingDispatch: db.reserveDispatch,
  markFileProcessingDispatchOutcome: db.markDispatch,
  readFileProcessingJob: db.readJob,
  getThread: db.getThread,
  listThreads: db.listThreads,
  listThreadHeaders: db.listHeaders,
  requireThread: db.requireThread,
  setThreadPaused: db.setPaused,
  enqueueQueuedSteering: db.enqueueQueued,
}))
const temporal = vi.hoisted(() => ({
  start: vi.fn(),
  signalWithStart: vi.fn(),
  handles: new Map<string, Record<string, unknown>>(),
  list: vi.fn(),
  history: vi.fn(),
  instances: [] as unknown[],
}))
vi.mock('@temporalio/client', async (original) => {
  const mod = await original<typeof import('@temporalio/client')>()
  return {
    ...mod,
    Client: class FakeClient {
      connection: unknown
      options = { namespace: 'unit-test' }
      workflow = {
        start: temporal.start,
        signalWithStart: temporal.signalWithStart,
        getHandle: (id: string) => {
          const handle = temporal.handles.get(id)
          if (!handle) throw new Error(`unexpected handle ${id}`)
          return handle
        },
        list: temporal.list,
      }
      constructor(opts: { connection: unknown }) {
        this.connection = opts.connection
        temporal.instances.push(this)
      }
    },
  }
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  temporal.handles.clear()
  temporal.instances.length = 0
})

function connection() {
  return {
    withDeadline: async (_deadline: number, work: () => Promise<unknown>) => work(),
    workflowService: { getWorkflowExecutionHistory: temporal.history },
    close: vi.fn(),
  }
}
function gateway() {
  db.project.mockResolvedValue({ caughtUp: true })
  return new TemporalRunsGateway(db.pool as never, connection() as never)
}
function handle(impl: Record<string, unknown> = {}) {
  return {
    workflowId: 'w',
    firstExecutionRunId: 'first-1',
    describe: async () => ({ type: 'sessionRun', status: { name: 'RUNNING' }, runId: 'run-1', startTime: new Date('2026-01-01T00:00:00.000Z'), closeTime: undefined, raw: { workflowExecutionInfo: { firstRunId: 'first-1' } } }),
    signal: async () => undefined,
    query: async () => ({}),
    cancel: async () => undefined,
    executeUpdate: async () => undefined,
    result: async () => undefined,
    ...impl,
  }
}
const JOB_ID = `fjob-${'a'.repeat(48)}`
function notFound(id: string) {
  return new WorkflowNotFoundError('gone', id, undefined)
}

describe('startFileProcessing', () => {
  it('validates the admission key', async () => {
    const g = gateway()
    await expect(g.startFileProcessing('nope', 0)).rejects.toThrow('Invalid file processing admission.')
    await expect(g.startFileProcessing(JOB_ID, -1)).rejects.toThrow('Invalid file processing admission.')
    expect(db.readJob).not.toHaveBeenCalled()
  })
  it('refuses superseded revisions and completed jobs', async () => {
    const g = gateway()
    db.readJob.mockResolvedValue({ revision: 1 })
    await expect(g.startFileProcessing(JOB_ID, 0)).rejects.toThrow('A newer file revision owns admission.')
    db.readJob.mockResolvedValue({ revision: 0, state: 'complete' })
    await g.startFileProcessing(JOB_ID, 0)
    expect(db.reserveDispatch).not.toHaveBeenCalled()
  })
  it('requires a durable reservation identity', async () => {
    const g = gateway()
    db.readJob.mockResolvedValue({ revision: 0, state: 'queued' })
    db.reserveDispatch.mockResolvedValue({})
    await expect(g.startFileProcessing(JOB_ID, 0)).rejects.toThrow('no durable reservation identity')
  })
  it('starts and confirms an owned reservation', async () => {
    const g = gateway()
    db.readJob.mockResolvedValue({ revision: 0, state: 'queued' })
    db.reserveDispatch.mockResolvedValue({ nonce: 'n1', workflowId: 'wf-1', ownsReservation: true })
    temporal.start.mockResolvedValueOnce({ firstExecutionRunId: 'exec-1' })
    await g.startFileProcessing(JOB_ID, 0)
    expect(temporal.start).toHaveBeenCalledWith('fileProcessing', expect.objectContaining({ workflowId: 'wf-1', args: [{ jobId: JOB_ID, revision: 0, dispatchNonce: 'n1' }] }))
    expect(db.markDispatch).toHaveBeenCalledWith(db.pool, { jobId: JOB_ID, revision: 0, nonce: 'n1', workflowId: 'wf-1', outcome: 'confirmed', executionId: 'exec-1' })
  })
  it('adopts a live reservation whose owner already runs', async () => {
    const g = gateway()
    db.readJob.mockResolvedValue({ revision: 0, state: 'queued' })
    db.reserveDispatch.mockResolvedValue({ nonce: 'n1', workflowId: 'wf-1', ownsReservation: false })
    temporal.handles.set('wf-1', handle({ describe: async () => ({ type: 'fileProcessing', runId: 'exec-2' }) }))
    temporal.history.mockResolvedValueOnce({
      history: { events: [{ workflowExecutionStartedEventAttributes: { input: { payloads: [defaultPayloadConverter.toPayload({ jobId: JOB_ID, revision: 0, dispatchNonce: 'n1' })] } } }] },
    })
    await g.startFileProcessing(JOB_ID, 0)
    expect(temporal.start).not.toHaveBeenCalled()
    expect(db.markDispatch).toHaveBeenCalledWith(db.pool, expect.objectContaining({ outcome: 'confirmed', executionId: 'exec-2' }))
  })
  it('marks uncertain and wraps owner mismatches', async () => {
    const g = gateway()
    db.readJob.mockResolvedValue({ revision: 0, state: 'queued' })
    db.reserveDispatch.mockResolvedValue({ nonce: 'n1', workflowId: 'wf-1', ownsReservation: false })
    temporal.handles.set('wf-1', handle({ describe: async () => ({ type: 'sessionRun', runId: 'exec-2' }) }))
    const error = await g.startFileProcessing(JOB_ID, 0).then(() => null, (e: unknown) => e as Error)
    expect(error?.message).toBe('File dispatch outcome requires durable owner inspection.')
    expect(String((error?.cause as Error)?.message)).toBe('File execution type does not match its reserved owner.')
    expect(db.markDispatch).toHaveBeenCalledWith(db.pool, expect.objectContaining({ outcome: 'uncertain' }))
  })
  it('marks uncertain when the inspection budget or input does not fit', async () => {
    const g = gateway()
    db.readJob.mockResolvedValue({ revision: 0, state: 'queued' })
    db.reserveDispatch.mockResolvedValue({ nonce: 'n1', workflowId: 'wf-1', ownsReservation: false })
    temporal.handles.set('wf-1', handle({ describe: async () => ({ type: 'fileProcessing', runId: 'exec-2' }) }))
    temporal.history.mockResolvedValueOnce({ history: { events: [{ blob: 'x'.repeat(1_048_577) }] } })
    const big = await g.startFileProcessing(JOB_ID, 0).then(() => null, (e: unknown) => e as Error)
    expect(big?.message).toBe('File dispatch outcome requires durable owner inspection.')
    expect((big?.cause as Error)?.message).toBe('File admission history exceeds its bounded inspection budget.')
    temporal.history.mockResolvedValueOnce({
      history: { events: [{ workflowExecutionStartedEventAttributes: { input: { payloads: [defaultPayloadConverter.toPayload({ jobId: JOB_ID, revision: 0, dispatchNonce: 'other' })] } } }] },
    })
    const mismatched = await g.startFileProcessing(JOB_ID, 0).then(() => null, (e: unknown) => e as Error)
    expect((mismatched?.cause as Error)?.message).toBe('File execution input does not match its reserved owner.')
  })
  it('marks uncertain when the start RPC itself fails', async () => {
    const g = gateway()
    db.readJob.mockResolvedValue({ revision: 0, state: 'queued' })
    db.reserveDispatch.mockResolvedValue({ nonce: 'n1', workflowId: 'wf-1', ownsReservation: true })
    temporal.start.mockRejectedValueOnce(new Error('rpc cut'))
    await expect(g.startFileProcessing(JOB_ID, 0)).rejects.toThrow('File dispatch outcome requires durable owner inspection.')
    expect(db.markDispatch).toHaveBeenCalledWith(db.pool, expect.objectContaining({ outcome: 'uncertain' }))
  })
})

describe('listRuns', () => {
  it('lists a session directory from its recorded graph', async () => {
    const g = gateway()
    db.listHeaders.mockResolvedValue([{ key: 'agent:child-1', kind: 'subagent', sessionId: 'sess-1', status: 'PAUSED' }])
    temporal.handles.set('session-run-sess-1', handle({ describe: async () => ({ type: 'sessionRun', status: { name: 'RUNNING' }, startTime: new Date('2026-01-02T00:00:00.000Z'), closeTime: undefined }) }))
    temporal.handles.set('sess-1', handle({ describe: async () => ({ type: 'unrelated' }) }))
    temporal.handles.set('child-1', handle({ describe: async () => ({ type: 'subagentRun', status: { name: 'RUNNING' }, startTime: new Date('2026-01-01T00:00:00.000Z'), closeTime: undefined }) }))
    const runs = await g.listRuns('sess-1')
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ id: 'session-run-sess-1', sessionId: 'sess-1', state: 'RUNNING' })
    expect(runs[1]).toMatchObject({ id: 'child-1', sessionId: 'sess-1', threadKey: 'agent:child-1', state: 'PAUSED' })
  })
  it('skips children outside the session graph and missing runs', async () => {
    const g = gateway()
    db.listHeaders.mockResolvedValue([])
    temporal.handles.set('session-run-sess-1', handle({ describe: async () => { throw notFound('session-run-sess-1') } }))
    temporal.handles.set('sess-1', handle({ describe: async () => ({ type: 'subagentRun', status: { name: 'RUNNING' }, startTime: new Date(), closeTime: undefined }) }))
    await expect(g.listRuns('sess-1')).resolves.toEqual([])
  })
  it('rethrows unexpected describe failures', async () => {
    const g = gateway()
    db.listHeaders.mockResolvedValue([])
    temporal.handles.set('session-run-sess-1', handle({ describe: async () => { throw new Error('store down') } }))
    temporal.handles.set('sess-1', handle({ describe: async () => { throw notFound('sess-1') } }))
    await expect(g.listRuns('sess-1')).rejects.toThrow('store down')
  })
  it('lists the fleet summary with child rows merged', async () => {
    const g = gateway()
    async function* executions() {
      yield { workflowId: 'session-run-a', type: 'sessionRun' }
      yield { workflowId: 'other', type: 'unrelated' }
      yield { workflowId: 'child-9', type: 'subagentRun' }
      yield { workflowId: 'child-10', type: 'subagentRun' }
      yield { workflowId: 'gone', type: 'sessionRun' }
    }
    temporal.list.mockReturnValue(executions())
    temporal.handles.set('session-run-a', handle({ describe: async () => ({ type: 'sessionRun', status: { name: 'RUNNING' }, startTime: new Date('2026-01-01T00:00:00.000Z'), closeTime: undefined }) }))
    temporal.handles.set('child-9', handle({ describe: async () => ({ type: 'subagentRun', status: { name: 'RUNNING' }, startTime: new Date('2026-01-01T00:00:00.000Z'), closeTime: undefined }) }))
    temporal.handles.set('child-10', handle({ describe: async () => ({ type: 'subagentRun', status: { name: 'RUNNING' }, startTime: new Date('2026-01-01T00:00:00.000Z'), closeTime: undefined }) }))
    temporal.handles.set('gone', handle({ describe: async () => { throw notFound('gone') } }))
    db.getThread.mockImplementation(async (_pool: unknown, key: string) => (key === 'agent:child-9' ? { key, sessionId: 'sess-9', status: 'RUNNING' } : null))
    const runs = await g.listRuns()
    expect(runs.map((run) => run.id)).toEqual(['session-run-a', 'child-9'])
    expect(runs[1]).toMatchObject({ sessionId: 'sess-9', threadKey: 'agent:child-9' })
  })
})

describe('getRun', () => {
  it('returns null for missing runs and rethrows unexpected failures', async () => {
    const g = gateway()
    temporal.handles.set('gone', handle({ describe: async () => { throw notFound('gone') } }))
    await expect(g.getRun('gone')).resolves.toBeNull()
    temporal.handles.set('bad', handle({ describe: async () => { throw new Error('store down') } }))
    await expect(g.getRun('bad')).rejects.toThrow('store down')
  })
  it('reads child runs from their thread row', async () => {
    const g = gateway()
    temporal.handles.set('child-1', handle({ describe: async () => ({ type: 'subagentRun', status: { name: 'RUNNING' }, startTime: new Date(), closeTime: undefined }) }))
    db.getThread.mockResolvedValue({ key: 'agent:child-1', sessionId: 'sess-1', updatedAt: '2026-01-03T00:00:00.000Z' })
    await expect(g.getRun('child-1')).resolves.toMatchObject({ id: 'child-1', sessionId: 'sess-1', threadKey: 'agent:child-1', state: 'RUNNING' })
    db.getThread.mockResolvedValue(null)
    await expect(g.getRun('child-1')).resolves.toBeNull()
  })
  it('reads research runs from their workflow state', async () => {
    const g = gateway()
    temporal.handles.set('res-1', handle({
      describe: async () => ({ type: 'researchRun', status: { name: 'RUNNING' }, startTime: new Date(), closeTime: undefined }),
      query: async () => ({ runId: 'res-1', status: 'paused', cursor: 7 }),
    }))
    await expect(g.getRun('res-1')).resolves.toMatchObject({ id: 'res-1', sessionId: 'res-1', threadKey: 'research:res-1', state: 'PAUSED', stageCursor: '7' })
  })
  it('falls back to close mapping when the run closes mid-read', async () => {
    const g = gateway()
    let calls = 0
    temporal.handles.set('res-1', handle({
      describe: async () => (++calls === 1
        ? { type: 'researchRun', status: { name: 'RUNNING' }, startTime: new Date('2026-01-01T00:00:00.000Z'), closeTime: undefined }
        : { type: 'researchRun', status: { name: 'COMPLETED' }, startTime: new Date('2026-01-01T00:00:00.000Z'), closeTime: new Date('2026-01-02T00:00:00.000Z') }),
      query: async () => { throw notFound('res-1') },
    }))
    await expect(g.getRun('res-1')).resolves.toMatchObject({ id: 'res-1', state: 'FINISHED' })
  })
})

describe('send', () => {
  function sessionThread() {
    return { key: 'sess-1', kind: 'session', status: 'RUNNING', sessionId: 'sess-1', acceptingSteer: true }
  }
  it('records a missed steer for text to a finished child', async () => {
    const g = gateway()
    // Resolve the address to the child, then report it finished.
    const seen: string[] = []
    db.getThread.mockImplementation(async (_pool: unknown, key: string) => {
      seen.push(key)
      if (seen.length === 1) return { key: 'agent:child-1', kind: 'subagent', status: 'RUNNING', sessionId: 'sess-1' }
      return { key: 'agent:child-1', kind: 'subagent', status: 'FINISHED', sessionId: 'sess-1' }
    })
    const result = await g.send('agent:child-1', 'late hello')
    expect(result).toMatchObject({ state: 'missed_steer' })
    expect(db.append).toHaveBeenCalledWith(db.pool, expect.objectContaining({ partition: 'session:sess-1', type: 't.subagent.missed_steer' }))
    expect(temporal.signalWithStart).not.toHaveBeenCalled()
  })
  it('maps a lost server to a 503 and reconnects fresh next time', async () => {
    const g = gateway()
    db.getThread.mockResolvedValue(sessionThread())
    db.listThreads.mockResolvedValue([])
    db.reserveIntent.mockResolvedValue(`epoch-${randomUUID()}`)
    temporal.signalWithStart.mockRejectedValueOnce(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }))
    const first = await g.send('sess-1', 'hello').then(() => null, (e: unknown) => e as Error)
    expect(first).toBeInstanceOf(TemporalUnavailableError)
    expect(temporal.instances).toHaveLength(1)
    expect(db.markIntent).toHaveBeenCalled()
    temporal.signalWithStart.mockResolvedValueOnce({ firstExecutionRunId: 'first-1', describe: async () => ({ runId: 'run-1', raw: { workflowExecutionInfo: { firstRunId: 'first-1' } } }) })
    const second = await g.send('sess-1', 'hello again')
    expect(second).toMatchObject({ state: 'accepted' })
    expect(temporal.instances).toHaveLength(2)
  })
  it('passes a missing child run through as 404', async () => {
    const g = gateway()
    db.getThread.mockResolvedValue({ key: 'agent:child-1', kind: 'subagent', status: 'RUNNING', sessionId: 'sess-1' })
    temporal.handles.set('child-1', handle({ signal: async () => { throw notFound('child-1') } }))
    await expect(g.send('agent:child-1', 'hello')).rejects.toBeInstanceOf(RunNotFound)
  })
})

describe('sector sweep lifecycle', () => {
  it('starts a sweep for a plan without an executable', async () => {
    const g = gateway()
    db.readSectorPlan.mockResolvedValue({ versions: [{ version: 2, executable: null }], approvedVersion: 2 })
    temporal.start.mockResolvedValueOnce({ workflowId: 'sector-sweep-sec-1' })
    const result = await g.startSectorSweep('sec-1')
    expect(result).toMatchObject({ state: 'accepted' })
    expect(temporal.start).toHaveBeenCalledWith('sectorSweep', expect.objectContaining({ workflowId: 'sector-sweep-sec-1', args: [expect.objectContaining({ sectorId: 'sec-1' })] }))
  })
  it('resumes an already-approved coordinator instead of duplicating', async () => {
    const g = gateway()
    const executable = { researchDepth: 'deep' }
    db.readSectorPlan.mockResolvedValue({ versions: [{ version: 2, executable }], approvedVersion: 2 })
    temporal.start.mockRejectedValueOnce(new WorkflowExecutionAlreadyStartedError('exists', 'sector-sweep-sec-1', 'run-1'))
    const signal = vi.fn(async () => undefined)
    temporal.handles.set('sector-sweep-sec-1', handle({
      describe: async () => ({ type: 'sectorCoordinator' }),
      query: async () => ({ paused: false, planVersion: 2 }),
      signal,
    }))
    const result = await g.startSectorSweep('sec-1')
    expect(result).toMatchObject({ state: 'accepted' })
    expect(signal).toHaveBeenCalledWith('coordinatorResume')
    expect(temporal.start).toHaveBeenCalledTimes(1)
  })
  it('accepts an already-running plain sweep', async () => {
    const g = gateway()
    db.readSectorPlan.mockResolvedValue({ versions: [{ version: 2, executable: null }], approvedVersion: 2 })
    temporal.start.mockRejectedValueOnce(new WorkflowExecutionAlreadyStartedError('exists', 'sector-sweep-sec-1', 'run-1'))
    temporal.handles.set('sector-sweep-sec-1', handle({ describe: async () => ({ type: 'sectorSweep' }) }))
    await expect(g.startSectorSweep('sec-1')).resolves.toMatchObject({ state: 'accepted' })
  })
  it('pauses coordinators, cancels sweeps, and accepts gone runs', async () => {
    const g = gateway()
    const signal = vi.fn(async () => undefined)
    temporal.handles.set('sector-sweep-sec-1', handle({ describe: async () => ({ type: 'sectorCoordinator' }), signal }))
    await expect(g.cancelSectorSweep('sec-1')).resolves.toMatchObject({ state: 'accepted' })
    expect(signal).toHaveBeenCalledWith('coordinatorPause')
    const cancel = vi.fn(async () => undefined)
    temporal.handles.set('sector-sweep-sec-2', handle({ describe: async () => ({ type: 'sectorSweep' }), cancel }))
    await expect(g.cancelSectorSweep('sec-2')).resolves.toMatchObject({ state: 'accepted' })
    expect(cancel).toHaveBeenCalledOnce()
    temporal.handles.set('sector-sweep-gone', handle({ describe: async () => { throw notFound('sector-sweep-gone') } }))
    await expect(g.cancelSectorSweep('gone')).resolves.toMatchObject({ state: 'accepted' })
  })
})

describe('delegateSubagent acceptance', () => {
  function parentMock() {
    let childId = ''
    temporal.signalWithStart.mockImplementation(async (_type: string, opts: { signalArgs: Array<{ childId: string }> }) => {
      childId = opts.signalArgs[0]!.childId
      return { firstExecutionRunId: 'first-1' }
    })
    return () => childId
  }
  it('fails fast when the durable queue rejects the child', async () => {
    const g = gateway()
    const childIdOf = parentMock()
    let polls = 0
    temporal.handles.set('delegation-sess-1', handle({
      query: async () => (++polls === 1 ? { queued: [] } : { children: [], queued: [], rejected: [{ childId: childIdOf(), reason: 'child queue full (2000 waiting); retry later' }] }),
    }))
    const error = await g.delegateSubagent({ sessionId: 'sess-1', goal: 'research', mode: 'empty', queueCapacity: 1 }).then(() => null, (e: unknown) => e as Error)
    expect(error).toBeInstanceOf(ChildQueueFull)
  })
  it('propagates a queue-full accept hook instead of polling past it', async () => {
    const g = gateway()
    const childIdOf = parentMock()
    let polls = 0
    temporal.handles.set('delegation-sess-1', handle({
      query: async () => (++polls === 1 ? { queued: [] } : { children: [{ childId: childIdOf(), goalFed: true }], queued: [] }),
    }))
    const accepted: string[] = []
    const error = await g.delegateSubagent({
      sessionId: 'sess-1', goal: 'research', mode: 'empty', queueCapacity: 1,
      onAccepted: async (childId) => {
        accepted.push(childId)
        throw new ChildQueueFull('child queue full (simulated accept race)')
      },
    }).then(() => null, (e: unknown) => e as Error)
    expect(error).toBeInstanceOf(ChildQueueFull)
    expect(accepted).toHaveLength(1)
  })
  it('times out polling a parent that never accepts', async () => {
    vi.useFakeTimers()
    const g = gateway()
    parentMock()
    temporal.handles.set('delegation-sess-1', handle({ query: async () => ({ children: [], queued: [] }) }))
    const pending = g.delegateSubagent({ sessionId: 'sess-1', goal: 'research', mode: 'empty', queueCapacity: 1 })
    const assertion = expect(pending).rejects.toThrow('not accepted (duplicate id?)')
    await vi.advanceTimersByTimeAsync(31_000)
    await assertion
  })
})

describe('startSectorPlan', () => {
  function launched() {
    return { firstExecutionRunId: 'first-1', describe: async () => ({ runId: 'run-1', raw: { workflowExecutionInfo: { firstRunId: 'first-1' } } }) }
  }
  it('requires the planning chat session', async () => {
    const g = gateway()
    await expect(g.startSectorPlan('sec-1')).rejects.toThrow('needs the planning chat sessionId')
    expect(temporal.start).not.toHaveBeenCalled()
  })
  it('starts a planning run with an execution epoch', async () => {
    const g = gateway()
    db.reserveIntent.mockResolvedValue('epoch-1')
    temporal.start.mockResolvedValueOnce(launched())
    const result = await g.startSectorPlan('sec-1', undefined, 'sess-plan')
    expect(result).toMatchObject({ state: 'accepted' })
    expect(temporal.start).toHaveBeenCalledWith('sectorPlan', expect.objectContaining({
      workflowId: 'sector-plan-sec-1',
      args: [{ sectorId: 'sec-1', sessionId: 'sess-plan', ownerEpoch: 'epoch-1' }],
    }))
    expect(db.confirmIntent).toHaveBeenCalledWith(db.pool, expect.objectContaining({ epoch: 'epoch-1', executionId: 'run-1', firstExecutionId: 'first-1' }))
  })
  it('adopts an already-running planning run', async () => {
    const g = gateway()
    db.reserveIntent.mockResolvedValue('epoch-1')
    temporal.start.mockRejectedValueOnce(new WorkflowExecutionAlreadyStartedError('exists', 'sector-plan-sec-1', 'run-1'))
    temporal.handles.set('sector-plan-sec-1', handle({ describe: async () => ({ runId: 'run-9', raw: { workflowExecutionInfo: { firstRunId: 'first-9' } } }) }))
    await expect(g.startSectorPlan('sec-1', undefined, 'sess-plan')).resolves.toMatchObject({ state: 'accepted' })
    expect(db.confirmIntent).toHaveBeenCalledWith(db.pool, expect.objectContaining({ epoch: 'epoch-1', executionId: 'run-9', firstExecutionId: 'first-9' }))
  })
  it('marks the intent when the launch fails', async () => {
    const g = gateway()
    db.reserveIntent.mockResolvedValue('epoch-1')
    temporal.start.mockRejectedValueOnce(new Error('lane down'))
    await expect(g.startSectorPlan('sec-1', undefined, 'sess-plan')).rejects.toThrow('lane down')
    expect(db.markIntent).toHaveBeenCalledWith(db.pool, 'epoch-1')
    expect(db.confirmIntent).not.toHaveBeenCalled()
  })
})
