// Temporal OTel wiring (P3.2). Installs the
// @temporalio/interceptors-opentelemetry interceptors plus the OTel context
// manager and W3C propagator they need: without a manager the async activity
// loses its context at the first await, and without a propagator the
// _tracer-data header carries nothing (both OTel globals default to noop).
// One module so the gateway, the worker factory, the entries, and tests
// share the same wiring. The workflow-span sink is mandatory: the
// workflowModules interceptor calls it on every span end, and a missing
// sink fails workflow tasks.
import { context, propagation, trace, type SpanContext } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import type { WorkflowClientInterceptor } from '@temporalio/client'
import {
  OpenTelemetryActivityInboundInterceptor,
  OpenTelemetryActivityOutboundInterceptor,
  OpenTelemetryWorkflowClientInterceptor,
  makeWorkflowExporter,
} from '@temporalio/interceptors-opentelemetry'
import type { ActivityInterceptorsFactory } from '@temporalio/worker'
import { Context } from '@temporalio/activity'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Logger } from 'pino'
import { childLogger, logOp, type LogContext } from './logging.js'
import { injectTraceparent, newTraceId } from './trace.js'
import { createJsonlSpanProcessor, currentTraceId } from './tracing.js'

const INVALID_TRACE_ID = '0'.repeat(32)

let installed = false

/** Register the OTel context manager + W3C propagator once per process.
 * Server and worker entries call this; tests that assert trace continuity
 * call it in setup. Safe to repeat. */
export function ensureTemporalTracing(): void {
  if (installed) return
  installed = true
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
}

/** Client interceptors for every Temporal `new Client`. */
export function temporalClientInterceptors(): WorkflowClientInterceptor[] {
  return [new OpenTelemetryWorkflowClientInterceptor()]
}

/** Activity interceptor factories for `Worker.create`. */
export function temporalActivityInterceptorFactories(): ActivityInterceptorsFactory[] {
  return [
    (ctx) => ({
      inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
      outbound: new OpenTelemetryActivityOutboundInterceptor(ctx),
    }),
  ]
}

const nodeRequire = createRequire(import.meta.url)

/** Workflow interceptor module for `Worker.create({ workflowModules })`. */
export function temporalWorkflowModules(): string[] {
  return [nodeRequire.resolve('@temporalio/interceptors-opentelemetry/lib/workflow-interceptors')]
}

type WorkflowSpanProcessor = Parameters<typeof makeWorkflowExporter>[0]
type WorkflowExporterResource = Parameters<typeof makeWorkflowExporter>[1]

/** Workflow-span sink: workflow execution spans export as JSONL like the
 * server's, so one trace_id joins HTTP, workflow, and activity spans. */
export function temporalWorkflowExportSinks(logger: Logger, serviceName: string) {
  // v1/v2 bridge: the interceptor ships its own sdk-trace-base@1 types, but
  // at runtime it only attaches the resource and duck-reads spans through
  // onEnd, both of which the v2 objects satisfy.
  const processor = createJsonlSpanProcessor(logger, serviceName) as unknown as WorkflowSpanProcessor
  const resource = resourceFromAttributes({ 'service.name': serviceName }) as unknown as WorkflowExporterResource
  return {
    exporter: makeWorkflowExporter(processor, resource),
  }
}

/** Run `fn` with an OTel context carrying `traceId` (client-side injection). */
export function withTraceContext<T>(traceId: string, fn: () => T): T {
  const spanContext: SpanContext = {
    traceId,
    spanId: randomBytes(8).toString('hex'),
    traceFlags: 1,
    isRemote: true,
  }
  return context.with(trace.setSpanContext(context.active(), spanContext), fn)
}

/** Ambient OTel trace id, when a real one is active. */
export function activeTraceId(): string | undefined {
  const id = trace.getSpanContext(context.active())?.traceId
  return id !== undefined && id !== INVALID_TRACE_ID ? id : undefined
}

/** Outgoing W3C traceparent for worker→server calls, from the ambient
 * activity trace. Undefined outside a traced context: callers then send
 * no header and the server mints its own trace (never an orphan id). */
