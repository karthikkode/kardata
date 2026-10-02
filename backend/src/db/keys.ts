// Keys repository: reads on api_keys (moved from auth/keys.ts, B7.3
// behavior-neutral). Auth semantics (roles, scope, denial reasons) stay in
// auth/keys.ts; this module only fetches and validates the row.
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'
import { createLogger, logOp } from '../observability/logging.js'

const KeyRow = z.object({
  key_id: z.string().min(1),
  tenant_id: z.string().min(1),
  project_id: z.string().min(1).nullable(),
  roles: z.string().min(1),
})

export type KeyRecord = z.infer<typeof KeyRow>

const ProvisionKey = z.object({
  keyId: z.string().trim().min(1).max(128),
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.object({ tenantId: z.string().min(1), projectId: z.string().min(1).nullable() }).strict(),
  role: z.enum(['viewer', 'operator', 'approver']),
}).strict()
const provisioningLogger = createLogger({ op: 'db.key.provision' })

/** Administrative bootstrap only, under explicit owner instruction.
 * Deliberately absent from HTTP/MCP tool surfaces. Never accept raw keys. */
export async function registerApiKey(db: Db, input: z.input<typeof ProvisionKey>): Promise<KeyRecord> {
  return logOp(provisioningLogger, 'db.key.provision', async () => {
    const parsed = ProvisionKey.safeParse(input)
    if (!parsed.success) throw new DbContractError('Invalid hashed key provisioning input')
    const { keyId, keyHash, scope, role } = parsed.data
    try {
      const { rows } = await db.query(
        `INSERT INTO api_keys(key_id,key_hash,tenant_id,project_id,roles) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING
         RETURNING key_id,tenant_id,project_id,roles`,
        [keyId, keyHash, scope.tenantId, scope.projectId, role],
      )
      if (rows[0]) return KeyRow.parse(rows[0])
      // A second READ COMMITTED statement sees a winning concurrent insert.
      // Targeting only key_id misses a twin conflict on the separate hash index.
      const existing = await findKeyByHash(db, keyHash)
      if (!existing || existing.key_id !== keyId || existing.tenant_id !== scope.tenantId || existing.project_id !== scope.projectId || existing.roles !== role) throw new DbContractError('Key provisioning conflict; existing credential was not changed')
      return existing
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new DbContractError('Key provisioning conflict; hash already belongs to a credential')
      throw error
    }
  }, typeof input?.keyId === 'string' ? { keyIdHash: createHash('sha256').update(input.keyId).digest('hex') } : {})
}

export async function findKeyByHash(db: Db, keyHash: string): Promise<KeyRecord | undefined> {
  if (!z.string().min(1).safeParse(keyHash).success) {
    throw new DbContractError('keyHash must be a non-empty string')
  }
  const { rows } = await db.query(
    'SELECT key_id, tenant_id, project_id, roles FROM api_keys WHERE key_hash = $1',
    [keyHash],
  )
  const row = rows[0]
  if (!row) return undefined
  const parsed = KeyRow.safeParse(row)
  if (!parsed.success) {
    throw new DbContractError(`api_keys row misaligned: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  return parsed.data
}
