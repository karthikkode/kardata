// Single pool factory for the DB access layer (B7.1). Every product-code
// pool comes from here so connection settings live in one place.
// pg pools are lazy: construction never connects, preserving the
// start-without-DB behavior the server and activities rely on.
//
// Defaults mirror node-postgres out of the box (behavior-neutral move);
// per-process budgets (statement timeouts, max connections for the
// server vs each worker) land here in slice 7 with the B5.6 numbers.
import { Pool } from 'pg'
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

/** Effective server budget: env wins, code default fills gaps. */
export function serverPoolBudget(): PoolBudget {
  return {
    max: envPositiveInt('KARDATA_PG_SERVER_MAX', DEFAULT_POOL_BUDGET.max),
    statementTimeoutMs: envPositiveInt(
      'KARDATA_PG_STATEMENT_TIMEOUT_MS',
      DEFAULT_POOL_BUDGET.statementTimeoutMs,
    ),
  }
}

/** Effective worker budget: env wins, code default fills gaps. */
export function workerPoolBudget(): PoolBudget {
  return {
    max: envPositiveInt('KARDATA_PG_WORKER_MAX', WORKER_POOL_BUDGET.max),
    statementTimeoutMs: envPositiveInt(
      'KARDATA_PG_STATEMENT_TIMEOUT_MS',
      DEFAULT_POOL_BUDGET.statementTimeoutMs,
    ),
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

/** HTTP server budget: serves routes + projector catch-up. */
export const SERVER_POOL_BUDGET: Required<PoolBudget> = {
  ...DEFAULT_POOL_BUDGET,
  max: 10,
}

/** Worker budget: one shared pool per worker process; activities are
 * I/O-light event/heartbeat writes, so it runs smaller than the server. */
export const WORKER_POOL_BUDGET: Required<PoolBudget> = {
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
