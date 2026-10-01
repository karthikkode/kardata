-- Persist start intent before Temporal can create a successor execution.
-- migrate:up
CREATE TABLE execution_intents (
  epoch text PRIMARY KEY,
  workflow_id text NOT NULL,
  thread_key text NOT NULL,
  session_id text NOT NULL,
  request_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','bound','uncertain','failed')),
  canonical_epoch text REFERENCES execution_intents(epoch),
  first_execution_id text,
  execution_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id,request_key)
);
CREATE UNIQUE INDEX execution_intents_canonical_chain ON execution_intents(workflow_id,first_execution_id)
  WHERE state='bound' AND canonical_epoch=epoch;
CREATE INDEX execution_intents_unresolved_thread ON execution_intents(thread_key)
  WHERE state IN ('pending','uncertain');
CREATE TABLE thread_execution_heads (
  thread_key text PRIMARY KEY,
  epoch text NOT NULL REFERENCES execution_intents(epoch)
);
ALTER TABLE thread_context ADD COLUMN active_epoch text REFERENCES execution_intents(epoch);
ALTER TABLE thread_context ADD COLUMN active_workflow_id text;
ALTER TABLE thread_context ADD COLUMN active_execution_id text;
-- migrate:down
ALTER TABLE thread_context DROP COLUMN active_execution_id;
ALTER TABLE thread_context DROP COLUMN active_workflow_id;
ALTER TABLE thread_context DROP COLUMN active_epoch;
DROP TABLE thread_execution_heads;
DROP TABLE execution_intents;
