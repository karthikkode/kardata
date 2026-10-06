// Global Meta concurrency limiter (P4.2). A Postgres permit table bounds
// live Meta calls across all worker replicas: the permit table is the
// only limiter shared by every replica without new infrastructure (a
// Temporal task-queue rate limit is per-worker, so it cannot cap the
// fleet). Holders are unique per call; crashed holders expire by lease.
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

/** A crashed holder's permit becomes stealable after the lease: 2x the
 * longest round timeout (180 s plan), renewed while held so only crashed
 * holders are ever reclaimed. Waiters give up after the wait bound (the
 * turn retry re-queues). Callers override per call. */
const META_PERMIT_LEASE_MS = 360_000
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

/** Poll sleep that wakes early on abort (the waiter rejects with the abort
 * reason instead of sleeping out the interval, then the wait bound). */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return sleep(ms)
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const onAbort = (): void => { cleanup(); reject(signal.reason ?? new Error('permit wait aborted')) }
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Acquires one fleet-wide Meta permit, polling until a slot frees, a
 * crashed holder's lease expires, or the wait bound hits. The holder must
 * be unique per call (release clears by holder). The poll honors `signal`
 * (owner cancellation stops the wait) and calls `heartbeat` every pass so
 * a long wait never looks wedged. */
export async function acquireMetaPermit(
  db: Db,
  holder: string,
  options: { max?: number; leaseMs?: number; waitMs?: number; signal?: AbortSignal; heartbeat?: () => void } = {},
): Promise<() => Promise<void>> {
  if (typeof holder !== 'string' || holder.length === 0) throw new DbContractError('holder must be a non-empty string')
  const max = options.max ?? resolveMetaMax()
  const leaseMs = options.leaseMs ?? META_PERMIT_LEASE_MS
  const waitMs = options.waitMs ?? META_PERMIT_WAIT_MS
  if (!Number.isInteger(max) || max < 1) throw new DbContractError('max must be a positive integer')
  const { signal, heartbeat } = options
  const start = Date.now()
  for (;;) {
    signal?.throwIfAborted()
    heartbeat?.()
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
      // Live holders renew at a third of the lease: the short lease only
      // reclaims crashed holders, never a slow vendor call. Unref'd so a
      // leaked permit never pins the process; cleared on release.
      const renew = setInterval(() => {
        db.query('UPDATE meta_permits SET held_at = now() WHERE holder = $1', [holder]).catch(() => undefined)
      }, Math.max(50, Math.floor(leaseMs / 3)))
      renew.unref()
      return async () => {
        if (released) return
        released = true
        clearInterval(renew)
        // Never throws: retry with backoff, then let the lease reclaim the
        // slot. A throwing release would replace a paid vendor response
        // with an error and pay the vendor twice on retry.
        for (let attempt = 0; ; attempt += 1) {
          try {
            await db.query('UPDATE meta_permits SET holder = NULL, held_at = NULL WHERE holder = $1', [holder])
            return
          } catch {
            if (attempt >= 4) return
            await sleep(100 * 2 ** attempt)
          }
        }
      }
    }
    if (Date.now() - start >= waitMs) throw new MetaPermitTimeout(`no Meta permit freed within ${waitMs} ms`)
    await abortableSleep(200 + Math.floor(Math.random() * 100), signal)
  }
}

/** Runs one Meta call under a fleet permit, always releasing. */
export async function withMetaPermit<T>(
  db: Db,
  holder: string,
  run: () => Promise<T>,
  options: { max?: number; leaseMs?: number; waitMs?: number; signal?: AbortSignal; heartbeat?: () => void } = {},
): Promise<T> {
  const release = await acquireMetaPermit(db, holder, options)
  try {
    return await run()
  } finally {
    await release()
  }
}
