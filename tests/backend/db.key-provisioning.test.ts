import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerApiKey, findKeyByHash } from '../../backend/src/db/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
describe.skipIf(!TEST_DATABASE_URL)('owner-authorized scoped key provisioning', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_key_provision'), max: 3 }) }, 120_000)
  afterAll(async () => { await pool?.end() })
  it('coalesces identical provisioning and stores only hashed credentials', async () => {
    const input = { keyId: 'TEST approver', keyHash: hash('TEST local-only credential'), scope: { tenantId: 'TEST pilot', projectId: 'TEST project' }, role: 'approver' as const }
    const records = await Promise.all(Array.from({ length: 10 }, () => registerApiKey(pool, input)))
    expect(records.every((record) => record.roles === 'approver' && record.project_id === 'TEST project')).toBe(true)
    const result = await pool.query<{ key_hash: string; count: string }>('SELECT key_hash, count(*)::text AS count FROM api_keys GROUP BY key_hash')
    expect(result.rows).toEqual([{ key_hash: input.keyHash, count: '1' }])
    expect(await findKeyByHash(pool, input.keyHash)).toEqual({ key_id: input.keyId, tenant_id: input.scope.tenantId, project_id: input.scope.projectId, roles: 'approver' })
  })
  it('does not upgrade or re-scope an existing operator credential', async () => {
    const input = { keyId: 'TEST unchanged operator', keyHash: hash('TEST operator credential'), scope: { tenantId: 'TEST original', projectId: null }, role: 'operator' as const }
    await registerApiKey(pool, input)
    await expect(registerApiKey(pool, { ...input, role: 'approver' })).rejects.toThrow(/conflict/i)
    await expect(registerApiKey(pool, { ...input, scope: { tenantId: 'TEST other', projectId: null } })).rejects.toThrow(/conflict/i)
    expect(await findKeyByHash(pool, input.keyHash)).toMatchObject({ roles: 'operator', tenant_id: 'TEST original' })
  })
  it('rejects duplicate hash identities and raw/invalid credential inputs', async () => {
    const input = { keyId: 'TEST hash identity', keyHash: hash('TEST one identity'), scope: { tenantId: 'TEST pilot', projectId: null }, role: 'viewer' as const }
    await registerApiKey(pool, input)
    await expect(registerApiKey(pool, { ...input, keyId: 'TEST different identity' })).rejects.toThrow(/conflict/i)
    await expect(registerApiKey(pool, { ...input, keyHash: 'TEST raw credential' })).rejects.toThrow()
    expect(await findKeyByHash(pool, input.keyHash)).toMatchObject({ key_id: input.keyId, roles: 'viewer' })
  })
})
