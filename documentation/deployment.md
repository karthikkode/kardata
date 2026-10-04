# Deployment

Compose files, Dockerfiles, environment templates. No secrets: ever
(dev-only placeholders are marked DEV ONLY and never leave local compose).

## Files

- `deployment/compose.yaml` — full local platform (db, temporal, temporal-ui,
  backend, loki, promtail, prometheus, grafana). Images pinned by digest.
- `deployment/Dockerfile` — backend runtime (multi-stage: build on
  alpine, Debian-slim runtime for the glibc-linked Temporal bridge;
  builds `@kardata/agents` from source, migrates via entrypoint then
  serves).
- `deployment/backend-entrypoint.sh` — `migrate up`, then exec server.
  Fail closed: no server without a migrated database.
- `deployment/scripts/stack.mjs` (+ pure `stack-lib.mjs`) — one-command
  local platform behind `npm run stack:*` (up/down/deploy/status/
  doctor/obs/worker:host/worker:compose). Deploy stamps images with the
  source SHA (`org.kardata.git-sha` label via `GIT_SHA` build arg);
  doctor fails on duplicate fleets and SHA drift. Commands and
  rituals live in `docs/environments.md`.
- `deployment/loki.yaml`, `promtail.yaml`, `prometheus.yaml`,
  `grafana-provisioning/` — telemetry configs. Prometheus scrapes the
  backend `/metrics` (requests, fleet gauges, pool pressure) plus
  itself; the Temporal SDK target stays commented until a worker fleet
  serves metrics.

## Operations

Postgres reserves a1-GiB `/dev/shm` mount for parallel query dynamic shared
memory. Docker's64-MiB default exhausted under the two-worker DB battery and the
pinned runtime crashed/recovered. Connection and per-process pool budgets stay
unchanged; more shared memory does not authorize unbounded query concurrency.
`deployment.capacity.test.ts` pins configuration. The existing CI integration
Postgres service uses the same1-GiB shared-memory
budget; the maintained regression parses both configurations. CI's service option
does not change the shared running database or authorize a deployment.
The original two-worker battery
must also pass on an isolated matching runtime. Updating source does not resize
the existing container: apply through a planned, backed-up rollout preserving
the existing data volume, never a volume reset. Measurements and commands belong
in operations documentation.

Boot, probe, migrate, and teardown commands live in `docs/environments.md`.
Prod topology is self-hosted; connection budget math lives in
`documentation/db.md` (process × max vs `max_connections`). Compose is
dev/staging, not prod; its Postgres flags are dev values.

The existing worker now initializes Temporal SDK logging/metrics before its
connection. SDK metrics bind port 9464 by default; Prometheus uses the worker
target, not the Temporal server. Deploy its matching scrape configuration with
the worker. The owner authorized merging the verified preflight fixes before the separate
2,000-company pilot. Preflight deployment/replay and applicable PR checks must
still pass; that merge does not certify the pending full release acceptance or
live company campaign.

Browser network guard uses the existing backend port, configured as
KARDATA_BROWSER_PROXY_URL in backend/worker. The existing KARDATA_MCP_TOKEN signs
domain-separated short-lived public-browser transport capabilities; no new secret
is published or service added. Sidecar launch includes runtime-verifiable
enable-automation, disable-quic and disable-non-proxied-UDP policy flags. Old
browsers without the required flags fail closed on new guarded execution.

New contexts require verified launch flags before page navigation. Local execution
uses the same critical flags as the existing sidecar; no unsafe certificate/web
security bypass is accepted. Updating this source/configuration does not roll the
existing shared workers/browser. Compatibility/replay checks still precede rollout.

Migration19 is additive attempt state. Apply it before starting matching hardening
workers. Do not mix unfenced older workers with new active attempts; preserve
older histories through replay and the explicit pause/review/start transition.
Rollback requires quiescing active attempts before returning to old workers;
source archive paths/hashes remain backward-readable and research data is retained.

Backend and worker must use the same archive target. Filesystem mode mounts the
existing `archive-data` volume at `/var/kardata/archive` in both roles; GCS mode
uses identical bucket/prefix/project settings and the same read-only ADC mount.
Worker evidence cannot live in its disposable container layer or a different
bucket from the owner-facing server. Configuration regression:
`tests/backend/archive.storage-config.test.ts`. Actual deployed round-trip and
restart verification remain separate gates. Before replacing an older worker,
inventory and preserve any legacy container-local archive bytes; never discard
them by treating a new shared mount as automatic migration.

CI integration gates durable PDF ingestion with `workflows.file-processing.test.ts`
on its existing isolated Temporal service. It explicitly sets
`KARDATA_FILE_TEMPORAL_ADDRESS=localhost:7233`; no shared-server fallback is allowed.
The suite includes archive recovery, worker replacement, hidden-file pause and
both 25-second storage heartbeat checks. Providers are scripted fixtures. This
gate establishes durable execution, not real Meta extraction quality; the
opt-in UI journey remains separate. The YAML-parsing deployment-capacity
regression pins the suite and explicit address together.

CI also runs the opt-in real PDF decoded-memory scenarios separately from
`pr:verify`, setting `KARDATA_PDF_MEMORY_TEST=1` and retaining the JSON report.
The scenarios assert image counts, pixel hashes and cleanup for near-limit
rasters with 1/10/100 repeated placements and up to two concurrent parsers.
Memory readings are measurements, not a portable hard-RSS bound.
