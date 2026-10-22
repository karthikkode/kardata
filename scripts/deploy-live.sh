#!/usr/bin/env bash
# Deploy main to the live checkout (~/kardata-live) and restart the service.
#
# Default: drain deploy. Promotion freezes via a pipeline checkpoint set to
# the current completed count (in-flight jobs finish normally, nothing new
# starts), the script waits for live work to drain (2h cap, override with
# DEPLOY_DRAIN_SECS), then pulls, builds, migrates, restarts, and restores
# the previous checkpoint (or clears it). If the drain times out the
# checkpoint is restored and the deploy aborts, so the wave resumes.
# A pipeline that is already paused stays paused (setting a checkpoint
# would resume it); the script only waits for the drain.
#
# --force: pause-all path. Pauses live jobs immediately (up to ~2 min for
# stragglers), then pulls/builds/migrates/restarts and resumes them.
#
# Order matters: pull/build/migrate happen while the old code still runs,
# so migrations must stay additive — the old code must tolerate the new
# schema until the restart. Never cancel/supersede company jobs mid-deploy:
# post-migration CHECK constraints may reject the old status values.
#
# A graceful stop parks live agent runs as failed, so both paths restart
# only with no running jobs; a job claimed in the last seconds may still
# park failed and need a manual company_job_retry (it shows in reports).
set -euo pipefail

LIVE="${HOME}/kardata-live"
FORCE=0
DRAIN_SECS="${DEPLOY_DRAIN_SECS:-7200}"
DRAIN_POLL_SECS=60
if [ "${1:-}" = "--force" ]; then FORCE=1; fi
if [ ! -d "${LIVE}" ]; then echo "no live checkout at ${LIVE}"; exit 1; fi

cd "${LIVE}"
if [ ! -f .env ]; then echo "no .env in ${LIVE} (copy the prod one there first)"; exit 1; fi
set -a
# shellcheck disable=SC1091
source .env
set +a
if [ -z "${KARDATA_OPERATOR_TOKEN:-}" ]; then echo "KARDATA_OPERATOR_TOKEN missing in ${LIVE}/.env"; exit 1; fi
MCP_URL="${KARDATA_MCP_URL:-http://127.0.0.1:8787/mcp}"

json_field() {
  # json_field <dotted.path>: read an MCP response on stdin, print the field.
  node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const j=JSON.parse(s);
    if(j.isError) process.exit(2);
    let v=j.structuredContent;
    for(const k of process.argv[1].split('.')) v=v?.[k];
    if(v===undefined||v===null) process.exit(3);
    console.log(typeof v==='object'?JSON.stringify(v):String(v));
  } catch { process.exit(2); }
});" "$1"
}

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

pause_all_ids() {
  npx tsx scripts/mcp-call.ts company_jobs_pause_all '{"reason":"deploy"}' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const j=JSON.parse(s);
    if(j.isError) process.exit(2);
    for(const id of j.structuredContent?.paused??[]) console.log(id);
  } catch { process.exit(2); }
});"
}

# Guard: freeze or pause live work before the restart. Sets PAUSED_IDS
# (jobs to resume after) and RESTORE_CHECKPOINT (target to put back, or
# the word "null" to clear, or empty when the checkpoint was untouched).
PAUSED_IDS=""
RESTORE_CHECKPOINT=""
FROZEN=0

restore_checkpoint() {
  if [ "${FROZEN}" = "0" ] || [ -z "${RESTORE_CHECKPOINT}" ]; then return 0; fi
  FROZEN=0
  if [ "${RESTORE_CHECKPOINT}" = "null" ]; then
    npx tsx scripts/mcp-call.ts pipeline_checkpoint_set '{"afterCompleted":null}' > /dev/null \
      || echo "warning: checkpoint clear failed (clear it by hand)"
  else
    npx tsx scripts/mcp-call.ts pipeline_checkpoint_set "{\"afterCompleted\":${RESTORE_CHECKPOINT}}" > /dev/null \
      || echo "warning: checkpoint restore to ${RESTORE_CHECKPOINT} failed (set it by hand)"
  fi
}

