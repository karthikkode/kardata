# Environments

Local operations for Kardata. Every command runs from the repo root unless
noted. Node 22.

## Staging / prod / remote (2026-10-10)

Three places, one box. Staging is THIS checkout
(`/home/karthik/projects/kardata_app`): dev, tests, and the pilot
stack. Prod is the sibling worktree `/home/karthik/projects/kardata_prod`
pinned to `origin/prod`: the owner's daily work, clean separate DB,
never runs tests. Remote is the `origin/prod` branch itself (the
release ref). Deploy = push a SHA to `origin/prod` + rebuild the
prod dir from it; `stack.mjs doctor` fails on any drift.

Port map (never overlap): staging keeps today's ports (pg 5432/5433,
Temporal 7233, Temporal-UI 8080, backend 3001, obs 3000/3100/9090,
vite 15173/15174, pilot 3201/25174). Prod takes pg 5434, Temporal 8233, Temporal-UI
9080, backend 4001, Loki 4100, Prometheus 10090, Grafana 4000, UI
45174. Staging processes must never bind a prod port or mount a
prod volume; tests use `TEST_DATABASE_URL`-derived databases only.

Resources: staging runs lean by default, prod is favored; one
script rebalances both ways (see `docs/runbook.md`: prod→0 /
staging→full for heavy test windows, back after). Profiles:

| Profile | Workers | DB pools | Small-model | Browser |
|---|---|---|---|---|
| `lean` (staging default) | 1 | 10 + 5 | 4 | 4 |
| `full` (prod default) | 4 | 20 + 10 | 8 | 8 |

`npm run stack:resources` prints the table; `stack:prod up --profile`
and `stack:rebalance <normal|testing>` apply it. The Meta vendor
account is shared across envs (full+full peaks at 16 vendor calls),
so rebalance to `testing` limits prod interference during big runs.

## Workspaces

| Workspace | Commands |
|---|---|
| `frontend` | `npm run dev -w frontend`, `npm run build -w frontend`, `npm run test:e2e -w frontend`, `npm run test:coverage -w frontend` (istanbul; reports in `frontend/coverage/`, gitignored) |
| `agents` | `npm run test --workspace @kardata/agents`, live probes below |
| `backend` | `npm run test --workspace @kardata/backend` (see Backend) |

All workspaces: `npm run lint`, `npm run typecheck`, `npm test`.

## Backend

- Install: `npm install --workspace @kardata/backend` (or plain `npm install`
  at root; workspaces hoist shared deps).
- Gates: `npm run lint --workspace @kardata/backend`,
  `npm run typecheck --workspace @kardata/backend`,
  `npm run test --workspace @kardata/backend`.
- Backend tests live at `tests/backend/...` mirroring the area they cover;
  they import `backend/src` relatively and run under the backend vitest
  config (repo root as file root, include scoped to `tests/backend`).
- Lint covers both `backend/` and `tests/backend/` under one rule set
  (`tests/backend/eslint.config.js` re-exports the backend rules; flat
  config only matches files under its own directory, so the tests tree
  lints from its own cwd).
- Build: `npm run build --workspace @kardata/backend` (emits `backend/dist/`).
- Run the server: `PORT=3001 node backend/dist/server.js`
  (B0.1; Compose owns process management from B0.4).
- Compose backend: `docker compose build backend && docker compose up -d backend`
  from `deployment/`. The image bakes `dist`, so code changes need a rebuild;
  a plain restart keeps serving stale code. Host DB port clashes (e.g. another
  project on 5432) need `KARDATA_PG_PORT=5433` on the same command line.
- Provider key: the compose `backend` service reads gitignored `agents/.env`
  via `env_file` (`KARDATA_META_KEY`, optional Meta model/mode overrides).
  Values never enter tracked files; `GET /v1/providers` reports key presence
  only. The same file feeds the harness live probes.
