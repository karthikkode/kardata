-- 0007_sector_domain: sector/company research projections (B-S1). These
-- tables are derived: sector.*/company.* events are the write path and the
-- projector upserts here, exactly like threads/thread_messages. State and
-- stage vocab matches the product contract (running/paused/queued/failed/
-- complete; Filter/Deep research/Problem found/Final validation).

-- migrate:up

CREATE TABLE IF NOT EXISTS sectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('running', 'paused', 'queued', 'failed', 'complete')),
  tenant_id TEXT,
  project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sectors_state_idx ON sectors (state);
CREATE INDEX IF NOT EXISTS sectors_tenant_idx ON sectors (tenant_id, project_id);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  sector_id TEXT NOT NULL REFERENCES sectors (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'Filter'
    CHECK (stage IN ('Filter', 'Deep research', 'Problem found', 'Final validation')),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('running', 'paused', 'queued', 'failed', 'complete')),
  tenant_id TEXT,
  project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_sector_idx ON companies (sector_id);
CREATE INDEX IF NOT EXISTS companies_state_idx ON companies (state);
CREATE INDEX IF NOT EXISTS companies_tenant_idx ON companies (tenant_id, project_id);

-- migrate:down

DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS sectors;
