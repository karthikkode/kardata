import { WorkReviewDecision, reviewResearchWork } from '../db/work-review.js'
import { rebuildThreadContext } from '../db/workspace.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Scope, Role } from '../auth/keys.js'
import { resolveCaller, roleAtLeast } from '../auth/keys.js'
import {
  ContextSections, WorkspaceError, decideContextChange, ensureResearchSession,
  previewContextChange,
  readSectorLibraryFile,
  listSectorLibrary, proposeFileContext, proposeGlobalContext, readGlobalContext, readResearchProgress,
  readThreadContext, saveThreadContext, setFileVisibility, type TransactableDb,
  retryFileProcessingJob, fileProcessingProgress, failFileProcessingJob,
  readSectorDocumentUnitsPage,
} from '../db/index.js'
import { compactOwnerThread } from '../context.js'
import { projectNewEvents } from '../projector.js'
import { authorize, header, parseInput, requireArchive, requirePool, requireRuns, route, sendError, withIdempotency } from './http.js'

interface Input { keyId: string; pool: TransactableDb; scope?: Scope; params: Record<string, string>; body: unknown }
export function workspaceRoutes(app: FastifyInstance): void {
  function register(method: 'get' | 'post' | 'patch', path: string, role: Role, handler: (input: Input) => Promise<unknown>) {
    route(app, method, path, async (request, reply, app) => {
      const pool = requirePool(app, reply)
      if (!pool) return undefined
      const auth = await authorize(app, request, reply, role)
      if (!auth) return undefined
      const work = async () => {
        await projectNewEvents(pool)
        try {
          const data = await handler({ keyId: auth.keyId, pool, scope: auth.scope, params: request.params as Record<string, string>, body: request.body })
          return { status: 200, body: { ok: true, data } }
        } catch (error) {
          if (error instanceof WorkspaceError) return { status: { not_found: 404, conflict: 409, permission_denied: 403, validation_failed: 400 }[error.code], body: { ok: false, error: { code: error.code, message: error.message } } }
          if (error instanceof z.ZodError) return { status: 400, body: { ok: false, error: { code: 'validation_failed', message: error.issues[0]?.message ?? 'Invalid input' } } }
          throw error
        }
      }
      if (method !== 'get') return withIdempotency(request, reply, pool, auth.keyId, work)
      const result = await work()
      if (!result.body.ok) return sendError(reply, result.status, result.body.error?.code as WorkspaceError['code'], result.body.error?.message ?? 'Request failed')
      return result.body
    })
  }
  const sector = (input: Input) => input.params['sectorId'] ?? ''
  const thread = (input: Input) => input.params['threadKey'] ?? ''
  register('post', '/v1/sectors/:sectorId/research-session', 'operator', ({ pool, scope, ...input }) => ensureResearchSession(pool, sector({ pool, scope, ...input }), scope))
  register('get', '/v1/sectors/:sectorId/global-context', 'viewer', (input) => readGlobalContext(input.pool, sector(input), input.scope))
  route(app, 'get', '/v1/sectors/:sectorId/files/:fileId/body', async (request, reply, app) => {
    const pool = requirePool(app, reply), archive = requireArchive(app, reply)
    if (!pool || !archive) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    await projectNewEvents(pool)
    const params = request.params as { sectorId: string; fileId: string }
    return { ok: true, data: await readSectorLibraryFile(pool, params.sectorId, params.fileId, archive, auth.scope) }
  })
  register('patch', '/v1/sectors/:sectorId/global-context', 'approver', (input) => {
    const body = z.object({ baseVersion: z.number().int().nonnegative(), sections: ContextSections }).strict().parse(input.body)
    return proposeGlobalContext(input.pool, { ...body, sectorId: sector(input), sourceThread: 'owner', owner: true, scope: input.scope })
  })
  register('post', '/v1/sectors/:sectorId/global-context/proposals', 'operator', (input) => {
    const body = z.object({ baseVersion: z.number().int().nonnegative(), sections: ContextSections, sourceThread: z.string().min(1) }).strict().parse(input.body)
    // Browser proposals never inherit autonomous research authority.
    return proposeGlobalContext(input.pool, { ...body, sectorId: sector(input), owner: false, scope: input.scope })
  })
  register('post', '/v1/sectors/:sectorId/global-context/proposals/:proposalId/decision', 'approver', (input) => {
    const body = z.object({ approve: z.boolean() }).strict().parse(input.body)
    return decideContextChange(input.pool, { ...body, sectorId: sector(input), id: input.params['proposalId'] ?? '', scope: input.scope })
  })
  register('get', '/v1/sectors/:sectorId/global-context/proposals/:proposalId', 'viewer', (input) => previewContextChange(input.pool, sector(input), input.params['proposalId'] ?? '', input.scope))
  register('post', '/v1/sectors/:sectorId/work/:workId/review', 'approver', (input) => reviewResearchWork(input.pool, { ...WorkReviewDecision.parse(input.body), sectorId: sector(input), workId: input.params['workId'] ?? '', author: input.keyId, scope: input.scope }))
  register('get', '/v1/sectors/:sectorId/progress', 'viewer', (input) => readResearchProgress(input.pool, sector(input), input.scope))
  register('get', '/v1/sectors/:sectorId/files', 'viewer', (input) => listSectorLibrary(input.pool, sector(input), input.scope))
  route(app, 'get', '/v1/sectors/:sectorId/files/:fileId/units', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await resolveCaller(pool, header(request, 'authorization'), header(request, 'x-tenant'), header(request, 'x-project'))
    if ('denied' in auth || !roleAtLeast(auth.caller, 'viewer')) return sendError(reply, 403, 'permission_denied', 'Indexed file sections require a viewer key.')
    request.kardataCaller = { keyId: auth.caller.keyId, tenantId: auth.scope.tenantId }
    const query = parseInput(z.object({ fromOrd: z.coerce.number().int().nonnegative().max(2147483647).default(0), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict(), request.query, reply)
    if (!query) return undefined
    const projection = await projectNewEvents(pool)
    if (!projection.caughtUp) return sendError(reply, 503, 'overload', 'File scope is still catching up. Try again shortly.')
    const params = request.params as { sectorId: string; fileId: string }
    return { ok: true, data: await readSectorDocumentUnitsPage(pool, params.sectorId, params.fileId, query.fromOrd, query.limit, auth.scope) }
  })
  route(app, 'post', '/v1/sectors/:sectorId/files/:fileId/retry', async (request, reply, app) => {
    const pool = requirePool(app, reply), runs = requireRuns(app, reply)
    if (!pool || !runs) return undefined
    const auth = await resolveCaller(pool, header(request, 'authorization'), header(request, 'x-tenant'), header(request, 'x-project'))
    if ('denied' in auth || !roleAtLeast(auth.caller, 'approver')) return sendError(reply, 403, 'permission_denied', 'File retries require an approver key.')
    request.kardataCaller = { keyId: auth.caller.keyId, tenantId: auth.scope.tenantId }
    const body = parseInput(z.object({ jobId: z.string().min(1).max(255), revision: z.number().int().nonnegative(), allowDuplicatePaid: z.boolean().default(false) }).strict(), request.body, reply)
    if (!body) return undefined
    if (!runs.startFileProcessing) return sendError(reply, 503, 'overload', 'File processing worker unavailable.')
    return withIdempotency(request, reply, pool, auth.caller.keyId, async () => {
      try {
        const params = request.params as { sectorId: string; fileId: string }
        const job = await retryFileProcessingJob(pool, { ...body, ...params, author: auth.caller.keyId, scope: auth.scope })
        try { await runs.startFileProcessing!(job.jobId, job.revision) }
        catch (error) { await failFileProcessingJob(pool, job.jobId, 'dispatch_outcome_unknown', job.revision, auth.scope); throw error }
        return { status: 200, body: { ok: true, data: fileProcessingProgress(job) } }
      } catch (error) {
        if (error instanceof WorkspaceError) return { status: { not_found: 404, conflict: 409, permission_denied: 403, validation_failed: 400 }[error.code], body: { ok: false, error: { code: error.code, message: error.message } } }
        throw error
      }
    })
  })
  register('patch', '/v1/sectors/:sectorId/files/:fileId', 'operator', (input) => {
    const body = z.object({ hidden: z.boolean() }).strict().parse(input.body)
    return setFileVisibility(input.pool, sector(input), input.params['fileId'] ?? '', body.hidden, input.scope)
  })
  register('post', '/v1/sectors/:sectorId/files/:fileId/context', 'operator', (input) => {
    const body = z.object({ baseVersion: z.number().int().nonnegative(), sourceThread: z.string().min(1), ords: z.array(z.number().int().nonnegative()).optional() }).strict().parse(input.body)
    return proposeFileContext(input.pool, { ...body, sectorId: sector(input), fileId: input.params['fileId'] ?? '', scope: input.scope })
  })
  register('get', '/v1/threads/:threadKey/context', 'viewer', (input) => readThreadContext(input.pool, thread(input), input.scope))
  register('patch', '/v1/threads/:threadKey/context', 'operator', (input) => {
    const body = z.object({ version: z.number().int().nonnegative(), notes: z.string().max(24000) }).strict().parse(input.body)
    return saveThreadContext(input.pool, thread(input), body, input.scope)
  })
  register('post', '/v1/threads/:threadKey/context/rebuild', 'approver', async (input) => {
    const body = z.object({ version: z.number().int().nonnegative(), summary: z.string().trim().min(1).max(48000), independent: z.literal(true) }).strict().parse(input.body)
    return rebuildThreadContext(input.pool, thread(input), { ...body, author: input.keyId }, input.scope)
  })
  register('post', '/v1/threads/:threadKey/context/compact', 'operator', async (input) => {
    return compactOwnerThread(input.pool, thread(input), input.scope)
  })
}
