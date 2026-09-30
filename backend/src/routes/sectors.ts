// Sector research routes (B-S4). Reads are projection-served (the route
// projects first, like every read path); start, restart, pause, and resume
// are operator mutations that honor Idempotency-Key. Lifecycle honesty:
// pause halts the sweep workflow before recording paused; resume and
// restart ensure a sweep workflow before recording running — states never
// describe runs that are not behind them. Owners drive all four from the
// sector chat strip; the agent starts via the db.start_sector_research
// MCP tool.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { OcrAdapter } from '../db/index.js'
import {
  addContextNotes,
  getSectorContext,
  setUnitExclusions,
} from '../db/sector-context.js'
import { approveSectorPlan, updateSectorPlan } from '../db/sector-plan.js'
import { pauseSectorSweep, restartSectorSweep, resumeSectorSweep } from '../db/sector-lifecycle.js'
import { SectorPlanError, planSectorResearch, readSectorPlan } from '../db/sector-plan.js'
import { SectorStartError, startSectorResearch } from '../db/sector-start.js'
import { createModelOcrAdapter } from '../ocr.js'
import { resolveAdapter } from '../providers/gateway.js'
import { projectNewEvents } from '../projector.js'
import {
  createSector,
  createSession,
  DbContractError,
  getSector,
  ingestSectorDocument,
  listCompanies,
  listSectorCompanies,
  listSectorDocuments,
  listSectors,
  sectorActivity,
  SectorTransitionError,
} from '../db/index.js'
import {
  authorize,
  parseInput,
  requirePool,
  requireRuns,
  route,
  sendError,
  withIdempotency,
} from './http.js'

const StateFilter = z.enum(['draft', 'running', 'paused', 'queued', 'failed', 'complete'])

const CreateSectorBody = z.object({
  name: z.string().min(1).max(200),
  topic: z.string().max(500).optional(),
  /** Creation state. Draft is the create-first flow (attach files, start
   * later); queued preserves the direct-research path. */
  state: z.enum(['draft', 'queued']).default('draft'),
})

const AttachDocumentBody = z.object({
  filename: z.string().min(1).max(255),
  /** Base64-encoded file bytes (8 MB cap). */
  contentBase64: z.string().min(1),
})

const ApprovePlanBody = z.object({
  /** Plan version to pin (must exist on the sector). */
  version: z.number().int().min(1),
})

/** Model OCR for document ingest: the vision model over the existing Meta
 * credential (KARDATA_OCR_MODEL, default muse-spark-1.3-contributor). No
 * new key. Missing key, explicit disable, or resolution failure means no
 * adapter: images attach as needs-ocr instead of failing the upload. */
function resolveOcrAdapter(): OcrAdapter | undefined {
  if ((process.env['KARDATA_OCR_DISABLED'] ?? '').trim() === '1') return undefined
  try {
    const model = process.env['KARDATA_OCR_MODEL']?.trim() || 'muse-spark-1.3-contributor'
    return createModelOcrAdapter(resolveAdapter('meta', { model }))
  } catch {
    return undefined
  }
}

const ListQuery = z.object({
  state: StateFilter.optional(),
  query: z.string().max(200).optional(),
})

const PagedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const CompanyListQuery = ListQuery.extend({
  sectorId: z.string().min(1).optional(),
}).extend(PagedQuery.shape)

const DetailQuery = PagedQuery

