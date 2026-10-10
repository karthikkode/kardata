// Phase 8 B8 quality checks (pure SQL over an injected pool). The CLI
// (pilot-quality.mjs) connects as the RO role; tests inject an owner
// pool on an isolated database. Counts feed §3.5 quality validation;
// the 30-company sample is machine-readable JSON for the owner.
// P8-B1 moved the B5 company checks here: the accepted-count gate (now
// tier-sized via minAccepted), the child-attribution counts, and plan
// filter 6 (≥1 fetched source URL with a timestamp — evidence items
// are URL strings and the row's `at` is the timestamp), which replaces
// the ≥3-evidence rule. The old thread-session check is gone:
// threads.session_id is NOT NULL, so it could never fire.

export const STUCK_ROUND_MINUTES = 30
export const SAMPLE_SIZE = 30
const OFF_ICP = ['%directory%', '%aggregator%', '%franchise%']

export async function runPilotQuality(pool, { sectorId, since, minAccepted = 100 }) {
  const versions = await pool.query(
    'SELECT max(plan_version) AS latest FROM research_work WHERE sector_id = $1',
    [sectorId],
  )
  const latest = Number(versions.rows[0]?.latest ?? 0)
  if (!latest) return { ok: false, counts: null, sample: [], violations: [`no research work for sector ${sectorId}`] }

  const scope = [sectorId, latest, since]
  const where = `sector_id = $1 AND plan_version = $2 AND kind = 'company' AND state = 'complete' AND at >= $3`
  const companyWhere = `w.sector_id = $1 AND w.plan_version = $2 AND w.kind = 'company' AND w.state = 'complete' AND w.at >= $3`

  const accepted = await pool.query(`SELECT count(*) AS n FROM research_work WHERE ${where}`, scope)
  const duplicates = await pool.query(
    `SELECT count(*) AS n FROM (SELECT lower(split_part(source_url, '/', 3)) AS domain FROM research_work
     WHERE ${where} AND source_url IS NOT NULL GROUP BY 1 HAVING count(*) > 1) dupes`,
    scope,
  )
  const noSource = await pool.query(`SELECT count(*) AS n FROM research_work WHERE ${where} AND source_url IS NULL`, scope)
  const filter6 = await pool.query(
    `SELECT count(*) AS n FROM research_work WHERE ${where} AND jsonb_array_length(evidence) < 1`,
    scope,
  )
  const nullChild = await pool.query(
    `SELECT count(*) AS n FROM research_work WHERE ${where} AND child_id IS NULL`,
    scope,
  )
  const nonSubagent = await pool.query(
    `SELECT count(*) AS n FROM research_work w LEFT JOIN threads t ON t.key = w.child_id
     WHERE ${companyWhere} AND w.child_id IS NOT NULL AND t.kind IS DISTINCT FROM 'subagent'`,
    scope,
  )
  const noRound = await pool.query(
    `SELECT count(*) AS n FROM research_work WHERE ${where} AND child_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM execution_rounds r WHERE r.thread_key = research_work.child_id AND r.session_id IS NOT NULL AND r.model IS NOT NULL)`,
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
    acceptedCompanies: Number(accepted.rows[0]?.n ?? 0),
    duplicatesByDomain: Number(duplicates.rows[0]?.n ?? 0),
    noSourceUrl: Number(noSource.rows[0]?.n ?? 0),
    filter6Failures: Number(filter6.rows[0]?.n ?? 0),
    offIcpKeywords: Number(offIcp.rows[0]?.n ?? 0),
    stuckSubagents: Number(stuck.rows[0]?.n ?? 0),
    nullChildId: Number(nullChild.rows[0]?.n ?? 0),
    nonSubagentChild: Number(nonSubagent.rows[0]?.n ?? 0),
    childWithoutRound: Number(noRound.rows[0]?.n ?? 0),
  }
  const violations = []
  if (counts.acceptedCompanies < minAccepted) {
    violations.push(`fewer than ${minAccepted} accepted companies (${counts.acceptedCompanies} complete at plan v${latest} since ${since})`)
  }
  if (counts.duplicatesByDomain > 0) violations.push(`${counts.duplicatesByDomain} duplicate source domains`)
  if (counts.noSourceUrl > 0) violations.push(`${counts.noSourceUrl} companies without a source URL`)
  if (counts.filter6Failures > 0) violations.push(`${counts.filter6Failures} companies failing filter 6 (need ≥1 fetched source URL with a timestamp)`)
  if (counts.offIcpKeywords > 0) violations.push(`${counts.offIcpKeywords} companies matching off-ICP keywords`)
  if (counts.stuckSubagents > 0) violations.push(`${counts.stuckSubagents} stuck subagents (round open > ${STUCK_ROUND_MINUTES}min)`)
  if (counts.nullChildId > 0) violations.push(`${counts.nullChildId} companies with no producing subagent (child_id null)`)
  if (counts.nonSubagentChild > 0) violations.push(`${counts.nonSubagentChild} companies whose child is not a subagent thread`)
  if (counts.childWithoutRound > 0) violations.push(`${counts.childWithoutRound} companies whose child has no execution round with session id + model`)
  return { ok: violations.length === 0, counts, sample: sample.rows, violations }
}
