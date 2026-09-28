-- 0008_knowledge_ledger: product knowledge corpus (FTS) plus the
-- cross-sector company master ledger. kb_documents/kb_chunks hold curated,
-- versioned corpus batches: source_path + source_sha pin provenance, batch_id
-- versions ingests, and superseded_by marks replacements without deleting
-- history. ledger_companies/ledger_problems are the master company record
-- (identity, qualification, problems, mailability, contacts) across runs;
-- the sector-scoped companies projection (0007) remains the per-run view.

-- migrate:up

CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  superseded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_documents_topic_idx ON kb_documents (topic);
CREATE INDEX IF NOT EXISTS kb_documents_batch_idx ON kb_documents (batch_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES kb_documents (id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', section || ' ' || text)) STORED
);
CREATE INDEX IF NOT EXISTS kb_chunks_doc_idx ON kb_chunks (doc_id);
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS ledger_companies (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT 'unresearched'
    CHECK (qualification IN ('unresearched', 'qualified', 'disqualified')),
  qualification_reason TEXT NOT NULL DEFAULT '',
  scale_signal TEXT NOT NULL DEFAULT '',
  mailable BOOLEAN NOT NULL DEFAULT FALSE,
  contact_ref TEXT NOT NULL DEFAULT '',
  researched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_companies_qualification_idx ON ledger_companies (qualification);
CREATE INDEX IF NOT EXISTS ledger_companies_sector_idx ON ledger_companies (sector);

CREATE TABLE IF NOT EXISTS ledger_problems (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES ledger_companies (id) ON DELETE CASCADE,
  problem TEXT NOT NULL,
  mechanism TEXT NOT NULL DEFAULT '',
  cost_evidence TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  headroom TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'worthy', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_problems_company_idx ON ledger_problems (company_id);
CREATE INDEX IF NOT EXISTS ledger_problems_status_idx ON ledger_problems (status);

-- migrate:down

DROP TABLE IF EXISTS ledger_problems;
DROP TABLE IF EXISTS ledger_companies;
DROP TABLE IF EXISTS kb_chunks;
DROP TABLE IF EXISTS kb_documents;
