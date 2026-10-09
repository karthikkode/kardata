import { describe, expect, it } from 'vitest'
import { frozenClock, seededRng, systemClock } from './clock.js'

describe('frozenClock [F:agents.clock.frozenClock]', () => {
  it('holds time still until advanced', () => {
    const clock = frozenClock(1_000)
    expect(clock.now()).toBe(1_000)
    expect(clock.now()).toBe(1_000)
    clock.advance(250)
    expect(clock.now()).toBe(1_250)
  })
})

describe('systemClock [F:agents.clock.systemClock]', () => {
  it('returns a plausible epoch ms', () => {
    expect(systemClock().now()).toBeGreaterThan(1_700_000_000_000)
  })
})

describe('seededRng [F:agents.clock.seededRng]', () => {
  it('reproduces the same sequence per seed', () => {
    const first = seededRng(42)
    const second = seededRng(42)
    const draws = Array.from({ length: 5 }, () => first())
    expect(draws).toEqual(Array.from({ length: 5 }, () => second()))
    expect(draws.every((draw) => draw >= 0 && draw < 1)).toBe(true)
  })

  it('differs across seeds', () => {
    expect(seededRng(1)()).not.toBe(seededRng(2)())
  })
})