- Provider selection: `KARDATA_PROVIDER` resolves `meta` (product calls via
  `KARDATA_META_KEY`/`KARDATA_META_MODEL`/`KARDATA_META_MODE`) or `fake`
  (scripted replies for tests and degraded mode). There is no second
  product provider, so the poisoned-lane playbook in `docs/runbook.md`
  drains to `fake` while the key/config fix goes forward.
- Document OCR needs no extra key: image and scanned-PDF uploads transcribe
  through the vision model over `KARDATA_META_KEY` (`KARDATA_OCR_MODEL`,
  default `muse-spark-1.3-contributor`; `KARDATA_OCR_DISABLED=1` skips OCR
  and attaches as `needs-ocr`). Without the Meta key, or when vision
  rejects, uploads degrade to `needs-ocr` with the reason attached.
- Retrieval keys: `KARDATA_WEB_SEARCH_KEY` enables `web_search` (endpoint
  override `KARDATA_WEB_SEARCH_URL`, default Brave); without the key the
  tool fails closed `unconfigured`. Sweeps still run: the fallback chain
  tries the keyless engine pool (no key needed, best-effort — expect bot
  walls) then the real-Chromium browser leg. `KARDATA_CHROME_PATH` points
  the `browser_*` tools at an explicit local Chromium binary (laptop dev
  only); in compose they ride `KARDATA_CHROME_CDP_URL` to the `browser`
  sidecar and never touch the laptop. Without either they fail closed.
  Values never enter tracked files. `KARDATA_BROWSER_TEST=1` gates the
  live browser suite (needs Chromium plus network); it is skipped by
  default like the Temporal suites.
- Browser-pool budget: `KARDATA_BROWSER_MAX` caps concurrent browser
  sessions (1–16, default 8; owner ceiling 16). The pool scales from
  zero: contexts are created on demand and closed on release or the
  5-minute idle reap, so idle pools hold no browser RAM. Size per
  context at 250–800 MB (heavier on JS pages): 8 slots fit a 16 GB
  laptop pool with headroom; 16 is the ceiling, not the target. Chrome
  also needs shared memory: keep the sidecar's `/dev/shm` large or
  `--disable-dev-shm-usage`, or tabs crash before RAM matters.
- Session chat worker (dev): `npm run worker --workspace @kardata/backend`
  serves the turn lane (`kardata-turn-v1`) so `POST /v1/commands/send` starts
  (signal-with-start) and runs session workflows. Needs `DATABASE_URL`,
  `TEMPORAL_ADDRESS=localhost:7233`, provider keys, and
  `KARDATA_MCP_URL`/`KARDATA_MCP_TOKEN` (backend `/mcp` plus an API key).
  Without a worker, sends are accepted but no turn executes. The `worker`
  compose service runs the turn lane (session chat) plus the sweep lane
  (sector discovery) in-container (`backend/src/temporal/dev-worker.ts`
  via `deployment/worker-entrypoint.sh`); `npm run worker` remains the
  laptop dev path. The compose worker needs `KARDATA_MCP_TOKEN` in
  `agents/.env` (it calls back into backend `/mcp` with an API key) and
  `KARDATA_WEB_SEARCH_KEY` for live sweeps.
- One worker fleet at a time: the compose worker and a laptop
  worker poll the same `kardata-turn-v1` queue, so a forgotten
  local worker steals turns at random. The stack scripts enforce
  this: `npm run stack:worker:host` refuses while a host worker
  polls and stops the compose worker before starting the laptop
  one, `npm run stack:worker:compose` refuses while a host worker
  polls, and `npm run stack:doctor` fails on any duplicate fleet
  (compose+host or host+host) with the exact kill commands.
  After rotating the token, recreate
  the worker (`docker compose up -d --force-recreate worker`): a plain
  restart keeps the stale credential and every tool-requiring turn it picks
  up fails with `mcp request ... failed with HTTP 403`, surfacing in chat
  as "I could not complete that reply." Boot logs a `[FATAL] worker mcp
  auth` line when the credential does not resolve.
