// Pool budget validation against max_connections (P4.2.5): a pool that
// fits resolves, a pool past the server ceiling rejects with the env var
// named. Needs TEST_DATABASE_URL like the other db-tier suites.
import { Client } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import { DbContractError, validatePoolBudget } from '../../backend/src/db/index.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('pool budget validation', () => {
  let url = ''

  beforeAll(async () => {
    url = await ensureTestDb('kardata_test_pool_validation')
  }, 120_000)

  async function maxConnections(): Promise<number> {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      const { rows } = await client.query<{ max_connections: string }>('SHOW max_connections')
      return Number(rows[0]?.max_connections)
    } finally {
      await client.end()
    }
  }

  it('accepts a pool within max_connections', async () => {
    const ceiling = await maxConnections()
    expect(Number.isInteger(ceiling) && ceiling > 0).toBe(true)
    await expect(validatePoolBudget(url, ceiling, 'KARDATA_DB_POOL_SERVER')).resolves.toBeUndefined()
    await expect(validatePoolBudget(url, 1, 'KARDATA_DB_POOL_WORKER')).resolves.toBeUndefined()
  })

  it('rejects a pool past max_connections naming the env var', async () => {
    const ceiling = await maxConnections()
    const error = await validatePoolBudget(url, ceiling + 1, 'KARDATA_DB_POOL_WORKER').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(DbContractError)
    expect((error as Error).message).toContain('KARDATA_DB_POOL_WORKER')
    expect((error as Error).message).toContain(`max_connections=${ceiling}`)
  })
})
