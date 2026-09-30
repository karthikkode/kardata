-- Durable active-turn checkpoints. Transcripts remain immutable.
-- migrate:up
ALTER TABLE thread_context ADD COLUMN working_user text;
ALTER TABLE thread_context ADD COLUMN working_messages jsonb;
ALTER TABLE thread_context ADD COLUMN working_sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE thread_context ADD COLUMN working_run text;
ALTER TABLE thread_context ADD COLUMN working_meta jsonb;
-- migrate:down
ALTER TABLE thread_context DROP COLUMN working_meta;
ALTER TABLE thread_context DROP COLUMN working_run;
ALTER TABLE thread_context DROP COLUMN working_sources;
ALTER TABLE thread_context DROP COLUMN working_messages;
ALTER TABLE thread_context DROP COLUMN working_user;
