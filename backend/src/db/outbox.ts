// Outbox repository: table reads plus the LISTEN handle for thread event
// streams (moved from streams/outbox.ts, B7.4 behavior-neutral). Stream
// mechanics (frames, snapshot-overflow, the generator) stay in
// streams/outbox.ts; every SQL statement lives here.
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'
import { DURABLE_STREAM_LOCK_SQL } from './checkpoints.js'
import { createLogger, logOp } from '../observability/logging.js'

const subscriptionLogger = createLogger({ op: 'db.outbox.subscription' })

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
  onError(callback: (error: Error) => void): void
  close(): Promise<void>
}

/** Dedicated LISTEN client. Failed setup/cleanup destroys the lease;
 * close is idempotent, including its failure result. */
export async function subscribeOutbox(db: ConnectableDb): Promise<OutboxSubscription> {
  const listener = await logOp(subscriptionLogger, 'db.outbox.acquire', () => db.connect())
  let failure: Error | undefined
  let released = false
  const errorHandlers = new Set<(error: Error) => void>()
  const release = (destroy = false): void => {
    if (released) return
    released = true
    if (destroy) listener.release(true)
    else listener.release()
  }
  const onError = (error: Error): void => {
    if (failure) return
    failure = error
    subscriptionLogger.error({ event: 'db.outbox.connection.error', op: 'db.outbox.connection', code: 'code' in error ? error.code : error.name })
    release(true)
    for (const callback of errorHandlers) callback(error)
  }
  // pg-pool removes its idle error handler while this client is leased.
  listener.on('error', onError)
  try {
    await logOp(subscriptionLogger, 'db.outbox.subscribe', async () => {
      await listener.query('LISTEN kardata_outbox')
      if (failure) throw failure
    })
  } catch (error) {
    release(true)
    throw error
  }
  const notify = (callback: (payload: string | undefined) => void) => (message: unknown): void => {
    callback((message as { payload?: string }).payload)
  }
  const handlers = new Map<(payload: string | undefined) => void, (message: unknown) => void>()
  let closing: Promise<void> | undefined
  return {
    onNotification(callback: (payload: string | undefined) => void): void {
      if (closing || failure || handlers.has(callback)) return
      const handler = notify(callback)
      handlers.set(callback, handler)
      listener.on('notification', handler)
    },
    onError(callback: (error: Error) => void): void {
      if (failure) callback(failure)
      else if (!closing) errorHandlers.add(callback)
    },
    close(): Promise<void> {
      if (closing) return closing
      for (const handler of handlers.values()) listener.removeListener('notification', handler)
      handlers.clear()
      errorHandlers.clear()
      closing = logOp(subscriptionLogger, 'db.outbox.unsubscribe', async () => {
        try {
          if (failure) throw failure
          await listener.query('UNLISTEN kardata_outbox')
          if (failure) throw failure
        } catch (error) {
          release(true)
          throw error
        }
        listener.removeListener('error', onError)
        release()
      })
      return closing
    },
  }
}
