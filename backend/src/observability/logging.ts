// B0.5 logging contract. Every log line is JSON with join keys
// (trace_id, run_id, op, attempt, tenant) so logs join to traces and events.
// Secret scrubbing is fail-closed: keys matching the sensitive pattern are
// redacted even when the exact field name was never allow-listed.
import { createHash } from 'node:crypto'
import { DefaultLogger, type LogEntry, type Logger as TemporalLogger, type LogLevel, type TelemetryOptions } from '@temporalio/worker'
import pino, { type Logger } from 'pino'

export interface LogContext {
  traceId?: string
  runId?: string
  op?: string
  attempt?: number
  tenant?: string
}

// Fail-closed pattern: any key containing one of these fragments (case
// insensitive, with or without separators) is a secret. Bare `key` alone is
// NOT matched: identifiers like thread keys and idempotency keys are
// legitimate log content.
const SENSITIVE_KEY = /api[_-]?key|secret|passwd|password|token|auth|bearer|credential|private[_-]?key|session[_-]?key/i
const REDACTED = '[Redacted]'
const TOKEN_COUNTER = /^(input_?tokens|output_?tokens|cache_?read_?tokens|cache_?write_?tokens|cache_?hit_?tokens|cache_?miss_?tokens|cached_?tokens|total_?tokens|token_?budget|token_?cap)$/i

/** Native Core defaults to its own console, independently of the JS logger.
 * Forward through this owned boundary while preserving SDK's default levels. */
export function workerLoggingOptions(): TelemetryOptions['logging'] {
  return { filter: { core: 'WARN',other: 'ERROR' },forward: {} }
}

/** Core error fields may be Rust-formatted strings, not Error instances.
 * Keep diagnostics/correlation, never native exception bodies or raw entries. */
function nativeDiagnostic(entry: LogEntry): { fields: Record<string,unknown>; message: string } {
  const meta=entry.meta ?? {}
  const fields: Record<string,unknown>={ sdkComponent: 'core',event: 'temporal.native',messageHash: createHash('sha256').update(entry.message).digest('hex') }
  for (const key of ['target','run_id','workflow_id','workflowId','runId','namespace','task_queue','taskQueue','activity_id','activityId','activity_type','activityType']) {
    const value=meta[key]
    if (typeof value==='string' && value.length<=512) fields[key]=value
  }
  for (const key of ['attempt','durationMs','duration_ms','latencyMs']) {
    const value=meta[key]
    if (typeof value==='number' && Number.isFinite(value) && value>=0) fields[key]=value
  }
  return { fields,message: 'Temporal native diagnostic' }
}

export function scrubSecrets<T>(value: T): T {
  const ancestors = new WeakSet<object>()
  const scrub = (entry: unknown): unknown => {
    if (typeof entry !== 'object' || entry === null) return entry
    if (entry instanceof Error) return { name: entry.name, ...('code' in entry && typeof entry.code === 'string' ? { code: entry.code } : {}) }
    if (ancestors.has(entry)) return '[Circular]'
    ancestors.add(entry)
    try {
      if (Array.isArray(entry)) return entry.map(scrub)
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      for (const [field, child] of Object.entries(entry)) {
        const counter = TOKEN_COUNTER.test(field) && typeof child === 'number' && Number.isSafeInteger(child) && child >= 0
        out[field] = SENSITIVE_KEY.test(field) && !counter ? REDACTED : scrub(child)
      }
      return out
    } finally { ancestors.delete(entry) }
  }
  return scrub(value) as T
}

export function createLogger(context: LogContext = {}, destination?: pino.DestinationStream): Logger {
  return pino(
    {
      formatters: {
        log: (object) => scrubSecrets(object) as Record<string, unknown>,
      },
      base: {
        ...(context.traceId ? { trace_id: context.traceId } : {}),
        ...(context.runId ? { run_id: context.runId } : {}),
        ...(context.op ? { op: context.op } : {}),
        ...(context.attempt !== undefined ? { attempt: context.attempt } : {}),
        ...(context.tenant ? { tenant: context.tenant } : {}),
      },
    },
    destination,
  )
}

export function childLogger(parent: Logger, context: LogContext): Logger {
  return parent.child({
    ...(context.traceId ? { trace_id: context.traceId } : {}),
    ...(context.runId ? { run_id: context.runId } : {}),
    ...(context.op ? { op: context.op } : {}),
    ...(context.attempt !== undefined ? { attempt: context.attempt } : {}),
    ...(context.tenant ? { tenant: context.tenant } : {}),
  })
}

/** Long-operation triple: wraps async work with start/done/error lines that
 * carry the logger's join keys plus op, latencyMs, and outcome. Every
 * cross-module call and long-running operation must go through this (or an
 * equivalent boundary log) so a stall or failure always leaves evidence.
 * Errors are logged with their code and rethrown, never swallowed. */
export async function logOp<T>(
  logger: Logger,
  op: string,
  work: () => Promise<T>,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const start = Date.now()
  logger.info({ event: `${op}.start`, op, ...extra })
  try {
    const result = await work()
    logger.info({ event: `${op}.done`, op, outcome: 'ok', latencyMs: Date.now() - start, ...extra })
    return result
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : error instanceof Error ? error.constructor.name : 'unknown'
    logger.error({
      event: `${op}.error`,
      op,
      outcome: 'error',
      code,
      latencyMs: Date.now() - start,
      ...extra,
    })
    throw error
  }
}

/** Temporal worker logger that emits pino JSON (B5.1). Worker, activity,
 * and workflow-signal logs flow through one JSON shape so Promtail parses
 * them with the same pipeline as HTTP logs; the workflow interceptor
 * already attaches workflow/run ids to signal lines. Pass to
 * `Worker.create({ logger: createWorkerLogger() })` when the worker fleet
 * lands. Secret scrubbing is the shared pino formatter — fail-closed. */
export function createWorkerLogger(
  level: LogLevel = 'INFO',
  destination?: pino.DestinationStream,
): TemporalLogger {
  const base = createLogger({ op: 'temporal' }, destination)
  const sink = (entry: LogEntry): void => {
    // pino owns the timestamp: the nanos field would not survive JSON.
    const native=entry.meta?.['sdkComponent']==='core' || entry.message.startsWith('Error converting native log entry:') ? nativeDiagnostic(entry) : undefined
    const fields = native?.fields ?? { ...(entry.meta ?? {}) }
    const message=native?.message ?? entry.message
    switch (entry.level) {
      case 'TRACE':
      case 'DEBUG':
        base.debug(fields, message)
        break
      case 'WARN':
        base.warn(fields, message)
        break
      case 'ERROR':
        base.error(fields, message)
        break
      default:
        base.info(fields, message)
    }
  }
  return new DefaultLogger(level, sink)
}
