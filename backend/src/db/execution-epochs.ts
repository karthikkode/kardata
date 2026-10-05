import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { appendEvent, type Db } from './events.js'
import { getSession } from './sessions.js'
import { DbContractError,WorkspaceError } from './errors.js'
import type { TransactableDb } from './checkpoints.js'
import { workspaceTransaction } from './workspace.js'
import type { TurnContinuation } from './workspace-threads.js'
import { createHash } from 'node:crypto'

const Id = z.string().min(1).max(512)
export interface ExecutionIntentInput { workflowId: string; threadKey: string; sessionId: string; requestKey: string }
export interface EpochOwnership { epoch: string; workflowId: string; executionId: string; firstExecutionId: string; continuedFromExecutionId?: string; threadKey: string; sessionId: string }

export function recoveryCheckpointHash(saved: TurnContinuation): string {
  const encoded=JSON.stringify(saved)
  if (Buffer.byteLength(encoded)>16*1024*1024) throw new WorkspaceError('conflict','Compact the saved original context before resuming this turn; it exceeds the recovery limit.')
  return createHash('sha256').update(encoded).digest('hex')
}

/** Producer metadata is read from the actual attempt, never requested alias
 * arguments. Null legacy fields need trusted SDK fallback at the adapter. */
export async function readActiveExecutionIdentity(db: Db,threadKey: string,lease: string): Promise<{ workflowId: string | null; executionId: string | null; ownerEpoch: string | null }> {
  if (!Id.safeParse(threadKey).success || !z.uuid().safeParse(lease).success) throw new DbContractError('invalid active execution identity')
  const row=(await db.query<{ active_workflow_id: string | null; active_execution_id: string | null; active_epoch: string | null }>('SELECT active_workflow_id,active_execution_id,active_epoch FROM thread_context WHERE thread_key=$1 AND active_lease=$2',[threadKey,lease])).rows[0]
  if (!row) throw new WorkspaceError('conflict','This attempt no longer owns its producer identity.')
  return { workflowId: row.active_workflow_id,executionId: row.active_execution_id,ownerEpoch: row.active_epoch }
}

/** Read-only proof for owner recovery of an immutable original SDK contract. */
export async function verifyOriginalExecutionEpoch(db: Db,input: { epoch: string; workflowId: string; firstExecutionId: string; threadKey: string; sessionId: string }): Promise<void> {
  const row=(await db.query<{ thread_key: string; session_id: string; workflow_id: string; first_execution_id: string | null }>(`SELECT thread_key,session_id,workflow_id,first_execution_id FROM execution_intents WHERE epoch=$1 AND state='bound'`,[input.epoch])).rows[0]
  if (!row || row.thread_key!==input.threadKey || row.session_id!==input.sessionId || row.workflow_id!==input.workflowId || row.first_execution_id!==input.firstExecutionId) throw new WorkspaceError('conflict','The original execution has no validated ownership proof. Review and start a new approved task.')
}

/** Commit before the start RPC. A retry returns the original epoch; every
 * unresolved concurrent request remains independently guarded. */
export async function reserveExecutionIntent(db: TransactableDb, input: ExecutionIntentInput): Promise<string> {
  for (const value of Object.values(input)) if (!Id.safeParse(value).success) throw new DbContractError('invalid execution intent identity')
  if (input.threadKey !== input.sessionId && input.threadKey !== `agent:${input.workflowId}`) throw new DbContractError('execution intent thread does not match its owner')
  if (!(await getSession(db,input.sessionId))) throw new DbContractError('execution intent session does not exist')
  return workspaceTransaction(db,input.threadKey,async (tx) => {
    const inserted = await tx.query<{ epoch: string; thread_key: string; session_id: string }>(`INSERT INTO execution_intents(epoch,workflow_id,thread_key,session_id,request_key,state,deadline_at)
      VALUES($1,$2,$3,$4,$5,'pending',now()+interval '60 seconds') ON CONFLICT(workflow_id,request_key) DO NOTHING RETURNING epoch,thread_key,session_id`,[randomUUID(),input.workflowId,input.threadKey,input.sessionId,input.requestKey])
    const existing = inserted.rows[0] ?? (await tx.query<{ epoch: string; thread_key: string; session_id: string }>('SELECT epoch,thread_key,session_id FROM execution_intents WHERE workflow_id=$1 AND request_key=$2',[input.workflowId,input.requestKey])).rows[0]
    if (!existing || existing.thread_key !== input.threadKey || existing.session_id !== input.sessionId) throw new DbContractError('execution request identity conflicts')
    if (inserted.rows.length) {
      await tx.query('INSERT INTO thread_execution_heads(thread_key,epoch) VALUES($1,$2) ON CONFLICT(thread_key) DO UPDATE SET epoch=EXCLUDED.epoch',[input.threadKey,existing.epoch])
      await appendEvent(tx,{ idempotencyKey: `execution-intent:${existing.epoch}:pending`,partition: `session:${input.sessionId}`,type: 't.execution.intent',payload: { ...input,epoch: existing.epoch,state: 'pending' } })
    }
    return existing.epoch
  })
}

