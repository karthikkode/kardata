import { createHash } from 'node:crypto'
import { recordThreadFileExposure } from '../../db/context-files.js'
import { getSession, type TransactableDb } from '../../db/index.js'
// Plan/task tool activities (B4.2). `toolCallActivity` executes one
// agents plan/task tool call with approval gates, timeouts, and durable
// idempotency — the pure core (`executeToolCall`) takes its side effects
// as deps so the matrix is unit-provable without a Temporal worker.
//
// State discipline: workers hold no plan/task state (AGENTS.md). The
// workflow carries snapshots in history; the activity rehydrates fresh
// stores per call and returns updated snapshots. Exactly-once is durable:
// the outcome is recorded under the caller's idempotency key as
// `t.tool.executed` (result plus snapshots), so a retry replays the row
// instead of re-executing.
//
// Recording contract per attempt:
//   - every attempt records `t.tool.executed` (deterministic replay);
//   - timeouts additionally record `t.tool.timeout` (the finding; the
//     error result is the recorded response — never silent);
//   - sensitive tools without an approving verdict record
//     `t.approval.decided` (denied) and never execute.
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { Context } from '@temporalio/activity'
import { TRACER_NAME, startSpan } from '../../observability/tracing.js'
import { activityLogFields } from '../../observability/temporal-tracing.js'
import {
  PlanStore,
  TaskLedger,
  ToolRegistry,
  dispatch,
  planTools,
  systemClock,
  taskTools,
  type ApprovalVerdict,
  type PlanSnapshot,
  type ToolCallRequest,
  type ToolRegistration,
  type ToolResult,
} from '@kardata/agents'
import { resolveArchiveTarget, type ArchiveTarget } from '../../archive/targets.js'
import {
  CorruptArtifactError,
  UnindexedArtifactError,
  serveArtifact,
} from '../../artifacts/pipeline.js'
import { appendEvent, findEventByKey, resolveArtifactScope, type Db } from '../../db/index.js'
import { recordHeartbeat } from '../../db/index.js'
import { workerPoolFromEnv } from '../../db/index.js'

export const TOOL_EXECUTED_EVENT = 't.tool.executed'
export const TOOL_TIMEOUT_EVENT = 't.tool.timeout'
export const TOOL_APPROVAL_EVENT = 't.approval.decided'

/** Mutating plan/task tools pause for an upstream approval verdict.
// Reads (plan.list) and routine progress notes execute freely. */
export const SENSITIVE_TOOLS: ReadonlySet<string> = new Set([
  'plan.create',
  'plan.update',
  'task.submit',
])

export interface TaskSnapshot {
  checkpoints: Array<{ note: string }>
  clarifications: Array<{ question: string }>
  blockers: Array<{ reason: string }>
  submissions: Array<{ summary: string; detail?: string }>
  failures: Array<{ reason: string }>
}

export function emptyTaskSnapshot(): TaskSnapshot {
  return { checkpoints: [], clarifications: [], blockers: [], submissions: [], failures: [] }
}

function rehydrateTasks(snapshot: TaskSnapshot | undefined): TaskLedger {
  const ledger = new TaskLedger()
  if (!snapshot) return ledger
  const arrays: Array<'checkpoints' | 'clarifications' | 'blockers' | 'submissions' | 'failures'> = [
    'checkpoints',
    'clarifications',
    'blockers',
    'submissions',
    'failures',
  ]
  for (const field of arrays) {
    const entries: unknown = snapshot[field]
    if (Array.isArray(entries)) {
      const target = ledger[field] as unknown as Array<Record<string, unknown>>
      for (const entry of entries) {
        target.push({ ...((entry as Record<string, unknown>) ?? {}) })
      }
    }
  }
  return ledger
}

function snapshotTasks(ledger: TaskLedger): TaskSnapshot {
  const copy = <T>(entries: T[]): T[] => entries.map((entry) => ({ ...entry }) as T)
  return {
    checkpoints: copy(ledger.checkpoints),
    clarifications: copy(ledger.clarifications),
    blockers: copy(ledger.blockers),
    submissions: copy(ledger.submissions),
    failures: copy(ledger.failures),
  }
}

export interface ApprovalInput {
  verdict: 'approve' | 'reject' | 'edit'
  reason?: string
  args?: Record<string, unknown>
}

export interface ToolCallInput {
  sessionId: string
  idempotencyKey: string
  call: ToolCallRequest
  plan?: PlanSnapshot
  tasks?: TaskSnapshot
  approval?: ApprovalInput
  timeoutMs?: number
  /** Test-only extra registrations (e.g. a hanging tool for the timeout
   * proof). Never set in production. */
  extraTools?: ToolRegistration[]
}

export interface ToolCallResult {
  result: ToolResult
  plan: PlanSnapshot
  tasks: TaskSnapshot
}

export interface RecordedToolCall {
  result: ToolResult
  plan: PlanSnapshot
  tasks: TaskSnapshot
}