- API auth is always on in the server (B3.3): seed service keys with SQL —
  plaintext never stored, only the SHA-256 hash. With an empty `api_keys`
  table every route answers 403. Hash locally, then insert the hex:
  `node -e "console.log(require('crypto').createHash('sha256').update('SECRET').digest('hex'))"`
  `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
   VALUES ('ops-1', '<hex>', 'tenant-a', NULL, 'approver');`
  (roles are `viewer` < `operator` < `approver`.)
- `GET /healthz` returns build sha (`BUILD_SHA`, default `dev`) and uptime.
  Unknown routes return the shared `{ ok: false, error: { code, message } }`
  envelope with 404.
- Capacity settings (Phase 4; invalid values fail fast at startup):
  `KARDATA_TURN_ACTIVITY_SLOTS` (turn activities per worker, default 4),
  `KARDATA_META_MAX_CONCURRENT` (fleet-wide Meta calls through the Postgres
  permit table, default 4 until the Phase 8 ceiling measurement),
  `KARDATA_MAX_CHILDREN_IN_FLIGHT` (default 50; over-cap children wait in
  the durable queue), `KARDATA_MAX_CHILDREN_QUEUED` (default 2000; over-cap
  rejects immediately, never a 30 s timeout), `KARDATA_DB_POOL_SERVER`
  (default 10) and `KARDATA_DB_POOL_WORKER` (default 5). At startup both
  entries validate the fleet: server + worker x `KARDATA_WORKER_REPLICAS`
  (default 1, set by `stack.mjs worker --replicas`) must fit inside
  `max_connections` minus `superuser_reserved_connections`, else boot
  fails naming every env var; unreachable DB only warns. The old
  `KARDATA_PG_SERVER_MAX` / `KARDATA_PG_WORKER_MAX` names still work with
  a deprecation warning. Research fan-out is a plan budget
  (`plan.budgets.concurrency`, 1–64), still under the Meta limiter. `/mcp`
  has its own per-key rate bucket (600/min default, code option, not env);
  /mcp calls with a verified execution binding are budgeted per thread, so
  the fleet never shares one budget on the worker token.
  Replicas: `stack.mjs worker --replicas N` (1–16). Turn MCP calls carry
  positional `(run, round, call_index)` keys, so retried rounds dedupe
  server-side instead of doubling effects.

## Staging UI (browser live mode)

No mocks exist anywhere in the product: every row renders from the backend,
and the old mock origin (`frontend/src/mock/`, scenario flags, staged
arrivals) is deleted. Surfaces without a backend (email tracking, its stat
cards) render an explicit not-connected placeholder with no numbers.

- `frontend/.env` (git-ignored): `VITE_STAGING_API=1`,
  `VITE_STAGING_URL=http://localhost:3001`,
  `VITE_STAGING_KEY=<service-key>`. Restart the vite dev server after
  editing; without the flag the app shows a backend-not-connected notice,
  never sample data.
- `KARDATA_CORS_ORIGINS` (compose backend env, comma-separated, default
  `http://localhost:5173,http://127.0.0.1:5173`): browser origins allowed
  to call the API. A UI on any other origin gets a connection-error panel
  because the browser blocks the preflight: that panel means "unreachable",
  never "empty". Refused keys render the lock notice instead, and genuinely
  empty lists render the first-run copy.
- API keys are minted by the operator, never shipped: generate 24 random
  bytes, store only the SHA-256 hex in `api_keys`, and hand out the
  plaintext once. Example (operator role, all projects):
  `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
  VALUES ('op-1', '<sha256-hex>', 'demo', NULL, 'operator');`
  Roles ladder viewer < operator < approver; unknown keys answer 403.
- Deep links: view state lives in query params, so refresh and Back/Forward
  restore the view — `?section=Researches&tab=companies`,
  `?section=SectorDetail&sector=<id>`, `?section=Agents`. No params means
  home, as before.
