// Per-request observability (B5.1 access log, B5.2 spans + metrics). One
// onResponse hook emits three consistent records: the OTel request span
// (parented to the ingress traceparent), the pino access line, and the
// Prometheus RED pair. Span names use the route pattern (set when routing
// resolves); pg spans parent implicitly through the ALS context entered
// here. Redaction mirrors the access log: patterns, never query strings,
// headers, or bodies.
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import type { Span } from '@opentelemetry/api'
import type { HttpMetrics } from './metrics.js'
import {
  TRACER_NAME,
  clearSpanContext,
  enterSpanContext,
  spanContextFromTrace,
} from './tracing.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Stashed by authorize(): who called, for the tenant join key. */
    kardataCaller?: { keyId: string; tenantId?: string }
    /** Request span, opened pre-routing and named once the pattern resolves. */
    kardataSpan?: Span
  }
}

export interface RequestObservability {
  logger?: Logger
  metrics?: HttpMetrics
}

export function registerRequestLogging(app: FastifyInstance, deps: RequestObservability): void {
  app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
    const tracer = trace.getTracer(TRACER_NAME)
    const traceId = request.traceContext?.traceId
    // Adopt the ingress trace (or the minted one): the span always carries
    // the same trace_id as the access line, so logs join spans with no map.
    const parent = traceId
      ? trace.setSpanContext(
          ROOT_CONTEXT,
          spanContextFromTrace(traceId, request.traceContext?.parentSpanId),
        )
      : undefined
    const span = tracer.startSpan(`http ${request.method}`, { kind: SpanKind.SERVER }, parent)
    request.kardataSpan = span
    if (traceId) enterSpanContext(spanContextFromTrace(traceId, span.spanContext().spanId))
    done()
  })

  app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const status = reply.statusCode
    const route = request.kardataBrowserProxy ? 'browser.proxy' : request.routeOptions?.url ?? request.url.split('?')[0]
    // Metric labels stay bounded: unmatched paths collapse to one bucket.
    const metricRoute = request.kardataBrowserProxy ? 'browser.proxy' : request.routeOptions?.url ?? '*unmatched*'
    const latencyMs = Math.round(reply.elapsedTime)
    const tenant = request.kardataCaller?.tenantId

    const span = request.kardataSpan
    if (span) {
      span.updateName(`http ${request.method} ${route}`)
      span.setAttributes({
        'http.method': request.method,
        'http.route': route,
        'http.status_code': status,
        ...(tenant ? { tenant } : {}),
      })
      span.setStatus(
        status >= 500 ? { code: SpanStatusCode.ERROR } : { code: SpanStatusCode.UNSET },
      )
      span.end()
      request.kardataSpan = undefined
    }
    clearSpanContext()

    if (deps.logger) {
      const fields = {
        op: 'http.request',
        method: request.method,
        route,
        status,
        latencyMs,
        trace_id: request.traceContext?.traceId,
        ...(tenant ? { tenant } : {}),
      }
      if (status >= 500) deps.logger.error(fields)
      else if (status >= 400) deps.logger.warn(fields)
      else deps.logger.info(fields)
    }

    if (deps.metrics) {
      // Labels stay bounded: method from a fixed set, route pattern (never
      // concrete ids), numeric status as string.
      const labels = { method: request.method, route: metricRoute, status: String(status) }
      deps.metrics.requests.inc(labels)
      deps.metrics.duration.observe(labels, reply.elapsedTime / 1000)
    }
    done()
  })
}
