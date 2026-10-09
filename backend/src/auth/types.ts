// Auth domain shapes: leaf module (P2 depcruise). Scope and Role lived in
// auth/keys.ts, but db/mcp/context modules import them while keys.ts
// imports the db barrel for findKeyByHash — type edges closing ~80 import
// cycles. Auth semantics stay in auth (see db/keys.ts); the shapes just
// live where both sides can reach them without a cycle.

export type Role = 'viewer' | 'operator' | 'approver'

/** Effective data scope: the caller's tenant, plus the selected project.
 * X-Project selects within the key's project binding; selecting outside it
 * is denied. A null project means all of the tenant's projects. */
export interface Scope {
  tenantId: string
  projectId: string | null
}
