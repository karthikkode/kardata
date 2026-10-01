import { z } from 'zod'
import { appendEvent, type Db } from './events.js'
import { requireThread, workspaceTransaction } from './workspace.js'
import type { TransactableDb } from './checkpoints.js'
import { DbContractError, WorkspaceError } from './errors.js'
import { createLogger, logOp } from '../observability/logging.js'
import type { Scope } from '../auth/keys.js'
import { createHash } from 'node:crypto'
const logger = createLogger({ op: 'execution.record' })

const RecordInput = z.object({
  sessionId: z.string().min(1).max(255), threadKey: z.string().min(1).max(255),
  runKey: z.string().min(1).max(255), lease: z.string().uuid(),
  round: z.number().int().nonnegative(), kind: z.enum(['request', 'response', 'tool-result']),
  workflowId: z.string().min(1).max(255).optional(), executionId: z.string().min(1).max(255).optional(), ownerEpoch: z.string().uuid().optional(),
  ref: z.object({ key: z.string().min(1).max(1024), hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(16 * 1024 * 1024) }).strict(),
}).strict()
/** Archive IO must finish first. Cancellation/replacement cannot journal a stale
 * attempt as current execution; immutable original records are never updated. */
export async function recordTurnExecution(db: TransactableDb, raw: z.input<typeof RecordInput>): Promise<void> {
  const parsed = RecordInput.safeParse(raw)
  if (!parsed.success) throw new DbContractError(parsed.error.issues[0]?.message ?? 'Invalid execution record.')
  const input = parsed.data
  const expectedKey = `execution-records/${createHash('sha256').update(input.sessionId).digest('hex')}/${input.ref.hash}.json`
  if (input.ref.key !== expectedKey) throw new WorkspaceError('permission_denied', 'Execution reference is outside its session namespace.')
  await logOp(logger, 'execution.record.commit', () => workspaceTransaction(db, input.threadKey, async (tx: Db) => {
    const actor = await requireThread(tx, input.threadKey)
    if (actor.session.id !== input.sessionId) throw new WorkspaceError('permission_denied', 'Execution record belongs to another session.')
    const owned = await tx.query<{ active_epoch: string | null; active_workflow_id: string | null; active_execution_id: string | null }>('SELECT active_epoch,active_workflow_id,active_execution_id FROM thread_context WHERE thread_key=$1 AND active_lease=$2 AND active_run=$3 FOR UPDATE', [input.threadKey, input.lease, input.runKey])
    if (!owned.rows.length) throw new WorkspaceError('conflict', 'Execution ownership changed before recording its content.')
    const owner = owned.rows[0]!
    if ((input.workflowId && owner.active_workflow_id && input.workflowId !== owner.active_workflow_id) || (input.executionId && owner.active_execution_id && input.executionId !== owner.active_execution_id)) throw new WorkspaceError('conflict', 'Execution metadata does not match the active owner.')
    const payload = { ...input, ...(owner.active_epoch ? { ownerEpoch: owner.active_epoch } : {}), ...(owner.active_workflow_id ? { workflowId: owner.active_workflow_id } : {}), ...(owner.active_execution_id ? { executionId: owner.active_execution_id } : {}) }
    await appendEvent(tx, {
      idempotencyKey: `execution:${input.lease}:${input.round}:${input.kind}:${input.ref.hash}`,
      partition: input.threadKey.startsWith('agent:') ? `child:${input.threadKey.slice(6)}` : `session:${input.sessionId}`,
      type: 't.execution.recorded', payload,
    })
  }), { threadKey: input.threadKey, runKey: input.runKey, round: input.round, kind: input.kind, contentHash: input.ref.hash })
}

export interface ExecutionRecordMetadata {
  seq: number; at: string; runKey: string; attemptLease: string; round: number
  kind: 'request' | 'response' | 'tool-result'
  workflowId?: string; executionId?: string; ownerEpoch?: string
  ref: { hash: string; bytes: number }
}
type JournalRow = { seq: number | string; at: Date; payload: unknown }
function journalView(row: JournalRow, threadKey: string, sessionId: string) {
  const parsed = RecordInput.safeParse(row.payload)
  if (!parsed.success || parsed.data.threadKey !== threadKey || parsed.data.sessionId !== sessionId) throw new WorkspaceError('conflict', 'Stored execution metadata has an invalid conversation binding.')
  const input = parsed.data
  const metadata: ExecutionRecordMetadata = { seq: Number(row.seq), at: new Date(row.at).toISOString(), runKey: input.runKey, attemptLease: input.lease, round: input.round, kind: input.kind, ref: { hash: input.ref.hash, bytes: input.ref.bytes }, ...(input.workflowId ? { workflowId: input.workflowId } : {}), ...(input.executionId ? { executionId: input.executionId } : {}), ...(input.ownerEpoch ? { ownerEpoch: input.ownerEpoch } : {}) }
  return { metadata, sessionId, ref: input.ref }
}
export async function listThreadExecutionRecords(db: Db, threadKey: string, scope?: Scope, afterSeq = 0, limit = 20): Promise<{ records: ExecutionRecordMetadata[]; nextAfterSeq: number | null }> {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new DbContractError('Execution cursor must be a non-negative integer and limit must be from1 to100.')
  const actor = await requireThread(db, threadKey, scope)
  const partition = actor.thread.kind === 'subagent' ? `child:${threadKey.slice(6)}` : `session:${actor.session.id}`
  const { rows } = await db.query<JournalRow>(`SELECT seq,at,payload FROM events WHERE partition=$1 AND type='t.execution.recorded' AND payload->>'threadKey'=$2 AND seq>$3 ORDER BY seq LIMIT $4`, [partition, threadKey, afterSeq, limit + 1])
  const records = rows.slice(0, limit).map((row) => journalView(row, threadKey, actor.session.id).metadata)
  return { records, nextAfterSeq: rows.length > limit ? records.at(-1)!.seq : null }
}
/** Private archive key comes exclusively from the scoped immutable journal. */
export async function readThreadExecutionReference(db: Db, threadKey: string, seq: number, scope?: Scope) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new DbContractError('Execution sequence must be a positive integer.')
  const actor = await requireThread(db, threadKey, scope)
  const partition = actor.thread.kind === 'subagent' ? `child:${threadKey.slice(6)}` : `session:${actor.session.id}`
  const { rows } = await db.query<JournalRow>(`SELECT seq,at,payload FROM events WHERE seq=$1 AND partition=$2 AND type='t.execution.recorded' AND payload->>'threadKey'=$3`, [seq, partition, threadKey])
  if (!rows[0]) throw new WorkspaceError('not_found', 'Execution record is not in this conversation.')
  return journalView(rows[0], threadKey, actor.session.id)
}

/** Trusted recovery adapters select a journal by logical turn, never an archive key. */
export async function readRecoveryRequestReference(db: Db, threadKey: string, runKey: string, scope?: Scope) {
  if (!z.string().min(1).max(255).safeParse(runKey).success) throw new DbContractError('Recovery operation identity must be non-empty.')
  const actor = await requireThread(db, threadKey, scope)
  const partition = actor.thread.kind === 'subagent' ? `child:${threadKey.slice(6)}` : `session:${actor.session.id}`
  const { rows } = await db.query<JournalRow>(`SELECT seq,at,payload FROM events WHERE partition=$1 AND type='t.execution.recorded' AND payload->>'threadKey'=$2 AND payload->>'runKey'=$3 AND payload->>'kind'='request' ORDER BY seq DESC LIMIT 1`, [partition, threadKey, runKey])
  return rows[0] ? journalView(rows[0], threadKey, actor.session.id) : undefined
}
