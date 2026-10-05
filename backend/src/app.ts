// HTTP boundary. B0.1 envelopes; B3.1 routes. buildApp() builds the
// instance (tests import it and use inject, never a bound port); server.ts
// only listens. Dependencies ride instance fields: without a pool or runs
// gateway the routes fail closed with 503 overload.
import Fastify, { type FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { parseCorsOrigins, registerCors } from './http/cors.js'
import { resolveArchiveTarget, type ArchiveTarget } from './archive/targets.js'
import type { TransactableDb } from './db/index.js'
import { createHttpMetrics, refreshFleetGauges, renderMetrics } from './observability/metrics.js'
import { registerRequestLogging } from './observability/requestLog.js'
import { tracePlugin } from './observability/trace.js'
import type { RunsGateway } from './temporal/runs-types.js'
import { artifactRoutes } from './routes/artifacts.js'
import { commandRoutes } from './routes/commands.js'
import { inspectorRoutes } from './routes/inspector.js'
import { mcpRoutes } from './mcp/routes.js'
import { fetchMetaModels, type ModelCatalog } from './providers/catalog.js'
import { providerRoutes } from './routes/providers.js'
import { registerRateLimit } from './routes/http.js'
import { runRoutes } from './routes/runs.js'
import { alertRoutes } from './routes/alerts.js'
import { sectorRoutes } from './routes/sectors.js'
import { sessionRoutes } from './routes/sessions.js'
import { skillRoutes } from './routes/skills.js'
import { threadRoutes } from './routes/threads.js'
import { registerBrowserProxy } from './retrieval/proxy.js'
import { workspaceRoutes } from './routes/workspace.js'
import { executionRecordRoutes } from './routes/execution-records.js'

interface HealthData {
  status: 'ok'
  buildSha: string
  uptimeSecs: number
}

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface AppOptions {
  buildSha?: string
  pool?: TransactableDb
  runs?: RunsGateway
  /** Keyed multi-tenant mode. Without it the routes stay open (B3.1) and
   * unscoped; server.ts always enables it. */
  auth?: boolean
  /** Fixed-window per-key budget for /v1/* (B3.4) and /mcp (P4.2.5,
   * separate buckets). Defaults to 600; 0 or negative disables the hook.
   * /healthz is never throttled. */
  rateLimitPerMin?: number
  /** Optional pino logger. Limit breaches are logged; without one the 429
   * envelope is still served but nothing is recorded. */
  logger?: Logger
  /** Archive target for artifact bodies. Defaults to resolveArchiveTarget()
   * (GCS when KARDATA_GCS_BUCKET is set, else filesystem); tests inject a
   * temp dir or fake. */
  archiveTarget?: ArchiveTarget
  /** Browser origins allowed to call the API. Defaults to
   * parseCorsOrigins(KARDATA_CORS_ORIGINS): the local vite dev origins
   * when unset. Tests inject an explicit list. */
  corsOrigins?: string[]
  /** Injectable live Meta model lookup for hermetic route tests. */
  metaCatalog?: ModelCatalog
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  // Eight-MiB uploads grow to ~10.7 MiB as base64 JSON. Per-file extraction
  // keeps its own eight-MiB limit; this transport ceiling includes metadata.
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 })
  const startedAt = Date.now()
  const buildSha = options.buildSha ?? process.env['BUILD_SHA'] ?? 'dev'
  const withDeps = app as FastifyInstance & {
    kardataPool?: TransactableDb
    kardataRuns?: RunsGateway
    kardataAuth?: boolean
    kardataArchive?: ArchiveTarget
    kardataLogger?: Logger
  }
  withDeps.kardataPool = options.pool
  withDeps.kardataRuns = options.runs
  withDeps.kardataAuth = options.auth === true
  withDeps.kardataArchive = options.archiveTarget ?? resolveArchiveTarget()
  if (options.logger) withDeps.kardataLogger = options.logger

  app.get('/healthz', async (): Promise<ApiResponse<HealthData>> => ({
    ok: true,
    data: {
      status: 'ok',
      buildSha,
      uptimeSecs: Math.floor((Date.now() - startedAt) / 1000),
    },
  }))

  registerBrowserProxy(app)

  // Trace first: every later hook and route reads request.traceContext.
  void app.register(tracePlugin)
  // CORS before the rate hook so browser preflights are never counted.
  registerCors(app, options.corsOrigins ?? parseCorsOrigins(process.env['KARDATA_CORS_ORIGINS']))
  registerRateLimit(app, options.rateLimitPerMin ?? 600, options.logger)
  const metrics = createHttpMetrics()
  registerRequestLogging(app, { logger: options.logger, metrics })

  // Prometheus scrape target (B5.2/B5.4). Fleet gauges refresh ahead of
  // every scrape (best-effort, never fails the scrape); cardinality is
  // bounded by the label allow-list in metrics.ts.
  app.get('/metrics', async (_request, reply) => {
    await refreshFleetGauges(metrics, { pool: options.pool, runs: options.runs })
    const rendered = await renderMetrics(metrics.registry)
    reply.header('content-type', rendered.contentType)
    return rendered.body
  })

  const metaCatalog = options.metaCatalog ?? (() => fetchMetaModels())
  sessionRoutes(app, metaCatalog)
  providerRoutes(app, metaCatalog)
  sectorRoutes(app)
  artifactRoutes(app)
  threadRoutes(app)
  workspaceRoutes(app)
  executionRecordRoutes(app)
  runRoutes(app)
  alertRoutes(app)
  commandRoutes(app)
  inspectorRoutes(app)
  skillRoutes(app)
  mcpRoutes(app)

  app.setNotFoundHandler((request, reply): Promise<ApiResponse<never>> => {
    reply.code(404)
    return Promise.resolve({
      ok: false,
      error: { code: 'not_found', message: `no route ${request.method} ${request.url}` },
    })
  })

  return app
}
