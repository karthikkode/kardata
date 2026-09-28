import { describe, expect, it } from 'vitest'
import { createRun, IllegalTransitionError, transition } from './loop.js'
import { cancelRun, IdempotencyLog, pauseRun, resumeRun } from './epochs.js'

describe('pause and resume', () => {
  it('parks at the boundary and resumes into a new epoch', () => {
    const run = createRun()
    transition(run, 'RUNNING')
    const epoch = run.epoch
    pauseRun(run)
    expect(run.state).toBe('PAUSED')
    expect(run.epoch).toBe(epoch)
    resumeRun(run)
    expect(run.state).toBe('RUNNING')
    expect(run.epoch).toBe(epoch + 1)
  })

  it('rejects resume without pause and pause without running', () => {
    const run = createRun()
    expect(() => resumeRun(run)).toThrow(IllegalTransitionError)
    transition(run, 'RUNNING')
    transition(run, 'FINISHED')
    expect(() => pauseRun(run)).toThrow(IllegalTransitionError)
  })

  it('skips completed actions on resume via the idempotency log', () => {
    const log = new IdempotencyLog()
    expect(log.record('tool:read:{"path":"a"}')).toBe(true)
    expect(log.record('tool:read:{"path":"a"}')).toBe(false)

    const actions = [
      { key: 'tool:read:{"path":"a"}', value: 'read-a' },
      { key: 'tool:edit:{"path":"b"}', value: 'edit-b' },
    ]
    // Simulate resume into a new epoch: only unrecorded actions run.
    expect(log.pending(actions)).toEqual(['edit-b'])
    expect(log.has('tool:read:{"path":"a"}')).toBe(true)
    expect(log.has('tool:edit:{"path":"b"}')).toBe(false)
  })
})

describe('cancel', () => {
  it('cancels from running and from paused, then finishes once', () => {
    const run = createRun()
    transition(run, 'RUNNING')
    cancelRun(run)
    expect(run.state).toBe('CANCELLING')
    // Second cancel is illegal: the first one already applies.
    expect(() => cancelRun(run)).toThrow(IllegalTransitionError)
    transition(run, 'FINISHED')
    expect(run.state).toBe('FINISHED')
  })
})
