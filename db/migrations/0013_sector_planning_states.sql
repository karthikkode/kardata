-- 0013_sector_planning_states: plan-mandatory research lifecycle.
-- Planning runs before any sweep: draft/failed -> planning (agent plans),
-- planning -> planned (artifact ready for owner review), planned ->
-- approved (owner approves in the UI), approved -> queued (start).
-- No data changes: existing rows keep valid states.

-- migrate:up

ALTER TABLE sectors DROP CONSTRAINT IF EXISTS sectors_state_check;
ALTER TABLE sectors ADD CHECK (state IN ('running', 'paused', 'queued', 'failed', 'complete', 'draft', 'planning', 'planned', 'approved'));

-- migrate:down

DELETE FROM sectors WHERE state IN ('planning', 'planned', 'approved');
ALTER TABLE sectors DROP CONSTRAINT IF EXISTS sectors_state_check;
ALTER TABLE sectors ADD CHECK (state IN ('running', 'paused', 'queued', 'failed', 'complete', 'draft'));
