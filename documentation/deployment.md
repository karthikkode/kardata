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
- `deployment/loki.yaml`, `promtail.yaml`, `prometheus.yaml`,
  `grafana-provisioning/` — telemetry configs. Prometheus scrapes the
  backend `/metrics` (requests, fleet gauges, pool pressure) plus
  itself; the Temporal SDK target stays commented until a worker fleet
  serves metrics.

## Operations

Boot, probe, migrate, and teardown commands live in `docs/environments.md`.
Prod topology is self-hosted; connection budget math lives in
`documentation/db.md` (process × max vs `max_connections`). Compose is
dev/staging, not prod; its Postgres flags are dev values.

The existing worker now initializes Temporal SDK logging/metrics before its
connection. SDK metrics bind port 9464 by default; Prometheus uses the worker
target, not the Temporal server. Deploy its matching scrape configuration with
the worker. The hardening PR remains a draft until live deployment, replay and
release acceptance evidence are complete.

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
