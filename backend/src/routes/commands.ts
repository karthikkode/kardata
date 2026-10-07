// Command routes. B3.1 mutations; B3.3 gates and scopes. Mutations accepted
// into the runs gateway answer 202 with accepted/missed_steer; unknown
// targets are 404, wrong run types and closed sessions are 409 conflict.
// Role minima: operator for send/steer/pause/cancel, approver for
// resume/approve. Tenant checks 404 (never 403) so tenants stay unprobbable;
// approval-to-session binding lands with the B4.2 approval gates, so approve
// is role-only here. B3.4: all six mutations honor Idempotency-Key —
// identical retries replay the stored outcome, key reuse for a different
// request is 409 conflict.
import type { FastifyInstance } from 'fastify'
import type { TransactableDb } from '../db/index.js'
import { z } from 'zod'
import { appendEvent, readPartition } from '../db/index.js'
import { projectNewEvents } from '../projector.js'
import { getThread } from '../db/index.js'
import type { Scope } from '../auth/types.js'
import { parseSlashCommand, resolveSlashCommand } from '../skills.js'
import type { RunsGateway } from '../temporal/runs-types.js'
import { authorize, parseInput, requirePool, requireRuns, route, sessionVisible, withIdempotency, type IdempotentOutcome } from './http.js'
import { runVisible } from './runs.js'

const ThreadTextBody = z.object({ threadKey: z.string().min(1), text: z.string().min(1) });
const RunRefBody = z.object({ runId: z.string().min(1) });
const ResumeBody = z.object({ runId: z.string().min(1), extendedBudgetMs: z.number().int().min(1).optional() });
const ApprovalBody = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'denied']),
});

function kardataPool(app: FastifyInstance): TransactableDb | undefined {
  return (app as FastifyInstance & { kardataPool?: TransactableDb }).kardataPool
}

function failed(status: number, code: 'not_found' | 'overload' | 'conflict', message: string): IdempotentOutcome {
  return { status, body: { ok: false, error: { code, message } } }
}

/** Thread-owning session for scope checks. Unknown threads and out-of-scope
 * sessions are 404 (never 403) so tenants stay unprobbable. Pure outcome —
 * the idempotency wrapper sends it, so replays store business errors too. */
async function threadCheck(
  app: FastifyInstance,
  threadKey: string,
  scope: Scope | undefined,
): Promise<IdempotentOutcome | undefined> {
  const pool = kardataPool(app)
  if (!pool) return failed(503, 'overload', 'database unavailable')
  await projectNewEvents(pool)
  const thread = await getThread(pool, threadKey)
  if (!thread) return failed(404, 'not_found', `no such thread ${threadKey}`)
  if (!(await sessionVisible(pool, thread.sessionId, scope))) {
    return failed(404, 'not_found', `no such thread ${threadKey}`)
  }
  return undefined
}

/** Queued-child fallback for the run check: a QUEUED (or paused-queued)
 * subagent thread with no workflow yet is a controllable run, addressed
 * by its child id. Finished/unknown threads stay 404; out-of-scope
 * sessions stay unprobbable. The gateway re-validates against the live
 * parent's queue before signalling. */
async function queuedChildVisible(
  pool: TransactableDb,
  runId: string,
  scope: Scope | undefined,
): Promise<boolean> {
  const thread = await getThread(pool, `agent:${runId}`)
  if (!thread || thread.kind !== 'subagent') return false
  if (thread.status !== 'QUEUED' && thread.status !== 'PAUSED') return false
  return sessionVisible(pool, thread.sessionId, scope)
}

