// Session routes. B3.1 reads/creates; B3.3 gates and scopes. Reads are
// event-sourced (always current, no projector involved); create appends
// t.session.created, which starts the session thread in projection.
// B3.4: create honors Idempotency-Key (replay the session, 409 on key
// reuse for a different title).
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { condense } from '@kardata/agents'
import {
  appendEvent,
  createSession,
  deleteSession,
  getSector,
  getSession,
  getThread,
  listSessions,
  renameSession,
  setSessionModel,
} from '../db/index.js'
import { RunNotFound, SESSION_PREFIX } from '../temporal/gateway.js'
import { projectNewEvents } from '../projector.js'
import { chatHistory } from '../temporal/activities/turn.js'
import type { ModelCatalog } from '../providers/catalog.js'
import { DEFAULT_EFFORT } from '../providers/registry.js'
import { authorize, parseInput, requirePool, requireRuns, route, sendError, withIdempotency } from './http.js'

const CreateSessionBody = z.object({ title: z.string().min(1), sectorId: z.string().min(1).optional() });

const SetSessionModelBody = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  reasoning: z.boolean().optional(),
  effort: z.string().min(1).optional(),
});

export function sessionRoutes(app: FastifyInstance, catalog: ModelCatalog): void {
  route(app, 'get', '/v1/sessions', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const query = request.query as { sectorId?: string }
    if (query.sectorId !== undefined && query.sectorId.trim().length === 0) {
      return sendError(reply, 400, 'validation_failed', 'sectorId must be a non-empty string')
    }
    return { ok: true, data: await listSessions(pool, auth.scope, query.sectorId) }
  })

  route(app, 'post', '/v1/sessions', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const body = parseInput(CreateSessionBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      if (body.sectorId !== undefined) {
        const sector = await getSector(pool, body.sectorId, auth.scope)
        if (!sector) {
          return {
            status: 404,
            body: { ok: false, error: { code: 'not_found', message: `unknown sector ${body.sectorId}` } },
          }
        }
      }
      const session = await createSession(pool, body.title, auth.scope, body.sectorId)
      return { status: 201, body: { ok: true, data: session } }
    })
  })

  route(app, 'get', '/v1/sessions/:sessionId', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const params = request.params as { sessionId: string }
    const session = await getSession(pool, params.sessionId, auth.scope)
    if (!session) return sendError(reply, 404, 'not_found', `no such session ${params.sessionId}`)
    return { ok: true, data: session }
  })

  route(app, 'patch', '/v1/sessions/:sessionId/model', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sessionId: string }
    const body = parseInput(SetSessionModelBody, request.body, reply)
    if (!body) return undefined
    let available
    try {
      available = await catalog()
    } catch {
      return sendError(reply, 503, 'overload', 'Meta model catalog unavailable. Try again.')
    }
    if (available.length === 0) return sendError(reply, 503, 'overload', 'Meta is not configured.')
    const selected = available.find((entry) => entry.model === body.model)
    if (!selected) {
      return sendError(
        reply,
        400,
        'validation_failed',
        `unknown model ${body.model} for provider ${body.provider}`,
      )
    }
    if (body.effort !== undefined && !selected.efforts.includes(body.effort)) {
      return sendError(
        reply,
        400,
        'validation_failed',
        `unknown effort ${body.effort} for model ${body.model}`,
      )
    }
    const selection = {
      provider: 'meta' as const,
      model: body.model,
      reasoning: body.reasoning ?? selected.reasoning === 'native',
      ...(selected.efforts.length === 0 ? {} : { effort: body.effort ?? DEFAULT_EFFORT }),
    }
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      const model = await setSessionModel(pool, params.sessionId, selection, auth.scope)
      if (!model) {
        return {
          status: 404,
          body: { ok: false, error: { code: 'not_found', message: `no such session ${params.sessionId}` } },
        }
      }
      return { status: 200, body: { ok: true, data: model } }
    })
  })

  route(app, 'delete', '/v1/sessions/:sessionId', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sessionId: string }
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      // Stop the session workflow first so no turn lands after the
      // tombstone; a missing workflow is fine (never started or already
      // closed) and never fails the delete.
      try {
        await runs.cancelRun(`${SESSION_PREFIX}${params.sessionId}`)
      } catch (error) {
        if (!(error instanceof RunNotFound)) throw error
      }
      const deleted = await deleteSession(pool, params.sessionId, auth.scope)
      if (!deleted) {
        return {
          status: 404,
          body: { ok: false, error: { code: 'not_found', message: `no such session ${params.sessionId}` } },
        }
      }
      return { status: 200, body: { ok: true, data: { id: params.sessionId, deleted: true } } }
    })
  })

  route(app, 'post', '/v1/sessions/:sessionId/rename', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sessionId: string }
    const body = parseInput(CreateSessionBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      const session = await renameSession(pool, params.sessionId, body.title, auth.scope)
      if (!session) {
        return {
          status: 404,
          body: { ok: false, error: { code: 'not_found', message: `no such session ${params.sessionId}` } },
        }
      }
      return { status: 200, body: { ok: true, data: session } }
    })
  })

  route(app, 'post', '/v1/sessions/:sessionId/compact', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sessionId?: string }
    const sessionId = params.sessionId ?? ''
    const session = await getSession(pool, sessionId, auth.scope)
    if (!session) return sendError(reply, 404, 'not_found', `no such session ${sessionId}`)
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      const thread = await getThread(pool, sessionId)
      // chatHistory appends the in-flight user turn; drop that trailing
      // empty turn so the count reflects persisted history only.
      const turns = chatHistory(thread?.messages ?? [], '').slice(0, -1)
      if (turns.length < 4) {
        return {
          status: 200,
          body: {
            ok: true,
            data: { sessionId, compacted: false, messageCount: turns.length, reason: 'history below compaction threshold' },
          },
        }
      }
      // Extractive marker: the summary names what was seen, history rows
      // stay untouched. A model rewrite is a later phase, not this route.
      const outcome = await condense({
        messages: turns,
        keepFirst: 1,
        maxSize: 6,
        force: true,
        summarizer: 'session:compaction',
        summarize: async (forgotten) => {
          const bullets = forgotten
            .slice(0, 8)
            .map((turn) => `${turn.role}: ${(turn.text ?? '').slice(0, 80).replace(/\s+/g, ' ')}`)
            .join('; ')
          return `Condensed ${forgotten.length} historical turns (${bullets}).`
        },
      })
      if (!outcome.needed) {
        return {
          status: 200,
          body: { ok: true, data: { sessionId, compacted: false, messageCount: turns.length, reason: 'nothing to condense' } },
        }
      }
      const summaryText = `[Context Compaction] ${outcome.summary.summaryText}`
      const key = `session-compact:${sessionId}:${turns.length}:${createHash('sha256').update(summaryText).digest('hex').slice(0, 16)}`
      await appendEvent(pool, {
        idempotencyKey: key,
        partition: `session:${sessionId}`,
        type: 't.message.appended',
        payload: { threadKey: sessionId, kind: 'text', message: { role: 'assistant', text: summaryText, compacted: true } },
      })
      await projectNewEvents(pool)
      return {
        status: 200,
        body: { ok: true, data: { sessionId, compacted: true, messageCount: turns.length, summary: outcome.summary } },
      }
    })
  })
}
