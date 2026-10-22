#!/usr/bin/env bash
# Deploy main to the live checkout (~/kardata-live) and restart the service.
# Safe while the pipeline idles. Refuses while company jobs run, unless
# --force: then it pauses them first and resumes them after the restart.
# A graceful stop parks live agent runs as failed, so the pause loop runs
# immediately before the restart; a job claimed in the last seconds may
# still park failed and need a manual company_job_retry (it shows in
# every report). Migrations must stay additive: the old code keeps
# running until the restart.
set -euo pipefail

LIVE="${HOME}/kardata-live"
FORCE=0
if [ "${1:-}" = "--force" ]; then FORCE=1; fi
if [ ! -d "${LIVE}" ]; then echo "no live checkout at ${LIVE}"; exit 1; fi

cd "${LIVE}"
git pull --ff-only origin main
npm ci --no-audit --no-fund

if [ ! -f .env ]; then echo "no .env in ${LIVE} (copy the prod one there first)"; exit 1; fi
set -a
# shellcheck disable=SC1091
source .env
set +a
if [ -z "${KARDATA_OPERATOR_TOKEN:-}" ]; then echo "KARDATA_OPERATOR_TOKEN missing in ${LIVE}/.env"; exit 1; fi
MCP_URL="${KARDATA_MCP_URL:-http://127.0.0.1:8787/mcp}"

npm run build
npm run db:migrate

# Guard: refuse while jobs run (restart would orphan them into failed).
PAUSED_IDS=""
if curl -sf -m 5 "${MCP_URL%/mcp}/healthz" > /dev/null; then
  running_ids() {
    npx tsx scripts/mcp-call.ts company_jobs_list '{"status":"running","limit":100}' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const j=JSON.parse(s);
    if(j.isError) process.exit(2);
    for(const e of j.structuredContent?.jobs??[]) console.log(e.job.id);
  } catch { process.exit(2); }
});"
  }
  RUNNING="$(running_ids)" || { echo "refusing: cannot list running jobs"; exit 1; }
  if [ -n "${RUNNING}" ]; then
    COUNT="$(echo "${RUNNING}" | wc -l)"
    if [ "${FORCE}" = "0" ]; then
      echo "refusing: ${COUNT} job(s) running. Re-run with --force to pause them first."
      exit 1
    fi
    for _ in 1 2 3 4 5 6; do
      IDS="$(npx tsx scripts/mcp-call.ts company_jobs_pause_all '{"reason":"deploy"}' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const j=JSON.parse(s);
    if(j.isError) process.exit(2);
    for(const id of j.structuredContent?.paused??[]) console.log(id);
  } catch { process.exit(2); }
});")" || { echo "pause-all failed, aborting"; exit 1; }
      PAUSED_IDS="${PAUSED_IDS} ${IDS}"
      sleep 20
      RUNNING="$(running_ids)" || { echo "re-check failed, aborting"; exit 1; }
      [ -z "${RUNNING}" ] && break
    done
    if [ -n "${RUNNING}" ]; then echo "refusing: jobs keep starting, try again"; exit 1; fi
    echo "paused for deploy:${PAUSED_IDS}"
  fi
else
  echo "warning: live server unreachable, proceeding (fresh install?)"
fi

systemctl --user restart kardata-server
for _ in $(seq 1 30); do
  curl -sf -m 5 "${MCP_URL%/mcp}/healthz" > /dev/null && break
  sleep 2
done
curl -sf -m 5 "${MCP_URL%/mcp}/healthz" > /dev/null \
  || { echo "restarted but unhealthy; paused jobs stay paused (resume per job)"; exit 1; }

for id in ${PAUSED_IDS}; do
  npx tsx scripts/mcp-call.ts company_job_resume "{\"jobId\":\"${id}\"}" > /dev/null \
    || echo "resume ${id} failed (resume it by hand)"
done
echo "live deploy done"
