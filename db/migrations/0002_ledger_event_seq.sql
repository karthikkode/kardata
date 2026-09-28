-- 0002_ledger_event_seq: link ledger rows to their source event so
-- re-projection never double-counts. B1.3.

-- migrate:up

ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS event_seq BIGINT UNIQUE;

-- migrate:down

ALTER TABLE ledger_entries DROP COLUMN IF EXISTS event_seq;
