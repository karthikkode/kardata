// Shared HTTP plumbing for v1 routes. B3.1. Every route answers the B0.1
// envelopes; validation failures are 400 validation_failed, unknown ids are
// 404 not_found, steer/run-type conflicts are 409 conflict, and anything
// without its dependency (pool, gateway) fails closed with 503 overload.
// Auth/role 403s arrived in B3.3; B3.4 adds the per-key rate hook and the
// Idempotency-Key mutation wrapper, both defined here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import type { ArchiveTarget } from '../archive/targets.js'
import type { Db, TransactableDb } from '../db/index.js'
import { z } from 'zod'
import { resolveCaller, roleAtLeast, type Role, type Scope } from '../auth/keys.js'
import {
  checkRate,
  WorkspaceError,
  claimIdempotency,
  completeIdempotency,
  releaseIdempotency,
} from '../db/index.js'
import { mutationFingerprint, rateBucket } from '../http/limits.js'
import { getSession } from '../db/index.js'
import type { RunsGateway } from '../temporal/gateway.js'
import { RunNotFound, ThreadNotAccepting } from '../temporal/gateway.js'

export interface RouteDeps {
  pool?: TransactableDb
  runs?: RunsGateway
}

export type ErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'rate_limited'
  | 'conflict'
  | 'validation_failed'
  | 'overload'

export function sendError(reply: FastifyReply, status: number, code: ErrorCode, message: string): unknown {
  return reply.code(status).send({ ok: false, error: { code, message } })
}

export function requirePool(app: FastifyInstance, reply: FastifyReply): TransactableDb | undefined {
  const pool = (app as FastifyInstance & { kardataPool?: TransactableDb }).kardataPool
  if (!pool) {
    void sendError(reply, 503, 'overload', 'database unavailable')
    return undefined
  }
  return pool
}

export function requireArchive(app: FastifyInstance, reply: FastifyReply): ArchiveTarget | undefined {
  const target = (app as FastifyInstance & { kardataArchive?: ArchiveTarget }).kardataArchive
  if (!target) {
    void sendError(reply, 503, 'overload', 'archive unavailable')
    return undefined
  }
  return target
}

export function requireRuns(app: FastifyInstance, reply: FastifyReply): RunsGateway | undefined {
  const runs = (app as FastifyInstance & { kardataRuns?: RunsGateway }).kardataRuns
  if (!runs) {
    void sendError(reply, 503, 'overload', 'runs gateway unavailable')
    return undefined
  }
  return runs
}

/** Zod body/query parsing with the spec's validation_failed envelope. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown, reply: FastifyReply): T | undefined {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first ? [...first.path.map(String), first.message].join(': ') : 'invalid input'
    void sendError(reply, 400, 'validation_failed', where)
    return undefined
  }
  return parsed.data
}

/** First header value (headers can repeat): shared by the v1 routes and
 * the MCP transport so the same lookup never drifts into two copies. */
export function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}

/** Role gate plus scope resolution. Open mode (no kardataAuth flag) skips
 * both and returns no scope; keyed mode denies absent/unknown/under-roled
 * callers with 403 permission_denied and returns the tenant/project scope.
 * Both modes return a stable keyId ('open' without auth) that scopes
 * idempotency records to the caller. */
export async function authorize(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  minimum: Role,
): Promise<{ scope?: Scope; keyId: string } | undefined> {
  const useAuth = (app as FastifyInstance & { kardataAuth?: boolean }).kardataAuth === true
  if (!useAuth) {
    request.kardataCaller = { keyId: 'open' }
    return { keyId: 'open' }
  }
  const pool = requirePool(app, reply)
  if (!pool) return undefined
  const result = await resolveCaller(pool, header(request, 'authorization'), header(request, 'x-tenant'), header(request, 'x-project'))
  if ('denied' in result) {
    void sendError(reply, 403, 'permission_denied', result.denied)
    return undefined
  }
  if (!roleAtLeast(result.caller, minimum)) {
    void sendError(reply, 403, 'permission_denied', `role ${result.caller.role} cannot perform this action`)
    return undefined
  }
  request.kardataCaller = { keyId: result.caller.keyId, tenantId: result.scope.tenantId }
  return { scope: result.scope, keyId: result.caller.keyId }
}

/** Per-key fixed-window rate hook (B3.4). Applies to /v1/* only; /healthz
 * stays unthrottled for load-balancer probes. Buckets follow the presented
 * bearer token, or the peer IP for unauthenticated callers. Over-limit
 * requests get 429 rate_limited with a Retry-After hint. A limiter outage
 * fails open so healthy traffic is never 500ed by its own guard. */
