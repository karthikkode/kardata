# Kardata incident runbooks (B5.4)

Every alert annotation points here plus a log query. The one-click path is
always the same: take the `trace_id` (reply `traceparent` header, signal
log line, or alert description) and open `{container="kardata-backend-1"}
| json | trace_id="<id>"` in Grafana Explore. Boards: **Kardata Fleet**
(platform RED, lanes, heartbeats), **Kardata Runs** (runs, tools,
provider calls, slow spans).

## env rituals (staging / prod / remote)

Prod is the sibling worktree `/home/karthik/projects/kardata_prod`
(project `kardata-prod`, own ports/volumes, clean `kardata_prod`
DB); remote is the `origin/prod` branch. Every release = SHA to
`origin/prod` + rebuild of the prod dir; `stack:doctor` fails on
any drift (image labels vs `origin/prod`).

Bootstrap (once): `git worktree add /home/karthik/projects/kardata_prod prod`;
copy `deployment/env.prod.example` to `agents/.env` inside the prod
dir (ignored, never committed) and set `KARDATA_UI_KEY`. Provider
keys are inherited from this checkout's `agents/.env` automatically;
the prod `agents/.env` only overrides them if prod must differ. First
deploy: `npm run stack:release -- <merge-sha>`; `npm run stack:prod -- up`
(boots everything, migrates the clean DB; workers stay tool-less until
keys exist); `npm run stack:prod -- provision-keys` (registers the
`prod-worker` + `prod-owner` API keys, hashes only); `npm run stack:prod
-- deploy` (fresh backend/worker/ui containers, full verify). Daily
release: `npm run stack:release -- <merge-sha>` then
`npm run stack:prod -- deploy` (keys persist in the kept volume).

Rebalance: heavy test window → `npm run stack:rebalance -- testing`
(production `down`, staging recomposes full); after →
`npm run stack:rebalance -- normal` (staging lean, prod up full).
Rollback: `npm run stack:release -- <older-sha> --rollback` then
`npm run stack:prod -- deploy --rollback` (resets the worktree back;
refuses on tracked modifications); prod data survives (volumes kept
unless `down --volumes`). Status: `npm run stack:prod -- status`,
freshness proof: `npm run stack:doctor` (`prod/*` PASS lines).
Backup: `npm run stack:prod -- backup`
(pg_dump to `<prod-dir>/var/backups/`).

## stall

The current worker source starts durable `executionReconciliation` on its existing
research queue. Verify the matching image/workflow is actually running before
assuming supervision is active. Its `t.reconciliation.finding` events appear in
the owning session inspector and sector `db.research_health` historical
observations. Modern attempts with exact terminal execution, matching current
epoch/lease and no unresolved start are parked for owner review with an
`execution.recovery` notice. Legacy/unknown ownership remains advisory. New start
reservations protect same-ID successors before event/lease acquisition. Inspect
saved local context/pending operations before deciding recovery. Heartbeat/progress/
queue observations never cancel a healthy slow workflow. Missing Temporal status means unresolved, not
dead. Complete cursor rotations add detection latency at large fleet sizes.

Legacy `t.stall.response` response names below describe pure policy decisions;
they alone do not prove an actual suspend/retry occurred. Alert delivery and
Prometheus incident wiring must be verified separately from durable finding
records. Do not treat a seeded metrics test as deployed reconciliation evidence.

- Alert: `KardataStaleHeartbeats` (page). A run is past its operation
  heartbeat threshold (60 s idle, 120 s in-tool).
- Diagnose: `{container="kardata-backend-1"} |= "stall.sweep"` shows the
  sweeper outcome per run: kind (`missing-heartbeat`, `no-progress`,
  `repeated-calls`, `budget-near`, `context-near`) plus the recorded
  response. The full record is the `t.stall.response` event in the run's
  session partition.
- Act: verify the actual workflow state, then inspect
  the reason, fix the cause (usually a stuck tool or dead provider call),
  then resume via `POST /v1/commands/resume` (approver role). `retry` →
  verify the actual Temporal activity attempts; watch one retry window before
  touching anything. `alert` (budget/context-near) → extend the budget via
  resume with `extendedBudgetMs`, or accept the coming suspension.
- Close: heartbeat resumes (gauge returns to 0) and the next sweep is
  clean. If the gauge sticks, the worker holding the run is dead — see
  no-worker heartbeat.

## backlog

- Alert: `KardataBacklog` (page). More than 20 RUNNING runs for over a
  minute: runs pile up faster than turns complete.
