// Thread workspace: inherited context, pause flags, thread context,
// steering queue, turn lifecycle, continuations, and compaction.
import { bindExecutionEpoch, recoveryCheckpointHash, type EpochOwnership } from './execution-epochs.js'
import type { PendingProviderResponse, RecoveryOperation } from '@kardata/agents'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/types.js'
import { appendEvent, type Db } from './events.js'
import { type TransactableDb } from './checkpoints.js'
import { checked, DbContractError, Id, WorkspaceError } from './errors.js'
import { publishOutboxFrame } from './outbox.js'
import type { ChatMessage, Usage } from '@kardata/agents'
import { estimateTokens } from '@kardata/agents'
import { assertThreadFileContext, ContextFileBlocked, threadFileRefs, validateFileRefs } from './context-files.js'

import {
  type ThreadContext,
  requireThread,
  workspaceTransaction,
} from './workspace.js'

const INHERITED_MESSAGE_CAP = 20
const INHERITED_TOKEN_CAP = 12000

/** Spawn-time brief for a child: the parent summary plus its recent
 * user/agent messages as Owner:/Agent: lines, capped at 12k estimated
 * tokens by dropping the oldest messages first. */
export async function buildInheritedContext(db: Db, parentThreadKey: string): Promise<string> {
  await requireThread(db, parentThreadKey)
  const local = await readThreadContext(db, parentThreadKey)
  const { rows } = await db.query<{ payload: unknown }>(
    `SELECT payload FROM thread_messages WHERE thread_key=$1 AND kind='text' ORDER BY seq DESC LIMIT 40`,
    [parentThreadKey],
  )
  const lines: string[] = []
  for (const row of [...rows].reverse()) {
    if (typeof row.payload !== 'object' || row.payload === null) continue
    const payload = row.payload as Record<string, unknown>
    if (typeof payload['text'] !== 'string') continue
    if (payload['role'] === 'user') lines.push(`Owner: ${payload['text']}`)
    else if (payload['role'] === 'agent') lines.push(`Agent: ${payload['text']}`)
  }
  const recent = lines.slice(-INHERITED_MESSAGE_CAP)
  const render = () => `Parent summary:\n${local.summary}\nRecent parent messages:\n${recent.join('\n')}`
  let body = render()
  while (recent.length > 0 && estimateTokens(body) > INHERITED_TOKEN_CAP) {
    recent.shift()
    body = render()
  }
  return body
}

/** Bare upsert: the child thread row may not have projected yet when the
 * brief lands between parent acceptance and the goal signal. */
export async function saveInheritedContext(db: Db, childThreadKey: string, inherited: string): Promise<void> {
  if (!childThreadKey) throw new DbContractError('childThreadKey must be a non-empty string')
  await db.query(
    `INSERT INTO thread_context(thread_key,inherited) VALUES($1,$2)
     ON CONFLICT(thread_key) DO UPDATE SET inherited=$2`,
    [childThreadKey, inherited],
  )
}

/** Owner pause flag: written by pause/resume runs, read at every
 * provider boundary. Missing row means running. */
export async function setThreadPaused(db: Db, threadKey: string, paused: boolean): Promise<void> {
  if (!threadKey) throw new DbContractError('threadKey must be a non-empty string')
  await db.query(
    `INSERT INTO thread_control(thread_key,paused,updated_at) VALUES($1,$2,now())
     ON CONFLICT(thread_key) DO UPDATE SET paused=$2,updated_at=now()`,
    [threadKey, paused],
  )
}

export async function isThreadPaused(db: Db, threadKey: string): Promise<boolean> {
  const researchState = await researchThreadState(db, threadKey).catch(() => null)
  if (researchState === 'paused' || researchState === 'planning' || researchState === 'planned') return true
  const { rows } = await db.query<{ paused: boolean }>('SELECT paused FROM thread_control WHERE thread_key=$1', [threadKey])
  return rows[0]?.paused ?? false
}

