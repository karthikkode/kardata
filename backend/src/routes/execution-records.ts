import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { resolveCaller, roleAtLeast } from '../auth/keys.js'
import { readExecutionRecord, ResearchSourceError } from '../archive/targets.js'
import { listThreadExecutionRecords, readThreadExecutionReference, type TransactableDb } from '../db/index.js'
import { projectNewEvents } from '../projector.js'
import { header, parseInput, requireArchive, requirePool, route, sendError } from './http.js'

/** Inspection always requires a real approver key, including local open mode.
 * These owner routes have no MCP counterpart. */
async function approver(db: TransactableDb, request: FastifyRequest, reply: FastifyReply) {
  const auth = await resolveCaller(db, header(request, 'authorization'), header(request, 'x-tenant'), header(request, 'x-project'))
  if ('denied' in auth) { sendError(reply, 403, 'permission_denied', auth.denied); return undefined }
  if (!roleAtLeast(auth.caller, 'approver')) { sendError(reply, 403, 'permission_denied', 'Execution inspection requires an approver key.'); return undefined }
  request.kardataCaller = { keyId: auth.caller.keyId, tenantId: auth.scope.tenantId }
  return auth.scope
}
export function executionRecordRoutes(app: FastifyInstance): void {
  route(app, 'get', '/v1/threads/:threadKey/execution-records', async (request, reply, app) => {
    const db = requirePool(app, reply)
    if (!db) return undefined
    const scope = await approver(db, request, reply)
    if (!scope) return undefined
    const query = parseInput(z.object({ afterSeq: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict(), request.query, reply)
    if (!query) return undefined
    await projectNewEvents(db)
    return { ok: true, data: await listThreadExecutionRecords(db, (request.params as { threadKey: string }).threadKey, scope, query.afterSeq, query.limit) }
  })
  route(app, 'get', '/v1/threads/:threadKey/execution-records/:seq', async (request, reply, app) => {
    const db = requirePool(app, reply), archive = requireArchive(app, reply)
    if (!db || !archive) return undefined
    const scope = await approver(db, request, reply)
    if (!scope) return undefined
    const params = parseInput(z.object({ threadKey: z.string().min(1).max(255), seq: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }), request.params, reply)
    if (!params) return undefined
    await projectNewEvents(db)
    const journal = await readThreadExecutionReference(db, params.threadKey, params.seq, scope)
    const abort = new AbortController()
    const disconnected = () => abort.abort(new Error('Execution inspection connection closed.'))
    request.raw.once('aborted', disconnected)
    reply.raw.once('close', disconnected)
    if (request.raw.aborted || reply.raw.destroyed) disconnected()
    try {
      const record = await readExecutionRecord(archive, journal.sessionId, journal.ref, abort.signal)
      if (!record || typeof record !== 'object' || Array.isArray(record)) return sendError(reply, 409, 'conflict', 'The stored execution record is not a valid JSON object.')
      return { ok: true, data: { record } }
    } catch (error) {
      if (error instanceof ResearchSourceError) return sendError(reply, 409, 'conflict', error.message)
      throw error
    } finally { request.raw.removeListener('aborted', disconnected); reply.raw.removeListener('close', disconnected); abort.abort() }
  })
}
