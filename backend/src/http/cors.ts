// Browser boundary for the staging UI. The mounted frontend runs on a
// different origin than the API, so any request with an Authorization
// header preflights first; without CORS answers the browser blocks the
// call and the UI can only show a connection error. Origins are an exact
// allow-list (never `*`): the key travels in a header on every call.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { sendError } from '../routes/http.js'

export const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/** Comma-separated KARDATA_CORS_ORIGINS; blank/unset falls back to the
 * local vite dev origins so plain `docker compose up` just works. */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_CORS_ORIGINS]
  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return origins.length > 0 ? origins : [...DEFAULT_CORS_ORIGINS]
}

function requestOrigin(request: FastifyRequest): string | undefined {
  const header = request.headers.origin
  if (Array.isArray(header)) return header[0]
  return header
}

/** Minimal request shape for origin reflection: only the header the
 * decision reads, so unit tests never fabricate a full request. */
export interface OriginCarrier {
  headers: { origin?: string | string[] }
}

/** Headers for hijacked (raw socket) responses such as the SSE thread
 * stream: hijacking skips onSend, so the reflection must be explicit.
 * Same exact allow-list, never `*`. */
export function corsHeadersFor(request: OriginCarrier, origins: string[]): Record<string, string> {
  const header = request.headers.origin
  const origin = Array.isArray(header) ? header[0] : header
  if (origin === undefined || !origins.includes(origin)) return {}
  return { 'access-control-allow-origin': origin, vary: 'Origin' }
}

/** Reflects an allowed origin on every response and answers preflights.
 * Preflight handling lives on onRequest ahead of the rate hook so browser
 * handshakes are never rate-counted; the allow headers cover exactly what
 * the staging client sends (Bearer [REDACTED] JSON bodies, idempotency keys on
 * mutations). A preflight from an origin off the list is 403
 * permission_denied, never an echo. */
export function registerCors(app: FastifyInstance, origins: string[]): void {
  const allowed = new Set(origins)
  // Remembered for hijacked responses (SSE): they skip onSend, so the
  // stream route reads the same list instead of re-parsing env.
  ;(app as FastifyInstance & { kardataCorsOrigins?: string[] }).kardataCorsOrigins = origins
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'OPTIONS') return
    const origin = requestOrigin(request)
    if (origin !== undefined && !allowed.has(origin)) {
      return sendError(reply, 403, 'permission_denied', `origin ${origin} is not allowed`)
    }
    if (origin !== undefined) {
      void reply.header('access-control-allow-origin', origin)
      void reply.header('vary', 'Origin')
    }
    void reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    void reply.header('access-control-allow-headers', 'Authorization, Content-Type, Idempotency-Key')
    void reply.header('access-control-max-age', '86400')
    return reply.code(204).send()
  })
  app.addHook('onSend', async (request, reply, payload) => {
    const origin = requestOrigin(request)
    if (origin !== undefined && allowed.has(origin)) {
      void reply.header('access-control-allow-origin', origin)
      void reply.header('vary', 'Origin')
    }
    return payload
  })
}
