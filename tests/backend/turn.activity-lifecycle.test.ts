import { MockActivityEnvironment } from '@temporalio/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { karbotTurnActivity, selectTurnContinuation, TURN_HEARTBEAT_MS } from '../../backend/src/temporal/activities/turn.js'

const db = vi.hoisted(() => ({ begin: vi.fn(), identity: vi.fn(), project: vi.fn(), inherit: vi.fn(), finish: vi.fn(), read: vi.fn(), beat: vi.fn(), pool: {} }))
vi.mock('../../backend/src/db/index.js', async (original) => ({ ...await original<typeof import('../../backend/src/db/index.js')>(), workerPoolFromEnv: () => db.pool, beginThreadTurn: db.begin, readActiveExecutionIdentity: db.identity, finishSteering: db.finish, readTurnContinuation: db.read, recordHeartbeat: db.beat }))
vi.mock('../../backend/src/projector.js', () => ({ projectNewEvents: db.project }))
vi.mock('../../backend/src/db/context-files.js', async (original) => ({ ...await original<typeof import('../../backend/src/db/context-files.js')>(), inheritThreadFileRefs: db.inherit }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('production activity setup supervision', () => {
  it('releases the claimed attempt when producer identity setup fails before provider work', async () => {
    const lease = '00000000-0000-4000-8000-000000000002'
    const failure = new Error('TEST identity read disconnected')
    db.begin.mockResolvedValueOnce(lease)
    db.identity.mockRejectedValueOnce(failure)
    await expect(new MockActivityEnvironment().run(karbotTurnActivity, { sessionId: 'TEST session', threadKey: 'TEST thread', runKey: 'TEST run', text: 'TEST prompt' })).rejects.toBe(failure)
    expect(db.finish).toHaveBeenCalledWith(db.pool, 'TEST thread', 'TEST run', lease)
    expect(db.project).not.toHaveBeenCalled()
  })
  it('supervises heartbeat failure during delayed setup and releases the active turn', async () => {
    vi.useFakeTimers()
    const lease = '00000000-0000-4000-8000-000000000001'
    db.begin.mockResolvedValueOnce(lease)
    db.identity.mockResolvedValueOnce({ workflowId: null, executionId: null, ownerEpoch: null })
    let release: () => void = () => undefined
    db.project.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(undefined) }))
    const failure = new Error('TEST heartbeat store disconnected')
    db.beat.mockRejectedValueOnce(failure)
    const errorLog = vi.fn()
    const logger = { log: vi.fn(), trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: errorLog }
    const environment = new MockActivityEnvironment(undefined, { logger })
    const unhandled: unknown[] = []
    const observe = (error: unknown) => { unhandled.push(error) }
    process.on('unhandledRejection', observe)
    try {
      const result = environment.run(karbotTurnActivity, { sessionId: 'TEST session', threadKey: 'TEST thread', runKey: 'TEST run', text: 'TEST prompt' })
      const rejected = expect(result).rejects.toBe(failure)
      await vi.advanceTimersByTimeAsync(TURN_HEARTBEAT_MS + 1)
      await rejected
      expect(db.finish).toHaveBeenCalledWith(db.pool, 'TEST thread', 'TEST run', lease)
      expect(errorLog).toHaveBeenCalledWith('karbot.heartbeat.error', expect.objectContaining({ code: 'heartbeat_failed' }))
      release()
      await vi.advanceTimersByTimeAsync(1)
      expect(db.inherit).not.toHaveBeenCalled()
      expect(unhandled).toEqual([])
    } finally { release(); process.off('unhandledRejection', observe) }
  })
})


describe('continuation operation identity', () => {
  const saved = { user: 'TEST repeated request', runKey: 'TEST cancelled operation', messages: [{ role: 'user' as const, text: 'TEST prior work' }], sources: [{ url: 'https://test.example.test', key: 'TEST archive key', hash: 'TEST hash' }], meta: { round: 7, toolCalls: 4, elapsedMs: 1250, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: '0', cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 } } }
  it('retains cumulative work and evidence for a retry of the same operation', () => {
    expect(selectTurnContinuation(saved, { runKey: saved.runKey, text: saved.user })).toBe(saved)
  })
  it('does not resurrect cancelled work when a later request repeats the same text', () => {
    expect(selectTurnContinuation(saved, { runKey: 'TEST new operation', text: saved.user })).toBeUndefined()
  })
  it('rejects a changed task even when an operation identifier is reused', () => {
    expect(selectTurnContinuation(saved, { runKey: saved.runKey, text: 'TEST changed assignment' })).toBeUndefined()
  })
})
