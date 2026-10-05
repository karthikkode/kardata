#!/usr/bin/env bash
# Live UI stack for sector backend v1 (B2). Starts a backend on 3101 plus a
# dev worker against the kardata_live database and kardata-live Temporal
# namespace. Never touches the owner's compose containers, ports
# 5173/5174/3001, or the kardata database.
#
# Usage: ./scripts/live-stack.sh
# Keys are generated, seeded into kardata_live, and written to
# $TMPDIR/kardata-live/ui-env.sh (sourced by the Playwright runner).
# They are never echoed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DIR="${TMPDIR:-/tmp}/kardata-live"
ARCHIVE_DIR="${TMPDIR:-/tmp}/kardata-live-archive"
mkdir -p "$LIVE_DIR" "$ARCHIVE_DIR"
export PATH="/home/karthik/.nvm/versions/node/v22.23.3/bin:$PATH"

# Refuse while the live battery runs: its in-process app holds 3102 and
# both poll kardata-live, so a second starter steals activities and fails
# them against the wrong database (sector-backend-v1 handoff bug 13).
if node -e "fetch('http://127.0.0.1:3102/healthz',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  echo "live battery is running (port 3102); wait for it before starting the browser stack" >&2
  exit 1
fi

# Provider keys etc. from agents/.env, without printing them. Parsed with
# node (shell sourcing breaks on space-containing values); nothing is echoed.
eval "$(node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { parseEnvFile } from '$ROOT/deployment/scripts/stack-lib.mjs';
const parsed = parseEnvFile(readFileSync('$ROOT/agents/.env', 'utf8'));
for (const [k, v] of Object.entries(parsed)) console.log('export ' + k + '=' + JSON.stringify(v));
")"
export PORT=3101
export TEMPORAL_NAMESPACE=kardata-live
export TEMPORAL_ADDRESS="${KARDATA_TEMPORAL_ADDRESS:-localhost:7233}"
export DATABASE_URL="${LIVE_DATABASE_URL:-postgresql://kardata:kardata-dev@localhost:5433/kardata_live}"
export KARDATA_CORS_ORIGINS="http://localhost:15174,http://127.0.0.1:15174"
export KARDATA_ARCHIVE_DIR="$ARCHIVE_DIR"
unset KARDATA_PROVIDER
OWNER_KEY="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
WORKER_KEY="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
export KARDATA_MCP_TOKEN="$WORKER_KEY"

# Migrate (additive) and seed the two service keys.
DATABASE_URL="$DATABASE_URL" node "$ROOT/backend/dist/db/cli.js" up >"$LIVE_DIR/migrate.log" 2>&1
OWNER_KEY="$OWNER_KEY" WORKER_KEY="$WORKER_KEY" DATABASE_URL="$DATABASE_URL" node --input-type=module -e "
import { createHash } from 'node:crypto';
import pg from '$ROOT/node_modules/pg/lib/index.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
for (const [id, key] of [['live-owner', process.env.OWNER_KEY], ['live-worker', process.env.WORKER_KEY]]) {
  const hash = createHash('sha256').update(key).digest('hex');
  await pool.query(
    'INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles) VALUES (\$1, \$2, \$3, \$4, \$5) ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash',
    [id, hash, 'tenant-live', null, 'approver'],
  );
}
await pool.end();
"

# Backend then worker, each with its own log.
DATABASE_URL="$DATABASE_URL" PORT="$PORT" TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" \
  KARDATA_CORS_ORIGINS="$KARDATA_CORS_ORIGINS" KARDATA_ARCHIVE_DIR="$ARCHIVE_DIR" \
  KARDATA_MCP_TOKEN="$WORKER_KEY" KARDATA_META_KEY="${KARDATA_META_KEY:-}" \
  KARDATA_META_MODEL="${KARDATA_META_MODEL:-}" \
  nohup node "$ROOT/backend/dist/server.js" >"$LIVE_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
DATABASE_URL="$DATABASE_URL" TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" TEMPORAL_ADDRESS="$TEMPORAL_ADDRESS" \
  KARDATA_ARCHIVE_DIR="$ARCHIVE_DIR" KARDATA_MCP_URL="http://127.0.0.1:3101/mcp" \
  KARDATA_MCP_TOKEN="$WORKER_KEY" KARDATA_META_KEY="${KARDATA_META_KEY:-}" \
  KARDATA_META_MODEL="${KARDATA_META_MODEL:-}" KARDATA_WEB_SEARCH_KEY="${KARDATA_WEB_SEARCH_KEY:-}" \
  nohup node "$ROOT/backend/dist/temporal/dev-worker.js" >"$LIVE_DIR/worker.log" 2>&1 &
WORKER_PID=$!
echo "$BACKEND_PID $WORKER_PID" >"$LIVE_DIR/pids"

# UI env for the Playwright runner. Sourced, never printed.
{
  echo "export VITE_STAGING_API=1"
  echo "export VITE_STAGING_URL=http://localhost:3101"
  echo "export VITE_STAGING_KEY=$OWNER_KEY"
  echo "export KARDATA_LIVE_UI=1"
} >"$LIVE_DIR/ui-env.sh"
chmod 600 "$LIVE_DIR/ui-env.sh"

echo "live stack starting: backend=$BACKEND_PID worker=$WORKER_PID logs=$LIVE_DIR/backend.log,$LIVE_DIR/worker.log"
echo "ui env: source $LIVE_DIR/ui-env.sh"
