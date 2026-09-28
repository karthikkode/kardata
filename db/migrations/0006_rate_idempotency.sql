-- 0006_rate_idempotency: fixed-window rate counters plus mutation replay
-- records for B3.4. Windows are per bucket per minute; stale windows are
-- deleted piggyback on each check. Replay records live until the retention
-- sweeper (B6) ages them out.

-- migrate:up

CREATE TABLE IF NOT EXISTS rate_windows (
  bucket TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'in_progress',
  status INTEGER,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- migrate:down

DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS rate_windows;
