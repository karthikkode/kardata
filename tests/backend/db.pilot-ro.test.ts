// Phase 8 B2: the pilot read-only role connects and SELECTs but can not
// INSERT, UPDATE, DELETE, or run DDL — on current and future tables.
// Live Postgres, isolated database; the role name is test-scoped so a
// rerun can never rotate a real pilot credential. Dropped afterwards.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PILOT_RO_ROLE, pilotRoStatements } from '../../deployment/scripts/stack-lib.mjs'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ROLE = `${PILOT_RO_ROLE}_test`
const PASSWORD = 'TEST-ro-password'

describe.skipIf(!TEST_DATABASE_URL)('pilot read-only role [F:stack.pilotRoStatements]', () => {
  let owner: Pool
  let ro: Pool
  let dbName: string

  beforeAll(async () => {
    const connectionString = await ensureTestDb('kardata_test_pilot_ro')
    const url = new URL(connectionString)
    dbName = url.pathname.replace(/^\//, '')
    owner = new Pool({ connectionString })
    await owner.query('CREATE TABLE ro_probe_before (id integer PRIMARY KEY, v text)')
    await owner.query("INSERT INTO ro_probe_before VALUES (1, 'TEST')")
    for (const statement of pilotRoStatements({ role: ROLE, owner: url.username, password: PASSWORD, database: dbName })) {
      await owner.query(statement)
    }
    await owner.query('CREATE TABLE ro_probe_after (id integer PRIMARY KEY, v text)')
    await owner.query("INSERT INTO ro_probe_after VALUES (1, 'TEST')")
    url.username = ROLE
    url.password = PASSWORD
    ro = new Pool({ connectionString: url.toString() })
  })
  afterAll(async () => {
    await ro?.end()
    await owner?.query(`DROP ROLE IF EXISTS "${ROLE}"`).catch(() => undefined)
    await owner?.end()
  })

  it('SELECTs current and future tables', async () => {
    expect((await ro.query('SELECT v FROM ro_probe_before WHERE id = 1')).rows[0]).toMatchObject({ v: 'TEST' })
    expect((await ro.query('SELECT v FROM ro_probe_after WHERE id = 1')).rows[0]).toMatchObject({ v: 'TEST' })
  })

  it('cannot INSERT, UPDATE, or DELETE', async () => {
    await expect(ro.query("INSERT INTO ro_probe_before VALUES (2, 'TEST')")).rejects.toThrow(/permission denied/i)
    await expect(ro.query("UPDATE ro_probe_before SET v = 'TEST' WHERE id = 1")).rejects.toThrow(/permission denied/i)
    await expect(ro.query('DELETE FROM ro_probe_before WHERE id = 1')).rejects.toThrow(/permission denied/i)
  })

  it('cannot run DDL', async () => {
    await expect(ro.query('CREATE TABLE ro_probe_evil (id integer)')).rejects.toThrow(/permission denied/i)
    await expect(ro.query('DROP TABLE ro_probe_before')).rejects.toThrow(/permission denied|must be owner/i)
  })
})
