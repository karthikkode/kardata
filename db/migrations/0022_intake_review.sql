-- Owner exclusions are distinct from completed evidence-backed work.
-- migrate:up
ALTER TABLE research_work DROP CONSTRAINT research_work_state_check;
ALTER TABLE research_work ADD CONSTRAINT research_work_state_check CHECK (state IN ('pending','running','complete','blocked','failed','excluded'));
-- migrate:down
-- Intentionally fails if exclusions exist: never relabel owner decisions.
ALTER TABLE research_work DROP CONSTRAINT research_work_state_check;
ALTER TABLE research_work ADD CONSTRAINT research_work_state_check CHECK (state IN ('pending','running','complete','blocked','failed'));
