-- 0028_thread_state_reason: stable supervisor reason code on thread rows.
-- writeFail tags t.thread.state with the reconciliation kind (closed-owner,
-- missing-heartbeat, ...); the UI maps closed-owner to its orphan copy.

-- migrate:up

ALTER TABLE threads ADD COLUMN IF NOT EXISTS state_reason TEXT;

-- migrate:down

ALTER TABLE threads DROP COLUMN IF EXISTS state_reason;