export function sectorRoutes(app: FastifyInstance): void {
  route(app, 'get', '/v1/sectors', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const filters = parseInput(ListQuery, request.query, reply)
    if (!filters) return undefined
    await projectNewEvents(pool)
    try {
      return { ok: true, data: await listSectors(pool, auth.scope, filters) }
    } catch (error) {
      if (error instanceof DbContractError) {
        return sendError(reply, 400, 'validation_failed', error.message)
      }
      throw error
    }
  })

  route(app, 'get', '/v1/sectors/:sectorId', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    const paging = parseInput(DetailQuery, request.query, reply)
    if (!paging) return undefined
    await projectNewEvents(pool)
    const sector = await getSector(pool, sectorId, auth.scope).catch((error: unknown) => {
      if (error instanceof DbContractError) return undefined
      throw error
    })
    if (!sector) return sendError(reply, 404, 'not_found', `no such sector ${sectorId}`)
    const companies = await listSectorCompanies(pool, sectorId, auth.scope, {}, paging)
    const activity = await sectorActivity(pool, sectorId, auth.scope, paging)
    return {
      ok: true,
      data: {
        ...sector,
        companies: companies.companies,
        companiesTotal: companies.total,
        activity: activity.entries,
        activityTotal: activity.total,
      },
    }
  })

  route(app, 'get', '/v1/companies', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const filters = parseInput(CompanyListQuery, request.query, reply)
    if (!filters) return undefined
    await projectNewEvents(pool)
    try {
      const { limit, offset, ...companyFilters } = filters
      const page = await listCompanies(pool, auth.scope, companyFilters, { limit, offset })
      return { ok: true, data: { companies: page.companies, total: page.total } }
    } catch (error) {
      if (error instanceof DbContractError) {
        return sendError(reply, 400, 'validation_failed', error.message)
      }
      throw error
    }
  })

  route(app, 'post', '/v1/sectors', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const body = parseInput(CreateSectorBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      try {
        const { sectorId } = await createSector(pool, {
          name: body.name,
          topic: body.topic,
          scope: auth.scope,
          initialState: body.state,
        })
        await projectNewEvents(pool)
        const sector = await getSector(pool, sectorId, auth.scope)
        return { status: 201, body: { ok: true, data: sector } }
      } catch (error) {
        if (error instanceof DbContractError) {
          return { status: 400, body: { ok: false, error: { code: 'validation_failed', message: error.message } } }
        }
        throw error
      }
    })
  })

  route(app, 'post', '/v1/sectors/:sectorId/start', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      const header = request.headers['idempotency-key']
      const key = typeof header === 'string' && header !== '' ? `sector-start:${sectorId}:${header}` : undefined
      try {
        await startSectorResearch(pool, runs, sectorId, auth.scope, key)
      } catch (error: unknown) {
        if (error instanceof SectorStartError) {
          const status = error.failure === 'not_found' ? 404 : error.failure === 'conflict' ? 409 : 503
          return { status, body: { ok: false, error: { code: error.failure, message: error.message } } }
        }
        throw error
      }
      await projectNewEvents(pool).catch(() => undefined)
      const started = await getSector(pool, sectorId, auth.scope)
      return { status: 200, body: { ok: true, data: started } }
    })
  })

  route(app, 'post', '/v1/sectors/:sectorId/plan', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      const header = request.headers['idempotency-key']
      const key = typeof header === 'string' && header !== '' ? `sector-plan:${sectorId}:${header}` : undefined
      // The planning chat is visible in the sector pool: owners watch the
      // plan take shape instead of a silent background run.
      let sessionId: string
      try {
        const session = await createSession(pool, 'Research plan', auth.scope, sectorId)
        sessionId = session.id
      } catch (error: unknown) {
        if (error instanceof DbContractError) {
          return { status: 400, body: { ok: false, error: { code: 'validation_failed', message: error.message } } }
        }
        throw error
      }
      try {
        await planSectorResearch(pool, runs, sectorId, sessionId, auth.scope, key)
      } catch (error: unknown) {
        if (error instanceof SectorPlanError) {
          const status = error.failure === 'not_found' ? 404 : error.failure === 'conflict' ? 409 : 503
          return { status, body: { ok: false, error: { code: error.failure, message: error.message } } }
        }
        throw error
      }
      await projectNewEvents(pool).catch(() => undefined)
      const planning = await getSector(pool, sectorId, auth.scope)
      return { status: 200, body: { ok: true, data: planning } }
    })
  })

  route(app, 'patch', '/v1/sectors/:sectorId/plan', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    const PatchPlanBody = z.object({ markdown: z.string().min(1).max(8000) })
    const body = parseInput(PatchPlanBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      const header = request.headers['idempotency-key']
      const key = typeof header === 'string' && header !== '' ? `sector-plan-edit:${sectorId}:${header}` : undefined
      try {
        const stored = await updateSectorPlan(pool, sectorId, body.markdown, auth.scope, key)
        await projectNewEvents(pool)
        return { status: 200, body: { ok: true, data: stored } }
      } catch (error: unknown) {
        if (error instanceof SectorTransitionError) {
          const status = error.failure === 'not_found' ? 404 : 409
          return { status, body: { ok: false, error: { code: error.failure, message: error.message } } }
        }
        if (error instanceof DbContractError) {
          return { status: 400, body: { ok: false, error: { code: 'validation_failed', message: error.message } } }
        }
        throw error
      }
    })
  })

  route(app, 'get', '/v1/sectors/:sectorId/plan', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    await projectNewEvents(pool)
    try {
      const plan = await readSectorPlan(pool, sectorId, auth.scope)
      if (!plan) return sendError(reply, 404, 'not_found', `no such sector ${sectorId}`)
      return { ok: true, data: plan }
    } catch (error) {
      if (error instanceof DbContractError) {
        return sendError(reply, 404, 'not_found', error.message)
      }
      throw error
    }
  })

  route(app, 'post', '/v1/sectors/:sectorId/documents', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    const body = parseInput(AttachDocumentBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      try {
        const document = await ingestSectorDocument(pool, {
          sectorId,
          filename: body.filename,
          contentBase64: body.contentBase64,
          scope: auth.scope,
          ocr: resolveOcrAdapter(),
        })
        return { status: 201, body: { ok: true, data: document } }
      } catch (error) {
        if (error instanceof DbContractError) {
          const status = error.message.startsWith('unknown sector') ? 404 : 400
          const code = status === 404 ? 'not_found' : 'validation_failed'
          return { status, body: { ok: false, error: { code, message: error.message } } }
        }
        throw error
      }
    })
  })

  route(app, 'get', '/v1/sectors/:sectorId/documents', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    await projectNewEvents(pool)
    try {
      return { ok: true, data: await listSectorDocuments(pool, sectorId, auth.scope) }
    } catch (error) {
      if (error instanceof DbContractError) {
        return sendError(reply, 404, 'not_found', error.message)
      }
      throw error
    }
  })

  route(app, 'get', '/v1/sectors/:sectorId/context', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    await projectNewEvents(pool)
    try {
      return { ok: true, data: await getSectorContext(pool, sectorId, auth.scope) }
    } catch (error) {
      if (error instanceof DbContractError) {
        return sendError(reply, 404, 'not_found', error.message)
      }
      throw error
    }
  })

  const UnitRefBody = z.object({
    documentId: z.string().min(1).max(64),
    /** Unit index; absent addresses the whole document. */
    ord: z.number().int().min(0).optional(),
  })

  const PatchContextBody = z.object({
    exclude: UnitRefBody.array().max(100).optional(),
    include: UnitRefBody.array().max(100).optional(),
    notes: z.string().min(1).max(2000).array().max(20).optional(),
  })

  route(app, 'patch', '/v1/sectors/:sectorId/context', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    const body = parseInput(PatchContextBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      try {
        const toRefs = (refs: Array<{ documentId: string; ord?: number }>): Array<{ documentId: string; ord: number }> =>
          refs.map((ref) => ({ documentId: ref.documentId, ord: ref.ord ?? -1 }))
        await setUnitExclusions(pool, sectorId, toRefs(body.exclude ?? []), true)
        await setUnitExclusions(pool, sectorId, toRefs(body.include ?? []), false)
        if (body.notes) await addContextNotes(pool, sectorId, body.notes)
        return { status: 200, body: { ok: true, data: await getSectorContext(pool, sectorId, auth.scope) } }
      } catch (error) {
        if (error instanceof DbContractError) {
          const status = error.message.startsWith('unknown sector') ? 404 : 400
          const code = status === 404 ? 'not_found' : 'validation_failed'
          return { status, body: { ok: false, error: { code, message: error.message } } }
        }
        throw error
      }
    })
  })

  route(app, 'post', '/v1/sectors/:sectorId/restart', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      const header = request.headers['idempotency-key']
      const key = typeof header === 'string' && header !== '' ? `sector-restart:${sectorId}:${header}` : undefined
      try {
        // Inner key binds the transition to the caller's idempotency key when
        // one is present, so a replayed restart executes exactly once.
        await restartSectorSweep(pool, runs, sectorId, auth.scope, key)
        await projectNewEvents(pool)
      } catch (error: unknown) {
        if (error instanceof SectorTransitionError) {
          const status = error.failure === 'not_found' ? 404 : error.failure === 'overload' ? 503 : 409
          const code = error.failure === 'overload' ? 'overload' : error.failure
          return { status, body: { ok: false, error: { code, message: error.message } } }
        }
        throw error
      }
      const restarted = await getSector(pool, sectorId, auth.scope)
      return { status: 200, body: { ok: true, data: restarted } }
    })
  })

  route(app, 'post', '/v1/sectors/:sectorId/pause', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      const header = request.headers['idempotency-key']
      const key = typeof header === 'string' && header !== '' ? `sector-pause:${sectorId}:${header}` : undefined
      try {
        await pauseSectorSweep(pool, runs, sectorId, auth.scope, key)
        await projectNewEvents(pool)
        const paused = await getSector(pool, sectorId, auth.scope)
        return { status: 200, body: { ok: true, data: paused } }
      } catch (error: unknown) {
        if (error instanceof SectorTransitionError) {
          const status = error.failure === 'not_found' ? 404 : error.failure === 'overload' ? 503 : 409
          const code = error.failure === 'overload' ? 'overload' : error.failure
          return { status, body: { ok: false, error: { code, message: error.message } } }
        }
        throw error
      }
    })
  })

  route(app, 'post', '/v1/sectors/:sectorId/resume', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      const header = request.headers['idempotency-key']
      const key = typeof header === 'string' && header !== '' ? `sector-resume:${sectorId}:${header}` : undefined
      try {
        await resumeSectorSweep(pool, runs, sectorId, auth.scope, key)
        await projectNewEvents(pool)
        const running = await getSector(pool, sectorId, auth.scope)
        return { status: 200, body: { ok: true, data: running } }
      } catch (error: unknown) {
        if (error instanceof SectorTransitionError) {
          const status = error.failure === 'not_found' ? 404 : error.failure === 'overload' ? 503 : 409
          const code = error.failure === 'overload' ? 'overload' : error.failure
          return { status, body: { ok: false, error: { code, message: error.message } } }
        }
        throw error
      }
    })
  })

  route(app, 'post', '/v1/sectors/:sectorId/approve', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const params = request.params as { sectorId?: string }
    const sectorId = params.sectorId ?? ''
    const body = parseInput(ApprovePlanBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      await projectNewEvents(pool)
      const header = request.headers['idempotency-key']
      const key = typeof header === 'string' && header !== '' ? `sector-approve:${sectorId}:${header}` : undefined
      try {
        const approved = await approveSectorPlan(pool, sectorId, body.version, auth.scope, key)
        await projectNewEvents(pool)
        const sector = await getSector(pool, sectorId, auth.scope)
        return { status: 200, body: { ok: true, data: { ...sector, approvedVersion: approved.version } } }
      } catch (error: unknown) {
        if (error instanceof SectorTransitionError) {
          const status = error.failure === 'not_found' ? 404 : 409
          return { status, body: { ok: false, error: { code: error.failure, message: error.message } } }
        }
        if (error instanceof DbContractError) {
          return { status: 400, body: { ok: false, error: { code: 'validation_failed', message: error.message } } }
        }
        throw error
      }
    })
  })
}
