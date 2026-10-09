// Table-backed supervision alerts (P3.4). Reconciliation writes one row
// per action; reads stay tenant/project scoped through the thread's
// session or the sector row. Resolution is explicit, never inferred.
import { z } from 'zod'
import type { Scope } from '../auth/types.js'
import { createLogger, logOp } from '../observability/logging.js'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

const Query = z.object({ beforeSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), limit: z.number().int().min(1).max(100), scope: z.object({ tenantId: z.string().min(1), projectId: z.string().min(1).nullable() }).strict() }).strict()

export const SupervisionAlert = z.object({
  seq: z.coerce.number().int().positive(),
  at: z.string(),
  kind: z.string().min(1),
  severity: z.enum(['info', 'warning', 'high', 'critical']),
  subject: z.string().min(1),
  threadKey: z.string().nullable(),
  sectorId: z.string().nullable(),
  sessionId: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  state: z.enum(['current-warning', 'historical']),
}).strict()
export type SupervisionAlert = z.infer<typeof SupervisionAlert>

const RaiseAlert = z.object({
  kind: z.string().min(1),
  severity: z.enum(['info', 'warning', 'high', 'critical']),
  subject: z.string().min(1).max(500),
  threadKey: z.string().min(1).optional(),
  sectorId: z.string().min(1).optional(),
}).strict()

export interface RaisedAlert {
  id: number
  duplicate: boolean
}

/** One unresolved row per (kind, subject, thread, sector): repeats while
 * unresolved dedupe to the first id. Requires a thread or a sector so
 * every alert stays scope-checkable. */
export async function raiseAlert(db: Db, input: unknown): Promise<RaisedAlert> {
  const parsed = RaiseAlert.safeParse(input)
  if (!parsed.success || (!parsed.data.threadKey && !parsed.data.sectorId)) {
    throw new DbContractError('alert needs kind, severity, subject, and a threadKey or sectorId')
  }
  const alert = parsed.data
  return logOp(createLogger({ op: 'alerts.raise' }), 'alerts.raise', async () => {
    const existing = await db.query<{ id: number }>(
      `SELECT id FROM alerts WHERE kind = $1 AND severity = $2 AND subject = $3
       AND thread_key IS NOT DISTINCT FROM $4 AND sector_id IS NOT DISTINCT FROM $5
       AND resolved_at IS NULL ORDER BY id ASC LIMIT 1`,
      [alert.kind, alert.severity, alert.subject, alert.threadKey ?? null, alert.sectorId ?? null],
    )
    if (existing.rows[0]) return { id: Number(existing.rows[0].id), duplicate: true }
    const inserted = await db.query<{ id: number }>(
      `INSERT INTO alerts (kind, severity, subject, thread_key, sector_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [alert.kind, alert.severity, alert.subject, alert.threadKey ?? null, alert.sectorId ?? null],
    )
    const row = inserted.rows[0]
    if (!row) throw new Error('raiseAlert: missing RETURNING row')
    return { id: Number(row.id), duplicate: false }
  }, { kind: alert.kind, severity: alert.severity })
}

export async function resolveAlert(db: Db, id: number): Promise<boolean> {
  if (!z.number().int().positive().safeParse(id).success) throw new DbContractError('alert id must be a positive integer')
  const updated = await db.query(
    'UPDATE alerts SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL',
    [id],
  )
  return (updated.rowCount ?? 0) === 1
}

export async function listSupervisionAlerts(db: Db, scope: Scope, beforeSeq = Number.MAX_SAFE_INTEGER, limit = 20): Promise<{ items: SupervisionAlert[]; nextBeforeSeq: number | null }> {
  if (!Query.safeParse({ scope, beforeSeq, limit }).success) throw new DbContractError('Invalid scoped alert page.')
  return logOp(createLogger({ op: 'alerts.read' }), 'alerts.read', async () => {
    const { rows } = await db.query<{
      id: number; kind: string; severity: string; subject: string
      thread_key: string | null; sector_id: string | null; session_id: string | null
      created_at: Date; resolved_at: Date | null
    }>(
      `WITH owned AS (
         SELECT DISTINCT ON (payload->>'sessionId') payload->>'sessionId' AS id,
           payload->>'tenantId' AS tenant, payload->>'projectId' AS project
         FROM events WHERE type = 't.session.created' ORDER BY payload->>'sessionId', seq ASC
       )
       SELECT a.id, a.kind, a.severity, a.subject, a.thread_key, a.sector_id,
         t.session_id, a.created_at, a.resolved_at
       FROM alerts a
       LEFT JOIN threads t ON t.key = a.thread_key
       LEFT JOIN sectors s ON s.id = a.sector_id
       LEFT JOIN owned o ON o.id = t.session_id
       WHERE a.id < $3
         AND ((t.session_id IS NOT NULL AND o.tenant = $1 AND ($2::text IS NULL OR o.project = $2)
           AND NOT EXISTS (SELECT 1 FROM events d WHERE d.type = 't.session.deleted' AND d.payload->>'sessionId' = t.session_id))
           OR (a.sector_id IS NOT NULL AND s.tenant_id = $1 AND ($2::text IS NULL OR s.project_id = $2)))
       ORDER BY a.id DESC LIMIT $4`,
      [scope.tenantId, scope.projectId, beforeSeq, limit + 1],
    )
    const items = rows.slice(0, limit).map((row) =>
      SupervisionAlert.parse({
        seq: row.id,
        at: new Date(row.created_at).toISOString(),
        kind: row.kind,
        severity: row.severity,
        subject: row.subject,
        threadKey: row.thread_key,
        sectorId: row.sector_id,
        sessionId: row.session_id,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        state: row.resolved_at ? 'historical' : 'current-warning',
      }),
    )
    return { items, nextBeforeSeq: rows.length > limit ? items.at(-1)!.seq : null }
  }, { limit })
}