export interface ToolCallDeps {
  log(fields: {
    op: 'tool.call'
    tool: string
    ok: boolean
    latencyMs: number
    timedOut?: boolean
    blocked?: boolean
  }): void
  findRecorded(idempotencyKey: string): Promise<RecordedToolCall | undefined>
  record(input: {
    idempotencyKey: string
    partition: string
    type: string
    payload: Record<string, unknown>
  }): Promise<void>
  /** Archive access for the artifact.read tool. Absent in hermetic unit
   * deps, where the tool answers "unavailable" instead of touching disk. */
  artifacts?: {
    db: Db
    target: ArchiveTarget
  }
}

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000

function toVerdict(input: ApprovalInput): ApprovalVerdict {
  switch (input.verdict) {
    case 'approve':
      return { verdict: 'approve' }
    case 'reject':
      return { verdict: 'reject', reason: input.reason ?? 'rejected' }
    case 'edit':
      return { verdict: 'edit', args: input.args ?? {} }
  }
}

export async function executeToolCall(
  input: ToolCallInput,
  deps: ToolCallDeps,
): Promise<ToolCallResult> {
  const started = Date.now()
  const partition = `session:${input.sessionId}`

  // Mutations replay exactly once; file reads recheck current visibility and integrity.
  const recorded = input.call.name === 'artifact.read' ? undefined : await deps.findRecorded(input.idempotencyKey)
  if (recorded) {
    deps.log({ op: 'tool.call', tool: input.call.name, ok: !recorded.result.isError, latencyMs: 0 })
    return recorded
  }

  const planStore = new PlanStore()
  if (input.plan) planStore.restore(input.plan)
  const ledger = rehydrateTasks(input.tasks)

  const finish = async (result: ToolResult, extra?: { timedOut?: boolean; blocked?: boolean }) => {
    const outcome: ToolCallResult = {
      result,
      plan: planStore.snapshot(),
      tasks: snapshotTasks(ledger),
    }
    await deps.record({
      idempotencyKey: input.idempotencyKey,
      partition,
      type: TOOL_EXECUTED_EVENT,
      payload: {
        result,
        plan: outcome.plan,
        tasks: outcome.tasks,
      },
    })
    deps.log({
      op: 'tool.call',
      tool: input.call.name,
      ok: !result.isError,
      latencyMs: Date.now() - started,
      ...extra,
    })
    return outcome
  }

  // Approval gate (fail-closed): sensitive tools without an approving
  // verdict never execute, and the denial is an approval event.
  if (SENSITIVE_TOOLS.has(input.call.name)) {
    const verdict = input.approval ? toVerdict(input.approval) : undefined
    if (!verdict || verdict.verdict === 'reject') {
      const reason =
        verdict?.verdict === 'reject'
          ? verdict.reason
          : `tool '${input.call.name}' requires approval and none was supplied`
      await deps.record({
        idempotencyKey: `tool-approval:${input.idempotencyKey}`,
        partition,
        type: TOOL_APPROVAL_EVENT,
        payload: {
          approvalId: input.call.id,
          toolName: input.call.name,
          decision: 'denied',
          reason,
        },
      })
      const blocked: ToolResult = {
        toolCallId: input.call.id,
        toolName: input.call.name,
        content: verdict ? `rejected by approval gate: ${reason}` : reason,
        isError: true,
      }
      return finish(blocked, { blocked: true })
    }
    if (verdict.verdict === 'approve' || verdict.verdict === 'edit') {
      await deps.record({
        idempotencyKey: `tool-approval:${input.idempotencyKey}`,
        partition,
        type: TOOL_APPROVAL_EVENT,
        payload: {
          approvalId: input.call.id,
          toolName: input.call.name,
          decision: verdict.verdict === 'approve' ? 'approved' : 'edited',
        },
      })
    }
    if (verdict.verdict === 'edit') {
      input = { ...input, call: { ...input.call, args: verdict.args } }
    }
  }

  const registry = new ToolRegistry()
  for (const registration of planTools(planStore)) registry.register(registration)
  for (const registration of taskTools(ledger)) registry.register(registration)
  for (const registration of input.extraTools ?? []) registry.register(registration)
  // File reads for agents: own or referenced session files resolve through
  // the owner's index gate, so a main agent can read a subagent's output
  // and any session can read what it attached. Reads execute freely (not
  // sensitive); unindexed or tampered bytes answer as tool errors, and the
  // outcome records durably like every other call.
  registry.register({
    definition: {
      name: 'artifact.read',
      description: 'Read the bytes of an indexed file visible to this session.',
      parameters: {
        type: 'object',
        properties: { artifactId: { type: 'string' } },
        required: ['artifactId'],
      },
    },
    handler: async (args) => {
      const artifactId = args['artifactId']
      if (typeof artifactId !== 'string' || artifactId.trim() === '') {
        return { content: 'artifactId must be a non-empty string', isError: true }
      }
      if (!deps.artifacts) return { content: 'artifact reads unavailable', isError: true }
      const { db, target } = deps.artifacts
      const resolved = await resolveArtifactScope(db, input.sessionId, artifactId)
      if (!resolved) return { content: `unknown artifact '${artifactId}'`, isError: true }
      try {
        const served = await serveArtifact(target, resolved.scope, artifactId, {
          // The call outcome (logged by finish) is the observability record;
          // per-byte serve logging inside a tool would double-report.
          log: () => undefined,
          findEvent: (key) => findEventByKey(db, key),
          record: (event) => appendEvent(db, event).then(() => undefined),
        })
        const session = await getSession(db, input.sessionId)
        if (session?.sectorId) await recordThreadFileExposure(db as TransactableDb, input.sessionId, session.sectorId, artifactId, undefined, undefined, createHash('sha256').update(served.body).digest('hex'))
        return { content: served.body }
      } catch (error) {
        if (error instanceof UnindexedArtifactError || error instanceof CorruptArtifactError) {
          return { content: error.message, isError: true }
        }
        throw error
      }
    },
  })

  // Timeout observation without string-matching: dispatch fires exactly one
  // timer (the timeout) when timeoutMs is set, so a fired wrapper means the
  // timeout verdict won.
  let timedOut = false
  const setTimeoutFn: typeof setTimeout = ((handler: () => void, ms?: number) => {
    return setTimeout(() => {
      timedOut = true
      handler()
    }, ms)
  }) as typeof setTimeout
  // Note: plan/task handlers are synchronous in-memory ops, so an
  // abandoned dispatch after Temporal cancellation costs nothing. Domain
  // tools with real side effects will need abort wiring when they land.
  const result = await dispatch(
    registry,
    input.call,
    { toolCallId: input.call.id, toolName: input.call.name, clock: systemClock(), signal: new AbortController().signal },
    { timeoutMs: input.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS, setTimeoutFn },
  )
  if (timedOut) {
    await deps.record({
      idempotencyKey: `tool-timeout:${input.idempotencyKey}`,
      partition,
      type: TOOL_TIMEOUT_EVENT,
      payload: {
        toolCallId: input.call.id,
        toolName: input.call.name,
        timeoutMs: input.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
        latencyMs: Date.now() - started,
      },
    })
    return finish(result, { timedOut: true })
  }
  return finish(result)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function toolCallActivity(input: ToolCallInput): Promise<ToolCallResult> {
  const context = Context.current()
  const pool = workerPoolFromEnv()
  let settled = false
  const beating = (async () => {
    try {
      while (!settled) {
        await Promise.race([sleep(5_000), context.cancelled])
        if (settled) break
        context.heartbeat({ tool: input.call.name, at: Date.now() })
        // Operation heartbeat for the stall sweeper (B5.3).
        await recordHeartbeat(pool, `session-run-${input.sessionId}`, 'tool.call', true)
      }
    } catch {
      // Cancellation races the beat; the call race below owns the outcome.
    }
  })()
  const store = {
    findRecorded: async (idempotencyKey: string) => {
      const row = await findEventByKey(pool, idempotencyKey)
      if (!row || row.type !== TOOL_EXECUTED_EVENT) return undefined
      const payload = row.payload as {
        result?: ToolResult
        plan?: PlanSnapshot
        tasks?: TaskSnapshot
      } | null
      if (!payload || typeof payload !== 'object') return undefined
      if (!payload.result || !payload.plan || !payload.tasks) return undefined
      return { result: payload.result, plan: payload.plan, tasks: payload.tasks }
    },
    record: async (event: {
      idempotencyKey: string
      partition: string
      type: string
      payload: Record<string, unknown>
    }) => {
      await appendEvent(pool, event)
    },
  }
  const span = startSpan(trace.getTracer(TRACER_NAME), 'activity.toolCall', undefined, {
    kind: SpanKind.INTERNAL,
    attributes: { session_id: input.sessionId, tool: input.call.name },
  })
  try {
    // Cancellation surfaces as a rejected promise (turn.ts pattern).
    const outcome = await Promise.race([
      executeToolCall(input, {
        log: (fields) => context.log.info('tool.call', { ...activityLogFields({ sessionId: input.sessionId }), ...fields }),
        ...store,
        artifacts: { db: pool, target: resolveArchiveTarget() },
      }),
      context.cancelled,
    ])
    span.setStatus(
      outcome.result.isError ? { code: SpanStatusCode.ERROR } : { code: SpanStatusCode.OK },
    )
    return outcome
  } catch (error) {
    // Re-raised unchanged: cancellation must still surface as
    // CancelledFailure, never a generic activity error.
    span.setStatus({ code: SpanStatusCode.ERROR })
    throw error
  } finally {
    span.end()
    settled = true
    void beating
  }
}
