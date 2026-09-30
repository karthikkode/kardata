// B0.5 logging contract. Every log line is JSON with join keys
// (trace_id, run_id, op, attempt, tenant) so logs join to traces and events.
// Secret scrubbing is fail-closed: keys matching the sensitive pattern are
// redacted even when the exact field name was never allow-listed.
import { DefaultLogger, type LogEntry, type Logger as TemporalLogger, type LogLevel } from '@temporalio/worker'
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

export function scrubSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => scrubSecrets(entry)) as T
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [field, entry] of Object.entries(value)) {
      out[field] = SENSITIVE_KEY.test(field) ? REDACTED : scrubSecrets(entry)
    }
    return out as T
  }
  return value
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
    const fields = { ...(entry.meta ?? {}) }
    switch (entry.level) {
      case 'TRACE':
      case 'DEBUG':
        base.debug(fields, entry.message)
        break
      case 'WARN':
        base.warn(fields, entry.message)
        break
      case 'ERROR':
        base.error(fields, entry.message)
        break
      default:
        base.info(fields, entry.message)
    }
  }
  return new DefaultLogger(level, sink)
}
