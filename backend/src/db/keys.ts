// Keys repository: reads on api_keys (moved from auth/keys.ts, B7.3
// behavior-neutral). Auth semantics (roles, scope, denial reasons) stay in
// auth/keys.ts; this module only fetches and validates the row.
import { z } from 'zod'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

const KeyRow = z.object({
  key_id: z.string().min(1),
  tenant_id: z.string().min(1),
  project_id: z.string().min(1).nullable(),
  roles: z.string().min(1),
})

export type KeyRecord = z.infer<typeof KeyRow>

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
