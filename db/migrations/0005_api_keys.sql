-- 0005_api_keys: service-managed API keys for B3.3 auth. Plaintext keys
-- never touch this table: only SHA-256 hashes. Roles are levels
-- (viewer < operator < approver). project_id null means all projects.

-- migrate:up

CREATE TABLE IF NOT EXISTS api_keys (
  key_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  project_id TEXT,
  roles TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- migrate:down

DROP TABLE IF EXISTS api_keys;
