import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { SubagentManager } from './subagents.js'

function manager(limits = { maxDepth: 1, maxConcurrent: 5 }): SubagentManager {
  return new SubagentManager(limits, frozenClock(0))
}

describe('SubagentManager lifecycle', () => {
  it('launches, messages, finishes, and collects summaries only', () => {
    const subagents = manager()
    const child = subagents.launch('research acme')
    expect(child.status).toBe('running')
    expect(subagents.message(child.id, 'also check pricing')).toEqual({ delivered: 'queued' })
    expect(subagents.get(child.id).queueDepth).toBe(1)
    subagents.appendToThread(child.id, { role: 'assistant', text: 'working' })
    const summary = subagents.finish(child.id, 'finished')
    expect(summary.status).toBe('finished')
    expect(summary.threadLength).toBe(1)
    // Parent sees summary, never intermediates.
    expect(subagents.collect(child.id)).toEqual(summary)
    expect(subagents.recentCompletions()).toHaveLength(1)
  })

  it('rejects empty goals, unknown children, and double finish', () => {
    const subagents = manager()
    expect(() => subagents.launch('  ')).toThrow()
    expect(() => subagents.get('missing')).toThrow()
    const child = subagents.launch('goal')
    subagents.finish(child.id, 'finished')
    expect(() => subagents.finish(child.id, 'finished')).toThrow()
  })

  it('enforces depth and concurrency caps', () => {
    const subagents = manager({ maxDepth: 1, maxConcurrent: 1 })
    const child = subagents.launch('goal', { parentId: 'run-1', depth: 1 })
    expect(child.depth).toBe(1)
    expect(() => subagents.launch('too deep', { parentId: child.id, depth: 2 })).toThrow()
    expect(() => subagents.launch('too many')).toThrow()
  })

  it('forbids fork children from delegating', () => {
    const subagents = manager()
    const fork = subagents.launch('goal', { mode: 'fork' })
    const isolated = subagents.launch('goal', { mode: 'empty' })
    expect(subagents.canDelegate(fork.id)).toBe(false)
    expect(subagents.canDelegate(isolated.id)).toBe(true)
  })

  it('propagates cancel to grandchildren and records missed steer', () => {
    const subagents = manager({ maxDepth: 2, maxConcurrent: 5 })
    const parent = subagents.launch('parent goal')
    const child = subagents.launch('child goal', { parentId: parent.id, depth: 1 })
    subagents.message(child.id, 'late note')
    subagents.cancel(parent.id)
    expect(subagents.get(parent.id).status).toBe('cancelled')
    expect(subagents.get(child.id).status).toBe('cancelled')
    const summary = subagents.finish(child.id, 'cancelled')
    expect(summary.missedSteer).toContain('late note')
  })

  it('rejects messages to finished children as missed steer, never relaunches', () => {
    const subagents = manager()
    const child = subagents.launch('goal')
    subagents.finish(child.id, 'finished')
    const verdict = subagents.message(child.id, 'too late')
    expect(verdict.delivered).toBe('rejected')
    expect(subagents.collect(child.id).missedSteer).toContain('too late')
    expect(subagents.list().filter((row) => row.status === 'running')).toHaveLength(0)
  })

  it('rejects steer past a full inbox with reason', () => {
    const subagents = manager()
    const child = subagents.launch('goal', { queueCapacity: 1 })
    expect(subagents.message(child.id, 'one')).toEqual({ delivered: 'queued' })
    const verdict = subagents.message(child.id, 'two')
    expect(verdict.delivered).toBe('rejected')
    if (verdict.delivered === 'rejected') expect(verdict.reason).toContain('capacity 1')
  })

  it('redirects with goal rewrite and rejects empty goals', () => {
    const subagents = manager()
    const child = subagents.launch('old goal')
    expect(subagents.redirect(child.id, 'new goal')).toEqual({ delivered: 'queued' })
    expect(subagents.get(child.id).goal).toBe('new goal')
    expect(subagents.redirect(child.id, '  ').delivered).toBe('rejected')
  })

  it('tracks activity and idle time on the injected clock', () => {
    const clock = frozenClock(0)
    const subagents = new SubagentManager({ maxDepth: 1, maxConcurrent: 5 }, clock)
    const child = subagents.launch('goal')
    clock.advance(450_000)
    expect(subagents.idleMs(child.id)).toBe(450_000)
    subagents.noteActivity(child.id, 'hound.search')
    expect(subagents.get(child.id).lastTool).toBe('hound.search')
    expect(subagents.idleMs(child.id)).toBe(0)
  })
})
