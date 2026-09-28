// Thread routes. B3.1. Reads project first (request-scoped projector), then
// serve from the threads projection. Launch-notice records (`launched`)
// are routing metadata, not chat: message pages skip them while keeping the
// underlying seqs as the paging basis.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { projectNewEvents } from '../projector.js'
import { openThreadStream } from '../streams/outbox.js'
import { getThread, listThreads } from '../db/index.js'
import { toApiMessage, toApiThread } from '../threads/views.js'
import { authorize, parseInput, requirePool, requireSessionScope, route, sendError } from './http.js'
import { corsHeadersFor, parseCorsOrigins } from '../http/cors.js'

const MessagesQuery = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const StreamQuery = z.object({
  lastSeq: z.coerce.number().int().min(0).default(0),
})

export function threadRoutes(app: FastifyInstance): void {
  route(app, 'get', '/v1/sessions/:sessionId/threads', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    await projectNewEvents(pool)
    const params = request.params as { sessionId: string }
    if (!(await requireSessionScope(pool, params.sessionId, auth.scope, reply))) return undefined
    const threads = await listThreads(pool, params.sessionId)
    return { ok: true, data: threads.map(toApiThread) }
  })

  route(app, 'get', '/v1/threads/:threadKey', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    await projectNewEvents(pool)
    const params = request.params as { threadKey: string }
    const thread = await getThread(pool, params.threadKey)
    if (!thread) return sendError(reply, 404, 'not_found', `no such thread ${params.threadKey}`)
    if (!(await requireSessionScope(pool, thread.sessionId, auth.scope, reply))) return undefined
    return { ok: true, data: toApiThread(thread) }
  })

  route(app, 'get', '/v1/threads/:threadKey/messages', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const query = parseInput(MessagesQuery, request.query, reply)
    if (!query) return undefined
    await projectNewEvents(pool)
    const params = request.params as { threadKey: string }
    const thread = await getThread(pool, params.threadKey)
    if (!thread) return sendError(reply, 404, 'not_found', `no such thread ${params.threadKey}`)
    if (!(await requireSessionScope(pool, thread.sessionId, auth.scope, reply))) return undefined
    const window = thread.messages.filter((message) => message.seq > query.afterSeq)
    const page = window.slice(0, query.limit)
    const data = page.map(toApiMessage).filter((message) => message !== undefined)
    const last = page[page.length - 1]
    return { ok: true, data, nextAfterSeq: last ? last.seq : query.afterSeq }
  })

  // SSE thread stream (B3.2). Validation/404 use envelopes before the
  // headers go out; after that the socket owns the contract. A mid-stream
  // failure closes the connection — the client resumes from its last good
  // token, which is always a fully-written frame.
  route(app, 'get', '/v1/threads/:threadKey/events', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const query = parseInput(StreamQuery, request.query, reply)
    if (!query) return undefined
    await projectNewEvents(pool)
    const params = request.params as { threadKey: string }
    // Auth first: fetching the thread before authorize lets unauthenticated
    // callers probe thread existence via 404-vs-403.
    const streamAuth = await authorize(app, request, reply, 'viewer')
    if (!streamAuth) return undefined
    const thread = await getThread(pool, params.threadKey)
    if (!thread) return sendError(reply, 404, 'not_found', `no such thread ${params.threadKey}`)
    if (!(await requireSessionScope(pool, thread.sessionId, streamAuth.scope, reply))) return undefined

    reply.hijack()
    const raw = reply.raw
    // Hijacking skips the CORS onSend hook, so reflect the allow-list
    // explicitly: without it browsers block the stream and sent messages
    // never arrive (the UI does not echo locally by design). The list is
    // the one registerCors stored, never a fresh env parse, so injected
    // test origins and production agree.
    const streamOrigins =
      (app as FastifyInstance & { kardataCorsOrigins?: string[] }).kardataCorsOrigins ??
      parseCorsOrigins(process.env['KARDATA_CORS_ORIGINS'])
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...corsHeadersFor(request, streamOrigins),
    })
    const controller = new AbortController()
    const onClose = (): void => controller.abort()
    request.raw.on('close', onClose)
    const ping = setInterval(() => {
      if (!controller.signal.aborted) raw.write(':\n\n')
    }, 15_000)
    try {
      for await (const frame of openThreadStream(pool, params.threadKey, query.lastSeq, controller.signal)) {
        if (controller.signal.aborted) break
        raw.write(`data: ${JSON.stringify(frame)}\n\n`)
      }
    } catch {
      // Socket owns the contract now: close and let the client resume.
    } finally {
      clearInterval(ping)
      request.raw.off('close', onClose)
      controller.abort()
      raw.end()
    }
    return undefined
  })
}
