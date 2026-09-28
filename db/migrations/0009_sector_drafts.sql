-- 0009_sector_drafts: draft state for create-first sectors plus
-- sector-scoped context documents. Drafts are created (event-sourced like
-- every sector write), context files attach while drafting, and an explicit
-- start transitions draft -> queued. Documents store extracted text (not
-- raw bytes): re-upload the source file to replace.

-- migrate:up

ALTER TABLE sectors DROP CONSTRAINT IF EXISTS sectors_state_check;
ALTER TABLE sectors ADD CHECK (state IN ('running', 'paused', 'queued', 'failed', 'complete', 'draft'));

CREATE TABLE IF NOT EXISTS sector_documents (
  id TEXT PRIMARY KEY,
  sector_id TEXT NOT NULL REFERENCES sectors (id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  text TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  tenant_id TEXT,
  project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sector_documents_sector_idx ON sector_documents (sector_id);
CREATE INDEX IF NOT EXISTS sector_documents_tenant_idx ON sector_documents (tenant_id, project_id);

-- migrate:down

DROP TABLE IF EXISTS sector_documents;
DELETE FROM sectors WHERE state = 'draft';
ALTER TABLE sectors DROP CONSTRAINT IF EXISTS sectors_state_check;
ALTER TABLE sectors ADD CHECK (state IN ('running', 'paused', 'queued', 'failed', 'complete'));