export function ambientTraceparent(): string | undefined {
  const traceId = activeTraceId()
  return traceId === undefined ? undefined : injectTraceparent({ traceId })
}

/** Wrap a workflow start so the client interceptor injects a trace: the
 * ambient OTel trace (activities), else the request trace from our ALS
 * (routes and MCP tools), else a fresh id (background starters). */
export function withAmbientTrace<T>(fn: () => T): T {
  return withTraceContext(activeTraceId() ?? currentTraceId() ?? newTraceId(), fn)
}

export interface ActivityIds {
  threadKey?: string
  sessionId?: string
  sectorId?: string
  round?: number
  runId?: string
  attempt?: number
}

/** Temporal activity identity when running inside a worker; empty on direct
 * unit-test calls (the recordSpend try/catch pattern in context-files). */
export function temporalActivityInfo(): { runId?: string; attempt?: number } {
  try {
    const info = Context.current().info
    return {
      ...(info.workflowExecution?.workflowId ? { runId: info.workflowExecution.workflowId } : {}),
      attempt: info.attempt,
    }
  } catch {
    return {}
  }
}

function resolvedActivityIds(ids: ActivityIds = {}): ActivityIds {
  const info = temporalActivityInfo()
  return {
    threadKey: ids.threadKey,
    sessionId: ids.sessionId,
    sectorId: ids.sectorId,
    round: ids.round,
    runId: ids.runId ?? info.runId,
    attempt: ids.attempt ?? info.attempt,
  }
}

/** Join keys for `createLogger`/`childLogger`: ambient trace plus activity
 * identity. Unknown keys stay absent; in production every activity line
 * carries trace_id, run_id, attempt, and the ids its input knows. */
export function activityLogContext(ids: ActivityIds = {}): LogContext {
  const traceId = activeTraceId()
  const resolved = resolvedActivityIds(ids)
  return {
    ...(traceId ? { traceId } : {}),
    ...(resolved.runId ? { runId: resolved.runId } : {}),
    ...(resolved.attempt !== undefined ? { attempt: resolved.attempt } : {}),
    ...(resolved.threadKey ? { threadKey: resolved.threadKey } : {}),
    ...(resolved.sessionId ? { sessionId: resolved.sessionId } : {}),
    ...(resolved.sectorId ? { sectorId: resolved.sectorId } : {}),
    ...(resolved.round !== undefined ? { round: resolved.round } : {}),
  }
}

/** Same keys in snake_case for `logOp` extras and `context.log` lines. */
export function activityLogFields(ids: ActivityIds = {}): Record<string, unknown> {
  const traceId = activeTraceId()
  const resolved = resolvedActivityIds(ids)
  return {
    ...(traceId ? { trace_id: traceId } : {}),
    ...(resolved.runId ? { run_id: resolved.runId } : {}),
    ...(resolved.attempt !== undefined ? { attempt: resolved.attempt } : {}),
    ...(resolved.threadKey ? { thread_key: resolved.threadKey } : {}),
    ...(resolved.sessionId ? { session_id: resolved.sessionId } : {}),
    ...(resolved.sectorId ? { sector_id: resolved.sectorId } : {}),
    ...(resolved.round !== undefined ? { round: resolved.round } : {}),
  }
}

/** Lifecycle triple for every registered activity (P3.3): start, done and
 * error via logOp with the activity join keys. Applied once in
 * createLaneWorker, so no activity file needs its own wrapper. The keys
 * resolve at call time, inside activity context. */
export function withActivityLogging(
  logger: Logger,
  activities: Record<string, (...args: never[]) => unknown>,
): Record<string, (...args: never[]) => unknown> {
  const wrapped: Record<string, (...args: never[]) => unknown> = {}
  for (const [name, fn] of Object.entries(activities)) {
    wrapped[name] = (...args: never[]) =>
      logOp(childLogger(logger, activityLogContext()), `activity.${name}`, () => Promise.resolve(fn(...args)), { activity: name })
  }
  return wrapped
}
