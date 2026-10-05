// Prometheus metrics (B5.2). HTTP RED metrics plus Node process defaults
// on a dedicated registry served at GET /metrics. Label names are an
// allow-list per metric (unknown names throw at construction); label VALUES
// stay bounded by construction (route patterns, never ids; fixed status
// and method sets). Series budget below; the traces test fails the build
// past it.
//
// Worker-process increments have no scraped path until the fleet lands, so
// domain counters (provider/tool/artifact) stay out of this registry: only
// what THIS process serves is counted here. Temporal SDK metrics export
// through `workerTelemetryOptions` when the fleet wires Runtime.install.
import type { TelemetryOptions } from '@temporalio/worker'
import type { Db } from '../db/index.js'
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client'
import { listHeartbeats, poolStats } from '../db/index.js'
import { DEFAULT_STALL_THRESHOLDS } from './stalls.js'
import type { RunsGateway } from '../temporal/gateway.js'

export type { TelemetryOptions }

/** Hard ceiling on active series in this registry (staging budget). */
export const CARDINALITY_BUDGET = 10_000

/** Label-name allow-list per metric. Values are bounded separately: route
 * patterns (never concrete ids), fixed method/status sets. */
const METRIC_LABEL_ALLOW: Record<string, string[]> = {
  http_requests_total: ['method', 'route', 'status'],
  http_request_duration_seconds: ['method', 'route', 'status'],
  kardata_runs_by_state: ['state'],
  kardata_stale_heartbeats: [],
  kardata_pg_pool_total: [],
  kardata_pg_pool_idle: [],
  kardata_pg_pool_waiting: [],
}

/** Guard constructor: unknown metrics or label names throw, so a new
 * high-cardinality label cannot slip past review. Exported for the
 * cardinality test. */
export function enforceLabelAllowlist(metric: string, labelNames: string[]): void {
  const allowed = METRIC_LABEL_ALLOW[metric]
  if (!allowed) throw new Error(`metric '${metric}' is not in the label allow-list`)
  for (const name of labelNames) {
    if (!allowed.includes(name)) {
      throw new Error(`label '${name}' is not allow-listed for metric '${metric}'`)
    }
  }
}

export interface HttpMetrics {
  registry: Registry
  requests: Counter<string>
  duration: Histogram<string>
  runsByState: Gauge<string>
  staleHeartbeats: Gauge<string>
  poolTotal: Gauge<string>
  poolIdle: Gauge<string>
  poolWaiting: Gauge<string>
}

/** HTTP RED pair on a fresh registry with process defaults. */
export function createHttpMetrics(): HttpMetrics {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })
  enforceLabelAllowlist('http_requests_total', ['method', 'route', 'status'])
  enforceLabelAllowlist('http_request_duration_seconds', ['method', 'route', 'status'])
  enforceLabelAllowlist('kardata_runs_by_state', ['state'])
  enforceLabelAllowlist('kardata_stale_heartbeats', [])
  enforceLabelAllowlist('kardata_pg_pool_total', [])
  enforceLabelAllowlist('kardata_pg_pool_idle', [])
  enforceLabelAllowlist('kardata_pg_pool_waiting', [])
  const requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests served by route pattern.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  })
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route pattern.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  })
  const runsByState = new Gauge({
    name: 'kardata_runs_by_state',
    help: 'Runs known to the gateway by workflow state.',
    labelNames: ['state'] as const,
    registers: [registry],
  })
  const staleHeartbeats = new Gauge({
    name: 'kardata_stale_heartbeats',
    help: 'Runs whose operation heartbeat is past the stall threshold.',
    registers: [registry],
  })
  const poolTotal = new Gauge({
    name: 'kardata_pg_pool_total',
    help: 'DB clients held across process pools.',
    registers: [registry],
  })
  const poolIdle = new Gauge({
    name: 'kardata_pg_pool_idle',
    help: 'Idle DB clients across process pools.',
    registers: [registry],
  })
  const poolWaiting = new Gauge({
    name: 'kardata_pg_pool_waiting',
    help: 'Requests queued waiting for a DB client.',
    registers: [registry],
  })
  return { registry, requests, duration, runsByState, staleHeartbeats, poolTotal, poolIdle, poolWaiting }
}

/** Refresh fleet gauges ahead of a scrape (B5.4). Best-effort: any failure
 * leaves the previous values, never fails the scrape. No pool or gateway
 * means no fleet signal — the gauges stay empty, not zero. */
export async function refreshFleetGauges(
  metrics: HttpMetrics,
  deps: { pool?: Db; runs?: RunsGateway; now?: number },
): Promise<void> {
  const now = deps.now ?? Date.now()
  try {
    if (deps.runs) {
      const counts = new Map<string, number>()
      for (const run of await deps.runs.listRuns()) {
        counts.set(run.state, (counts.get(run.state) ?? 0) + 1)
      }
      metrics.runsByState.reset()
      for (const [state, count] of counts) metrics.runsByState.set({ state }, count)
    }
    if (deps.pool) {
      let stale = 0
      for (const beat of await listHeartbeats(deps.pool)) {
        const limit = beat.busy
          ? DEFAULT_STALL_THRESHOLDS.inToolStaleMs
          : DEFAULT_STALL_THRESHOLDS.idleStaleMs
        if (now - beat.atMs > limit) stale += 1
      }
      metrics.staleHeartbeats.set(stale)
    }
    // Process-local factory registry: needs no pool handle, so pool
    // pressure reports even when the request has no Db.
    let total = 0
    let idle = 0
    let waiting = 0
    for (const stat of poolStats()) {
      total += stat.total
      idle += stat.idle
      waiting += stat.waiting
    }
    metrics.poolTotal.set(total)
    metrics.poolIdle.set(idle)
    metrics.poolWaiting.set(waiting)
  } catch {
    // Scrape-time failure: keep previous gauge values.
  }
}

/** Prometheus exposition for GET /metrics. */
export async function renderMetrics(registry: Registry): Promise<{ contentType: string; body: string }> {
  return {
    contentType: registry.contentType,
    body: await registry.metrics(),
  }
}

/** Temporal SDK metrics for the worker fleet (B5.2 wiring point). Pass to
 * `Runtime.install({ telemetryOptions: workerTelemetryOptions(port) })`
 * when the fleet entrypoint lands; Prometheus scrapes the port (the
 * compose `temporal` target stays commented until then). Pure builder so
 * it unit-tests without installing a global runtime. */
export function workerTelemetryOptions(metricsPort: number): TelemetryOptions['metrics'] {
  if (!Number.isInteger(metricsPort) || metricsPort < 1 || metricsPort > 65535) {
    throw new Error(`invalid metrics port ${metricsPort}`)
  }
  return {
    prometheus: { bindAddress: `0.0.0.0:${metricsPort}` },
  }
}
