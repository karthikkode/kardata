// W3C trace-context propagation. B0.5. Fastify extracts (or mints) the
// trace on ingress; background work (Temporal activities, pg jobs) carries
// the same TraceContext object explicitly. tracestate is not propagated
// (documented deferral: single-vendor traces until B5.2).
import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

export interface TraceContext {
  traceId: string
  parentSpanId?: string
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export function newTraceId(): string {
  return randomUUID().replace(/-/g, '')
}

function newSpanId(): string {
  return randomBytes(8).toString('hex')
}

export function extractTraceContext(headers: Record<string, string | string[] | undefined>): TraceContext {
  const raw = headers['traceparent']
  const value = Array.isArray(raw) ? raw[0] : raw
  const match = typeof value === 'string' ? TRACEPARENT.exec(value.trim()) : null
  if (!match) return { traceId: newTraceId() }
  return { traceId: match[1], parentSpanId: match[2] }
}

export function injectTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.parentSpanId ?? newSpanId()}-01`
}

declare module 'fastify' {
  interface FastifyRequest {
    traceContext: TraceContext
  }
}

// Wrapped in fastify-plugin so the hook lands on the registering context:
// registering at the app root covers root routes (plain register() would
// encapsulate the hook away from them, proven by test).
export const tracePlugin = fp(async (app: FastifyInstance): Promise<void> => {
  // reply.header is synchronous: never await it, because Reply is thenable
  // and awaiting the reply deadlocks the hook.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    request.traceContext ??= extractTraceContext(request.headers as Record<string, string | string[] | undefined>)
    reply.header('traceparent', injectTraceparent(request.traceContext))
  })
})
