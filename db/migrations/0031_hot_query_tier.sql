-- 0031_hot_query_tier: the stress volume tier (1M events / 100k rounds /
-- 20k companies) blew the 100 ms p95 budget on five reads: session.list
-- 2.3 s, library.list 8.6 s, context.global 9.4 s, evaluation.sector 248 ms,
-- agent_reliability 246 ms, plus a companies seq-scan plan gate. This
-- migration adds the serving indexes; the query rewrites that use them land
-- in the same fix-loop strand. v_agent_reliability is restructured twice:
-- loops/stalls become correlated subqueries per (sector, kind) group so the
-- sector predicate pushes, and the round counts become a two-level
-- aggregate (per-run groups, then sums) because COUNT(DISTINCT run_id)
-- forced a disk-spilling sort of all rounds. Semantics are unchanged
-- (first-round attribution, IS NOT DISTINCT FROM sector matching);
-- tests/backend/db.sector-evaluation.test.ts pins them.

-- migrate:up

-- Per-session freshness: MAX(at) over one partition becomes a one-row
-- index scan for the sessions LATERAL rewrite.
CREATE INDEX IF NOT EXISTS events_partition_at_idx ON events (partition, at DESC);

-- companies.page orders updated_at; the volume plan gate pins created_at.
CREATE INDEX IF NOT EXISTS companies_sector_created_idx ON companies (sector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS companies_sector_updated_idx ON companies (sector_id, updated_at DESC);

-- Covering index for the per-sector reliability/cost aggregates: sector
-- filter plus GROUP BY kind plus all aggregated columns, index-only.
CREATE INDEX IF NOT EXISTS execution_rounds_sector_kind_cover_idx
  ON execution_rounds (sector_id, kind)
  INCLUDE (run_id, outcome, attempt, input_tokens, output_tokens, cached_tokens);

-- The artifact fold only folds rows carrying an artifactId key: without
-- the key a row is invalid (no fold contribution) and its
-- payload->>'artifactId' is NULL (no arrival contribution). This partial
-- covering index lets the fold skip keyless rows without touching the
-- heap, and serves keyed rows index-only once vacuumed.
CREATE INDEX IF NOT EXISTS events_artifact_fold_idx
  ON events (partition, seq) INCLUDE (type, payload, at)
  WHERE payload ? 'artifactId';

CREATE OR REPLACE VIEW v_agent_reliability AS
WITH per_run AS (
  SELECT r.sector_id AS sector_id, r.kind AS kind, r.run_id AS run_id,
    COUNT(*) AS rounds,
    COUNT(*) FILTER (WHERE r.outcome = 'ok') AS ok,
    COUNT(*) FILTER (WHERE r.outcome = 'error') AS errors,
    COUNT(*) FILTER (WHERE r.outcome = 'timeout') AS timeouts,
    COUNT(*) FILTER (WHERE r.outcome = 'cancelled') AS cancelled,
    COUNT(*) FILTER (WHERE r.attempt > 0) AS retries
  FROM execution_rounds r
  GROUP BY r.sector_id, r.kind, r.run_id
)
SELECT p.sector_id AS sector_id,
  p.kind AS kind,
  COUNT(*) AS runs,
  SUM(p.rounds)::bigint AS rounds,
  SUM(p.ok)::bigint AS ok,
  SUM(p.errors)::bigint AS errors,
  SUM(p.timeouts)::bigint AS timeouts,
  SUM(p.cancelled)::bigint AS cancelled,
  SUM(p.retries)::bigint AS retries,
  (SELECT COUNT(*) FROM events e
   WHERE e.type = 't.loop.detected'
     AND (SELECT tk.sector_id FROM execution_rounds tk
          WHERE tk.thread_key = e.payload->>'threadKey'
          ORDER BY tk.round ASC, tk.attempt ASC LIMIT 1)
         IS NOT DISTINCT FROM p.sector_id
     AND (SELECT tk.kind FROM execution_rounds tk
          WHERE tk.thread_key = e.payload->>'threadKey'
          ORDER BY tk.round ASC, tk.attempt ASC LIMIT 1) = p.kind
  ) AS loops,
  (SELECT COUNT(DISTINCT e.seq) FROM events e
   WHERE e.type = 't.reconciliation.finding'
     AND e.payload->>'kind' IN ('missing-heartbeat', 'stalled-progress')
     AND (SELECT tk.sector_id FROM execution_rounds tk
          WHERE tk.thread_key = e.payload->>'threadKey'
          ORDER BY tk.round ASC, tk.attempt ASC LIMIT 1)
         IS NOT DISTINCT FROM p.sector_id
     AND (SELECT tk.kind FROM execution_rounds tk
          WHERE tk.thread_key = e.payload->>'threadKey'
          ORDER BY tk.round ASC, tk.attempt ASC LIMIT 1) = p.kind
  ) AS stalls
FROM per_run p
GROUP BY p.sector_id, p.kind;

-- migrate:down

DROP INDEX IF EXISTS events_artifact_fold_idx;
DROP INDEX IF EXISTS execution_rounds_sector_kind_cover_idx;
DROP INDEX IF EXISTS companies_sector_updated_idx;
DROP INDEX IF EXISTS companies_sector_created_idx;
DROP INDEX IF EXISTS events_partition_at_idx;

CREATE OR REPLACE VIEW v_agent_reliability AS
WITH thread_kind AS (
  SELECT DISTINCT ON (thread_key) thread_key, kind, sector_id
  FROM execution_rounds
  ORDER BY thread_key, round ASC, attempt ASC
),
loops AS (
  SELECT tk.sector_id AS sector_id, tk.kind AS kind, COUNT(*) AS loops
  FROM events e
  JOIN thread_kind tk ON tk.thread_key = e.payload->>'threadKey'
  WHERE e.type = 't.loop.detected'
  GROUP BY tk.sector_id, tk.kind
),
stalls AS (
  SELECT tk.sector_id AS sector_id, tk.kind AS kind, COUNT(DISTINCT e.seq) AS stalls
  FROM events e
  JOIN thread_kind tk ON tk.thread_key = e.payload->>'threadKey'
  WHERE e.type = 't.reconciliation.finding'
    AND e.payload->>'kind' IN ('missing-heartbeat', 'stalled-progress')
  GROUP BY tk.sector_id, tk.kind
)
SELECT r.sector_id AS sector_id,
  r.kind AS kind,
  COUNT(DISTINCT r.run_id) AS runs,
  COUNT(*) AS rounds,
  COUNT(*) FILTER (WHERE r.outcome = 'ok') AS ok,
  COUNT(*) FILTER (WHERE r.outcome = 'error') AS errors,
  COUNT(*) FILTER (WHERE r.outcome = 'timeout') AS timeouts,
  COUNT(*) FILTER (WHERE r.outcome = 'cancelled') AS cancelled,
  COUNT(*) FILTER (WHERE r.attempt > 0) AS retries,
  COALESCE(l.loops, 0) AS loops,
  COALESCE(s.stalls, 0) AS stalls
FROM execution_rounds r
LEFT JOIN loops l ON l.sector_id IS NOT DISTINCT FROM r.sector_id AND l.kind = r.kind
LEFT JOIN stalls s ON s.sector_id IS NOT DISTINCT FROM r.sector_id AND s.kind = r.kind
GROUP BY r.sector_id, r.kind, l.loops, s.stalls;