export async function readInheritedContext(db: Db, threadKey: string): Promise<string> {
  const { rows } = await db.query<{ inherited: string }>('SELECT inherited FROM thread_context WHERE thread_key=$1', [threadKey])
  return rows[0]?.inherited ?? ''
}

export async function readThreadContext(db: Db, threadKey: string, scope?: Scope): Promise<ThreadContext> {
  await requireThread(db, threadKey, scope)
  const { rows } = await db.query<{ notes: string; summary: string; covered_seq: number | string; version: number; usage: ThreadContext['usage']; working_user: string | null; working_meta: TurnContinuation['meta'] | null }>('SELECT * FROM thread_context WHERE thread_key=$1', [threadKey])
  const row = rows[0]
  let contextBlocked: string | undefined
  try { await assertThreadFileContext(db, threadKey, scope) } catch (error) { if (!(error instanceof ContextFileBlocked)) throw error; contextBlocked = error.message }
  return { ...(row?.working_meta?.pendingResponse ? { pendingResponse: { round: row.working_meta.pendingResponse.round } } : {}), ...(row?.working_user ? { task: row.working_user } : {}), sourceRefs: await threadFileRefs(db, threadKey, scope), ...(contextBlocked ? { contextBlocked } : {}), threadKey, notes: row?.notes ?? '', summary: row?.summary ?? '', coveredSeq: Number(row?.covered_seq ?? 0), version: row?.version ?? 0, ...(row?.usage ? { usage: row.usage } : {}), ...(row?.working_meta?.blockedOperations?.length ? { pendingOperations: row.working_meta.blockedOperations.map((operation) => ({ operationId: operation.operationId, toolName: operation.call.name, callId: operation.call.id, reason: operation.reason })) } : {}) }
}
export async function saveThreadContext(db: TransactableDb, threadKey: string, input: { version: number; notes?: string; summary?: string; coveredSeq?: number }, scope?: Scope, lease?: string): Promise<ThreadContext> {
  checked(z.object({ version: z.number().int().nonnegative(), notes: z.string().max(24000).optional(), summary: z.string().max(48000).optional(), coveredSeq: z.number().int().nonnegative().optional() }).strict(), input)
  await requireThread(db, threadKey, scope)
  return workspaceTransaction(db, threadKey, async (tx) => {
    if (lease && !(await tx.query('SELECT thread_key FROM thread_context WHERE thread_key=$1 AND active_lease=$2', [threadKey, lease])).rows.length) throw new WorkspaceError('conflict', 'This attempt no longer owns its summary.')
    const current = await readThreadContext(tx, threadKey, scope)
    const fileRefs = await threadFileRefs(tx, threadKey, scope)
    const identity = await requireThread(tx, threadKey, scope)
    if (input.summary !== undefined && identity.session.sectorId) await validateFileRefs(tx, identity.session.sectorId, fileRefs, scope)
    if (current.version !== input.version) throw new WorkspaceError('conflict', 'Local context changed. Try again.')
    if ((input.coveredSeq ?? current.coveredSeq) < current.coveredSeq) throw new WorkspaceError('conflict', 'Summary coverage cannot move backwards.')
    await tx.query(`INSERT INTO thread_context(thread_key,notes,summary,covered_seq,version) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(thread_key) DO UPDATE SET notes=$2,summary=$3,covered_seq=$4,version=$5`, [threadKey, input.notes ?? current.notes, input.summary ?? current.summary, input.coveredSeq ?? current.coveredSeq, current.version + 1])
    if (input.summary !== undefined) await tx.query('UPDATE thread_context SET summary_file_refs=$2::jsonb WHERE thread_key=$1', [threadKey, JSON.stringify(fileRefs)])
    if (input.summary !== undefined) await publishOutboxFrame(tx, threadKey, 'compaction', { version: current.version + 1, coveredSeq: input.coveredSeq })
    return readThreadContext(tx, threadKey, scope)
  })
}
export async function rebuildThreadContext(db: TransactableDb, threadKey: string, input: { version: number; summary: string; independent: true; author: string }, scope?: Scope): Promise<ThreadContext> {
  checked(z.object({ version: z.number().int().nonnegative(), summary: z.string().trim().min(1).max(48000), independent: z.literal(true), author: Id }).strict(), input)
  await requireThread(db, threadKey, scope)
  return workspaceTransaction(db, threadKey, async (tx) => {
    await tx.query('INSERT INTO thread_context(thread_key) VALUES($1) ON CONFLICT DO NOTHING', [threadKey])
    const before = await readThreadContext(tx, threadKey, scope)
    const state = await tx.query<{ active_run: string | null; active_lease: string | null; working_meta: TurnContinuation['meta'] | null }>('SELECT active_run,active_lease,working_meta FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])
    const row = state.rows[0]
    if (row?.active_run || row?.active_lease) throw new WorkspaceError('conflict', 'Pause the active turn before rebuilding private context.')
    if (before.version !== input.version) throw new WorkspaceError('conflict', 'Local context changed. Review the latest version.')
    if (row?.working_meta?.pendingResponse) throw new ContextFileBlocked('A paid provider response is waiting for durable recording. Resume its original turn after storage and source availability recover before rebuilding.')
    if (before.contextBlocked && row?.working_meta?.blockedOperations?.length) throw new ContextFileBlocked('Unresolved operations retain their original source-dependent arguments. Reveal or reconcile those original operations before rebuilding.')
    const coverage = await tx.query<{ covered: number }>('SELECT COALESCE(MAX(seq),0) AS covered FROM thread_messages WHERE thread_key=$1', [threadKey])
    const coveredSeq = Math.max(before.coveredSeq, Number(coverage.rows[0]?.covered ?? 0))
    const changed = await tx.query(`UPDATE thread_context SET summary=$2,covered_seq=$3,version=version+1,summary_file_refs='[]'::jsonb,file_exposures='[]'::jsonb,file_inheritance_set=true,history_provenance_known=true,
      working_messages=CASE WHEN working_messages IS NULL THEN NULL ELSE $4::jsonb END,
      working_file_refs=CASE WHEN working_messages IS NULL THEN NULL ELSE '[]'::jsonb END,rebuilt_history=true,rebuilt_outbox_floor=(SELECT COALESCE(MAX(seq),0) FROM outbox WHERE thread_key=$1)
      WHERE thread_key=$1 AND version=$5 AND active_run IS NULL AND active_lease IS NULL RETURNING thread_key`, [threadKey, input.summary, coveredSeq, JSON.stringify([{ role: 'assistant', text: input.summary, contextSeq: coveredSeq }]), input.version])
    if (!changed.rows.length) throw new WorkspaceError('conflict', 'Context changed during source review.')
    await appendEvent(tx, { idempotencyKey: `context-rebuild:${threadKey}:v${input.version + 1}`, partition: threadKey, type: 't.context.rebuilt', payload: { threadKey, author: input.author, previousVersion: input.version, version: input.version + 1, previousSummary: before.summary, previousSources: before.sourceRefs, replacement: input.summary, coveredSeq, independent: true } })
    await publishOutboxFrame(tx, threadKey, 'compaction', { version: input.version + 1, coveredSeq, rebuilt: true })
    return readThreadContext(tx, threadKey, scope)
  })
}
export async function enqueueSteering(db: TransactableDb, threadKey: string, text: string, id: string, scope?: Scope): Promise<{ id: string; state: string }> {
  await requireThread(db, threadKey, scope)
  checked(z.string().trim().min(1).max(24000), text); checked(Id, id)
  return workspaceTransaction(db, threadKey, async (tx) => {
    const { rows } = await tx.query<{ state: string }>(`INSERT INTO thread_instructions(id,thread_key,text,state)
      VALUES($1,$2,$3,CASE WHEN EXISTS(SELECT 1 FROM thread_context WHERE thread_key=$2 AND active_run IS NOT NULL) THEN 'pending' ELSE 'missed' END)
      ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING state`, [id, threadKey, text])
    return { id, state: rows[0]?.state ?? 'missed' }
  })
}
export async function readSteeringReceiptsPage(db: Db, threadKey: string, afterId = '', limit = 200, scope?: Scope): Promise<{ items: Array<{ id: string; state: 'consumed' | 'missed' }>; nextAfterId: string | null }> {
  await requireThread(db, threadKey, scope)
  checked(z.string().max(255), afterId); checked(z.number().int().min(1).max(200), limit)
  const { rows } = await db.query<{ id: string; state: 'consumed' | 'missed' }>(
    "SELECT id,state FROM thread_instructions WHERE thread_key=$1 AND state IN ('consumed','missed') AND id>$2 ORDER BY id LIMIT $3",
    [threadKey, afterId, limit + 1])
  const items = rows.slice(0, limit)
  return { items, nextAfterId: rows.length > limit ? items.at(-1)!.id : null }
}

export async function beginThreadTurn(db: TransactableDb, threadKey: string, runKey: string, owner?: EpochOwnership, recoveryProof?: { runKey: string; user: string; checkpointHash: string }): Promise<string> {
  checked(Id, threadKey); checked(Id, runKey)
  const lease = randomUUID()
  await workspaceTransaction(db, threadKey, async (tx) => {
    if (recoveryProof) {
      checked(z.object({ runKey: Id, user: z.string().min(1), checkpointHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), recoveryProof)
      await tx.query('SELECT thread_key FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])
      const saved = await readTurnContinuation(tx, threadKey)
      if (!owner || runKey !== recoveryProof.runKey || !saved || saved.runKey !== recoveryProof.runKey || saved.user !== recoveryProof.user || recoveryCheckpointHash(saved) !== recoveryProof.checkpointHash) throw new WorkspaceError('conflict', 'The original checkpoint changed. Review this task and retry Resume.')
    }
    if (!owner && (await tx.query<{ active_epoch: string | null }>('SELECT active_epoch FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])).rows[0]?.active_epoch) throw new WorkspaceError('conflict', 'A legacy attempt cannot replace a validated execution owner.')
    if (owner && owner.threadKey !== threadKey) throw new WorkspaceError('permission_denied', 'Execution epoch belongs to another thread.')
    const epoch = owner ? await bindExecutionEpoch(tx, owner) : null
    await tx.query('INSERT INTO thread_context(thread_key,active_run,active_lease,active_epoch,active_workflow_id,active_execution_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(thread_key) DO UPDATE SET active_run=$2,active_lease=$3,active_epoch=$4,active_workflow_id=$5,active_execution_id=$6', [threadKey, runKey, lease, epoch, owner?.workflowId ?? null, owner?.executionId ?? null])
    if (owner && epoch) {
      const latest = await tx.query<{ payload: { status?: string; recoveryEpoch?: string } }>("SELECT payload FROM events WHERE type='t.thread.state' AND payload->>'threadKey'=$1 ORDER BY seq DESC LIMIT 1", [threadKey])
      const state = latest.rows[0]?.payload
      if (state?.status === 'PAUSED' && typeof state.recoveryEpoch === 'string') await appendEvent(tx, { idempotencyKey: `execution-started:${epoch}:${owner.executionId}`, partition: `session:${owner.sessionId}`, type: 't.thread.state', payload: { threadKey, status: 'RUNNING', acceptingSteer: true, ownerEpoch: epoch, executionId: owner.executionId } })
    }
  })
  return lease
}
export async function consumeSteering(db: TransactableDb, threadKey: string, runKey: string, round: number, lease?: string): Promise<string[]> {
  checked(Id, threadKey); checked(Id, runKey); checked(z.number().int().positive(), round)
  return workspaceTransaction(db, threadKey, async (tx) => {
    if (lease && !(await tx.query('SELECT thread_key FROM thread_context WHERE thread_key=$1 AND active_run=$2 AND active_lease=$3', [threadKey, runKey, lease])).rows.length) throw new WorkspaceError('conflict', 'This turn attempt no longer owns its context.')
    const { rows } = await tx.query<{ id: string }>(`UPDATE thread_instructions SET state='consumed',run_key=$2,round=$3
      WHERE thread_key=$1 AND state='pending' RETURNING id`, [threadKey, runKey, round])
    const replay = await tx.query<{ text: string }>('SELECT text FROM thread_instructions WHERE thread_key=$1 AND run_key=$2 AND round=$3 ORDER BY at,id', [threadKey, runKey, round])
    if (rows.length) await publishOutboxFrame(tx, threadKey, 'steering-consumption', { ids: rows.map((row) => row.id), runKey, round })
    return replay.rows.map((row) => row.text)
  })
}
export async function finishSteering(db: TransactableDb, threadKey: string, runKey: string, lease?: string): Promise<void> {
  checked(Id, threadKey); checked(Id, runKey)
  await workspaceTransaction(db, threadKey, async (tx) => {
    const active = await tx.query('SELECT active_run FROM thread_context WHERE thread_key=$1 AND active_run=$2 AND ($3::text IS NULL OR active_lease=$3)', [threadKey, runKey, lease ?? null])
    if (!active.rows.length) return
    const { rows } = await tx.query<{ id: string }>("UPDATE thread_instructions SET state='missed' WHERE thread_key=$1 AND state='pending' RETURNING id", [threadKey])
    await tx.query('UPDATE thread_context SET active_run=NULL,active_lease=NULL,active_epoch=NULL,active_workflow_id=NULL,active_execution_id=NULL WHERE thread_key=$1 AND active_run=$2 AND ($3::text IS NULL OR active_lease=$3)', [threadKey, runKey, lease ?? null])
    if (rows.length) await publishOutboxFrame(tx, threadKey, 'steering-consumption', { ids: rows.map((row) => row.id), state: 'missed' })
  })
}

export interface TurnContinuation { user: string; messages: ChatMessage[]; runKey: string; sources: Array<{ url: string; key: string; hash: string }>; meta: { round: number; usage: Usage; toolCalls: number; elapsedMs: number; blockedOperations?: RecoveryOperation[]; pendingResponse?: PendingProviderResponse } }
export async function readTurnContinuation(db: Db, threadKey: string): Promise<TurnContinuation | undefined> {
  checked(Id, threadKey)
  const { rows } = await db.query<{ working_user: string | null; working_messages: ChatMessage[] | null; working_run: string | null; working_sources: TurnContinuation['sources']; working_meta: TurnContinuation['meta'] }>('SELECT working_user,working_messages,working_run,working_sources,working_meta FROM thread_context WHERE thread_key=$1', [threadKey])
  const row = rows[0]
  return row?.working_user && row.working_messages && row.working_run && row.working_meta ? { user: row.working_user, messages: row.working_messages, runKey: row.working_run, sources: row.working_sources, meta: row.working_meta } : undefined
}
export async function saveTurnContinuation(db: Db, threadKey: string, continuation: TurnContinuation, lease?: string): Promise<void> {
  checked(Id, threadKey); checked(Id, continuation.runKey)
  checked(z.string().min(1), continuation.user)
  if (!Array.isArray(continuation.messages) || continuation.messages.some((message) => !['user','assistant','tool','system'].includes(message.role))) throw new DbContractError('Invalid continuation messages')
  const saved = await db.query(`INSERT INTO thread_context(thread_key,working_user,working_messages,working_run,working_sources,working_meta) SELECT $1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb
    WHERE $7::text IS NULL OR EXISTS(SELECT 1 FROM thread_context WHERE thread_key=$1 AND active_run=$4 AND active_lease=$7)
    ON CONFLICT(thread_key) DO UPDATE SET working_user=$2,working_messages=$3::jsonb,working_run=$4,working_sources=$5::jsonb,working_meta=$6::jsonb
    WHERE $7::text IS NULL OR (thread_context.active_run=$4 AND thread_context.active_lease=$7)`, [threadKey, continuation.user, JSON.stringify(continuation.messages), continuation.runKey, JSON.stringify(continuation.sources), JSON.stringify(continuation.meta), lease ?? null])
  if (!saved.rowCount) throw new WorkspaceError('conflict', 'This turn attempt no longer owns its checkpoint.')
  const refs = await threadFileRefs(db, threadKey)
  await db.query('UPDATE thread_context SET working_file_refs=$2::jsonb WHERE thread_key=$1 AND ($3::text IS NULL OR active_lease=$3)', [threadKey, JSON.stringify(refs), lease ?? null])
}
export async function clearTurnContinuation(db: Db, threadKey: string, lease?: string): Promise<void> {
  checked(Id, threadKey)
  await db.query('UPDATE thread_context SET working_user=NULL,working_messages=NULL,working_run=NULL,working_meta=NULL,working_sources=\'[]\'::jsonb WHERE thread_key=$1 AND ($2::text IS NULL OR active_lease=$2)', [threadKey, lease ?? null])
}
/** Atomically repair durable history and the parked working view. A
 * running activity or changed checkpoint prevents stale replacement. */
export async function commitThreadCompaction(db: TransactableDb, threadKey: string, input: { version: number; summary: string; coveredSeq: number; continuation?: { previous: TurnContinuation; messages: ChatMessage[] } }, scope?: Scope): Promise<ThreadContext> {
  await requireThread(db, threadKey, scope)
  checked(z.number().int().nonnegative(), input.version)
  checked(z.number().int().nonnegative(), input.coveredSeq)
  checked(z.string().trim().min(1).max(96000), input.summary)
  return workspaceTransaction(db, threadKey, async (tx) => {
    await tx.query('INSERT INTO thread_context(thread_key) VALUES($1) ON CONFLICT DO NOTHING', [threadKey])
    const refs = await threadFileRefs(tx, threadKey, scope)
    const identity = await requireThread(tx, threadKey, scope)
    if (identity.session.sectorId) await validateFileRefs(tx, identity.session.sectorId, refs, scope)
    const changed = await tx.query(`UPDATE thread_context SET summary=$2,covered_seq=$3,version=version+1,
      working_messages=CASE WHEN $4::text IS NOT NULL THEN $5::jsonb ELSE working_messages END
      WHERE thread_key=$1 AND version=$6 AND active_run IS NULL AND covered_seq <= $3
      AND ($4::text IS NULL OR (working_run=$4 AND working_messages=$7::jsonb)) RETURNING thread_key`,
      [threadKey, input.summary, input.coveredSeq, input.continuation?.previous.runKey ?? null, JSON.stringify(input.continuation?.messages ?? null), input.version, JSON.stringify(input.continuation?.previous.messages ?? null)])
    if (!changed.rows.length) throw new WorkspaceError('conflict', 'Context is running or changed during compaction. Pause and review the latest context before retrying.')
    await tx.query('UPDATE thread_context SET summary_file_refs=$2::jsonb,working_file_refs=CASE WHEN working_messages IS NULL THEN working_file_refs ELSE $2::jsonb END WHERE thread_key=$1', [threadKey, JSON.stringify(refs)])
    await publishOutboxFrame(tx, threadKey, 'compaction', { coveredSeq: input.coveredSeq, version: input.version + 1 })
    return readThreadContext(tx, threadKey, scope)
  })
}
async function researchThreadState(db: Db, threadKey: string): Promise<string | null> {
  checked(Id, threadKey)
  const { rows } = await db.query<{ state: string }>(`SELECT s.state FROM research_work w JOIN sectors s ON s.id=w.sector_id WHERE w.child_id=$1`, [threadKey.replace(/^agent:/, '')])
  return rows[0]?.state ?? null
}
export async function recordContextMeasurement(db: Db, threadKey: string, usage: NonNullable<ThreadContext['usage']>): Promise<void> {
  checked(Id, threadKey)
  checked(z.object({ inputTokens: z.number().int().nonnegative(), budget: z.number().int().positive(), window: z.number().int().positive(), method: z.enum(['exact','estimated']) }).strict(), usage)
  await db.query('UPDATE thread_context SET usage=$2::jsonb WHERE thread_key=$1', [threadKey, JSON.stringify(usage)])
}
