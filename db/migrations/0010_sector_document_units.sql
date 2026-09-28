-- 0010_sector_document_units: per-file extraction index for sector
-- context documents. A document's context is its units (ord, kind, text,
-- confidence): turns include units, never raw bytes. sector_documents
-- gains a status so image/scanned uploads degrade to needs-ocr explicitly
-- instead of failing the attach.

-- migrate:up

ALTER TABLE sector_documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'indexed';

CREATE TABLE IF NOT EXISTS sector_document_units (
  document_id TEXT NOT NULL REFERENCES sector_documents (id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  uncertain BOOLEAN NOT NULL DEFAULT FALSE,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (document_id, ord)
);
CREATE INDEX IF NOT EXISTS sector_document_units_document_idx ON sector_document_units (document_id);

-- migrate:down

DROP TABLE IF EXISTS sector_document_units;
ALTER TABLE sector_documents DROP COLUMN IF EXISTS status;
