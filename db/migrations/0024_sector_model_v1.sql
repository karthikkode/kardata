-- Sector backend v1 sector model: per-chat settings, file summary blocks,
-- subagent inheritance and pause controls. Additive; one file for all of
-- Part A, appended per item. Backfills preserve existing behavior.
-- migrate:up

-- A5: per-chat "use global context" switch plus chat purpose.
CREATE TABLE session_settings (
  session_id text PRIMARY KEY,
  use_global_context boolean NOT NULL DEFAULT true,
  purpose text NOT NULL DEFAULT 'chat',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A6: one standardized AI summary block per context file.
CREATE TABLE context_file_blocks (
  sector_id text NOT NULL,
  file_id text NOT NULL,
  document_id text NOT NULL,
  hash text NOT NULL,
  filename text NOT NULL,
  state text NOT NULL CHECK (state IN ('summarizing','ready','failed','legacy')),
  summary text NOT NULL DEFAULT '',
  tokens integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  error text,
  requested_by text NOT NULL,
  added_version integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sector_id, file_id)
);
-- Backfill: every raw-included file becomes a legacy block served the old
-- way until summarized. Provenance comes from its approval row.
INSERT INTO context_file_blocks (sector_id, file_id, document_id, hash, filename, state, requested_by)
SELECT wf.sector_id, wf.file_id, COALESCE(wf.document_id, wf.file_id),
  COALESCE(c.file_ref->>'hash', ''), COALESCE(c.file_ref->>'filename', wf.file_id),
  'legacy', 'backfill'
FROM workspace_files wf LEFT JOIN workspace_changes c ON c.id = wf.approval_id
WHERE wf.included = true
ON CONFLICT DO NOTHING;

-- A9: compaction writes history as system:compaction.
ALTER TABLE workspace_changes DROP CONSTRAINT workspace_changes_author_check;
ALTER TABLE workspace_changes ADD CONSTRAINT workspace_changes_author_check CHECK (author IN ('owner', 'research', 'session', 'system:compaction'));
ALTER TABLE workspace_changes ADD COLUMN input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE workspace_changes ADD COLUMN output_tokens integer NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE workspace_changes DROP COLUMN output_tokens;
ALTER TABLE workspace_changes DROP COLUMN input_tokens;
ALTER TABLE workspace_changes DROP CONSTRAINT workspace_changes_author_check;
ALTER TABLE workspace_changes ADD CONSTRAINT workspace_changes_author_check CHECK (author IN ('owner', 'research', 'session'));
DROP TABLE context_file_blocks;
DROP TABLE session_settings;
