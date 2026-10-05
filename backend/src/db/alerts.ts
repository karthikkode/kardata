// Scoped durable supervision delivery. No fleet or execution payload escapes.
import { z } from 'zod'
import type { Scope } from '../auth/types.js'
import { createLogger, logOp } from '../observability/logging.js'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'

const Query = z.object({ beforeSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), limit: z.number().int().min(1).max(100), scope: z.object({ tenantId: z.string().min(1), projectId: z.string().min(1).nullable() }).strict() }).strict()
export const SupervisionAlert = z.object({ seq: z.coerce.number().int().positive(), at: z.string(), sessionId: z.string(), sessionTitle: z.string(), threadKey: z.string(), sectorId: z.string().nullable(), kind: z.enum(['closed-owner','missing-heartbeat','stalled-progress','queue-starvation','owner-unavailable']), response: z.enum(['observe','park']), state: z.enum(['current-warning','historical']), threadStatus: z.string() }).strict()
export type SupervisionAlert = z.infer<typeof SupervisionAlert>

export async function listSupervisionAlerts(db: Db, scope: Scope, beforeSeq = Number.MAX_SAFE_INTEGER, limit = 20): Promise<{ items: SupervisionAlert[]; nextBeforeSeq: number | null }> {
  if (!Query.safeParse({ scope, beforeSeq, limit }).success) throw new DbContractError('Invalid scoped alert page.')
  return logOp(createLogger({ op: 'alerts.read' }), 'alerts.read', async () => {
    const { rows } = await db.query<{ seq: string; at: Date; session_id: string; session_title: string; thread_key: string; sector_id: string | null; kind: string; response: string; state: string; thread_status: string }>(`
      WITH owned AS (
        SELECT DISTINCT ON (payload->>'sessionId') payload->>'sessionId' AS id,payload->>'title' AS title,
          payload->>'tenantId' AS tenant,payload->>'projectId' AS project,payload->>'sectorId' AS sector
        FROM events WHERE type='t.session.created' ORDER BY payload->>'sessionId',seq ASC
      )
      SELECT e.seq,e.at,t.session_id,COALESCE(renamed.title,owned.title) AS session_title,t.key AS thread_key,
        CASE WHEN sector.tenant_id=$1 AND ($2::text IS NULL OR sector.project_id=$2) THEN sector.id ELSE NULL END AS sector_id,
        e.payload->>'kind' AS kind,e.payload->>'response' AS response,t.status AS thread_status,
        CASE WHEN e.payload->>'kind'='closed-owner' AND e.payload->>'response'='park'
          AND t.status='PAUSED' AND parked.seq=latest_state.seq
          AND parked.payload->>'recoveryEpoch'=head.epoch::text
          AND NOT EXISTS(SELECT 1 FROM execution_intents pending WHERE pending.thread_key=t.key AND pending.state IN ('pending','uncertain'))
          THEN 'current-warning' ELSE 'historical' END AS state
      FROM events e JOIN threads t ON t.key=e.payload->>'threadKey' AND e.partition='session:'||t.session_id
      JOIN owned ON owned.id=t.session_id
      LEFT JOIN LATERAL(SELECT payload->>'title' AS title FROM events WHERE type='t.session.renamed' AND partition='session:'||owned.id AND payload->>'sessionId'=owned.id ORDER BY at DESC,seq DESC LIMIT 1) renamed ON true
      LEFT JOIN sectors sector ON sector.id=owned.sector
      LEFT JOIN thread_execution_heads head ON head.thread_key=t.key
      LEFT JOIN events parked ON parked.idempotency_key=e.idempotency_key||':state'
        AND parked.type='t.thread.state' AND parked.partition=e.partition AND parked.payload->>'threadKey'=t.key
      LEFT JOIN LATERAL(SELECT seq FROM events WHERE partition=e.partition AND type='t.thread.state' AND payload->>'threadKey'=t.key ORDER BY seq DESC LIMIT 1) latest_state ON true
      WHERE e.type='t.reconciliation.finding' AND e.seq<$3 AND owned.tenant=$1
        AND ($2::text IS NULL OR owned.project=$2)
        AND NOT EXISTS(SELECT 1 FROM events deleted WHERE deleted.type='t.session.deleted' AND deleted.payload->>'sessionId'=owned.id)
        AND e.payload->>'kind' IN ('closed-owner','missing-heartbeat','stalled-progress','queue-starvation','owner-unavailable')
        AND e.payload->>'response' IN ('observe','park')
      ORDER BY e.seq DESC LIMIT $4`, [scope.tenantId, scope.projectId, beforeSeq, limit + 1])
    const items = rows.slice(0,limit).map((r) => SupervisionAlert.parse({ seq: r.seq, at: new Date(r.at).toISOString(), sessionId: r.session_id, sessionTitle: r.session_title, threadKey: r.thread_key, sectorId: r.sector_id, kind: r.kind, response: r.response, state: r.state, threadStatus: r.thread_status }))
    return { items, nextBeforeSeq: rows.length>limit ? items.at(-1)!.seq : null }
  }, { limit })
}
