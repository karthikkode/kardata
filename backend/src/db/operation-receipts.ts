// Execution receipts are research records, not operational log bodies.
import { createHash } from 'node:crypto'
import type { Scope } from '../auth/types.js'
import { appendEvent, findEventByKey, type Db } from './events.js'
import { requireThread, WorkspaceError } from './workspace.js'

export interface OperationReceiptIdentity { keyId: string; operationId: string; threadKey: string; fingerprint: string; toolName: string }
const key = (identity: Pick<OperationReceiptIdentity, 'keyId' | 'operationId'>, kind: string) => `mcp-receipt:${createHash('sha256').update(JSON.stringify([identity.keyId, identity.operationId])).digest('hex')}:${kind}`
export async function recordOperationIntent(db: Db, identity: OperationReceiptIdentity): Promise<void> {
  await appendEvent(db, { idempotencyKey: key(identity, 'intent'), partition: identity.threadKey, type: 't.operation.intent', payload: identity })
  const stored = await findEventByKey(db, key(identity, 'intent'))
  const prior = stored?.payload as OperationReceiptIdentity | undefined
  if (stored?.partition !== identity.threadKey || prior?.fingerprint !== identity.fingerprint || prior?.toolName !== identity.toolName) throw new WorkspaceError('conflict', 'The recorded operation has a different execution identity. Its effect remains protected.')
}
export async function recordOperationResult(db: Db, identity: OperationReceiptIdentity, status: number, body: unknown): Promise<void> {
  await appendEvent(db, { idempotencyKey: key(identity, 'result'), partition: identity.threadKey, type: 't.operation.result', payload: { ...identity, status, body } })
}
export async function recoverOperationResult(db: Db, identity: OperationReceiptIdentity): Promise<{ status: number; body: unknown } | undefined> {
  const event = await findEventByKey(db, key(identity, 'result'))
  if (!event || event.partition !== identity.threadKey) return undefined
  const receipt = event.payload as OperationReceiptIdentity & { status: number; body: unknown }
  if (receipt.fingerprint !== identity.fingerprint || receipt.keyId !== identity.keyId || receipt.operationId !== identity.operationId || receipt.toolName !== identity.toolName) return undefined
  return { status: receipt.status, body: receipt.body }
}
export async function inspectOperationReceipt(db: Db, threadKey: string, operationId: string, scope?: Scope): Promise<{ operationId: string; toolName?: string; state: 'confirmed' | 'unresolved'; reason: string; recordedAt?: string }> {
  await requireThread(db, threadKey, scope)
  // The continuation, not caller-provided key IDs, authorizes the lookup.
  const { rows } = await db.query<{ payload: OperationReceiptIdentity; at: Date }>(
    `SELECT payload, at FROM events WHERE partition=$1 AND type='t.operation.intent' AND payload->>'operationId'=$2 ORDER BY seq DESC LIMIT 1`, [threadKey, operationId])
  const row = rows[0]
  if (!row) {
    const { rows: pending } = await db.query<{ present: boolean }>(`SELECT EXISTS (SELECT 1 FROM thread_context WHERE thread_key=$1 AND working_meta->'blockedOperations' @> $2::jsonb) AS present`, [threadKey, JSON.stringify([{ operationId }])])
    if (!pending[0]?.present) throw new WorkspaceError('not_found', 'No operation receipt in this conversation.')
    return { operationId, state: 'unresolved', reason: 'Legacy or unavailable receipt: the effect cannot be proven. The original operation remains blocked.' }
  }
  const result = await recoverOperationResult(db, row.payload)
  return { operationId, toolName: row.payload.toolName, state: result ? 'confirmed' : 'unresolved', recordedAt: row.at.toISOString(), reason: result ? 'A durable successful reply is recorded. Resume checks the original operation without repeating the change; authority or guard conflicts remain blocked.' : 'No durable successful reply is recorded. The effect may have happened; the claim remains protected.' }
}