- Clean-slate reset: `KARDATA_PG_PORT=5433 docker compose -f
  deployment/compose.yaml down -v` destroys all volumes (data, demo keys,
  demo seeds), then `up -d` migrates fresh and you mint keys as above. The
  `seed` CLI command (`backend/src/db/cli.ts`) is a local-dev tool only and
  is never run against this database.
- Cleanliness gates: the `no-hardcoded-staging` suites fail on `localhost`,
  `127.0.0.1`, dev ports, or demo key names in product source, and on any
  `mock/` import, scenario hook, or `Mock`-prefixed type. The only allowed
  literals are documented env defaults (`TEMPORAL_ADDRESS` local fallback,
  CORS local-vite origins), each listed exactly in the backend test's
  allow-list. The contract test (`tests/backend/contract.test.ts`) maps
  every live UI wire shape to its OpenAPI schema.

## Provider keys (agents live probes)

Opt-in only: copy `agents/.env.example` to `agents/.env` and set
`KARDATA_META_KEY`. Without the key the live suite
skips; nothing else changes.

## Archive storage (GCS, B-F2)

Three host values, all optional in dev:

- `KARDATA_GCS_BUCKET` — set it and the backend/worker use GCS as the
  archive target; unset and everything runs on the filesystem target at
  `KARDATA_ARCHIVE_DIR` (compose default `/var/kardata/archive`,
  code default `var/archive`). No credentials needed without a bucket.
- `KARDATA_GCS_PREFIX` — optional key prefix inside the bucket.
- `KARDATA_GCP_PROJECT_ID` — GCP project for the storage client.
- `KARDATA_GCP_ADC_PATH` — host path of the previous kardata project's
  service-account file, mounted read-only at `/run/kardata/adc.json`
  (`GOOGLE_APPLICATION_CREDENTIALS`). Key material never enters the repo;
  only this path crosses the boundary.

## Compose platform (B0.4)

- Boot: `npm run stack:up` (db, temporal, browser, backend,
  worker; cold boot to green in ~1 min). Telemetry + temporal-ui
  are opt-in via `npm run stack:obs` (Loki needs ~30 s ring-join
  settle, smoke probes poll); on machines where a second stack
  already holds 3000/3100/8080/9090 (e.g. preflight here) `obs`
  fails to bind by design — the app services are unaffected.
  Raw form: `docker compose -f deployment/compose.yaml up -d
  <services>`.