update_and_restart() {
  git pull --ff-only origin main
  npm ci --no-audit --no-fund
  npm run build
  npm run db:migrate
  # Final guard: a job begun since the drain check would orphan on restart.
  local running
  running="$(running_ids)" || { echo "refusing: cannot list running jobs"; return 1; }
  if [ -n "${running}" ]; then
    echo "stragglers since the drain check, pausing: $(echo "${running}" | wc -l) job(s)"
    PAUSED_IDS="$(pause_all_ids)" || { echo "pause-all failed, aborting"; return 1; }
    sleep 20
    running="$(running_ids)" || { echo "re-check failed, aborting"; return 1; }
    if [ -n "${running}" ]; then echo "refusing: jobs keep starting, try again"; return 1; fi
  fi
  systemctl --user restart kardata-server
  for _ in $(seq 1 30); do
    curl -sf -m 5 "${MCP_URL%/mcp}/healthz" > /dev/null && break
    sleep 2
  done
  curl -sf -m 5 "${MCP_URL%/mcp}/healthz" > /dev/null \
    || { echo "restarted but unhealthy; paused jobs stay paused (resume per job)"; return 1; }
}

if curl -sf -m 5 "${MCP_URL%/mcp}/healthz" > /dev/null; then
  if [ "${FORCE}" = "1" ]; then
    RUNNING="$(running_ids)" || { echo "refusing: cannot list running jobs"; exit 1; }
    if [ -n "${RUNNING}" ]; then
      for _ in 1 2 3 4 5 6; do
        IDS="$(pause_all_ids)" || { echo "pause-all failed, aborting"; exit 1; }
        PAUSED_IDS="${PAUSED_IDS} ${IDS}"
        sleep 20
        RUNNING="$(running_ids)" || { echo "re-check failed, aborting"; exit 1; }
        [ -z "${RUNNING}" ] && break
      done
      if [ -n "${RUNNING}" ]; then echo "refusing: jobs keep starting, try again"; exit 1; fi
      echo "paused for deploy:${PAUSED_IDS}"
    fi
    update_and_restart || exit 1
  else
    STATUS="$(npx tsx scripts/mcp-call.ts pipeline_status '{}')" \
      || { echo "refusing: cannot read pipeline status"; exit 1; }
    COMPLETED="$(echo "${STATUS}" | json_field completed)" || { echo "refusing: bad status"; exit 1; }
    ALREADY_PAUSED="$(echo "${STATUS}" | json_field paused.paused)" || ALREADY_PAUSED="false"
    PREV_TARGET="$(echo "${STATUS}" | json_field checkpointTarget)" || PREV_TARGET="null"
    if [ "${ALREADY_PAUSED}" = "true" ]; then
      echo "pipeline already paused, waiting for the drain (checkpoint untouched)"
    else
      FREEZE_TARGET="${COMPLETED}"
      if [ "${FREEZE_TARGET}" -lt 1 ]; then FREEZE_TARGET=1; fi
      echo "freezing promotion at ${FREEZE_TARGET} completed (checkpoint was ${PREV_TARGET})"
      npx tsx scripts/mcp-call.ts pipeline_checkpoint_set "{\"afterCompleted\":${FREEZE_TARGET}}" > /dev/null \
        || { echo "freeze failed, aborting"; exit 1; }
      RESTORE_CHECKPOINT="${PREV_TARGET}"
      FROZEN=1
      trap restore_checkpoint EXIT
    fi
    WAITED=0
    while true; do
      RUNNING="$(running_ids)" || { echo "drain check failed, aborting"; exit 1; }
      if [ -z "${RUNNING}" ]; then break; fi
      if [ "${WAITED}" -ge "${DRAIN_SECS}" ]; then
        echo "drain timed out after ${DRAIN_SECS}s, wave resumes (deploy aborted)"
        exit 1
      fi
      COUNT="$(echo "${RUNNING}" | wc -l)"
      echo "draining: ${COUNT} job(s) live (${WAITED}s elapsed)"
      sleep "${DRAIN_POLL_SECS}"
      WAITED=$((WAITED + DRAIN_POLL_SECS))
    done
    echo "drained, deploying"
    update_and_restart || exit 1
    trap - EXIT
    restore_checkpoint
  fi
else
  echo "warning: live server unreachable, proceeding (fresh install?)"
  update_and_restart || exit 1
fi

for id in ${PAUSED_IDS}; do
  npx tsx scripts/mcp-call.ts company_job_resume "{\"jobId\":\"${id}\"}" > /dev/null \
    || echo "resume ${id} failed (resume it by hand)"
done
echo "live deploy done"
