import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import {
  BudgetTracker,
  fingerprintAction,
  RepetitionTracker,
  type BudgetLimits,
} from './budgets.js'

function limits(overrides: Partial<BudgetLimits> = {}): BudgetLimits {
  return {
    maxTurns: 10,
    maxToolCalls: 20,
    maxTokens: 100_000,
    maxCost: 10,
    maxWallMs: 60_000,
    maxStalledTurns: 3,
    ...overrides,
  }
}

describe('BudgetTracker [F:agents.budgets.BudgetTracker]', () => {
  it('trips nothing on a fresh tracker', () => {
    const tracker = new BudgetTracker(limits(), frozenClock(0))
    expect(tracker.tripped()).toEqual([])
  })

  it('trips each cap deterministically', () => {
    const clock = frozenClock(0)
    const turns = new BudgetTracker(limits({ maxTurns: 2 }), clock)
    turns.noteTurn(true)
    turns.noteTurn(true)
    expect(turns.tripped()).toContain('turns')

    const tools = new BudgetTracker(limits({ maxToolCalls: 1 }), clock)
    tools.noteToolCall()
    expect(tools.tripped()).toContain('toolCalls')

    const tokens = new BudgetTracker(limits({ maxTokens: 100 }), clock)
    tokens.noteTokens(100)
    expect(tokens.tripped()).toContain('tokens')

    const cost = new BudgetTracker(limits({ maxCost: 1 }), clock)
    cost.noteCost(1)
    expect(cost.tripped()).toContain('cost')
  })

  it('trips the wall clock on frozen time advance', () => {
    const clock = frozenClock(0)
    const tracker = new BudgetTracker(limits({ maxWallMs: 500 }), clock)
    expect(tracker.tripped()).toEqual([])
    clock.advance(500)
    expect(tracker.tripped()).toContain('wallClock')
  })

  it('counts stalled turns and resets on progress', () => {
    const tracker = new BudgetTracker(limits({ maxStalledTurns: 2 }), frozenClock(0))
    tracker.noteTurn(false)
    expect(tracker.tripped()).toEqual([])
    tracker.noteTurn(true)
    tracker.noteTurn(false)
    expect(tracker.tripped()).toEqual([])
    tracker.noteTurn(false)
    expect(tracker.tripped()).toContain('stalledTurns')
  })
})

describe('RepetitionTracker [F:agents.budgets.RepetitionTracker] [F:agents.budgets.fingerprintAction]', () => {
  it('escalates warn, replan, blocked', () => {
    const tracker = new RepetitionTracker()
    const fp = fingerprintAction('read_file', { path: 'a.ts' })
    expect(tracker.note(fp)).toBe('ok')
    expect(tracker.note(fp)).toBe('warn')
    expect(tracker.note(fp)).toBe('replan')
    expect(tracker.note(fp)).toBe('blocked')
    expect(tracker.note(fp)).toBe('blocked')
  })

  it('tracks fingerprints independently and normalizes args', () => {
    const tracker = new RepetitionTracker()
    expect(tracker.note(fingerprintAction('a', { x: 1 }))).toBe('ok')
    expect(tracker.note(fingerprintAction('b', { x: 1 }))).toBe('ok')
    expect(tracker.note(fingerprintAction('a', { x: 1 }))).toBe('warn')
    expect(tracker.note(fingerprintAction('a', { x: 2 }))).toBe('ok')
  })
})
