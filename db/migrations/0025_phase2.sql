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

-- migrate:down

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
