// Global Meta concurrency limiter (P4.2). A Postgres permit table bounds
// live Meta calls across all worker replicas: the permit table is the
// only limiter shared by every replica without new infrastructure (a
// Temporal task-queue rate limit is per-worker, so it cannot cap the
// fleet). Holders are unique per call; crashed holders expire by lease.
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

/** A crashed holder's permit becomes stealable after the lease, and a
 * waiter gives up after the wait bound (the turn retry re-queues). Both
 * bound the worst case at 10 minutes. Callers override per call. */
const META_PERMIT_LEASE_MS = 600_000
const META_PERMIT_WAIT_MS = 600_000

export class MetaPermitTimeout extends Error {
  readonly code = 'meta_permit_timeout' as const
  constructor(message: string) {
    super(message)
    this.name = 'MetaPermitTimeout'
  }
}

/** Max concurrent Meta calls fleet-wide. Default 4 until the Phase 8
 * ceiling measurement sets it; invalid values fail fast at acquire. */
export function resolveMetaMax(value: string | undefined = process.env['KARDATA_META_MAX_CONCURRENT']): number {
  if (value === undefined || value === '') return 4
  const max = Number(value)
  if (!Number.isInteger(max) || max < 1) throw new DbContractError(`KARDATA_META_MAX_CONCURRENT must be a positive integer, got ${JSON.stringify(value)}`)
  return max
}

/** Converges the permit rows to the configured fleet size: missing slots
 * are inserted, and unheld slots past the max are dropped (held slots are
 * never deleted, so shrinking waits for their release). */
export async function ensureMetaPermits(db: Db, max: number): Promise<void> {
  if (!Number.isInteger(max) || max < 1) throw new DbContractError('max must be a positive integer')
  await db.query('INSERT INTO meta_permits(slot) SELECT g FROM generate_series(0, $1 - 1) g ON CONFLICT(slot) DO NOTHING', [max])
  await db.query('DELETE FROM meta_permits WHERE slot >= $1 AND holder IS NULL', [max])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Acquires one fleet-wide Meta permit, polling until a slot frees, a
 * crashed holder's lease expires, or the wait bound hits. The holder must
 * be unique per call (release clears by holder). */
export async function acquireMetaPermit(
  db: Db,
  holder: string,
  options: { max?: number; leaseMs?: number; waitMs?: number } = {},
): Promise<() => Promise<void>> {
  if (typeof holder !== 'string' || holder.length === 0) throw new DbContractError('holder must be a non-empty string')
  const max = options.max ?? resolveMetaMax()
  const leaseMs = options.leaseMs ?? META_PERMIT_LEASE_MS
  const waitMs = options.waitMs ?? META_PERMIT_WAIT_MS
  if (!Number.isInteger(max) || max < 1) throw new DbContractError('max must be a positive integer')
  const start = Date.now()
  for (;;) {
    await ensureMetaPermits(db, max)
    const { rows } = await db.query<{ slot: number }>(
      `UPDATE meta_permits SET holder = $1, held_at = now() WHERE slot = (
         SELECT slot FROM meta_permits
         WHERE holder IS NULL OR held_at < now() - make_interval(secs => $2)
         ORDER BY slot LIMIT 1 FOR UPDATE SKIP LOCKED
       ) RETURNING slot`,
      [holder, leaseMs / 1000],
    )
    if (rows.length > 0) {
      let released = false
      return async () => {
        if (released) return
        released = true
        await db.query('UPDATE meta_permits SET holder = NULL, held_at = NULL WHERE holder = $1', [holder])
      }
    }
    if (Date.now() - start >= waitMs) throw new MetaPermitTimeout(`no Meta permit freed within ${waitMs} ms`)
    await sleep(200 + Math.floor(Math.random() * 100))
  }
}

/** Runs one Meta call under a fleet permit, always releasing. */
export async function withMetaPermit<T>(
  db: Db,
  holder: string,
  run: () => Promise<T>,
  options: { max?: number; leaseMs?: number; waitMs?: number } = {},
): Promise<T> {
  const release = await acquireMetaPermit(db, holder, options)
  try {
    return await run()
  } finally {
    await release()
  }
}
