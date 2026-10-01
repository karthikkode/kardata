// Checkpoints repository: projection_checkpoints rows plus the
// serialized transaction they gate (moved from projector.ts, B7.6
// behavior-neutral). Concurrent projectors serialize on a transaction-
// scoped advisory lock; the loser waits, then finds nothing new.
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

/** A Db that can hand out a transaction client. pg Pool satisfies this
 * structurally; callers pass the pool through opaquely. */
export type TransactableDb = Db & { connect(): Promise<PoolClient> }
/** Both durable streams share one lock: transactions cannot invert event
 * and outbox lock order, and cursors cannot overtake uncommitted seqs. */
export const DURABLE_STREAM_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('kardata:durable-stream'))"

/** Transaction handle: the client query surface plus checkpoint reads and
 * writes bound to the open transaction. */
export interface CheckpointTx extends Db {
  checkpointSeq(): Promise<number>
  storeCheckpointSeq(seq: number): Promise<void>
}

const NameSchema = z.string().min(1)
const SeqSchema = z.number().int().min(0)

/**
 * Runs fn inside one transaction behind the projector advisory lock.
 * Commits on success, rolls back on error, always releases the client.
 */
export async function runCheckpointTx<T>(
  db: TransactableDb,
  checkpoint: string,
  fn: (tx: CheckpointTx) => Promise<T>,
): Promise<T> {
  if (!NameSchema.safeParse(checkpoint).success) {
    throw new DbContractError('checkpoint must be a non-empty string')
  }
  if (typeof fn !== 'function') throw new DbContractError('fn must be a function')
  const client = await db.connect()
  const tx: CheckpointTx = {
    query: async <TRow>(text: string, params?: unknown[]) => {
      const result = await client.query(text, params)
      return { rowCount: result.rowCount, rows: result.rows as TRow[] }
    },
    checkpointSeq: async (): Promise<number> => {
      const { rows } = await client.query<{ seq: number | string }>(
        `INSERT INTO projection_checkpoints (name, seq) VALUES ($1, 0)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING seq`,
        [checkpoint],
      )
      return Number(rows[0]?.seq ?? 0)
    },
    storeCheckpointSeq: async (seq: number): Promise<void> => {
      if (!SeqSchema.safeParse(seq).success) {
        throw new DbContractError('seq must be a non-negative integer')
      }
      await client.query('UPDATE projection_checkpoints SET seq = $2 WHERE name = $1', [checkpoint, seq])
    },
  }
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kardata-projector'))")
    const result = await fn(tx)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
