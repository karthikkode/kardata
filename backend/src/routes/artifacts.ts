// Artifact routes. Lists stored/indexed metadata for a session scope
// (files menu); the body route serves bytes through the app-held archive
// target with the same index gate as the pipeline; the references route
// attaches an existing file to another session without copying bytes;
// the tenant listing powers cross-session attach discovery.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  CorruptArtifactError,
  UnindexedArtifactError,
  serveArtifact,
} from '../artifacts/pipeline.js'
import {
  DbContractError,
  appendEvent,
  findEventByKey,
  listArtifacts,
  listTenantArtifacts,
  referenceArtifact,
  resolveArtifactScope,
} from '../db/index.js'
import {
  authorize,
  parseInput,
  requireArchive,
  requirePool,
  requireSessionScope,
  route,
  sendError,
  withIdempotency,
} from './http.js'

const ReferenceBody = z.object({
  artifactId: z.string().min(1),
  fromScope: z.object({
    kind: z.enum(['session', 'task']),
    id: z.string().min(1),
  }),
})

export function artifactRoutes(app: FastifyInstance): void {
  route(app, 'get', '/v1/sessions/:sessionId/artifacts', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const params = request.params as { sessionId?: string }
    const sessionId = params.sessionId ?? ''
    if (!(await requireSessionScope(pool, sessionId, auth.scope, reply))) return undefined
    return { ok: true, data: await listArtifacts(pool, sessionId) }
  })

  route(app, 'get', '/v1/sessions/:sessionId/artifacts/:artifactId/body', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const target = requireArchive(app, reply)
    if (!target) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const params = request.params as { sessionId?: string; artifactId?: string }
    const sessionId = params.sessionId ?? ''
    const artifactId = params.artifactId ?? ''
    if (!(await requireSessionScope(pool, sessionId, auth.scope, reply))) return undefined
    const resolved = await resolveArtifactScope(pool, sessionId, artifactId)
    if (!resolved) {
      return sendError(reply, 404, 'not_found', `no such artifact ${artifactId}`)
    }
    try {
      const served = await serveArtifact(target, resolved.scope, artifactId, {
        log: (fields) => request.log.info(fields),
        findEvent: (key) => findEventByKey(pool, key),
        record: (event) => appendEvent(pool, event).then(() => undefined),
      })
      return { ok: true, data: { body: served.body, meta: served.meta } }
    } catch (error) {
      // Stored but not yet indexed: the file exists, it is not servable.
      if (error instanceof UnindexedArtifactError) {
        return sendError(reply, 409, 'conflict', `artifact ${artifactId} is not indexed`)
      }
      if (error instanceof CorruptArtifactError) {
        request.log.error({ op: 'artifact.serve', artifactId }, 'indexed bytes failed integrity')
        return sendError(reply, 500, 'overload', 'artifact failed its integrity check')
      }
      throw error
    }
  })

  route(app, 'post', '/v1/sessions/:sessionId/artifacts/references', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sessionId?: string }
    const sessionId = params.sessionId ?? ''
    const body = parseInput(ReferenceBody, request.body, reply)
    if (!body) return undefined
    if (!(await requireSessionScope(pool, sessionId, auth.scope, reply))) return undefined
    // Session-owned sources need same-tenant possession; task sources ride
    // producer possession (the agent handing over the id ran in-tenant).
    if (body.fromScope.kind === 'session') {
      if (!(await requireSessionScope(pool, body.fromScope.id, auth.scope, reply))) return undefined
    }
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      try {
        const summary = await referenceArtifact(pool, {
          artifactId: body.artifactId,
          fromScope: body.fromScope,
          toSessionId: sessionId,
          scope: auth.scope,
        })
        return { status: 201, body: { ok: true, data: summary } }
      } catch (error) {
        if (error instanceof DbContractError) {
          return { status: 404, body: { ok: false, error: { code: 'not_found', message: error.message } } }
        }
        throw error
      }
    })
  })

  route(app, 'get', '/v1/artifacts', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    if (!auth.scope) {
      return sendError(reply, 403, 'permission_denied', 'tenant listing needs an authed key')
    }
    return { ok: true, data: await listTenantArtifacts(pool, auth.scope) }
  })
}
