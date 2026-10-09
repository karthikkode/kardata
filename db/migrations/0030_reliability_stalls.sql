-- 0030_reliability_stalls: v_agent_reliability stalls counted the write-dead
-- t.stall.response event joined on payload runId = rounds run_id, but the
-- only emitter wrote workflow ids — stalls was always 0. Stalls now count
-- the live t.reconciliation.finding stall kinds, joined on threadKey
-- exactly like the loops CTE.

-- migrate:up

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

-- migrate:down

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
  SELECT r.sector_id AS sector_id, r.kind AS kind, COUNT(DISTINCT e.seq) AS stalls
  FROM events e
  JOIN execution_rounds r ON r.run_id = e.payload->>'runId'
  WHERE e.type = 't.stall.response'
  GROUP BY r.sector_id, r.kind
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
