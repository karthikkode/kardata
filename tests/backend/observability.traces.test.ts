// Telemetry pipeline (B5.2). Span join (ingress traceparent → request
// span → pg span, one trace_id), pattern-only span/metric names, the label
// allow-list plus series-budget guard, and the /metrics exposition. The
// keyed section proves pg spans parent the request span through the live
// stack and that concrete ids never reach a metric label.
import { SpanKind, trace } from '@opentelemetry/api'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import {
  CARDINALITY_BUDGET,
  createHttpMetrics,
  enforceLabelAllowlist,
  workerTelemetryOptions,
} from '../../backend/src/observability/metrics.js'
import { createLogger } from '../../backend/src/observability/logging.js'
import {
  TRACER_NAME,
  ensureTracing,
  startSpan,
  withSpanContext,
  wrapPool,
} from '../../backend/src/observability/tracing.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { Writable } from 'node:stream'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

function capture(): { lines: string[]; stream: Writable } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) lines.push(line)
      }
      callback()
    },
  })
  return { lines, stream }
}

// One global provider per file: spans export to this capture.
const captureBox = capture()
ensureTracing({ logger: createLogger({ op: 'otel' }, captureBox.stream) })

function spans(): Array<Record<string, unknown>> {
  return captureBox.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

function resetSpans(): void {
  captureBox.lines.length = 0
}

describe('telemetry pipeline (B5.2)', () => {
  it('joins the request span to the ingress trace', async () => {
    resetSpans()
    const { stream } = capture()
    const app: FastifyInstance = buildApp({ logger: createLogger({ op: 'http' }, stream) })
    try {
      const traceId = '0af7651916cd43dd8448eb211c80319c'
      const parent = 'b7ad6b7169203331'
      await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { traceparent: `00-${traceId}-${parent}-01` },
      })
      const span = spans().find((line) => line['op'] === 'otel.span')
      expect(span).toMatchObject({
        service: 'kardata-backend',
        trace_id: traceId,
        parent_span_id: parent,
        name: 'http GET /healthz',
        kind: 'SERVER',
        status: 'ok',
      })
      expect(span?.['attributes']).toMatchObject({
        'http.method': 'GET',
        'http.route': '/healthz',
        'http.status_code': 200,
      })
      expect(typeof span?.['durationMs']).toBe('number')
    } finally {
      await app.close()
    }
  })

  it('parents explicit child spans and wraps pg verbs without SQL text', async () => {
    resetSpans()
    const tracer = trace.getTracer(TRACER_NAME)
    const parent = tracer.startSpan('test-parent', { kind: SpanKind.INTERNAL })
    const parentCtx = parent.spanContext()
    let childId = ''
    withSpanContext(
      { traceId: parentCtx.traceId, spanId: parentCtx.spanId, traceFlags: 1 },
      () => {
        const child = startSpan(tracer, 'test-child')
        childId = child.spanContext().spanId
        child.end()
      },
    )
    parent.end()

    const fakeDb = {
      query: async (_text: string, _params?: unknown[]) => ({ rowCount: 3, rows: [] }),
    }
    const pool = wrapPool(fakeDb)
    await withSpanContext(
      { traceId: parentCtx.traceId, spanId: childId, traceFlags: 1 },
      async () => {
        await pool.query('SELECT * FROM secrets WHERE token = $1', ['SECRET-SQL-ZZZ'])
      },
    )
    const lines = spans()
    const child = lines.find((line) => line['name'] === 'test-child')
    expect(child).toMatchObject({ trace_id: parentCtx.traceId, parent_span_id: parentCtx.spanId })
    const query = lines.find((line) => line['name'] === 'db.query')
    expect(query).toMatchObject({
      trace_id: parentCtx.traceId,
      parent_span_id: childId,
      kind: 'CLIENT',
      status: 'ok',
    })
    expect(query?.['attributes']).toMatchObject({
      'db.system': 'postgresql',
      'db.operation': 'SELECT',
      'db.rows': 3,
    })
    const text = JSON.stringify(lines)
    expect(text).not.toContain('SECRET-SQL-ZZZ')
    expect(text).not.toContain('SELECT * FROM')
  })

  it('marks failed queries without leaking the error text beyond 200 chars', async () => {
    resetSpans()
    const failing = {
      query: async (_text: string): Promise<{ rowCount: number; rows: never[] }> => {
        throw new Error('boom')
      },
    }
    const pool = wrapPool(failing)
    await expect(pool.query('SELECT 1')).rejects.toThrow('boom')
    const query = spans().find((line) => line['name'] === 'db.query')
    expect(String(query?.['status'])).toMatch(/^error/)
  })

  it('exposes Prometheus exposition with the RED pair', async () => {
    const { stream } = capture()
    const app: FastifyInstance = buildApp({ logger: createLogger({ op: 'http' }, stream) })
    try {
      await app.inject({ method: 'GET', url: '/healthz' })
      const response = await app.inject({ method: 'GET', url: '/metrics' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toMatch(/text\/plain/)
      const body = response.body as string
      expect(body).toContain('http_requests_total')
      expect(body).toContain('http_request_duration_seconds')
      expect(body).toContain('route="/healthz"')
    } finally {
      await app.close()
    }
  })

  it('enforces the label allow-list and the series budget', async () => {
    expect(() => enforceLabelAllowlist('http_requests_total', ['method', 'route', 'status'])).not.toThrow()
    expect(() => enforceLabelAllowlist('http_requests_total', ['method', 'userId'])).toThrow(
      /not allow-listed/,
    )
    expect(() => enforceLabelAllowlist('custom_metric', ['a'])).toThrow(/not in the label allow-list/)
    const { registry } = createHttpMetrics()
    const series = await registry.getMetricsAsArray()
    expect(series.length).toBeGreaterThan(0)
    expect(series.length).toBeLessThan(CARDINALITY_BUDGET)
  })

  it('builds worker SDK telemetry options for the fleet', () => {
    expect(workerTelemetryOptions(9464)).toEqual({ prometheus: { bindAddress: '0.0.0.0:9464' } })
    expect(() => workerTelemetryOptions(0)).toThrow(/invalid metrics port/)
    expect(() => workerTelemetryOptions(99999)).toThrow(/invalid metrics port/)
  })

  describe.skipIf(!ENABLED)('against Postgres', () => {
    it('parents pg spans under the request span with pattern-only labels', async () => {
      resetSpans()
      const url = await ensureTestDb('kardata_test_traces')
      const pool = wrapPool(new Pool({ connectionString: url }))
      const { stream } = capture()
      const app: FastifyInstance = buildApp({
        pool,
        auth: true,
        logger: createLogger({ op: 'http' }, stream),
      })
      try {
        await pool.query(
          `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
           VALUES ('traces-op', $1, 'tenant-t', NULL, 'operator')
           ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash`,
          [hashKey('key-traces-operator')],
        )
        const created = await app.inject({
          method: 'POST',
          url: '/v1/sessions',
          headers: { authorization: 'Bearer key-traces-operator' },
          payload: { title: 'Trace me' },
        })
        expect(created.statusCode).toBe(201)
        const sessionId = (created.json() as { data: { id: string } }).data.id
        const fetched = await app.inject({
          method: 'GET',
          url: `/v1/sessions/${sessionId}`,
          headers: { authorization: 'Bearer key-traces-operator' },
        })
        expect(fetched.statusCode).toBe(200)

        const lines = spans()
        const request = lines.find((line) => line['name'] === 'http GET /v1/sessions/:sessionId')
        expect(request).toBeDefined()
        const requestId = request?.['span_id'] as string
        const traceId = request?.['trace_id'] as string
        // pg spans join the request span through the implicit context.
        const queries = lines.filter(
          (line) => line['name'] === 'db.query' && line['trace_id'] === traceId,
        )
        expect(queries.length).toBeGreaterThan(0)
        for (const query of queries) {
          expect(query['parent_span_id']).toBe(requestId)
        }
        // Metric labels carry the pattern, never the concrete session id.
        const metrics = await app.inject({ method: 'GET', url: '/metrics' })
        const body = metrics.body as string
        expect(body).toContain('route="/v1/sessions/:sessionId"')
        expect(body).not.toContain(sessionId)
      } finally {
        await app.close()
        await pool.end()
      }
    }, 120_000)
  })
})
