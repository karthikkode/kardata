// Capability-based routing with per-unit overrides and rate limits. T2.5.
// Day one everything points at the token-efficient default; moving a unit to
// a quality provider later is a config change. Cold-start cache cost of an
// override is surfaced, not hidden.
import type { Clock } from './clock.js'
import type { ProviderAdapter } from './providers.js'

export interface ModelCapabilities {
  toolCalling: boolean
  structuredOutput: boolean
  vision: boolean
  reasoning: boolean
  contextWindow: number
}

export interface ProviderRoute {
  name: string
  adapter: ProviderAdapter
  capabilities: ModelCapabilities
  inputPricePerMTok: number
  outputPricePerMTok: number
}

export interface UnitRequirement {
  unit: string
  toolCalling?: boolean
  structuredOutput?: boolean
  vision?: boolean
  reasoning?: boolean
  minContextWindow?: number
}

export class NoSatisfyingRouteError extends Error {
  constructor(readonly unit: string) {
    super(`No provider route satisfies unit ${unit}`)
    this.name = 'NoSatisfyingRouteError'
  }
}

function satisfies(route: ProviderRoute, requirement: UnitRequirement): boolean {
  const caps = route.capabilities
  if (requirement.toolCalling && !caps.toolCalling) return false
  if (requirement.structuredOutput && !caps.structuredOutput) return false
  if (requirement.vision && !caps.vision) return false
  if (requirement.reasoning && !caps.reasoning) return false
  if ((requirement.minContextWindow ?? 0) > caps.contextWindow) return false
  return true
}

function estimatedCost(route: ProviderRoute): number {
  return route.inputPricePerMTok + route.outputPricePerMTok
}

// Token bucket per route. RPM plus TPM refill continuously against the
// injected clock, so limiter behavior is deterministic in tests.
export class RateLimiter {
  private requestTokens: number
  private minuteTokens: number
  private lastRefill: number

  constructor(
    private readonly requestsPerMinute: number,
    private readonly tokensPerMinute: number,
    private readonly clock: Clock,
  ) {
    this.requestTokens = requestsPerMinute
    this.minuteTokens = tokensPerMinute
    this.lastRefill = clock.now()
  }

  private refill(): void {
    const now = this.clock.now()
    const elapsedMs = now - this.lastRefill
    if (elapsedMs <= 0) return
    const minutes = elapsedMs / 60_000
    this.requestTokens = Math.min(
      this.requestsPerMinute,
      this.requestTokens + minutes * this.requestsPerMinute,
    )
    this.minuteTokens = Math.min(
      this.tokensPerMinute,
      this.minuteTokens + minutes * this.tokensPerMinute,
    )
    this.lastRefill = now
  }

  take(tokens: number): { ok: true } | { ok: false; retryAfterMs: number } {
    this.refill()
    if (this.requestTokens < 1 || this.minuteTokens < tokens) {
      const forRequests = ((1 - this.requestTokens) / this.requestsPerMinute) * 60_000
      const forTokens = ((tokens - this.minuteTokens) / this.tokensPerMinute) * 60_000
      return { ok: false, retryAfterMs: Math.max(0, Math.ceil(Math.max(forRequests, forTokens))) }
    }
    this.requestTokens -= 1
    this.minuteTokens -= tokens
    return { ok: true }
  }
}

export interface RouterConfig {
  routes: ProviderRoute[]
  defaultRoute: string
  overrides?: Record<string, string>
}

export class Router {
  private readonly byName: Map<string, ProviderRoute>
  private readonly overrides: Map<string, string>

  constructor(private readonly config: RouterConfig) {
    this.byName = new Map(config.routes.map((route) => [route.name, route]))
    this.overrides = new Map(Object.entries(config.overrides ?? {}))
    if (!this.byName.has(config.defaultRoute)) {
      throw new NoSatisfyingRouteError(`default:${config.defaultRoute}`)
    }
  }

  overrideUnit(unit: string, routeName: string): void {
    if (!this.byName.has(routeName)) throw new NoSatisfyingRouteError(`${unit}:${routeName}`)
    this.overrides.set(unit, routeName)
  }

  routeFor(requirement: UnitRequirement): ProviderRoute {
    const pinned = this.overrides.get(requirement.unit)
    const candidates = this.config.routes.filter((route) => satisfies(route, requirement))
    if (candidates.length === 0) throw new NoSatisfyingRouteError(requirement.unit)
    if (pinned) {
      const route = this.byName.get(pinned)
      if (route && satisfies(route, requirement)) return route
      throw new NoSatisfyingRouteError(requirement.unit)
    }
    // Cheapest satisfying route wins; default breaks exact ties by order.
    const [cheapest] = [...candidates].sort(
      (left, right) => estimatedCost(left) - estimatedCost(right),
    )
    return cheapest as ProviderRoute
  }
}
