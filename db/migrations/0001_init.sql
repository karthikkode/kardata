-- 0001_init: event log, heartbeats, outbox, projections. B0.3.
-- Sections split by the backend migrator on the exact marker lines.

-- migrate:up

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only event log: the only write path (B1.1). Gapless per partition
-- is enforced by readers on (partition, seq); seq itself is a global order.
CREATE TABLE IF NOT EXISTS events (
  seq BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  partition TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  redacted BOOLEAN NOT NULL DEFAULT FALSE,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_partition_seq_idx ON events (partition, seq);

-- Per-operation heartbeats for stall detection (B5.3).
CREATE TABLE IF NOT EXISTS heartbeats (
  run_id TEXT NOT NULL,
  op TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  busy BOOLEAN NOT NULL DEFAULT FALSE,
  attempt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, op)
);

-- Outbox feeding SSE (B3.2). delivered_at claims a row for a publisher.
CREATE TABLE IF NOT EXISTS outbox (
  seq BIGSERIAL PRIMARY KEY,
  thread_key TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS outbox_thread_seq_idx ON outbox (thread_key, seq);

-- Projections rebuilt from events (B1.2 transcript/threads, B1.3 ledger).
CREATE TABLE IF NOT EXISTS threads (
  key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('session', 'subagent')),
  status TEXT NOT NULL,
  accepting_steer BOOLEAN NOT NULL DEFAULT TRUE,
  queue_depth INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thread_messages (
  thread_key TEXT NOT NULL REFERENCES threads (key) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'tool', 'approval')),
  payload JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_key, seq)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_run_idx ON ledger_entries (run_id);

-- migrate:down

DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS thread_messages;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS heartbeats;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS schema_migrations;
