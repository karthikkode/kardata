// Ambient request context (leaf module). The span and event-caller stores
// live here so the db layer can read them without importing tracing.ts
// (which depends on db types for wrapPool). No repo imports: node + OTel
// API types only.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SpanContext } from '@opentelemetry/api'

const spanAls = new AsyncLocalStorage<SpanContext>()

/** Run `fn` with `ctx` as the implicit span parent. */
export function withSpanContext<T>(ctx: SpanContext, fn: () => T): T {
  return spanAls.run(ctx, fn)
}

/** Enter `ctx` for the current execution chain (Fastify hook pattern). */
export function enterSpanContext(ctx: SpanContext): void {
  spanAls.enterWith(ctx)
}

export function clearSpanContext(): void {
  spanAls.enterWith(undefined as unknown as SpanContext)
}

export function currentSpanContext(): SpanContext | undefined {
  return spanAls.getStore()
}

/** Ambient request trace id from our ALS (the Fastify hook enters it). */
export function currentTraceId(): string | undefined {
  return currentSpanContext()?.traceId
}

/** Event caller client (P3.2.6): ui for /v1 routes, agent-mcp for /mcp,
 * system for background worker writes, other for the rest. The route()
 * wrapper enters it; appendEvent reads it. Phase 8 derives it from the
 * api_keys client column instead of the route. */
export type EventClient = 'ui' | 'agent-mcp' | 'system' | 'other'

const callerAls = new AsyncLocalStorage<EventClient>()

/** Run `fn` with `client` as the ambient event caller. */
export function runWithEventClient<T>(client: EventClient, fn: () => T): T {
  return callerAls.run(client, fn)
}

/** Ambient event caller, when a route entered one. */
export function currentEventClient(): EventClient | undefined {
  return callerAls.getStore()
}
