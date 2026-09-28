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
