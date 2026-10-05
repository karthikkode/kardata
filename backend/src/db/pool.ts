// Single pool factory for the DB access layer (B7.1). Every product-code
// pool comes from here so connection settings live in one place.
// pg pools are lazy: construction never connects, preserving the
// start-without-DB behavior the server and activities rely on.
//
// Defaults mirror node-postgres out of the box (behavior-neutral move);
// per-process budgets (statement timeouts, max connections for the
// server vs each worker) land here in slice 7 with the B5.6 numbers.
import { Client, Pool } from 'pg'
import type { Logger } from 'pino'
import { DbContractError } from './errors.js'

export interface PoolBudget {
  /** Max clients per pool. Defaults to node-postgres default (10). */
  max?: number
  /** Idle client eviction. Defaults to node-postgres default (10 s). */
  idleTimeoutMs?: number
  /** Kill runaway queries past this. No default: set per process. */
  statementTimeoutMs?: number
}

export const DEFAULT_POOL_BUDGET: Required<PoolBudget> = {
  max: 10,
  idleTimeoutMs: 10_000,
  statementTimeoutMs: 30_000,
}

/** Env overrides (compose sets these; unset means the code default).
 * Invalid values throw DbContractError at startup — a misconfigured pool
 * must fail fast, not silently run small. */
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DbContractError(`env ${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return parsed
}

/** Effective server budget: env wins, code default fills gaps. Both
 * fields always resolve (no `??` needed downstream). */
export function serverPoolBudget(): { max: number; statementTimeoutMs: number } {
  return {
    max: envPositiveInt('KARDATA_DB_POOL_SERVER', DEFAULT_POOL_BUDGET.max),
    statementTimeoutMs: envPositiveInt(
      'KARDATA_PG_STATEMENT_TIMEOUT_MS',
      DEFAULT_POOL_BUDGET.statementTimeoutMs,
    ),
  }
}

/** Effective worker budget: env wins, code default fills gaps. Both
 * fields always resolve (no `??` needed downstream). */
export function workerPoolBudget(): { max: number; statementTimeoutMs: number } {
  return {
    max: envPositiveInt('KARDATA_DB_POOL_WORKER', WORKER_POOL_BUDGET.max),
    statementTimeoutMs: envPositiveInt(
      'KARDATA_PG_STATEMENT_TIMEOUT_MS',
      DEFAULT_POOL_BUDGET.statementTimeoutMs,
    ),
  }
}

/** Startup guard (P4.2.5): the pool must fit inside the server's
 * `max_connections`. Over budget throws DbContractError naming the env
 * var — fail fast, not a wedged pool at runtime. Unreachable DB (or an
 * unreadable setting) only warns: the server boots without a database,
 * so validation never blocks startup, it just skips. Uses a dedicated
 * 2 s client, never the lazy product pool. */
export async function validatePoolBudget(
  connectionString: string,
  max: number,
  envName: string,
  logger?: Logger,
): Promise<void> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 2000 })
  try {
    await client.connect()
  } catch (error) {
    logger?.warn(
      { op: 'db.pool.validate', env: envName, code: error instanceof Error ? error.message : String(error) },
      'pool budget validation skipped: Postgres unreachable',
    )
    return
  }
  try {
    const { rows } = await client.query<{ max_connections: string }>('SHOW max_connections')
    const maxConnections = Number(rows[0]?.max_connections)
    if (!Number.isInteger(maxConnections) || maxConnections <= 0) {
      logger?.warn({ op: 'db.pool.validate', env: envName }, 'pool budget validation skipped: unreadable max_connections')
      return
    }
    if (max > maxConnections) {
      throw new DbContractError(
        `env ${envName}=${max} exceeds Postgres max_connections=${maxConnections}: lower ${envName} or raise max_connections`,
      )
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}

export interface PoolStat {
  name: string
  total: number
  idle: number
  waiting: number
}

const livePools = new Map<Pool, string>()

function registerPool(pool: Pool, name: string): Pool {
  livePools.set(pool, name)
  return pool
}

/** Process-local pool telemetry for the pool gauges. Sums across every
 * pool this process created (server holds one; workers hold one each). */
export function poolStats(): PoolStat[] {
  return [...livePools.entries()].map(([pool, name]) => ({
    name,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  }))
}

export function createDbPool(connectionString: string, budget: PoolBudget = {}, name = 'server'): Pool {
  const merged = { ...DEFAULT_POOL_BUDGET, ...budget }
  return registerPool(
    new Pool({
      connectionString,
      max: merged.max,
      idleTimeoutMillis: merged.idleTimeoutMs,
      statement_timeout: merged.statementTimeoutMs,
    }),
    name,
  )
}

/** Worker budget: one shared pool per worker process; activities are
 * I/O-light event/heartbeat writes, so it runs smaller than the server. */
const WORKER_POOL_BUDGET: Required<PoolBudget> = {
  ...DEFAULT_POOL_BUDGET,
  max: 5,
}

const workerPools = new Map<string, Pool>()

/** Worker-side pool from DATABASE_URL, shared per process. Lazy:
 * construction never connects. Replaces the per-activity copies. */
export function workerPoolFromEnv(): Pool {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) throw new Error('DATABASE_URL is required for event activities')
  let pool = workerPools.get(connectionString)
  if (!pool) {
    pool = createDbPool(connectionString, workerPoolBudget(), 'worker')
    workerPools.set(connectionString, pool)
  }
  return pool
}
