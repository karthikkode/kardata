// Quotas repository: rate_windows counters and idempotency_records claims
// (moved from http/limits.ts, B7.3 behavior-neutral). Pure helpers
// (rateBucket, hashKey, mutationFingerprint) stay in http/limits.ts.
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

export interface RateDecision {
  allowed: boolean
  count: number
  limit: number
  retryAfterSec: number
}

const BucketSchema = z.string().min(1)
const LimitSchema = z.number().int().positive()
const KeySchema = z.string().min(1)
const FingerprintSchema = z.string().min(1)
const StatusSchema = z.number().int().min(100).max(599)

function reject(what: string): never {
  throw new DbContractError(what)
}

export async function checkRate(
  db: Db,
  bucket: string,
  limitPerMin: number,
  nowMs: number = Date.now(),
): Promise<RateDecision> {
  if (!BucketSchema.safeParse(bucket).success) reject('bucket must be a non-empty string')
  if (!LimitSchema.safeParse(limitPerMin).success) reject('limitPerMin must be a positive integer')
  if (!Number.isFinite(nowMs)) reject('nowMs must be finite')
  const windowStart = Math.floor(nowMs / 60_000)
  const row = await db.query<{ count: number }>(
    `INSERT INTO rate_windows (bucket, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start)
     DO UPDATE SET count = rate_windows.count + 1
     RETURNING count`,
    [bucket, windowStart],
  )
  const count = row.rows[0]?.count ?? 1
  // Piggyback cleanup of expired windows; best effort.
  void db
    .query(`DELETE FROM rate_windows WHERE window_start < $1`, [windowStart - 1])
    .catch(() => undefined)
  const retryAfterSec = Math.max(1, 60 - Math.floor((nowMs - windowStart * 60_000) / 1000))
  return { allowed: count <= limitPerMin, count, limit: limitPerMin, retryAfterSec }
}

export type IdempotencyOutcome =
  | { kind: 'proceed' }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'conflict'; reason: string }

/**
 * Claim an idempotency key before executing a mutation. Returns `proceed`
 * for first use (caller executes then calls `completeIdempotency`), `replay`
 * with the stored response for an identical retry, or `conflict` when the
 * key was used for a different request or a twin execution is in flight.
 * The claim insert is the concurrency guard: exactly one twin wins.
 */
export async function claimIdempotency(
  db: Db,
  key: string,
  fingerprint: string,
): Promise<IdempotencyOutcome> {
  if (!KeySchema.safeParse(key).success) reject('key must be a non-empty string')
  if (!FingerprintSchema.safeParse(fingerprint).success) {
    reject('fingerprint must be a non-empty string')
  }
  // Fast path: a completed record with the same fingerprint replays.
  const existing = await db.query<{
    fingerprint: string
    state: string
    status: number | null
    response: unknown
  }>(`SELECT fingerprint, state, status, response FROM idempotency_records WHERE key = $1`, [key])
  const row = existing.rows[0]
  if (row) {
    if (row.state === 'completed') {
      if (row.fingerprint === fingerprint) {
        return { kind: 'replay', status: row.status ?? 200, body: row.response }
      }
      return {
        kind: 'conflict',
        reason: 'idempotency key was already used for a different request',
      }
    }
    return { kind: 'conflict', reason: 'request with this idempotency key is already in progress' }
  }
  const claimed = await db.query(
    `INSERT INTO idempotency_records (key, fingerprint, state)
     VALUES ($1, $2, 'in_progress')
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key, fingerprint],
  )
  if (claimed.rowCount === 0) {
    // A twin claimed between our read and insert; re-read for the verdict.
    return claimIdempotency(db, key, fingerprint)
  }
  return { kind: 'proceed' }
}

export async function completeIdempotency(
  db: Db,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (!KeySchema.safeParse(key).success) reject('key must be a non-empty string')
  if (!StatusSchema.safeParse(status).success) reject('status must be an HTTP status code')
  await db.query(
    `UPDATE idempotency_records SET state = 'completed', status = $2, response = $3 WHERE key = $1`,
    [key, status, JSON.stringify(body ?? null)],
  )
}

/** Retention sweeper (the B6 sweeper migration 0006 promises): age out
 * completed replay records older than the cutoff. In-progress claims are
 * never touched — a slow mutation must not lose its guard. Returns the
 * number of deleted records. */
export async function sweepIdempotency(db: Db, olderThan: Date): Promise<number> {
  if (!(olderThan instanceof Date) || !Number.isFinite(olderThan.getTime())) {
    throw new DbContractError('olderThan must be a valid Date')
  }
  const { rowCount } = await db.query(
    `DELETE FROM idempotency_records WHERE state = 'completed' AND created_at < $1`,
    [olderThan.toISOString()],
  )
  return rowCount ?? 0
}

/** Drop an in-progress claim so a failed mutation can be retried. */
export async function releaseIdempotency(db: Db, key: string): Promise<void> {
  if (!KeySchema.safeParse(key).success) reject('key must be a non-empty string')
  await db.query(`DELETE FROM idempotency_records WHERE key = $1 AND state = 'in_progress'`, [key])
}
