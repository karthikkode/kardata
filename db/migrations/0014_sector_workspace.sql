-- Additive workspace state. Existing transcripts, artifacts and plans remain.
-- migrate:up
CREATE TABLE sector_workspace (
  sector_id text PRIMARY KEY REFERENCES sectors(id),
  research_session_id text UNIQUE,
  context_version integer NOT NULL DEFAULT 0,
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  protected_decisions text NOT NULL DEFAULT '',
  discovery_closed boolean NOT NULL DEFAULT false
);
CREATE TABLE workspace_changes (
  id text PRIMARY KEY,
  sector_id text NOT NULL REFERENCES sectors(id),
  base_version integer NOT NULL,
  sections jsonb NOT NULL,
  source_thread text NOT NULL,
  author text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','parent-review','approved','denied')),
  version integer,
  at timestamptz NOT NULL DEFAULT now(),
  file_ref jsonb
);
CREATE INDEX workspace_changes_sector ON workspace_changes(sector_id, at);
CREATE TABLE thread_context (
  thread_key text PRIMARY KEY,
  notes text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  covered_seq bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0,
  active_run text
);
CREATE TABLE workspace_files (
  sector_id text NOT NULL REFERENCES sectors(id),
  file_id text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  included boolean NOT NULL DEFAULT false,
  PRIMARY KEY (sector_id,file_id)
);
CREATE TABLE research_work (
  id text PRIMARY KEY,
  sector_id text NOT NULL REFERENCES sectors(id),
  plan_version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('discovery','company')),
  title text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','running','complete','blocked','failed')),
  attempts integer NOT NULL DEFAULT 0,
  child_id text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_work_sector ON research_work(sector_id,plan_version);
CREATE TABLE thread_instructions (
  id text PRIMARY KEY,
  thread_key text NOT NULL,
  text text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','consumed','missed')),
  run_key text,
  round integer,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX thread_instructions_pending ON thread_instructions(thread_key,state,at);

-- migrate:down
DROP TABLE thread_instructions;
DROP TABLE research_work;
DROP TABLE workspace_files;
DROP TABLE thread_context;
DROP TABLE workspace_changes;
DROP TABLE sector_workspace;
