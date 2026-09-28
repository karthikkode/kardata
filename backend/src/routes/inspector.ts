// B5.5 read-only run inspector: debug answers derived strictly from the
// append-only event log. This route never contacts Temporal (no workflow
// queries, no describes): every field comes from `session:<id>` plus the
// run's artifact and approval partitions. Event-derived state can lag the
// live workflow; that lag is the documented trade, not a bug.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { readPartition, type StoredEvent } from '../db/index.js'
import { authorize, requirePool, requireSessionScope, route, sendError } from './http.js'

const SESSION_RUN_PREFIX = 'session-run:'
const SESSION_RUN_PREFIX_LEGACY = 'session-run-'

const ApprovalPayload = z
  .object({
    approvalId: z.string().min(1),
    toolName: z.string().min(1).optional(),
    decision: z.string().min(1).optional(),
    reason: z.string().optional(),
  })
  .passthrough()

const ThreadStatePayload = z
  .object({
    threadKey: z.string().min(1),
    status: z.string().min(1),
    acceptingSteer: z.boolean().optional(),
  })
  .passthrough()

const StallFindingPayload = z
  .object({
    runId: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    detail: z.string().optional(),
    response: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough()

const ArtifactPayload = z
  .object({
    artifactId: z.string().min(1),
    name: z.string().min(1).optional(),
    bytes: z.number().int().nonnegative().optional(),
    sha256: z.string().optional(),
  })
  .passthrough()

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

function toTimelineEntry(event: StoredEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    type: event.type,
    at: event.at,
    key: event.idempotencyKey,
    payload: event.payload,
  }
}

export function inspectorRoutes(app: FastifyInstance): void {
  route(app, 'get', '/v1/debug/runs/:runId', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined

    const params = request.params as { runId?: string }
    const rawRunId = params.runId ?? ''
    let sessionId = rawRunId
    if (sessionId.startsWith(SESSION_RUN_PREFIX)) sessionId = sessionId.slice(SESSION_RUN_PREFIX.length)
    else if (sessionId.startsWith(SESSION_RUN_PREFIX_LEGACY)) {
      sessionId = sessionId.slice(SESSION_RUN_PREFIX_LEGACY.length)
    }

    const query = request.query as { limit?: string; afterSeq?: string }
    const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit)
    const afterSeq = query.afterSeq === undefined ? 0 : Number(query.afterSeq)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return sendError(reply, 400, 'validation_failed', `limit must be an integer 1..${MAX_LIMIT}`)
    }
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      return sendError(reply, 400, 'validation_failed', 'afterSeq must be a non-negative integer')
    }

    // Events only: a run with no session partition is unknown. No workflow
    // describe/query fallback exists by design.
    const sessionPartition = `session:${sessionId}`
    const sessionEvents = sessionId ? await readPartition(pool, sessionPartition) : []
    if (sessionEvents.length === 0) {
      return sendError(reply, 404, 'not_found', `no such run ${rawRunId}`)
    }
    if (!(await requireSessionScope(pool, sessionId, auth.scope, reply))) return undefined

    const artifactEvents = await readPartition(pool, `artifact:session:${sessionId}`)

    const last = sessionEvents[sessionEvents.length - 1]
    const threadByKey = new Map<string, { status: string; acceptingSteer?: boolean; at: string; seq: number }>()
    for (const event of sessionEvents) {
      if (event.type !== 't.thread.state') continue
      const parsed = ThreadStatePayload.safeParse(event.payload)
      if (!parsed.success) continue
      threadByKey.set(parsed.data.threadKey, {
        status: parsed.data.status,
        acceptingSteer: parsed.data.acceptingSteer,
        at: event.at,
        seq: event.seq,
      })
    }

    // Approvals: gate verdicts live in the session partition; operator
    // approve-command records live in `approval:<id>` partitions. Join the
    // two per approval id, both event-sourced.
    const approvalsById = new Map<
      string,
      {
        approvalId: string
        toolName?: string
        gateDecision?: string
        operatorDecision?: string
        events: Array<{ seq: number; at: string; source: string; decision?: string }>
      }
    >()
    const ensureApproval = (approvalId: string) => {
      let entry = approvalsById.get(approvalId)
      if (!entry) {
        entry = { approvalId, events: [] }
        approvalsById.set(approvalId, entry)
      }
      return entry
    }
    for (const event of sessionEvents) {
      if (event.type !== 't.approval.decided') continue
      const parsed = ApprovalPayload.safeParse(event.payload)
      if (!parsed.success) continue
      const entry = ensureApproval(parsed.data.approvalId)
      if (parsed.data.toolName) entry.toolName = parsed.data.toolName
      if (parsed.data.decision) entry.gateDecision = parsed.data.decision
      entry.events.push({ seq: event.seq, at: event.at, source: sessionPartition, decision: parsed.data.decision })
    }
    for (const approvalId of [...approvalsById.keys()]) {
      const operatorEvents = await readPartition(pool, `approval:${approvalId}`)
      for (const event of operatorEvents) {
        if (event.type !== 't.approval.decided') continue
        const parsed = ApprovalPayload.safeParse(event.payload)
        if (!parsed.success) continue
        const entry = ensureApproval(parsed.data.approvalId)
        if (parsed.data.decision) entry.operatorDecision = parsed.data.decision
        entry.events.push({
          seq: event.seq,
          at: event.at,
          source: `approval:${approvalId}`,
          decision: parsed.data.decision,
        })
      }
    }

    const findings: Array<{ seq: number; at: string; key: string; finding: unknown }> = []
    for (const event of sessionEvents) {
      if (event.type !== 't.stall.response') continue
      const parsed = StallFindingPayload.safeParse(event.payload)
      if (!parsed.success) continue
      findings.push({ seq: event.seq, at: event.at, key: event.idempotencyKey, finding: parsed.data })
    }

    const artifactsById = new Map<string, { artifactId: string; stored?: unknown; indexed?: unknown }>()
    for (const event of artifactEvents) {
      if (event.type !== 't.artifact.stored' && event.type !== 't.artifact.indexed') continue
      const parsed = ArtifactPayload.safeParse(event.payload)
      if (!parsed.success) continue
      let entry = artifactsById.get(parsed.data.artifactId)
      if (!entry) {
        entry = { artifactId: parsed.data.artifactId }
        artifactsById.set(parsed.data.artifactId, entry)
      }
      if (event.type === 't.artifact.stored') {
        entry.stored = { seq: event.seq, at: event.at, payload: event.payload }
      } else {
        entry.indexed = { seq: event.seq, at: event.at, payload: event.payload }
      }
    }

    const keySet = new Set<string>()
    for (const event of [...sessionEvents, ...artifactEvents]) {
      if (event.idempotencyKey) keySet.add(event.idempotencyKey)
    }
    const idempotencyKeys = [...keySet].sort()

    const timeline = sessionEvents.filter((event) => event.seq > afterSeq).slice(0, limit)

    return {
      ok: true,
      data: {
        run: { runId: rawRunId, sessionId },
        state: {
          eventCount: sessionEvents.length,
          lastSeq: last.seq,
          lastEventType: last.type,
          lastEventAt: last.at,
          threads: [...threadByKey.entries()].map(([threadKey, thread]) => ({ threadKey, ...thread })),
        },
        timeline: timeline.map(toTimelineEntry),
        findings,
        approvals: [...approvalsById.values()],
        artifacts: [...artifactsById.values()],
        idempotencyKeys,
      },
    }
  })
}
