-- Phase 3 observability spine: every event carries the trace that
-- produced it plus the caller client. trace_id joins the event to its
-- HTTP log, workflow, activity, provider round and MCP lines; client
-- (ui, agent-mcp, system, other) is derived from the route at the HTTP
-- boundary, defaulting to system for background worker writes. The
-- pilot UI-only audit counts mutating events by client.
-- migrate:up

ALTER TABLE events ADD COLUMN trace_id text;
ALTER TABLE events ADD COLUMN client text;
CREATE INDEX IF NOT EXISTS events_trace_id_idx ON events (trace_id);
CREATE INDEX IF NOT EXISTS events_type_at_idx ON events (type, at);

-- P3.4 supervision that acts: durable table-backed owner alerts. Every
-- reconciliation action writes a row; resolution is explicit, never
-- inferred from later events.
CREATE TABLE IF NOT EXISTS alerts (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  severity text NOT NULL,
  subject text NOT NULL,
  thread_key text,
  sector_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS alerts_unresolved_idx ON alerts (resolved_at, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_thread_idx ON alerts (thread_key, created_at DESC);

-- P3.5 queryable rounds and tool calls, projected from t.provider.round
-- and t.tool.call events. One row per provider call (retries are separate
-- attempts); resumed replays record no round (no call was made).
CREATE TABLE IF NOT EXISTS execution_rounds (
  id bigserial PRIMARY KEY,
  trace_id text,
  run_id text NOT NULL,
  thread_key text NOT NULL,
  session_id text,
  sector_id text,
  parent_thread_key text,
  kind text NOT NULL,
  round int NOT NULL,
  attempt int NOT NULL,
  model text NOT NULL,
  provider text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  cached_tokens int,
  outcome text NOT NULL,
  error_code text,
  request_ref text,
  response_ref text,
  context_version int,
  plan_version int,
  UNIQUE (run_id, thread_key, round, attempt)
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id bigserial PRIMARY KEY,
  round_id bigint REFERENCES execution_rounds(id),
  thread_key text NOT NULL,
  tool text NOT NULL,
  args_hash text NOT NULL,
  args_ref text,
  result_ref text,
  outcome text NOT NULL,
  latency_ms int,
  error_code text,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS execution_rounds_thread_round_idx ON execution_rounds (thread_key, round);
CREATE INDEX IF NOT EXISTS execution_rounds_sector_started_idx ON execution_rounds (sector_id, started_at);
CREATE INDEX IF NOT EXISTS execution_rounds_trace_idx ON execution_rounds (trace_id);
CREATE INDEX IF NOT EXISTS tool_calls_thread_at_idx ON tool_calls (thread_key, at);

-- P3.5 agent-authored files: the author thread of an auto-registered
-- artifact document. Uploads and legacy rows stay null.
ALTER TABLE sector_documents ADD COLUMN author_thread text;

-- P3.5 retention cold pointers: every operational event moved to cold
-- storage keeps a durable DB reference to its archive bytes.
CREATE TABLE cold_event_pointers (
  partition text NOT NULL,
  seq bigint NOT NULL,
  archive_key text NOT NULL,
  type text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (partition, seq)
);

-- P3.5 evaluation views. Token cost per thread, research quality per
-- sector, agent reliability per sector and turn kind. Cost is tokens;
-- no pricing table exists. Loops attribute to the thread's first round
-- kind, stalls to the run's kind.
CREATE VIEW v_thread_cost AS
SELECT thread_key,
  MAX(session_id) AS session_id,
  MAX(sector_id) AS sector_id,
  COUNT(*) AS rounds,
  COALESCE(SUM(input_tokens), 0) AS input_tokens,
  COALESCE(SUM(output_tokens), 0) AS output_tokens,
  COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
  COUNT(*) FILTER (WHERE outcome <> 'ok') AS errors,
  MAX(finished_at) AS last_round_at
FROM execution_rounds
GROUP BY thread_key;

CREATE VIEW v_research_quality AS
SELECT s.id AS sector_id,
  (SELECT COUNT(*) FROM companies c WHERE c.sector_id = s.id) AS found,
  (SELECT COUNT(*) FROM companies c WHERE c.sector_id = s.id AND c.state = 'complete') AS accepted,
  (SELECT COUNT(*) FROM companies c WHERE c.sector_id = s.id AND c.state = 'failed') AS rejected,
  (SELECT COALESCE(SUM(cnt - 1), 0) FROM (SELECT COUNT(*) AS cnt FROM companies c WHERE c.sector_id = s.id GROUP BY lower(c.name) HAVING COUNT(*) > 1) dup) AS duplicates,
  (SELECT AVG(CASE WHEN w.evidence <> '[]'::jsonb THEN 1.0 ELSE 0.0 END) FROM research_work w WHERE w.sector_id = s.id AND w.kind = 'company') AS source_coverage,
  (SELECT COALESCE(SUM(COALESCE(r.input_tokens, 0) + COALESCE(r.output_tokens, 0)), 0)::numeric FROM execution_rounds r WHERE r.sector_id = s.id)
    / NULLIF((SELECT COUNT(*) FROM companies c WHERE c.sector_id = s.id AND c.state = 'complete'), 0) AS cost_per_accepted
FROM sectors s;

CREATE VIEW v_agent_reliability AS
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

-- migrate:down

DROP VIEW IF EXISTS v_agent_reliability;
DROP VIEW IF EXISTS v_research_quality;
DROP VIEW IF EXISTS v_thread_cost;
DROP TABLE IF EXISTS cold_event_pointers;
ALTER TABLE sector_documents DROP COLUMN IF EXISTS author_thread;
DROP INDEX IF EXISTS tool_calls_thread_at_idx;
DROP INDEX IF EXISTS execution_rounds_trace_idx;
DROP INDEX IF EXISTS execution_rounds_sector_started_idx;
DROP INDEX IF EXISTS execution_rounds_thread_round_idx;
DROP TABLE IF EXISTS tool_calls;
DROP TABLE IF EXISTS execution_rounds;
DROP INDEX IF EXISTS alerts_thread_idx;
DROP INDEX IF EXISTS alerts_unresolved_idx;
DROP TABLE IF EXISTS alerts;
DROP INDEX IF EXISTS events_type_at_idx;
DROP INDEX IF EXISTS events_trace_id_idx;
ALTER TABLE events DROP COLUMN IF EXISTS client;
ALTER TABLE events DROP COLUMN IF EXISTS trace_id;
