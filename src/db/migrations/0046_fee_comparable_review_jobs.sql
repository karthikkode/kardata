CREATE TABLE benchmark_comparable_jobs (
  id uuid PRIMARY KEY,
  sector_id uuid NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  company_ids uuid[] NOT NULL,
  version text NOT NULL,
  concurrency integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  reason text,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX benchmark_comparable_jobs_status_created_idx ON benchmark_comparable_jobs(status, created_at);
