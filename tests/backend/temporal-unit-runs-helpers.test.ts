// Pure unit tests for runs-gateway helpers: deadline detection, launch
// mapping, status mapping, workflow-type gating, and queued-child controls.
// No database, no Temporal server: the db surface is mocked, clients are fakes.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { WorkflowNotFoundError } from '@temporalio/client'
import {
  childNameOf,
  closeState,
  controlQueuedChild,
  ensureApprovedCoordinator,
  isTemporalDeadlineExceeded,
  mapResearchStatus,
  normalizeLaunchError,
  requireWorkflowType,
  steerQueuedChild,
} from '../../backend/src/temporal/runs-helpers.js'
import { RunNotFound, TemporalUnavailableError, ThreadNotAccepting } from '../../backend/src/temporal/runs-types.js'

const db = vi.hoisted(() => ({ getThread: vi.fn(), setPaused: vi.fn(), append: vi.fn(), enqueue: vi.fn(), pool: {} }))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  getThread: db.getThread,
  setThreadPaused: db.setPaused,
  appendEvent: db.append,
  enqueueQueuedSteering: db.enqueue,
}))

afterEach(() => { vi.clearAllMocks() })

function thread(overrides: Record<string, unknown> = {}) {
  return { key: 'agent:child-1', kind: 'subagent', status: 'QUEUED', sessionId: 'sess-1', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides }
}

function clientWith(handles: Record<string, { query?: (name: string) => Promise<unknown>; signal?: (...args: unknown[]) => Promise<void>; describe?: () => Promise<unknown> }>) {
  return {
    workflow: {
      getHandle: (id: string) => {
        const handle = handles[id] ?? handles['*']
        if (!handle) throw new Error(`unexpected handle ${id}`)
        return {
          query: handle.query ?? (async () => ({})),
          signal: handle.signal ?? (async () => undefined),
          describe: handle.describe ?? (async () => ({})),
        }
      },
    },
  }
}

describe('ensureApprovedCoordinator limits', () => {
  it('rejects non-positive or non-integer versions and timeouts', async () => {
    const handle = { workflowId: 'w', query: vi.fn(), signal: vi.fn(), cancel: vi.fn(), result: async () => undefined }
    await expect(ensureApprovedCoordinator(handle, 0, async () => undefined)).rejects.toThrow('Invalid research transition limits')
    await expect(ensureApprovedCoordinator(handle, 1.5, async () => undefined)).rejects.toThrow('Invalid research transition limits')
    await expect(ensureApprovedCoordinator(handle, 2, async () => undefined, 0)).rejects.toThrow('Invalid research transition limits')
    await expect(ensureApprovedCoordinator(handle, 2, async () => undefined, Number.NaN)).rejects.toThrow('Invalid research transition limits')
    expect(handle.query).not.toHaveBeenCalled()
  })
})

describe('isTemporalDeadlineExceeded', () => {
  it('matches gRPC code 4 and the DEADLINE_EXCEEDED name', () => {
    expect(isTemporalDeadlineExceeded({ code: 4 })).toBe(true)
    expect(isTemporalDeadlineExceeded({ code: 'DEADLINE_EXCEEDED' })).toBe(true)
  })
  it('matches deadline-exceeded messages case-insensitively', () => {
    expect(isTemporalDeadlineExceeded(new Error('rpc failed: Deadline Exceeded'))).toBe(true)
    expect(isTemporalDeadlineExceeded(new Error('connection refused'))).toBe(false)
  })
  it('walks nested causes but stops at non-objects', () => {
    expect(isTemporalDeadlineExceeded({ cause: { cause: { cause: { code: 4 } } } })).toBe(true)
    expect(isTemporalDeadlineExceeded({ cause: { cause: 'nope' } })).toBe(false)
    expect(isTemporalDeadlineExceeded(null)).toBe(false)
    expect(isTemporalDeadlineExceeded('deadline exceeded')).toBe(false)
  })
  it('gives up past four causes deep', () => {
    let deep: unknown = { code: 4 }
    for (let i = 0; i < 6; i += 1) deep = { cause: deep }
    expect(isTemporalDeadlineExceeded(deep)).toBe(false)
  })
})

