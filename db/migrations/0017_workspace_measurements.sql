-- Stable candidate identity and observed input budgets.
-- migrate:up
ALTER TABLE research_work ADD COLUMN source_url text;
ALTER TABLE thread_context ADD COLUMN usage jsonb;
-- migrate:down
ALTER TABLE thread_context DROP COLUMN usage;
ALTER TABLE research_work DROP COLUMN source_url;
