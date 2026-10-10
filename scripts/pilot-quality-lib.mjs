// Phase 8 B8 quality checks (pure SQL over an injected pool). The CLI
// (pilot-quality.mjs) connects as the RO role; tests inject an owner
// pool on an isolated database. Counts feed §3.5 quality validation;
// the 30-company sample is machine-readable JSON for the owner.

export const STUCK_ROUND_MINUTES = 30
export const SAMPLE_SIZE = 30
const OFF_ICP = ['%directory%', '%aggregator%', '%franchise%']

export async function runPilotQuality(pool, { sectorId, since }) {
  const versions = await pool.query(
    'SELECT max(plan_version) AS latest FROM research_work WHERE sector_id = $1',
    [sectorId],
  )
  const latest = Number(versions.rows[0]?.latest ?? 0)
  if (!latest) return { ok: false, counts: null, sample: [], violations: [`no research work for sector ${sectorId}`] }

  const scope = [sectorId, latest, since]
  const where = `sector_id = $1 AND plan_version = $2 AND kind = 'company' AND state = 'complete' AND at >= $3`

  const duplicates = await pool.query(
    `SELECT count(*) AS n FROM (SELECT lower(split_part(source_url, '/', 3)) AS domain FROM research_work
     WHERE ${where} AND source_url IS NOT NULL GROUP BY 1 HAVING count(*) > 1) dupes`,
    scope,
  )
  const noSource = await pool.query(`SELECT count(*) AS n FROM research_work WHERE ${where} AND source_url IS NULL`, scope)
  const thin = await pool.query(
    `SELECT count(*) AS n FROM research_work WHERE ${where} AND jsonb_array_length(evidence) < 3`,
    scope,
  )
  const offIcp = await pool.query(
    `SELECT count(*) AS n FROM research_work WHERE ${where} AND (title ILIKE $4 OR title ILIKE $5 OR title ILIKE $6)`,
    [...scope, ...OFF_ICP],
  )
  const stuck = await pool.query(
    `SELECT count(DISTINCT r.thread_key) AS n FROM execution_rounds r
     JOIN threads t ON t.key = r.thread_key
     WHERE t.kind = 'subagent' AND r.sector_id = $1 AND r.finished_at IS NULL
     AND r.started_at < now() - make_interval(mins => ${STUCK_ROUND_MINUTES})`,
    [sectorId],
  )
  const sample = await pool.query(
    `SELECT w.id, w.title, w.source_url, w.evidence, w.child_id, t.session_id
     FROM research_work w LEFT JOIN threads t ON t.key = w.child_id
     WHERE w.sector_id = $1 AND w.plan_version = $2 AND w.kind = 'company' AND w.state = 'complete' AND w.at >= $3
     ORDER BY random() LIMIT ${SAMPLE_SIZE}`,
    scope,
  )

  const counts = {
    duplicatesByDomain: Number(duplicates.rows[0]?.n ?? 0),
    noSourceUrl: Number(noSource.rows[0]?.n ?? 0),
    thinEvidence: Number(thin.rows[0]?.n ?? 0),
    offIcpKeywords: Number(offIcp.rows[0]?.n ?? 0),
    stuckSubagents: Number(stuck.rows[0]?.n ?? 0),
  }
  const violations = []
  if (counts.duplicatesByDomain > 0) violations.push(`${counts.duplicatesByDomain} duplicate source domains`)
  if (counts.noSourceUrl > 0) violations.push(`${counts.noSourceUrl} companies without a source URL`)
  if (counts.thinEvidence > 0) violations.push(`${counts.thinEvidence} companies with fewer than 3 evidence items`)
  if (counts.offIcpKeywords > 0) violations.push(`${counts.offIcpKeywords} companies matching off-ICP keywords`)
  if (counts.stuckSubagents > 0) violations.push(`${counts.stuckSubagents} stuck subagents (round open > ${STUCK_ROUND_MINUTES}min)`)
  return { ok: violations.length === 0, counts, sample: sample.rows, violations }
}
