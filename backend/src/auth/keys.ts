// API-key auth with tenant/project scope and role levels. B3.3. Service
// keys only (no JWT/OAuth): the presented key is SHA-256 hashed and looked
// up in api_keys; the row binds tenant, optional project, and one role
// level (viewer < operator < approver, each including the levels below).
// Absent, unknown, or insufficient credentials all answer 403
// permission_denied — the spec's only denied code — so callers cannot
// distinguish missing keys from wrong roles.
import { createHash } from 'node:crypto'
import { type Db, findKeyByHash } from '../db/index.js'
import type { Role, Scope } from './types.js'

export type { Role, Scope } from './types.js'

const LEVELS: Record<Role, number> = { viewer: 1, operator: 2, approver: 3 }

export interface Caller {
  keyId: string
  tenantId: string
  projectId: string | null
  role: Role
}

export function hashKey(presented: string): string {
  return createHash('sha256').update(presented, 'utf8').digest('hex')
}

function toRole(value: string): Role {
  return value === 'approver' ? 'approver' : value === 'operator' ? 'operator' : 'viewer'
}

/** Resolves the caller from the Authorization header. Tenant/project
 * headers never widen scope: X-Tenant must equal the key's tenant and
 * X-Project must stay inside the key's project binding. */
export async function resolveCaller(
  pool: Db,
  authorization: string | undefined,
  tenantHeader: string | undefined,
  projectHeader: string | undefined,
): Promise<{ caller: Caller; scope: Scope } | { denied: string }> {
  const presented = (authorization ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!presented) return { denied: 'missing credentials' }
  const row = await findKeyByHash(pool, hashKey(presented))
  if (!row) return { denied: 'unknown credentials' }
  if (tenantHeader !== undefined && tenantHeader !== row.tenant_id) {
    return { denied: 'tenant header does not match key tenant' }
  }
  if (row.project_id !== null && projectHeader !== undefined && projectHeader !== row.project_id) {
    return { denied: 'project header outside key project binding' }
  }
  const caller: Caller = {
    keyId: row.key_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    role: toRole(row.roles),
  }
  return { caller, scope: { tenantId: row.tenant_id, projectId: projectHeader ?? row.project_id } }
}

export function roleAtLeast(caller: Caller, minimum: Role): boolean {
  return roleLevelAtLeast(caller.role, minimum)
}

/** Bare-role comparison for callers that already resolved the role (MCP
 * tool gates). One ladder lives here; nothing else defines its own. */
export function roleLevelAtLeast(role: Role, minimum: Role): boolean {
  return LEVELS[role] >= LEVELS[minimum]
}
