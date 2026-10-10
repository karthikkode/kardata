// Phase 8 B5 audit checks (pure SQL over an injected pool). The CLI
// (pilot-audit.mjs) connects as the RO role; tests inject an owner
// pool on an isolated database. All checks scope to the sector's
// latest plan version (P9 copies kept work forward) and the run
// window (--since). Returns every violation; the first names the
// offender so the report can quote it.

export async function runPilotAudit(pool, { sectorId, since }) {
  const violations = []

  const versions = await pool.query(
    'SELECT max(plan_version) AS latest FROM research_work WHERE sector_id = $1',
    [sectorId],
  )
  const latest = Number(versions.rows[0]?.latest ?? 0)
  if (!latest) {
    return { ok: false, violations: [`no research work for sector ${sectorId}`] }
  }

  const accepted = await pool.query(
    `SELECT id, source_url, evidence, child_id FROM research_work
     WHERE sector_id = $1 AND plan_version = $2 AND kind = 'company' AND state = 'complete' AND at >= $3
     ORDER BY id`,
    [sectorId, latest, since],
  )
  if (accepted.rows.length < 100) {
    violations.push(
      `fewer than 100 accepted companies (${accepted.rows.length} complete at plan v${latest} since ${since})`,
    )
  }

  for (const row of accepted.rows) {
    if (!row.source_url) {
      violations.push(`company ${row.id} has no fetched source URL`)
      break
    }
    const evidence = Array.isArray(row.evidence) ? row.evidence : []
    if (evidence.length < 3) {
      violations.push(`company ${row.id} has ${evidence.length} evidence items (need 3)`)
      break
    }
  }

  for (const row of accepted.rows) {
    if (!row.child_id) {
      violations.push(`company ${row.id} has no producing subagent (child_id null)`)
      break
    }
    const threads = await pool.query('SELECT kind, session_id FROM threads WHERE key = $1', [row.child_id])
    const thread = threads.rows[0]
    if (!thread || thread.kind !== 'subagent') {
      violations.push(`company ${row.id} child ${row.child_id} is not a subagent thread`)
      break
    }
    if (!thread.session_id) {
      violations.push(`company ${row.id} child ${row.child_id} has no session id`)
      break
    }
    const rounds = await pool.query(
      'SELECT count(*) AS n FROM execution_rounds WHERE thread_key = $1 AND session_id IS NOT NULL AND model IS NOT NULL',
      [row.child_id],
    )
    if (Number(rounds.rows[0]?.n ?? 0) < 1) {
      violations.push(`company ${row.id} child ${row.child_id} has no execution round with session id + model`)
      break
    }
  }

  return { ok: violations.length === 0, violations }
}
