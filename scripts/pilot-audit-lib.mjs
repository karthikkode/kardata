// Phase 8 B5 UI-only audit (P8-B1): pure SQL over an injected pool. The
// CLI (pilot-audit.mjs) connects as the RO role; tests inject an owner
// pool on an isolated database. The pilot database holds one run, so
// the audit scopes by time (--since), not by sector.
// (a) run-window events grouped by client; (b) ui_only_violation alerts
// in the window; (c) owner-type events carry the UI client. Exit 1
// unless other=0, violations=0 and (c) holds.
//
// Owner action -> checked event types, one line each. Handler-inline
// appends carry ambient 'ui'; worker activities carry 'system'.
// - sector.created: sector create (createSector, handler inline) — ui only.
// - sector.plan_approved: plan approve (approveSectorPlan, handler inline) — ui only.
// - sector.plan_written: plan edit (ui) + planner writes (system) — ui or system.
// - sector.context.decided: context decision (decideContextChange, handler inline) — ui only.
// - sector.file.processing.created/.source: upload intake (createFileProcessingJob, handler inline) — ui only.
// - sector.state_changed: pause/resume/restart (ui) + sweep/lifecycle (system) — ui or system.
// - t.thread.state + status CANCELLING: stops come from the owner (ui),
//   supervision auto-cancel / parent unwind (system), and Karbot stops on
//   owner command (agent-mcp) — reported by client, never gated. Only
//   approvals (sector.plan_approved) stay ui-only.
// - spawn, steer: NO inline event (Temporal signal + thread_instructions
//   row); their routes are UI-gated and the M1 coverage test pins the
//   403 for non-UI keys, so a bypass attempt lands in (b).

export const OWNER_UI_ONLY_TYPES = [
  'sector.created',
  'sector.plan_approved',
  'sector.context.decided',
  'sector.file.processing.created',
  'sector.file.processing.source',
]

export const OWNER_UI_OR_SYSTEM_TYPES = ['sector.plan_written', 'sector.state_changed']

const MAX_OFFENDERS = 10

export async function runPilotAudit(pool, { since }) {
  const byClient = await pool.query('SELECT client, count(*) AS n FROM events WHERE at >= $1 GROUP BY 1 ORDER BY 1', [
    since,
  ])
  const eventsByClient = {}
  for (const row of byClient.rows) eventsByClient[row.client ?? '(null)'] = Number(row.n)
  const alerts = await pool.query(
    "SELECT count(*) AS n FROM alerts WHERE kind = 'ui_only_violation' AND created_at >= $1",
    [since],
  )
  const violationAlerts = Number(alerts.rows[0]?.n ?? 0)
  const offenders = await pool.query(
    `SELECT seq, type, client FROM events WHERE at >= $1 AND (
       (type = ANY($2) AND client IS DISTINCT FROM 'ui')
       OR (type = ANY($3) AND client IS DISTINCT FROM 'ui' AND client IS DISTINCT FROM 'system')
     ) ORDER BY seq`,
    [since, OWNER_UI_ONLY_TYPES, OWNER_UI_OR_SYSTEM_TYPES],
  )
  const cancelling = await pool.query(
    `SELECT client, count(*) AS n FROM events
     WHERE at >= $1 AND type = 't.thread.state' AND payload->>'status' = 'CANCELLING'
     GROUP BY 1 ORDER BY 1`,
    [since],
  )
  const cancellingByClient = {}
  for (const row of cancelling.rows) cancellingByClient[row.client ?? '(null)'] = Number(row.n)

  const violations = []
  const other = (eventsByClient['other'] ?? 0) + (eventsByClient['(null)'] ?? 0)
  if (other > 0) violations.push(`${other} events with client 'other' or unstamped since ${since}`)
  if (violationAlerts > 0) violations.push(`${violationAlerts} ui_only_violation alerts since ${since}`)
  for (const row of offenders.rows.slice(0, MAX_OFFENDERS)) {
    violations.push(`owner-type event ${row.type} #${row.seq} has client '${row.client ?? '(null)'}'`)
  }
  if (offenders.rows.length > MAX_OFFENDERS) {
    violations.push(`... and ${offenders.rows.length - MAX_OFFENDERS} more owner-type offenders`)
  }
  return { ok: violations.length === 0, counts: { eventsByClient, violationAlerts, cancellingByClient }, violations }
}
