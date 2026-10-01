// Outbox repository: table reads plus the LISTEN handle for thread event
// streams (moved from streams/outbox.ts, B7.4 behavior-neutral). Stream
// mechanics (frames, snapshot-overflow, the generator) stay in
// streams/outbox.ts; every SQL statement lives here.
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'
import { DURABLE_STREAM_LOCK_SQL } from './checkpoints.js'

/** A Db that can also hand out a dedicated LISTEN client. pg Pool
 * satisfies this structurally; callers pass the pool through opaquely. */
export type ConnectableDb = Db & { connect(): Promise<PoolClient> }

export interface OutboxRow {
  seq: number | string
  thread_key: string
  type: string
  payload: unknown
  at: Date | string
}

const ThreadKeySchema = z.string().min(1)
const AfterSeqSchema = z.number().int().min(0)

export async function readOutboxBacklog(
  db: Db,
  threadKey: string,
  afterSeq: number,
  limit?: number,
): Promise<OutboxRow[]> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  if (!AfterSeqSchema.safeParse(afterSeq).success) {
    throw new DbContractError('afterSeq must be a non-negative integer')
  }
  if (limit !== undefined && !z.number().int().positive().safeParse(limit).success) {
    throw new DbContractError('limit must be a positive integer')
  }
  const { rows } = await db.query<OutboxRow>(
    `SELECT seq, thread_key, type, payload, at FROM outbox
     WHERE thread_key = $1 AND seq > $2 ORDER BY seq ASC${limit === undefined ? '' : ' LIMIT $3'}`,
    limit === undefined ? [threadKey, afterSeq] : [threadKey, afterSeq, limit],
  )
  return rows
}

/** Publishes one frame; returns the outbox seq. Every thread-affecting
 * projection write calls this exactly once (outbox rule, B3.2). Delta
 * frames are the exemption: activity-published, ephemeral token text that
 * the terminal message event supersedes — never projected, never replayed
 * as history. */
export async function publishOutboxFrame(
  db: Db,
  threadKey: string,
  type: 'message' | 'state' | 'delta' | 'reasoning' | 'tool' | 'context-version' | 'approval' | 'work-progress' | 'compaction' | 'steering-consumption',
  payload: unknown,
): Promise<number> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  if (!['message', 'state', 'delta', 'reasoning', 'tool', 'context-version', 'approval', 'work-progress', 'compaction', 'steering-consumption'].includes(type)) {
    throw new DbContractError("type must be 'message', 'state', 'delta', 'reasoning', or 'tool'")
  }
  const { rows } = await db.query<{ seq: number | string }>(
    `WITH durable_order AS MATERIALIZED (${DURABLE_STREAM_LOCK_SQL})
     INSERT INTO outbox (thread_key, type, payload) SELECT $1, $2, $3::jsonb FROM durable_order RETURNING seq`,
    [threadKey, type, JSON.stringify(payload)],
  )
  const row = rows[0]
  if (!row) throw new Error('publishOutboxFrame: missing RETURNING row')
  return Number(row.seq)
}

/** Retention reaper: delete frames older than the cutoff. Consumers resume
 * from their last good token, so a frame older than the retention window is
 * never replayed — unbounded per-thread growth ends here. Returns the
 * number of deleted frames. */
export async function pruneOutbox(db: Db, olderThan: Date): Promise<number> {
  if (!(olderThan instanceof Date) || !Number.isFinite(olderThan.getTime())) {
    throw new DbContractError('olderThan must be a valid Date')
  }
  const { rowCount } = await db.query('DELETE FROM outbox WHERE at < $1', [olderThan.toISOString()])
  return rowCount ?? 0
}

export async function latestOutboxSeq(db: Db, threadKey: string): Promise<number> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  const { rows } = await db.query<{ max: number | string | null }>(
    'SELECT MAX(seq) AS max FROM outbox WHERE thread_key = $1',
    [threadKey],
  )
  return Number(rows[0]?.max ?? 0)
}

export interface OutboxSubscription {
  onNotification(callback: (payload: string | undefined) => void): void
  close(): Promise<void>
}

/** Dedicated LISTEN client. Closing anyway runs UNLISTEN best-effort. */
export async function subscribeOutbox(db: ConnectableDb): Promise<OutboxSubscription> {
  const listener = await db.connect()
  await listener.query('LISTEN kardata_outbox')
  const notify = (callback: (payload: string | undefined) => void) => (message: unknown): void => {
    callback((message as { payload?: string }).payload)
  }
  const handlers = new Map<(payload: string | undefined) => void, (message: unknown) => void>()
  return {
    onNotification(callback: (payload: string | undefined) => void): void {
      const handler = notify(callback)
      handlers.set(callback, handler)
      listener.on('notification', handler)
    },
    async close(): Promise<void> {
      for (const handler of handlers.values()) listener.removeListener('notification', handler)
      handlers.clear()
      try {
        await listener.query('UNLISTEN kardata_outbox')
      } catch {
        // Closing anyway; release below still runs.
      } finally {
        listener.release()
      }
    },
  }
}
