import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { FakeProvider } from './fake.js'
import {
  NoSatisfyingRouteError,
  RateLimiter,
  Router,
  type ProviderRoute,
} from './router.js'

function route(name: string, overrides: Partial<ProviderRoute> = {}): ProviderRoute {
  return {
    name,
    adapter: new FakeProvider([]),
    capabilities: {
      toolCalling: true,
      structuredOutput: true,
      vision: false,
      reasoning: false,
      contextWindow: 128_000,
    },
    inputPricePerMTok: 1,
    outputPricePerMTok: 4,
    ...overrides,
  }
}

describe('Router', () => {
  it('routes to the cheapest satisfying route by default', () => {
    const router = new Router({
      routes: [
        route('quality', { inputPricePerMTok: 10, outputPricePerMTok: 40 }),
        route('cheap', { inputPricePerMTok: 1, outputPricePerMTok: 4 }),
      ],
      defaultRoute: 'cheap',
    })
    expect(router.routeFor({ unit: 'compaction' }).name).toBe('cheap')
  })

  it('overrides a unit to another route with config only', () => {
    const router = new Router({
      routes: [route('cheap'), route('quality', { inputPricePerMTok: 10, outputPricePerMTok: 40 })],
      defaultRoute: 'cheap',
    })
    router.overrideUnit('research', 'quality')
    expect(router.routeFor({ unit: 'research' }).name).toBe('quality')
    expect(router.routeFor({ unit: 'compaction' }).name).toBe('cheap')
  })

  it('rejects unsatisfiable requirements and unknown routes', () => {
    const router = new Router({ routes: [route('cheap')], defaultRoute: 'cheap' })
    expect(() => router.routeFor({ unit: 'vision-task', vision: true })).toThrow(
      NoSatisfyingRouteError,
    )
    expect(() => router.overrideUnit('research', 'missing')).toThrow(NoSatisfyingRouteError)
    expect(() => router.routeFor({ unit: 'research' })).not.toThrow()
  })

  it('rejects an override that cannot satisfy the unit', () => {
    const router = new Router({
      routes: [route('cheap'), route('narrow', { capabilities: {
        toolCalling: false,
        structuredOutput: false,
        vision: false,
        reasoning: false,
        contextWindow: 4_000,
      } })],
      defaultRoute: 'cheap',
    })
    router.overrideUnit('research', 'narrow')
    expect(() => router.routeFor({ unit: 'research', toolCalling: true })).toThrow(
      NoSatisfyingRouteError,
    )
  })
})

describe('RateLimiter', () => {
  it('admits within budget and reports retry delay past it', () => {
    const clock = frozenClock(0)
    const limiter = new RateLimiter(1, 100, clock)
    expect(limiter.take(50)).toEqual({ ok: true })
    const denied = limiter.take(50)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.retryAfterMs).toBeGreaterThan(0)
  })

  it('refills deterministically on frozen time', () => {
    const clock = frozenClock(0)
    const limiter = new RateLimiter(1, 100, clock)
    expect(limiter.take(100).ok).toBe(true)
    expect(limiter.take(1).ok).toBe(false)
    clock.advance(60_000)
    expect(limiter.take(100)).toEqual({ ok: true })
  })
})
