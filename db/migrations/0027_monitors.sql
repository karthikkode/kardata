-- 0027_monitors: Karbot monitor registry. One active monitor per
-- target (partial uniques); ticks claim an overlap guard so a stuck
-- previous tick skips instead of doubling.

-- migrate:up

CREATE TABLE IF NOT EXISTS monitors (
  id text PRIMARY KEY,
  target_sector_id text,
  target_thread_key text,
  every_minutes integer NOT NULL,
  brief text NOT NULL,
  until timestamptz NOT NULL,
  karbot_session_id text NOT NULL,
  karbot_thread_key text NOT NULL,
  workflow_id text NOT NULL,
  tenant_id text NOT NULL,
  project_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  last_tick_at timestamptz,
  last_tick_done boolean NOT NULL DEFAULT TRUE,
  CHECK (target_sector_id IS NOT NULL OR target_thread_key IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS monitors_active_sector ON monitors(target_sector_id)
  WHERE stopped_at IS NULL AND target_sector_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS monitors_active_thread ON monitors(target_thread_key)
  WHERE stopped_at IS NULL AND target_thread_key IS NOT NULL;

-- migrate:down

DROP TABLE IF EXISTS monitors;
