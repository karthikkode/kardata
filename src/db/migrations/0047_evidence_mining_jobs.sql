CREATE TABLE evidence_mining_jobs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_ids uuid[] NOT NULL,
  version text NOT NULL,
  settings jsonb NOT NULL,
  concurrency integer NOT NULL CHECK (concurrency BETWEEN 1 AND 4),
  status text NOT NULL DEFAULT 'queued',
  reason text,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX evidence_mining_jobs_status_created_idx ON evidence_mining_jobs(status, created_at);