export function registerRateLimit(app: FastifyInstance, limitPerMin: number, logger?: Logger): void {
  app.addHook('onRequest', async (request, reply) => {
    if (limitPerMin <= 0 || !request.url.startsWith('/v1/')) return
    const pool = (app as FastifyInstance & { kardataPool?: TransactableDb }).kardataPool
    if (!pool) return
    const bucket = rateBucket(header(request, 'authorization'), request.ip)
    let decision
    try {
      decision = await checkRate(pool, bucket, limitPerMin)
    } catch {
      return
    }
    if (!decision.allowed) {
      // The bucket holds a credential hash or peer IP, never key material.
      logger?.warn(
        { op: 'http.rate_limited', bucket, count: decision.count, limit: decision.limit },
        'rate limit exceeded',
      )
      void reply.header('retry-after', decision.retryAfterSec)
      return sendError(reply, 429, 'rate_limited', `Slow down; retry after ${decision.retryAfterSec} seconds`)
    }
  })
}

export interface IdempotentOutcome {
  status: number
  body: unknown
}

/** Idempotent mutation wrapper (B3.4). Without an Idempotency-Key header —
 * or without a pool to record in — the mutation executes directly. With a
 * key, first use executes and stores the outcome, an identical retry
 * replays the stored status and body without re-executing, and key reuse
 * for a different request (or a twin execution in flight) is 409 conflict.
 * Records are scoped to the caller so keys never replay across tenants.
 * Thrown errors release the claim so the retry is not wedged. */
export async function withIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Db | undefined,
  keyId: string,
  execute: () => Promise<IdempotentOutcome>,
): Promise<unknown> {
  const raw = header(request, 'idempotency-key')
  if (raw === undefined || pool === undefined) {
    const direct = await execute()
    return reply.code(direct.status).send(direct.body)
  }
  if (raw.length === 0 || raw.length > 128) {
    return sendError(reply, 400, 'validation_failed', 'idempotency key must be 1-128 characters')
  }
  const recordKey = `${keyId}:${raw}`
  const fingerprint = mutationFingerprint(request.method, request.url, request.body)
  const claim = await claimIdempotency(pool, recordKey, fingerprint)
  if (claim.kind === 'replay') return reply.code(claim.status).send(claim.body)
  if (claim.kind === 'conflict') return sendError(reply, 409, 'conflict', claim.reason)
  try {
    const result = await execute()
    await completeIdempotency(pool, recordKey, result.status, result.body)
    return reply.code(result.status).send(result.body)
  } catch (error) {
    await releaseIdempotency(pool, recordKey)
    throw error
  }
}

/** Quiet tenant/project visibility for one session. */
export async function sessionVisible(
  pool: Db,
  sessionId: string,
  scope: Scope | undefined,
): Promise<boolean> {
  if (!scope) return true
  return (await getSession(pool, sessionId, scope)) !== undefined
}

/** Tenant/project visibility for one session. Open mode always passes;
 * keyed mode 404s (never 403) so callers cannot probe other tenants. */
export async function requireSessionScope(
  pool: Db,
  sessionId: string,
  scope: Scope | undefined,
  reply: FastifyReply,
): Promise<boolean> {
  if (await sessionVisible(pool, sessionId, scope)) return true
  void sendError(reply, 404, 'not_found', `no such session ${sessionId}`)
  return false
}

export function mapRouteError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof WorkspaceError) return sendError(reply, { not_found: 404, permission_denied: 403, conflict: 409, validation_failed: 400 }[error.code], error.code, error.message)
  if (error instanceof RunNotFound) return sendError(reply, 404, 'not_found', error.message)
  if (error instanceof ThreadNotAccepting) return sendError(reply, 409, 'conflict', error.message)
  return sendError(reply, 500, 'overload', 'internal error')
}

export type RouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
  app: FastifyInstance,
) => Promise<unknown>

/** Registers a handler with gateway/domain errors mapped to envelopes. */
export function route(
  app: FastifyInstance,
  method: 'get' | 'post' | 'patch' | 'delete',
  url: string,
  handler: RouteHandler,
): void {
  const wrapped = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    try {
      return await handler(request, reply, app)
    } catch (error) {
      // Route errors never vanish into an envelope: the app logger records
      // route + trace + code so a 500 joins to Loki via trace_id. The
      // envelope stays shape-only (detail may carry key material); without
      // a configured logger the route still answers, observability degrades.
      const logger = (app as FastifyInstance & { kardataLogger?: Logger }).kardataLogger
      logger?.error({
        event: 'http.route.error',
        op: 'http.route',
        route: `${method.toUpperCase()} ${url}`,
        ...(request.traceContext ? { trace_id: request.traceContext.traceId } : {}),
        code: error instanceof WorkspaceError ? error.code : error instanceof RunNotFound ? 'not_found' : error instanceof ThreadNotAccepting ? 'conflict' : 'internal',
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      })
      return mapRouteError(reply, error)
    }
  }
  if (method === 'get') app.get(url, wrapped)
  else if (method === 'post') app.post(url, wrapped)
  else if (method === 'patch') app.patch(url, wrapped)
  else app.delete(url, wrapped)
}
