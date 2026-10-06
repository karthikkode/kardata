-- 0029_thread_turn_started_at: when the current turn claimed its lease.
-- The supervision wall clock measures the TURN (lease age), not the
-- long-lived session workflow age (head-epoch intent.created_at).

-- migrate:up

ALTER TABLE thread_context ADD COLUMN active_run_started_at TIMESTAMPTZ;

-- migrate:down

ALTER TABLE thread_context DROP COLUMN active_run_started_at;
