import { WorkReviewDecision, reviewResearchWork } from '../db/work-review.js'
import { rebuildThreadContext } from '../db/workspace-threads.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Scope, Role } from '../auth/types.js'
import { resolveCaller, roleAtLeast } from '../auth/keys.js'
import {
  ContextSections, PartialContextSections, WorkspaceError, createSession, decideContextChange, ensureResearchSession,
  previewContextChange,
  readSectorLibraryFile,
  listSectorLibrary, proposeFileContext, proposeGlobalContext, readGlobalContext, readGlobalContextUsage, readResearchProgress, removeContextFileBlock, restoreGlobalContextVersion,
  readThreadContext, saveThreadContext, setFileVisibility, setSessionPurpose, type TransactableDb,
  retryFileProcessingJob, fileProcessingProgress, failFileProcessingJob,
  readSectorDocumentUnitsPage, readSectorEvaluation,
} from '../db/index.js'
import type { RunsGateway } from '../temporal/runs-types.js'
import { insertContextFileBlock, readContextFileBlock, resetContextFileBlock } from '../db/context-files.js'
import { compactOwnerThread } from '../context.js'
import { projectNewEvents } from '../projector.js'
import { authorize, header, parseInput, requireArchive, requirePool, requireRuns, route, sendError, withIdempotency } from './http.js'