- Deploy after every repo move or branch switch: `npm run
  stack:deploy` — rebuilds `backend`/`worker` from HEAD (stamped
  with the source SHA), boots, waits for health, fails on worker
  `[FATAL]`, and verifies MCP parity. A stale image silently
  drops new MCP tools on the wire (observed: 55 vs 59 tools) or
  dies on endpoints the code already handles (observed: stale
  worker throwing on Meta's 402 for the token-count endpoint);
  `npm run stack:doctor` fails on image/HEAD SHA drift so it
  cannot go unnoticed.
- On this machine host 5432 is held by another Postgres; the
  stack scripts default to `KARDATA_PG_PORT=5433` (override via
  env). Plain `up` without it bounces `db`, which dies on the
  port conflict and takes backend+worker down with it (observed
  2026-09-28; volumes untouched, data safe).
- Diagnose: `npm run stack:status` (state + freshness vs HEAD),
  `npm run stack:doctor` (duplicate fleets, stale images, MCP
  parity, with fix commands). Stop: `npm run stack:down`
  (volumes kept; never `down -v`). Stale test processes:
  `npm run stack:clean` (live stack plus owned vite/playwright
  leftovers only; the owner's dev servers are never touched).
- `db` and `temporal` restart with the daemon (`unless-stopped`,
  data in volumes), so a power cut self-heals; confirm with
  `npm run stack:status` before redeploying.
- Services: `db` (Postgres 16, :5432), `temporal` (:7233), `temporal-ui`
  (:8080), `backend` (:3001, self-migrates on boot, fails closed without DB),
  `loki` (:3100), `promtail`, `prometheus` (:9090), `grafana` (:3000,
  admin/kardata-dev, Loki + Prometheus provisioned).
- All images pinned by digest in `deployment/compose.yaml`. Passwords marked
  DEV ONLY are local-dev placeholders, never staging/prod secrets.
- Reachability: `KARDATA_COMPOSE=1 npm run test --workspace @kardata/backend`
  (smoke suite polls each service; without the flag it skips explicitly).
- DB shell: `docker compose -f deployment/compose.yaml exec db psql -U kardata -d kardata`.
- Host 5432 taken by another Postgres? `KARDATA_PG_PORT=5433 docker compose
  -f deployment/compose.yaml up -d db` remaps the host side only.
- Backend live-DB tests: `TEST_DATABASE_URL=postgresql://kardata:kardata-dev@localhost:5433/kardata_test
  npm run test --workspace @kardata/backend` (DB suites derive their own
  databases). Without the variable the DB suites skip explicitly; compose
  smoke additionally needs `KARDATA_COMPOSE=1`.
- Temporal proof tests: boot the stack first
  (`KARDATA_PG_PORT=5433 docker compose -f deployment/compose.yaml up -d db temporal`),
  then `KARDATA_TEMPORAL_TEST=1 npm run test --workspace @kardata/backend`.
  Without the flag the Temporal suites skip explicitly.
- Alert rules: `npm run prom:check` (config) and `npm run prom:test`
  (firing proofs, incl. `KardataPoolExhaustion`); both run promtool from
  the pinned Prometheus image, no local install needed.
- Verification matrix: every suite states its gate. `TEST_DATABASE_URL`
  gates DB suites, `KARDATA_TEMPORAL_TEST=1` gates Temporal suites,
  `KARDATA_COMPOSE=1` gates compose smoke, the Meta key gates live
  provider probes. Without its gate a suite skips explicitly and the
  handoff states what was skipped. Failures remain merge blockers: retain the
  failed run and compare a bounded isolated reproduction to diagnose resource
  contention. A passing rerun does not erase the failure or justify weakening
  deadlines; record its root cause and maintained regression.
- Migrate outside compose: `DATABASE_URL=... npm run migrate --workspace @kardata/backend -- up|down`.
- Retention sweep (B6): `DATABASE_URL=... node backend/dist/db/cli.js sweep [days]`
  deletes outbox frames, completed idempotency replay records, and heartbeat
  rows older than the window (default 90 days). In-progress idempotency
  claims are never swept. Run it on a schedule (cron/systemd timer) — without
  it those three tables grow unbounded.
- Tear down: `docker compose -f deployment/compose.yaml down` preserves volumes.
  Removing volumes requires an explicit scoped owner instruction and inventory;
  never add `-v` as routine test or deployment cleanup.
- Archive backend: `KARDATA_ARCHIVE_TARGET=gcs|fs` (default `fs`),
  `KARDATA_GCS_BUCKET` + `KARDATA_ARCHIVE_PREFIX` for staging GCS,
  credentials via `GOOGLE_APPLICATION_CREDENTIALS`. Local runs stay on the
  filesystem target; nothing here is a secret.

## Log access + query cookbook (B5.1)

- Flow: backend and workers log pino JSON to stdout; `promtail` (docker
  socket) ships every container to `loki` (:3100); Grafana (:3000,
  admin/kardata-dev) has Loki as its default datasource. Promtail parses
  `level`/`msg` out of each JSON line, so `level` is a stream label.
- Join keys: every HTTP line carries `trace_id` (ingress traceparent,
  echoed back on the reply), plus `tenant` on keyed requests. Workflow
  signal lines carry the Temporal workflow/run ids from the log
  interceptor. Alert runbooks (B5.4) paste the `trace_id`/`run_id` into the
  first query below: alert to exact logs in one click.
- Cookbook (all verified against the staging Loki push/query path):
  - One trace end to end: `{container="kardata-backend-1"} | json |
    trace_id="<id>"`
  - Errors only: `{container="kardata-backend-1", level="error"}`
  - Slow requests: `{container="kardata-backend-1"} | json |
    latencyMs > 1000`
  - Rate-limit breaches: `{container="kardata-backend-1"} |=
    "http.rate_limited"`
  - Workflow signals (once the worker fleet lands; same pipeline):
    `{container=~"kardata-worker.+"} |= "signal received"`
  - No-secrets audit: `{container=~"kardata-.+"} |~ "(?i)secret"` must
    stay empty — credential values never reach a line (query strings and
    headers are excluded by construction; the scrub formatter is the
    second net).
- Capacity budget: Loki retains 7 days (`deployment/loki.yaml`
  `retention_period: 168h`, compactor enforced — boot-validated). Measure
  burn with `sum by (container)
  (bytes_over_time({container=~"kardata-.+"}[24h]))`. The B5.6 synthetic soak (`tests/backend/soak.report.md`) measured
  detection, precision, ledger, and gauge truthfulness at 1000-agent
  scale; its token spend is the synthetic-ruler number, not a production
  burn rate. Treat 7d × measured daily burn as the ceiling check before
  lengthening retention.

## Run inspector guide (B5.5)

- Diagnose a stuck run from the event log (no Temporal access needed):
  `GET /v1/debug/runs/session-run-<sessionId>` with an `operator` key.
  The reply carries event count + last thread states, the paginated
  timeline (`?afterSeq=&limit=`, max 1000), stall findings, decided
  approvals (gate verdict joined with the operator record), stored/indexed
  artifacts, and distinct idempotency keys. Answers reflect the durable
  log and can lag live workflow truth.
- Act on it: `POST /v1/commands/pause` (operator, suspend),
  `POST /v1/commands/resume` (approver, retry, optional
  `extendedBudgetMs`), `POST /v1/commands/cancel` (operator) with
  `{ "runId": "session-run-<sessionId>" }`. Every action returns 202 plus
  a `commandId` and lands in the access log with its `trace_id`.
- Denials: `viewer` callers get 403 `permission_denied` on both the
  inspector and the commands; cross-tenant ids get 404 with no payload,
  so tenants stay unprobbable.
- Flow proven by `tests/backend/ops.inspector.test.ts`
  (find → diagnose → act); read model proven by
  `tests/backend/api.inspector.test.ts`.

## Staging acceptance scripts

- Reachability (B0.4, live): the compose smoke suite above, proven green
  against a cold boot (backend, Temporal UI, Grafana, Prometheus, Loki).
- Contract + replay + soak checks land with their phases (B2.2, B5.6
  landed, B6.2 next).
- Sector draft-to-sweep acceptance (pending live keys): create a draft
  sector, attach a context document, `POST /v1/sectors/{id}/start`, and
  watch one `sector-sweep-{id}` workflow reach terminal state under
  compose with `KARDATA_WEB_SEARCH_KEY` set. Not yet run — no search
  provider key or pilot sector provisioned.
- Skipped verification is recorded explicitly per run, never silently.

Hardening worker telemetry: `KARDATA_TEMPORAL_METRICS_PORT` defaults to 9464,
and the existing Prometheus worker job uses that port. A port change must update
the scrape target in the same deployment. The worker installs its redacting
logger before its SDK connection. The current local UI credential has operator
role, so the approver-only real pilot remains blocked until the owner configures
an existing approver credential; no key was upgraded by the agent.

On2026-10-01 the owner explicitly authorized a dedicated test approver. The prior
UI operator record remains unchanged. Local raw material is in ignored
`frontend/.env.pilot-key`, original UI configuration in ignored
`frontend/.env.pilot-backup`, and active configuration in `frontend/.env`; permissions
are0600. Do not print/commit these files. Owner-authorized provisioning now uses
`registerApiKey` inside backend/src/db, validates hash/scope/role, coalesces exact
repeats and rejects conflicting identities. It is not an HTTP/MCP tool. Restore
local UI configuration from the backup if returning to the operator; do not delete
pilot records or credentials without separate scoped owner instruction. The earlier
operator-only blockade above is historical; compatibility and rollout gates remain.
