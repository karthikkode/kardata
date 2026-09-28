-- 0011_sector_context_selection: user control over sector context.
-- Exclusions hide whole documents (unit_ord NULL) or single units from
-- the assembled references; notes are user-authored context lines that
-- ride the references after files. Absent rows mean included.

-- migrate:up

-- unit_ord -1 addresses the whole document (real ords are >= 0); NULL
-- would defeat the primary key since Postgres treats NULLs as distinct.
CREATE TABLE IF NOT EXISTS sector_context_selection (
  sector_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  unit_ord INTEGER NOT NULL DEFAULT -1,
  excluded BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sector_id, document_id, unit_ord)
);
CREATE INDEX IF NOT EXISTS sector_context_selection_sector_idx ON sector_context_selection (sector_id);

CREATE TABLE IF NOT EXISTS sector_context_notes (
  id TEXT PRIMARY KEY,
  sector_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sector_context_notes_sector_idx ON sector_context_notes (sector_id);

-- migrate:down

DROP TABLE IF EXISTS sector_context_notes;
DROP TABLE IF EXISTS sector_context_selection;
