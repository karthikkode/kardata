// Fleet pool validation against max_connections minus the superuser
// reserve (P4.2.5): server + worker x replicas. A fitting fleet resolves;
// an over-budget fleet rejects naming every env var. Needs
// TEST_DATABASE_URL like the other db-tier suites. Env is saved and
// restored per test so cases stay order-independent.
import { Client } from 'pg'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DbContractError, validatePoolBudget } from '../../backend/src/db/index.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const VARS = ['KARDATA_DB_POOL_SERVER', 'KARDATA_DB_POOL_WORKER', 'KARDATA_WORKER_REPLICAS']

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(VARS.map((name) => [name, process.env[name]]))
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const name of VARS) {
    const value = snapshot[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

describe.skipIf(!TEST_DATABASE_URL)('pool budget validation [F:db.index.DbContractError] [F:db.index.validatePoolBudget] [F:db.errors.DbContractError] [F:db.pool.validatePoolBudget]', () => {
  let url = ''
  const snapshot = snapshotEnv()
  afterEach(() => restoreEnv(snapshot))

  beforeAll(async () => {
    url = await ensureTestDb('kardata_test_pool_validation')
  }, 120_000)

  async function connectionBudget(): Promise<{ maxConnections: number; reserved: number }> {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      const { rows } = await client.query<{ name: string; setting: string }>(
        `SELECT name, setting FROM pg_settings WHERE name IN ('max_connections', 'superuser_reserved_connections')`,
      )
      return {
        maxConnections: Number(rows.find((row) => row.name === 'max_connections')?.setting),
        reserved: Number(rows.find((row) => row.name === 'superuser_reserved_connections')?.setting),
      }
    } finally {
      await client.end()
    }
  }

  it('accepts a fleet within max_connections minus the reserve', async () => {
    const { maxConnections: ceiling, reserved } = await connectionBudget()
    expect(Number.isInteger(ceiling) && ceiling > 0).toBe(true)
    // A server that cannot host even 2 connections is broken infra, not
    // a passing test: fail loudly instead of asserting a rejection.
    expect(ceiling - reserved).toBeGreaterThanOrEqual(2)
    process.env['KARDATA_DB_POOL_SERVER'] = '1'
    process.env['KARDATA_DB_POOL_WORKER'] = '1'
    process.env['KARDATA_WORKER_REPLICAS'] = '1'
    await expect(validatePoolBudget(url)).resolves.toBeUndefined()
  })

  it('rejects an over-budget fleet naming every env var', async () => {
    const { maxConnections: ceiling } = await connectionBudget()
    // ceiling + worker x replicas always exceeds ceiling - reserved.
    process.env['KARDATA_DB_POOL_SERVER'] = String(ceiling)
    process.env['KARDATA_DB_POOL_WORKER'] = '1'
    process.env['KARDATA_WORKER_REPLICAS'] = '1'
    const error = await validatePoolBudget(url).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(DbContractError)
    expect((error as Error).message).toContain('KARDATA_DB_POOL_SERVER')
    expect((error as Error).message).toContain('KARDATA_DB_POOL_WORKER')
    expect((error as Error).message).toContain('KARDATA_WORKER_REPLICAS')
    expect((error as Error).message).toContain(`max_connections=${ceiling}`)
  })

  it('multiplies the worker budget by the replica count', async () => {
    const { maxConnections: ceiling, reserved } = await connectionBudget()
    expect(ceiling - reserved).toBeGreaterThanOrEqual(2)
    // Same budgets: one replica fits, ceiling replicas cannot.
    process.env['KARDATA_DB_POOL_SERVER'] = '1'
    process.env['KARDATA_DB_POOL_WORKER'] = '1'
    process.env['KARDATA_WORKER_REPLICAS'] = '1'
    await expect(validatePoolBudget(url)).resolves.toBeUndefined()
    process.env['KARDATA_WORKER_REPLICAS'] = String(ceiling)
    await expect(validatePoolBudget(url)).rejects.toBeInstanceOf(DbContractError)
  })
})