export function commandRoutes(app: FastifyInstance): void {
  async function scopedRunCheck(
    app: FastifyInstance,
    runId: string,
    scope: Scope | undefined,
  ): Promise<IdempotentOutcome | undefined> {
    const pool = kardataPool(app)
    const runs = (app as FastifyInstance & { kardataRuns?: RunsGateway }).kardataRuns
    if (!pool || !runs) return failed(503, 'overload', 'runs gateway unavailable')
    await projectNewEvents(pool)
    const run = await runs.getRun(runId)
    if (!run) {
      // A queued child has no workflow to describe: accept it by its
      // thread row so pause/resume/cancel reach the live parent. Any
      // other workflow-less id stays 404.
      if (await queuedChildVisible(pool, runId, scope)) return undefined
      return failed(404, 'not_found', `no such run ${runId}`)
    }
    if (!(await runVisible(pool, run, scope))) {
      return failed(404, 'not_found', `no such run ${runId}`)
    }
    return undefined
  }

  route(app, 'post', '/v1/commands/send', async (request, reply, app) => {
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const body = parseInput(ThreadTextBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, kardataPool(app), auth.keyId, async () => {
      const blocked = await threadCheck(app, body.threadKey, auth.scope)
      if (blocked) return blocked
      // Leading `/name` invokes a registered skill; anything else is chat.
      // Unknown skills are 400 with the available list, never literal text.
      const slash = parseSlashCommand(body.text)
      if (slash !== undefined) {
        const resolved = resolveSlashCommand(slash)
        if ('error' in resolved) {
          return { status: 400, body: { ok: false, error: { code: 'validation_failed', message: resolved.error } } }
        }
        const result = await runs.sendSkill(body.threadKey, {
          name: resolved.skill.name,
          prompt: resolved.skill.prompt,
          tools: resolved.skill.tools,
          text: slash.rest,
          ...(resolved.skill.mode === undefined ? {} : { mode: resolved.skill.mode }),
        })
        return { status: 202, body: { ok: true, data: result } }
      }
      const result = await runs.send(body.threadKey, body.text)
      return { status: 202, body: { ok: true, data: result } }
    })
  })

  route(app, 'post', '/v1/commands/steer', async (request, reply, app) => {
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const body = parseInput(ThreadTextBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, kardataPool(app), auth.keyId, async () => {
      const blocked = await threadCheck(app, body.threadKey, auth.scope)
      if (blocked) return blocked
      const result = await runs.steer(body.threadKey, body.text)
      return { status: 202, body: { ok: true, data: result } }
    })
  })

  route(app, 'post', '/v1/commands/pause', async (request, reply, app) => {
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const body = parseInput(RunRefBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, kardataPool(app), auth.keyId, async () => {
      const blocked = await scopedRunCheck(app, body.runId, auth.scope)
      if (blocked) return blocked
      const result = await runs.pauseRun(body.runId)
      return { status: 202, body: { ok: true, data: result } }
    })
  })

  route(app, 'post', '/v1/commands/resume', async (request, reply, app) => {
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'approver')
    if (!auth) return undefined
    const body = parseInput(ResumeBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, kardataPool(app), auth.keyId, async () => {
      const blocked = await scopedRunCheck(app, body.runId, auth.scope)
      if (blocked) return blocked
      const result = await runs.resumeRun(body.runId, body.extendedBudgetMs)
      return { status: 202, body: { ok: true, data: result } }
    })
  })

  route(app, 'post', '/v1/commands/cancel', async (request, reply, app) => {
    const runs = requireRuns(app, reply)
    if (!runs) return undefined
    const auth = await authorize(app, request, reply, 'operator')
    if (!auth) return undefined
    const body = parseInput(RunRefBody, request.body, reply)
    if (!body) return undefined
    const pool = kardataPool(app)
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      const blocked = await scopedRunCheck(app, body.runId, auth.scope)
      if (blocked) return blocked
      const result = await runs.cancelRun(body.runId)
      // The gateway appended CANCELLING ahead of the signal: project now
      // so the state frame streams promptly and the UI releases its
      // thinking indicator without waiting for the unwind.
      if (pool) await projectNewEvents(pool)
      return { status: 202, body: { ok: true, data: result } }
    })
  })

  route(app, 'post', '/v1/commands/approve', async (request, reply, app) => {
    const pool = requirePool(app, reply)
    if (!pool) return undefined
    const auth = await authorize(app, request, reply, 'approver')
    if (!auth) return undefined
    const body = parseInput(ApprovalBody, request.body, reply)
    if (!body) return undefined
    return withIdempotency(request, reply, pool, auth.keyId, async () => {
      // Single decision per approval: an approval that is both approved
      // and denied is unanswerable for every future consumer, so a second
      // distinct decision conflicts instead of appending. Repeating the
      // same decision replays idempotently through the keyed append below.
      const prior = await readPartition(pool, `approval:${body.approvalId}`)
      const decided = prior.find((event) => event.type === 't.approval.decided')
      if (decided) {
        const previous = (decided.payload as { decision?: unknown }).decision
        if (previous !== body.decision) {
          return failed(409, 'conflict', `approval ${body.approvalId} already decided`)
        }
      }
      await appendEvent(pool, {
        idempotencyKey: `approval:${body.approvalId}:${body.decision}`,
        partition: `approval:${body.approvalId}`,
        type: 't.approval.decided',
        payload: { approvalId: body.approvalId, decision: body.decision },
      })
      return { status: 202, body: { ok: true, data: { commandId: `cmd-${body.approvalId}`, state: 'accepted' } } }
    })
  })
}