- Diagnose: `kardata_runs_by_state` on the Fleet board shows which states
  pile up. Sample a stuck run: `runState` query, then its trace
  (`trace_id` from the last command reply) for the slow span — usually a
  saturated tool lane (B2.1 lane proof: turn lane stays green while tool
  lane saturates) or provider latency (`|= "provider.chat"` lines with
  large `latencyMs`).
- Act: short-term, pause low-priority runs (`POST /v1/commands/pause`)
  to drain the tool lane; mid-term, raise tool-lane slots or the provider
  timeout. Never cancel en masse to "clear" the board — cancel parks one
  run at a time with an audit trail.
- Close: RUNNING count under threshold for 10 minutes with p99 back under
  2 s.

## pool-exhaustion

- Alert: `KardataPoolExhaustion` (page). Requests queued for a DB client
  for over 5 minutes: pool max too small or a query holds clients.
- Diagnose: `kardata_pg_pool_total` vs `kardata_pg_pool_idle` on the
  Fleet board shows the pressure; slow lines (`| json |
  name="db.query" | durationMs > 1000`) name the hogging query.
- Act: short-term, raise `KARDATA_DB_POOL_SERVER` / `KARDATA_DB_POOL_WORKER`
  and redeploy; mid-term, fix or index the slow query, then update the
  connection budget table in `documentation/db.md`.
- Close: `kardata_pg_pool_waiting` back at zero for 10 minutes.

## poisoned lane

- Alert: none directly — suspect it when one lane's activities fail while
  the rest of the fleet is green (error rate alert scoped to routes that
  fan out to that lane, plus `temporal_activity_failed` once SDK metrics
  land).
- Diagnose: group error logs by route and trace into the failing activity
  (`activity.providerChat` / `activity.toolCall` error spans). A single
  tool or provider selection failing 100% while siblings pass is the
  signature — check the last deploy diff for that lane first.
- Act: pause affected runs, fix forward (config/key/selector), resume.
  A poisoned provider selection can be drained by flipping
  `KARDATA_PROVIDER` to `fake` (scripted replies: safe degraded mode, not
  a healthy provider — `meta` is the only product selection) and
  redeploying the worker.
- Close: lane error share back at baseline for 15 minutes.

## retention shortfall

- Alert: none (capacity, not paging) — watch `lokidata` volume usage
  against the 7-day retention budget (`sum by (container)
  (bytes_over_time({container=~"kardata-.+"}[24h]))`, see the environments
  cookbook). Page only if ingester rejects writes (WAL/full errors in the
  Loki container logs).
- Diagnose: break down burn by stream; request/span lines dominate at
  soak scale. Confirm no secret-shaped lines before touching anything
  (the no-secrets audit query must stay empty).
- Act: shorten `retention_period` in `deployment/loki.yaml` and redeploy
  Loki (compactor enforces within `retention_delete_delay`); or grow the
  `lokidata` volume. Record the new bytes/agent/day number alongside the
  B5.6 synthetic baseline (`tests/backend/soak.report.md`).
- Close: projected 7-day usage under 80% of the volume.

## no-worker heartbeat

- Alert: `KardataBackendDown` adjacent — suspect when runs exist but no
  `turn`/`provider.chat`/`tool.call` heartbeat rows advance
  (`heartbeats` table `at` frozen) while the backend serves traffic.
- Diagnose: `SELECT run_id, op, max(at) FROM heartbeats GROUP BY 1, 2`
  against staging Postgres. If rows advance, workers live and the problem
  is above (see stall). If frozen, the worker fleet is down: `docker
  compose ps`, worker container logs (`|= "activity"` absent entirely),
  Temporal UI (:8080) for poller presence.
- Act: restart the worker fleet (`docker compose up -d` the worker
  service once the fleet entrypoint lands; today, the test workers).
  In-flight activities retry within their windows; cancelled turns stay
  cancelled — never re-send blindly, check `runState` first.
- Close: heartbeat rows advance within one threshold window and the
  sweeper goes quiet.

## backend-down

- `docker compose ps backend`, container logs (`level="error"` stream),
  then DB (`pg_isready`) and Temporal (`:7233`) health. The entrypoint
  migrates before serving — a failed migration fails closed; read its line
  before restarting anything.

## error-rate

- Failing `{{ $labels.route }}` from the alert; trace one 5xx reply end
  to end; 5xx from missing pool/gateway is the fail-closed path doing its
  job — fix the dependency, not the route.

## latency

- Slow-span panel first (`db.query` over 500 ms), then provider lines;
  per-route p99, not global average.

## rate-limit-spike

- `|= "http.rate_limited"` offenders by key hash; sustained 429 is usually
  one misconfigured client, not an attack — throttle the client before
  touching the limit.