interface Input { keyId: string; pool: TransactableDb; scope?: Scope; params: Record<string, string>; body: unknown; runs?: RunsGateway }
export function workspaceRoutes(app: FastifyInstance): void {
  function register(method: 'get' | 'post' | 'patch' | 'delete', path: string, role: Role, handler: (input: Input) => Promise<unknown>) {
    route(app, method, path, async (request, reply, app) => {
      const pool = requirePool(app, reply)
      if (!pool) return undefined
      const auth = await authorize(app, request, reply, role)
      if (!auth) return undefined
      const work = async () => {
        await projectNewEvents(pool)
        try {
          const data = await handler({ keyId: auth.keyId, pool, scope: auth.scope, params: request.params as Record<string, string>, body: request.body, runs: (app as FastifyInstance & { kardataRuns?: RunsGateway }).kardataRuns })
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
  async function triggerCompactionIfFull(pool: TransactableDb, runs: RunsGateway | undefined, sectorId: string, scope?: Scope): Promise<void> {
    if (!runs) return
    const usage = await readGlobalContextUsage(pool, sectorId, scope)
    if (usage.total >= usage.budget * 0.7) await runs.startContextCompaction(sectorId, 'auto')
  }
  register('patch', '/v1/sectors/:sectorId/global-context', 'approver', async (input) => {
    const body = z.object({ baseVersion: z.number().int().nonnegative(), sections: ContextSections }).strict().parse(input.body)
    const change = await proposeGlobalContext(input.pool, { ...body, sectorId: sector(input), sourceThread: 'owner', owner: true, scope: input.scope })
    await triggerCompactionIfFull(input.pool, input.runs, sector(input), input.scope)
    return change
  })
  register('post', '/v1/sectors/:sectorId/global-context/proposals', 'operator', (input) => {
    const body = z.object({ baseVersion: z.number().int().nonnegative(), sections: PartialContextSections, sourceThread: z.string().min(1) }).strict().parse(input.body)
    // Browser proposals never inherit autonomous research authority.
    return proposeGlobalContext(input.pool, { ...body, sectorId: sector(input), owner: false, scope: input.scope })
  })
  register('post', '/v1/sectors/:sectorId/global-context/proposals/:proposalId/decision', 'approver', async (input) => {
    const body = z.object({ approve: z.boolean() }).strict().parse(input.body)
    const decided = await decideContextChange(input.pool, { ...body, sectorId: sector(input), id: input.params['proposalId'] ?? '', scope: input.scope })
    if (body.approve && decided.state === 'approved' && decided.fileRef) {
      if (!input.runs) throw new Error('runs gateway unavailable')
      await input.runs.startContextFileSummary(sector(input), decided.fileRef.fileId, decided.fileRef.hash)
    }
    if (body.approve && decided.state === 'approved' && decided.version !== null) {
      await triggerCompactionIfFull(input.pool, input.runs, sector(input), input.scope)
    }
    return decided
  })
  register('post', '/v1/sectors/:sectorId/global-context/compact', 'approver', async (input) => {
    if (!input.runs) throw new Error('runs gateway unavailable')
    await input.runs.startContextCompaction(sector(input), 'manual')
    return { started: true }
  })
  register('post', '/v1/sectors/:sectorId/global-context/restore', 'approver', async (input) => {
    const body = z.object({ version: z.number().int().nonnegative() }).strict().parse(input.body)
    const restored = await restoreGlobalContextVersion(input.pool, { sectorId: sector(input), version: body.version, scope: input.scope })
    await triggerCompactionIfFull(input.pool, input.runs, sector(input), input.scope)
    return restored
  })
  register('post', '/v1/sectors/:sectorId/global-context/rewrite', 'approver', async (input) => {
    const body = z.object({ instruction: z.string().trim().min(1).max(2000) }).strict().parse(input.body)
    if (!input.runs) throw new Error('runs gateway unavailable')
    const sectorId = sector(input)
    const session = await createSession(input.pool, `Context rewrite: ${body.instruction.trim().slice(0, 40)}`, input.scope, sectorId)
    await projectNewEvents(input.pool)
    await setSessionPurpose(input.pool, session.id, 'context-rewrite', input.scope)
    await input.runs.send(session.id, `Rewrite the global context: ${body.instruction}`)
    return { sessionId: session.id }
  })
  register('post', '/v1/sectors/:sectorId/global-context/files', 'approver', async (input) => {
    const body = z.object({ fileId: z.string().min(1) }).strict().parse(input.body)
    const sectorId = sector(input)
    const file = (await listSectorLibrary(input.pool, sectorId, input.scope)).find((entry) => entry.id === body.fileId)
    if (!file) throw new WorkspaceError('not_found', 'File not found in this sector.')
    if (file.hidden) throw new WorkspaceError('conflict', 'Reveal the file before including it.')
    if (file.status !== 'indexed') throw new WorkspaceError('conflict', 'The file is not indexed yet.')
    if (file.kind !== 'document' && !file.documentId) throw new WorkspaceError('conflict', 'Only processed documents can be included as shared context.')
    const existing = await readContextFileBlock(input.pool, sectorId, body.fileId)
    if (existing?.state === 'summarizing' || existing?.state === 'ready') return existing
    const usage = await readGlobalContextUsage(input.pool, sectorId, input.scope)
    if (usage.total >= usage.budget) throw new WorkspaceError('conflict', 'Global context is full. Remove a file or compact first.')
    if (!input.runs) throw new Error('runs gateway unavailable')
    const documentId = file.kind === 'document' ? file.id : (file.documentId ?? file.id)
    const block = existing
      ? (await resetContextFileBlock(input.pool, { sectorId, fileId: file.id, hash: file.hash, filename: file.filename, documentId, requestedBy: `owner:${input.keyId}` })) ?? existing
      : await insertContextFileBlock(input.pool, { sectorId, fileId: file.id, documentId, hash: file.hash, filename: file.filename, requestedBy: `owner:${input.keyId}` })
    await input.runs.startContextFileSummary(sectorId, file.id, file.hash)
    return block
  })
  register('post', '/v1/sectors/:sectorId/global-context/files/:fileId/summarize', 'approver', async (input) => {
    const sectorId = sector(input)
    const fileId = input.params['fileId'] ?? ''
    const existing = await readContextFileBlock(input.pool, sectorId, fileId)
    if (!existing || existing.state === 'ready' || existing.state === 'summarizing') throw new WorkspaceError('conflict', 'Only a failed block or a legacy file can be summarized.')
    const file = (await listSectorLibrary(input.pool, sectorId, input.scope)).find((entry) => entry.id === fileId)
    if (!file) throw new WorkspaceError('not_found', 'File not found in this sector.')
    if (file.hidden) throw new WorkspaceError('conflict', 'Reveal the file before including it.')
    if (file.status !== 'indexed') throw new WorkspaceError('conflict', 'The file is not indexed yet.')
    if (file.kind !== 'document' && !file.documentId) throw new WorkspaceError('conflict', 'Only processed documents can be included as shared context.')
    if (!input.runs) throw new Error('runs gateway unavailable')
    const documentId = file.kind === 'document' ? file.id : (file.documentId ?? file.id)
    const block = (await resetContextFileBlock(input.pool, { sectorId, fileId: file.id, hash: file.hash, filename: file.filename, documentId, requestedBy: `owner:${input.keyId}` })) ?? existing
    await input.runs.startContextFileSummary(sectorId, file.id, file.hash)
    return block
  })
  register('delete', '/v1/sectors/:sectorId/global-context/files/:fileId', 'approver', async (input) => {
    const sectorId = sector(input)
    const fileId = input.params['fileId'] ?? ''
    const removed = await removeContextFileBlock(input.pool, { sectorId, fileId, scope: input.scope })
    // No AI call: deletion is instant. A summary in flight is cancelled
    // best effort; a late completion finds no row and stays out.
    if (removed.state === 'summarizing' && input.runs) {
      try { await input.runs.cancelContextFileSummary(sectorId, fileId, removed.hash) } catch { /* best effort */ }
    }
    return removed
  })
  register('get', '/v1/sectors/:sectorId/global-context/proposals/:proposalId', 'viewer', (input) => previewContextChange(input.pool, sector(input), input.params['proposalId'] ?? '', input.scope))
  register('post', '/v1/sectors/:sectorId/work/:workId/review', 'approver', (input) => reviewResearchWork(input.pool, { ...WorkReviewDecision.parse(input.body), sectorId: sector(input), workId: input.params['workId'] ?? '', author: input.keyId, scope: input.scope }))
  register('get', '/v1/sectors/:sectorId/progress', 'viewer', (input) => readResearchProgress(input.pool, sector(input), input.scope))
  register('get', '/v1/sectors/:sectorId/evaluation', 'viewer', (input) => readSectorEvaluation(input.pool, sector(input), input.scope))
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
