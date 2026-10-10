-- 0032_api_key_client: Phase 8 pilot needs to prove every mutating
-- call came from the UI. api_keys gains a client column so the event's
-- client comes from the authenticated key instead of the URL (any curl
-- with any key audits as UI today). Values: ui (pilot UI key),
-- agent-mcp (worker key, /mcp only), viewer (B2 read-only key),
-- other (default; every pre-existing key).

-- migrate:up

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS client TEXT NOT NULL DEFAULT 'other';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_client_check') THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_client_check CHECK (client IN ('ui', 'agent-mcp', 'viewer', 'other'));
  END IF;
END
$$;

-- migrate:down

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_client_check;
ALTER TABLE api_keys DROP COLUMN IF EXISTS client;
