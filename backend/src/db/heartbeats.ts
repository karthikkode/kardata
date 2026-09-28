// Heartbeats repository: operation liveness rows for the stall sweeper
// (moved from observability/heartbeats.ts, B7.4 behavior-neutral). One row
// per (run, op), upserted with a 5 s in-process throttle: the table is a
// liveness signal, not a trace, so sub-threshold beats would be pure write
// burn. The throttle cache is ephemeral performance state, never
// authoritative — worst case is one extra row write.
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

/** Minimum milliseconds between table writes for one (run, op). */
export const HEARTBEAT_WRITE_MS = 5_000

const lastWrite = new Map<string, number>()

export function heartbeatThrottleKey(runId: string, op: string): string {
  return `${runId}:${op}`
}

const RunIdSchema = z.string().min(1)
const OpSchema = z.string().min(1)

export async function recordHeartbeat(
  db: Db,
  runId: string,
  op: string,
  busy: boolean,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new DbContractError('runId must be a non-empty string')
  }
  if (!OpSchema.safeParse(op).success) {
    throw new DbContractError('op must be a non-empty string')
  }
  if (typeof busy !== 'boolean') throw new DbContractError('busy must be a boolean')
  if (!Number.isFinite(nowMs)) throw new DbContractError('nowMs must be finite')
  const key = heartbeatThrottleKey(runId, op)
  const last = lastWrite.get(key)
  if (last !== undefined && nowMs - last < HEARTBEAT_WRITE_MS) return
  lastWrite.set(key, nowMs)
  await db.query(
    `INSERT INTO heartbeats (run_id, op, at, busy)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (run_id, op)
     DO UPDATE SET at = EXCLUDED.at, busy = EXCLUDED.busy`,
    [runId, op, busy],
  )
}

export interface StoredHeartbeat {
  runId: string
  atMs: number
  busy: boolean
}

/** Latest beat per run across all ops: any busy op marks the run busy. */
export async function listHeartbeats(db: Db): Promise<StoredHeartbeat[]> {
  const { rows } = await db.query<{
    run_id: string
    at: Date
    busy: boolean
  }>(
    `SELECT run_id, max(at) AS at, bool_or(busy) AS busy
     FROM heartbeats GROUP BY run_id`,
    [],
  )
  return rows.map((row) => ({
    runId: row.run_id,
    atMs: row.at instanceof Date ? row.at.getTime() : new Date(row.at).getTime(),
    busy: row.busy,
  }))
}

/** Retention reaper: delete liveness rows older than the cutoff. Closed
 * runs stop beating, so without this their final row goes stale forever.
 * Returns the number of deleted rows. */
export async function pruneHeartbeats(db: Db, olderThan: Date): Promise<number> {
  if (!(olderThan instanceof Date) || !Number.isFinite(olderThan.getTime())) {
    throw new DbContractError('olderThan must be a valid Date')
  }
  const { rowCount } = await db.query('DELETE FROM heartbeats WHERE at < $1', [olderThan.toISOString()])
  return rowCount ?? 0
}
