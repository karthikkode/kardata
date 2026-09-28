// Run routes. B3.1 reads; B3.3 scopes. Thin reads over the runs gateway:
// the list is summary-level (describe only), detail carries the live query
// state. Research and guarded runs are self-scoped (`research:<runId>`).
// Under auth, only session runs of the caller's tenant resolve — ad-hoc
// research runs carry no tenant binding until the B5.5 inspector binds them,
// so they 404 rather than leak across tenants.
import type { FastifyInstance } from 'fastify'
import type { Db } from '../db/index.js'
import type { Scope } from '../auth/keys.js'
import type { RunInfo } from '../temporal/gateway.js'
import { authorize, requirePool, requireRuns, route, sendError, sessionVisible } from './http.js'

function toApiRun(run: RunInfo): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: run.id,
    sessionId: run.sessionId,
    threadKey: run.threadKey,
    state: run.state,
    budgetUsedRatio: run.budgetUsedRatio,
    contextUsedRatio: run.contextUsedRatio,
    updatedAt: run.updatedAt,
  }
  if (run.stageCursor !== undefined) data['stageCursor'] = run.stageCursor
  return data
}

/** Session runs are tenant-scoped; anything else has no tenant binding. */
export async function runVisible(pool: Db, run: RunInfo, scope: Scope | undefined): Promise<boolean> {
  if (!scope) return true
  if (!run.id.startsWith('session-run-')) return false
  return sessionVisible(pool, run.sessionId, scope)
}

export function runRoutes(app: FastifyInstance): void {
  route(app, 'get', '/v1/runs', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const query = request.query as { sessionId?: string }
    const sessionId = typeof query.sessionId === 'string' ? query.sessionId : undefined
    const listed = await runs.listRuns(sessionId)
    if (!auth.scope) return { ok: true, data: listed.map(toApiRun) }
    const visible: Record<string, unknown>[] = []
    for (const run of listed) {
      if (await runVisible(pool, run, auth.scope)) visible.push(toApiRun(run))
    }
    return { ok: true, data: visible }
  })

  route(app, 'get', '/v1/runs/:runId', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const params = request.params as { runId: string }
    const run = await runs.getRun(params.runId)
    if (!run) return sendError(reply, 404, 'not_found', `no such run ${params.runId}`)
    if (!(await runVisible(pool, run, auth.scope))) {
      return sendError(reply, 404, 'not_found', `no such run ${params.runId}`)
    }
    return { ok: true, data: toApiRun(run) }
  })
}