describe('normalizeLaunchError', () => {
  it('passes non-deadline errors through without dropping the client', () => {
    const drop = vi.fn()
    const error = new Error('boom')
    expect(normalizeLaunchError(error, drop)).toBe(error)
    expect(drop).not.toHaveBeenCalled()
  })
  it('converts a fired RPC deadline into a 503 and drops the client', () => {
    const drop = vi.fn()
    const error = { code: 4, message: 'deadline exceeded' }
    const mapped = normalizeLaunchError(error, drop) as TemporalUnavailableError
    expect(mapped).toBeInstanceOf(TemporalUnavailableError)
    expect(mapped.message).toContain('retry the command shortly')
    expect(drop).toHaveBeenCalledOnce()
  })
})

describe('closeState and mapResearchStatus', () => {
  it('maps terminal workflow statuses to run states', () => {
    expect(closeState('COMPLETED')).toBe('FINISHED')
    expect(closeState('CANCELLED')).toBe('FINISHED')
    expect(closeState('CONTINUED_AS_NEW')).toBe('RUNNING')
    expect(closeState('FAILED')).toBe('ERROR')
    expect(closeState('TERMINATED')).toBe('ERROR')
  })
  it('maps research run statuses to run states', () => {
    expect(mapResearchStatus('running')).toBe('RUNNING')
    expect(mapResearchStatus('paused')).toBe('PAUSED')
    expect(mapResearchStatus('blocked')).toBe('ERROR')
    expect(mapResearchStatus('complete')).toBe('FINISHED')
    expect(mapResearchStatus('anything-else')).toBe('FINISHED')
  })
})

describe('childNameOf', () => {
  it('returns the launched child name and ignores unlaunched rows', () => {
    expect(childNameOf([{ payload: { launched: 'false', name: 'old' } }, { payload: { launched: 'true', name: 'scout' } }])).toBe('scout')
    expect(childNameOf([{ payload: { launched: 'true' } }])).toBeUndefined()
    expect(childNameOf([])).toBeUndefined()
  })
})

describe('requireWorkflowType', () => {
  it('maps a missing workflow to RunNotFound', async () => {
    const client = clientWith({ 'gone': { describe: async () => { throw new WorkflowNotFoundError('gone', 'run', 'run') } } })
    await expect(requireWorkflowType(client as never, 'gone', ['sessionRun'])).rejects.toBeInstanceOf(RunNotFound)
  })
  it('rejects a workflow type with no path for the command', async () => {
    const client = clientWith({ 'r1': { describe: async () => ({ type: 'researchRun' }) } })
    await expect(requireWorkflowType(client as never, 'r1', ['sessionRun'])).rejects.toBeInstanceOf(ThreadNotAccepting)
  })
  it('returns the type when allowed', async () => {
    const client = clientWith({ 'r1': { describe: async () => ({ type: 'sessionRun' }) } })
    await expect(requireWorkflowType(client as never, 'r1', ['sessionRun'])).resolves.toBe('sessionRun')
  })
})