interface IntentRow { epoch: string; workflow_id: string; thread_key: string; session_id: string; request_key: string; state: string; canonical_epoch: string | null; first_execution_id: string | null; execution_id: string | null }

/** Called under the caller's workspace transaction. Workflow arguments alone
 * are insufficient: actual SDK execution identity and persisted bindings must
 * agree. Continuations advance only from their recorded predecessor. */
export async function bindExecutionEpoch(tx: Db, owner: EpochOwnership, fenceCurrentHead = true): Promise<string> {
  if (!z.uuid().safeParse(owner.epoch).success || !owner.executionId || !owner.firstExecutionId) throw new DbContractError('invalid execution epoch proof')
  const row = (await tx.query<IntentRow>('SELECT * FROM execution_intents WHERE epoch=$1',[owner.epoch])).rows[0]
  if (!row || row.state === 'failed' || row.workflow_id !== owner.workflowId || row.thread_key !== owner.threadKey || row.session_id !== owner.sessionId || (row.first_execution_id && row.first_execution_id !== owner.firstExecutionId)) throw new DbContractError('execution epoch ownership conflicts')
  let canonical = (await tx.query<IntentRow>(`SELECT * FROM execution_intents WHERE workflow_id=$1 AND first_execution_id=$2 AND state='bound' AND canonical_epoch=epoch`,[owner.workflowId,owner.firstExecutionId])).rows[0]
  if (canonical && (canonical.thread_key !== owner.threadKey || canonical.session_id !== owner.sessionId)) throw new DbContractError('execution chain thread ownership conflicts')
  const head = (await tx.query<IntentRow>(`SELECT i.* FROM thread_execution_heads h JOIN execution_intents i ON i.epoch=h.epoch WHERE h.thread_key=$1`,[owner.threadKey])).rows[0]
  if (fenceCurrentHead && head?.state === 'bound' && head.canonical_epoch !== (canonical?.epoch ?? row.epoch)) throw new DbContractError('a newer execution already owns this thread')
  if (canonical && canonical.execution_id !== owner.executionId && canonical.execution_id !== owner.continuedFromExecutionId) throw new DbContractError('execution epoch cannot move backwards or to an unrelated run')
  canonical ??= row
  await tx.query(`UPDATE execution_intents SET state='bound',canonical_epoch=$2,first_execution_id=$3,execution_id=$4,updated_at=now() WHERE epoch=$1`,[canonical.epoch,canonical.epoch,owner.firstExecutionId,owner.executionId])
  if (canonical.epoch !== row.epoch) await tx.query(`UPDATE execution_intents SET state='bound',canonical_epoch=$2,first_execution_id=$3,execution_id=$4,updated_at=now() WHERE epoch=$1`,[row.epoch,canonical.epoch,owner.firstExecutionId,owner.executionId])
  await tx.query(`UPDATE execution_intents SET state='bound',canonical_epoch=$1,updated_at=now() WHERE workflow_id=$2 AND thread_key=$3 AND session_id=$4
    AND state IN ('pending','uncertain') AND first_execution_id=$5 AND execution_id=$6`,[canonical.epoch,owner.workflowId,owner.threadKey,owner.sessionId,owner.firstExecutionId,owner.executionId])
  await tx.query(`UPDATE thread_execution_heads h SET epoch=$2 WHERE h.thread_key=$1 AND EXISTS(
    SELECT 1 FROM execution_intents proof WHERE proof.epoch=h.epoch AND proof.state='bound' AND proof.canonical_epoch=$2
      AND proof.execution_id=$3 AND proof.first_execution_id=$4)`,[owner.threadKey,canonical.epoch,owner.executionId,owner.firstExecutionId])
  await appendEvent(tx,{ idempotencyKey: `execution-intent:${row.epoch}:bound:${owner.executionId}`,partition: `session:${owner.sessionId}`,type: 't.execution.intent',payload: { epoch: row.epoch,canonicalEpoch: canonical.epoch,workflowId: owner.workflowId,threadKey: owner.threadKey,executionId: owner.executionId,firstExecutionId: owner.firstExecutionId,state: 'bound' } })
  return canonical.epoch
}

