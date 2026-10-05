// OpenTelemetry tracing (B5.2). OTel API + SDK with W3C-compatible trace
// ids: our ingress `trace_id` (32 lowercase hex) is a valid OTel trace id,
// so request spans join the B5.1 access lines with zero mapping.
//
// Export is JSONL through the app pino logger (one line per span), which
// Promtail ships to Loki with the same pipeline as logs — no collector or
// Tempo on staging. The OTLP upgrade keeps every call site: only the span
// processor changes.
//
// Implicit parenting rides a small AsyncLocalStorage (no OTel context
// manager dependency): the Fastify hook enters the request span context,
// `wrapPool` parents pg spans to whatever is current, and tests/assets use
// `withSpanContext` explicitly. Never pass raw SQL, headers, or bodies as
// attributes — names and verbs are bounded, values stay counters/ids.
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type SpanContext,
  type Tracer,
} from '@opentelemetry/api'
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type { Logger } from 'pino'
import type { Db, DbQueryResult } from '../db/index.js'

export const TRACER_NAME = 'kardata-backend'

const als = new AsyncLocalStorage<SpanContext>()

/** Run `fn` with `ctx` as the implicit span parent. */
export function withSpanContext<T>(ctx: SpanContext, fn: () => T): T {
  return als.run(ctx, fn)
}

/** Enter `ctx` for the current execution chain (Fastify hook pattern). */
export function enterSpanContext(ctx: SpanContext): void {
  als.enterWith(ctx)
}

export function clearSpanContext(): void {
  als.enterWith(undefined as unknown as SpanContext)
}

function currentSpanContext(): SpanContext | undefined {
  return als.getStore()
}

/** Ambient request trace id from our ALS (the Fastify hook enters it). */
export function currentTraceId(): string | undefined {
  return currentSpanContext()?.traceId
}

/** Adopt an ingress trace: same trace_id, remote parent when one arrived. */
export function spanContextFromTrace(traceId: string, parentSpanId?: string): SpanContext {
  return {
    traceId,
    spanId: parentSpanId ?? randomBytes(8).toString('hex'),
    traceFlags: 1,
    isRemote: true,
  }
}

function contextWithParent(parent: SpanContext): Context {
  return trace.setSpanContext(ROOT_CONTEXT, parent)
}

export interface StartSpanOptions {
  kind?: SpanKind
  attributes?: Record<string, string | number | boolean>
}

/** Start a span parented to `parent` (explicit), falling back to the
 * implicit ALS parent, falling back to a fresh trace. */
export function startSpan(
  tracer: Tracer,
  name: string,
  parent?: SpanContext,
  options: StartSpanOptions = {},
): Span {
  const resolved = parent ?? currentSpanContext()
  const span = tracer.startSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    resolved ? contextWithParent(resolved) : undefined,
  )
  return span
}

interface SpanLine {
  op: 'otel.span'
  service: string
  trace_id: string
  span_id: string
  parent_span_id?: string
  name: string
  kind: string
  status: string
  attributes: Record<string, string | number | boolean>
  durationMs: number
}

/** pg spans (B5.2). Patches `db.query` in place: every query gets a
 * CLIENT span parented to the implicit context (the request span inside
 * HTTP handlers). Attributes are the engine and the SQL verb only — raw
 * SQL never becomes an attribute. Returns the same handle. Typed against
 * the layer Db so tracing never imports the driver. */
export function wrapPool<T extends Db>(db: T): T {
  const original = db.query.bind(db)
  const wrapped = async <TRow>(text: string, params?: unknown[]): Promise<DbQueryResult<TRow>> => {
    const verb = (/^\s*(\w+)/.exec(text)?.[1] ?? 'unknown').toUpperCase()
    const tracer = trace.getTracer(TRACER_NAME)
    const span = startSpan(tracer, 'db.query', undefined, {
      kind: SpanKind.CLIENT,
      attributes: { 'db.system': 'postgresql', 'db.operation': verb },
    })
    try {
      const result = await original<TRow>(text, params)
      if (typeof result.rowCount === 'number') span.setAttribute('db.rows', result.rowCount)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        // PG errors can echo private bound values. The original error
        // remains available to the caller, never copied into public spans.
        message: 'query failed',
      })
      throw error
    } finally {
      span.end()
    }
  }
  db.query = wrapped as T['query']
  return db
}

/** JSONL span exporter: one pino line per span. Shared by the server
 * provider and the Temporal workflow-span sink so both emit one shape. */
function createJsonlSpanExporter(logger: Logger, serviceName: string): SpanExporter {
  return {
    export: (spans: ReadableSpan[], resultCallback) => {
      for (const span of spans) {
        const ctx = span.spanContext()
        const parent = span.parentSpanContext
        const duration = Math.round(span.duration[0] * 1000 + span.duration[1] / 1_000_000)
        const line: SpanLine = {
          op: 'otel.span',
          service: serviceName,
          trace_id: ctx.traceId,
          span_id: ctx.spanId,
          ...(parent ? { parent_span_id: parent.spanId } : {}),
          name: span.name,
          kind: SpanKind[span.kind] ?? String(span.kind),
          status:
            span.status.code === SpanStatusCode.ERROR
              ? `error: ${span.status.message ?? ''}`
              : 'ok',
          attributes: {
            ...(span.attributes as Record<string, string | number | boolean>),
          },
          durationMs: duration,
        }
        logger.info(line)
      }
      resultCallback({ code: 0 as const })
    },
    shutdown: () => Promise.resolve(),
  }
}

export function createJsonlSpanProcessor(logger: Logger, serviceName: string): SpanProcessor {
  return new SimpleSpanProcessor(createJsonlSpanExporter(logger, serviceName))
}

/** JSONL exporter: one pino line per span. The global tracer stays
 * provider-less (valid non-recording spans) until `ensureTracing` runs. */
export function ensureTracing(options: {
  logger?: Logger
  serviceName?: string
}): { tracer: Tracer; shutdown: () => Promise<void> } {
  const service = options.serviceName ?? 'kardata-backend'
  const processors =
    options.logger === undefined
      ? []
      : [createJsonlSpanProcessor(options.logger, service)]
  const provider = new BasicTracerProvider({ spanProcessors: processors })
  trace.setGlobalTracerProvider(provider)
  const tracer = trace.getTracer(TRACER_NAME)
  return { tracer, shutdown: () => provider.shutdown() }
}