describe('controlQueuedChild', () => {
  it('leaves non-subagent and running threads on the existing path', async () => {
    db.getThread.mockResolvedValueOnce(thread({ kind: 'session' }))
    expect(await controlQueuedChild(db.pool as never, {} as never, 'child-1', 'pause', async () => undefined)).toBeNull()
    db.getThread.mockResolvedValueOnce(thread({ status: 'RUNNING' }))
    expect(await controlQueuedChild(db.pool as never, {} as never, 'child-1', 'pause', async () => undefined)).toBeNull()
    db.getThread.mockResolvedValueOnce(null)
    expect(await controlQueuedChild(db.pool as never, {} as never, 'child-1', 'pause', async () => undefined)).toBeNull()
  })
  it('reports a stale QUEUED row whose parent is gone as a conflict', async () => {
    db.getThread.mockResolvedValue(thread())
    const client = clientWith({
      'delegation-sess-1': { query: async () => { throw new WorkflowNotFoundError('p', 'run', 'run') } },
    })
    await expect(controlQueuedChild(db.pool as never, client as never, 'child-1', 'pause', async () => undefined)).rejects.toThrow('has no live parent')
  })
  it('reports a parent lost between query and signal as a conflict', async () => {
    db.getThread.mockResolvedValue(thread())
    const client = clientWith({
      'delegation-sess-1': {
        query: async () => ({ queued: ['child-1'] }),
        signal: async () => { throw new WorkflowNotFoundError('p', 'run', 'run') },
      },
    })
    await expect(controlQueuedChild(db.pool as never, client as never, 'child-1', 'pause', async () => undefined)).rejects.toThrow('has no live parent')
  })
  it('pauses a queued child through its live parent', async () => {
    db.getThread.mockResolvedValueOnce(thread()).mockResolvedValue(thread({ status: 'PAUSED' }))
    const signal = vi.fn(async () => undefined)
    const client = clientWith({ 'delegation-sess-1': { query: async () => ({ queued: ['child-1'] }), signal } })
    const result = await controlQueuedChild(db.pool as never, client as never, 'child-1', 'pause', async () => undefined)
    expect(result).toMatchObject({ state: 'accepted' })
    expect(signal).toHaveBeenCalledWith('parentChildControl', { childId: 'child-1', action: 'pause' })
    expect(db.setPaused).toHaveBeenCalledWith(db.pool, 'agent:child-1', true)
  })
  it('cancels a queued child with a prompt CANCELLING state', async () => {
    db.getThread.mockResolvedValueOnce(thread()).mockResolvedValue(thread({ status: 'FINISHED' }))
    const client = clientWith({ 'delegation-sess-1': { query: async () => ({ queued: ['child-1'] }) } })
    const result = await controlQueuedChild(db.pool as never, client as never, 'child-1', 'cancel', async () => undefined)
    expect(result).toMatchObject({ state: 'accepted' })
    expect(db.append).toHaveBeenCalledWith(db.pool, expect.objectContaining({ partition: 'child:child-1', type: 't.thread.state' }))
    expect(db.setPaused).not.toHaveBeenCalled()
  })
})

describe('steerQueuedChild', () => {
  it('leaves session threads and running children on the existing path', async () => {
    expect(await steerQueuedChild(db.pool as never, {} as never, { key: 's', kind: 'session', status: 'QUEUED' }, 'hi')).toBeNull()
    expect(await steerQueuedChild(db.pool as never, {} as never, { key: 'agent:c', kind: 'subagent', status: 'RUNNING' }, 'hi')).toBeNull()
  })
  it('leaves a PAUSED child with a live workflow on the running path', async () => {
    const client = clientWith({ 'c1': { describe: async () => ({ type: 'subagentRun' }) } })
    expect(await steerQueuedChild(db.pool as never, client as never, { key: 'agent:c1', kind: 'subagent', status: 'PAUSED' }, 'hi')).toBeNull()
    expect(db.enqueue).not.toHaveBeenCalled()
  })
  it('queues steering for a PAUSED child with no live workflow yet', async () => {
    const client = clientWith({ 'c1': { describe: async () => { throw new WorkflowNotFoundError('c1', 'run', 'run') } } })
    const result = await steerQueuedChild(db.pool as never, client as never, { key: 'agent:c1', kind: 'subagent', status: 'PAUSED' }, 'wait for me')
    expect(result).toMatchObject({ state: 'accepted' })
    expect(db.enqueue).toHaveBeenCalledWith(db.pool, 'agent:c1', 'wait for me', expect.any(String))
  })
  it('rethrows non-missing describe failures for a PAUSED child', async () => {
    const failure = new Error('store down')
    const client = clientWith({ 'c1': { describe: async () => { throw failure } } })
    await expect(steerQueuedChild(db.pool as never, client as never, { key: 'agent:c1', kind: 'subagent', status: 'PAUSED' }, 'hi')).rejects.toBe(failure)
  })
  it('queues steering for a QUEUED child', async () => {
    const result = await steerQueuedChild(db.pool as never, {} as never, { key: 'agent:c1', kind: 'subagent', status: 'QUEUED' }, 'hold this')
    expect(result).toMatchObject({ state: 'accepted' })
    expect(db.enqueue).toHaveBeenCalledWith(db.pool, 'agent:c1', 'hold this', expect.any(String))
  })
})