/** A confirmed RPC receipt may adopt the canonical existing execution. */
export async function confirmExecutionIntent(db: TransactableDb, owner: EpochOwnership): Promise<string> {
  return workspaceTransaction(db,owner.threadKey,async (tx) => {
    const canonical = (await tx.query<IntentRow>(`SELECT * FROM execution_intents WHERE workflow_id=$1 AND first_execution_id=$2 AND state='bound' AND canonical_epoch=epoch`,[owner.workflowId,owner.firstExecutionId])).rows[0]
    if (canonical && canonical.execution_id !== owner.executionId) {
      const request = (await tx.query<IntentRow>('SELECT * FROM execution_intents WHERE epoch=$1',[owner.epoch])).rows[0]
      if (request?.state === 'bound' && request.canonical_epoch === canonical.epoch && request.first_execution_id === owner.firstExecutionId) return canonical.epoch
      // Acceptance into the chain does not prove predecessor order. Keep
      // the guard until the new activity validates that edge.
      const changed = await tx.query(`UPDATE execution_intents SET state='uncertain',first_execution_id=$2,execution_id=$3,updated_at=now()
        WHERE epoch=$1 AND workflow_id=$4 AND thread_key=$5 AND session_id=$6 AND state IN ('pending','uncertain')`,[owner.epoch,owner.firstExecutionId,owner.executionId,owner.workflowId,owner.threadKey,owner.sessionId])
      if (changed.rowCount !== 1) throw new DbContractError('execution receipt conflicts')
      return canonical.epoch
    }
    return bindExecutionEpoch(tx,owner,false)
  })
}

/** Unknown RPC outcomes retain their guard. 'failed' is only for a caller that
 * proves it aborted before invoking Temporal; deadlines cannot grant that proof. */
export async function markExecutionIntent(db: TransactableDb, epoch: string, beforeDispatch = false, preparingExecutionId?: string): Promise<void> {
  const row = (await db.query<IntentRow>('SELECT * FROM execution_intents WHERE epoch=$1',[epoch])).rows[0]
  if (!row) throw new DbContractError('execution intent does not exist')
  if (preparingExecutionId && !row.request_key.startsWith(`${preparingExecutionId}:`)) throw new DbContractError('only the preparing execution can settle its child intent')
  await workspaceTransaction(db,row.thread_key,async (tx) => {
    const changed = await tx.query("UPDATE execution_intents SET state=$2,updated_at=now() WHERE epoch=$1 AND state IN ('pending','uncertain')",[epoch,beforeDispatch ? 'failed' : 'uncertain'])
    if (changed.rowCount !== 1) return
    if (beforeDispatch) await tx.query(`UPDATE thread_execution_heads h SET epoch=c.active_epoch FROM thread_context c JOIN execution_intents i ON i.epoch=c.active_epoch
      WHERE h.thread_key=$1 AND h.epoch=$2 AND c.thread_key=h.thread_key AND i.state='bound' AND i.execution_id=c.active_execution_id
        AND NOT EXISTS(SELECT 1 FROM execution_intents pending WHERE pending.thread_key=h.thread_key AND pending.state IN ('pending','uncertain'))`,[row.thread_key,epoch])
    await appendEvent(tx,{ idempotencyKey: `execution-intent:${epoch}:${beforeDispatch ? 'failed' : 'uncertain'}`,partition: `session:${row.session_id}`,type: 't.execution.intent',payload: { epoch,workflowId: row.workflow_id,threadKey: row.thread_key,state: beforeDispatch ? 'failed' : 'uncertain' } })
    // Existing conversation surfaces show unresolved starts; they are not
    // buried solely in backend plumbing or interpreted as successful work.
    await appendEvent(tx,{ idempotencyKey: `execution-intent:${epoch}:notice`,partition: `session:${row.session_id}`,type: 't.message.appended',payload: { threadKey: row.session_id,kind: 'tool',message: { id: `execution-start:${epoch}`,name: 'execution.start',state: 'failed',detail: beforeDispatch ? 'A new execution was not started. The launch was rejected before a new execution was created; existing work retains its ownership.' : 'The start outcome is not confirmed. Its durable reservation blocks unsafe recovery; inspect the workflow before retrying.' } } })
  })
}
