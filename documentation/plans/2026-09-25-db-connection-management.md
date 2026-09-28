# Plan: DB connection management (pools, telemetry, agent paths)

## Goal

Every process's database usage is measured, budgeted, and tunable without
code changes — and every agent, inside or outside the system, reaches the
database through exactly one defined path each, none of which is a raw
connection string in agent hands.

## Success Criteria

- Prometheus exposes per-process pool gauges
  (`kardata_pg_pool_total/idle/waiting`); an alert fires on sustained
  waiting clients.
- Pool `max` and statement timeout come from env with current numbers as
  defaults; changing them is a compose edit, not a code change.
- `documentation/db.md` carries the connection budget table, and the
  column total provably fits the compose Postgres `max_connections`.
- The agent connection contract is written down and enforced: activities
  via `workerPoolFromEnv`, HTTP callers via keyed routes, future MCP
  tools via the binding table; agents never receive `DATABASE_URL`.
- Full gates green (lint, typecheck, build, backend suite).

## Context And Current Facts

- One factory owns pools (`backend/src/db/pool.ts`, B7.7):
  `SERVER_POOL_BUDGET` max 10, `WORKER_POOL_BUDGET` max 5, 30 s
  statement timeout, all hardcoded. Numbers are starting values from
  the B7 plan, not measurements.
- Compose (`deployment/compose.yaml`) has no worker service yet and no
  Postgres tuning: stock `max_connections` (100), no
  `log_min_duration_statement`. `DATABASE_URL` is wired only into the
  backend service (dev password).
- Metrics precedent: `refreshFleetGauges` already renders
  `kardata_runs_by_state` / `kardata_stale_heartbeats` from the same
  registry; pool gauges follow the pattern. node-postgres exposes
  `totalCount`/`idleCount`/`waitingCount` on the pool object.
- Current agent paths (verified): Temporal activities call
  `workerPoolFromEnv` (one cached pool per worker process); workflows
  cannot touch the DB (SDK restriction — activities only); subagent/LLM
  agents act through workflow signals and tools and never see
  credentials; external callers use keyed HTTP routes → layer
  functions. No MCP server exists; its tools will wrap binding-table
  functions.
- The company/sector example from discussion: no such tables exist.
  Domain entities are out of scope here; the convention (migration →
  repo → binding row → tool) already covers how they will attach.

## Constraints And Non-goals

- No PgBouncer, no new services, no schema changes.
- No timeout/pool-size tuning by guesswork: this plan installs the
  dials and the instruments; retunes happen against measured data later.
- Small diffs; no drive-by refactors.

## Key Decisions

1. **Telemetry lives in the factory, gauges in metrics**: `db/pool.ts`
   tracks created pools and exports `poolStats()`; `refreshFleetGauges`
   renders the three gauges. Rejected: per-route instrumentation —
   pool-level numbers answer the contention question, per-query does not.
2. **Env overrides, code defaults**: `KARDATA_PG_SERVER_MAX`,
   `KARDATA_PG_WORKER_MAX`, `KARDATA_PG_STATEMENT_TIMEOUT_MS`; unset
   means today's numbers. Rejected: single shared max — server and
   worker have different shapes.
3. **Budget table is documentation, enforced by review**: a table in
   `documentation/db.md` (process × max × count = total vs
   `max_connections`); compose sets `max_connections: 100` explicitly
   so the ceiling is a conscious number. Rejected: automated
   admission control — overkill at this fleet size.
4. **Agent contract, three paths**: (a) runtime activities →
   `workerPoolFromEnv`, never `DATABASE_URL` handling of their own;
   (b) external/harness agents → keyed HTTP routes → layer; (c) future
   MCP tools → binding-table functions. Agents never receive database
   credentials; `DATABASE_URL` exists only in server/worker/migrator
   process env. Codified in `documentation/db.md` + `AGENTS.md`
   one-liner; enforced by the existing `pg` lint ban plus a contract
   test asserting the factory's single-pool-per-process caching.
5. **Slow-query visibility via Postgres, not code**:
   `log_min_duration_statement = 1000` in compose; the 30 s killer
   stays a backstop, not a tuning signal.

## Recommended Approach

Instruments first (so later tuning has data), then dials, then the
written contract. Each slice independently green.

## Work Plan

1. **Pool telemetry**: `poolStats()` in `db/pool.ts` (registry of live
   pools, total/idle/waiting); three gauges in `refreshFleetGauges`;
   alert rule (waiting > 0 for 5m) next to the B5.4 rules with a
   promtool check. Validate: metrics suite + `promtool check rules`.
2. **Env budgets**: three env vars wired into the factory with current
   defaults; compose passes explicit values; test asserts defaults and
   overrides. Validate: typecheck + new unit tests (no DB needed).
3. **Postgres explicitness**: `max_connections: 100` and
   `log_min_duration_statement: 1000` in compose `db` service (command
   overrides, documented as dev values). Validate: compose boot +
   smoke (`docs/environments.md` script).
4. **Budget table + agent contract**: `documentation/db.md` gains the
   connection budget table and the three-path agent contract;
   `AGENTS.md` gains the credentials rule; contract test pins
   single-pool caching and rejects direct `new Pool` outside the
   factory (grep-based, tests excluded). Validate: new tests + lint.
5. **Final sweep**: full gates green; `docs/architecture.md` telemetry
   section notes the new gauges.

## Validation Plan

- Slice 1: `npx vitest run tests/backend/observability.boards.test.ts`
  (gauges render), `promtool check rules
  deployment/prometheus-rules.yaml`.
- Slice 2: new `tests/backend/db.pool.test.ts` (defaults, env
  overrides, single-cached-worker-pool) — no DB needed.
- Slice 3: `docker compose up -d db` + connectivity/smoke per
  `docs/environments.md`; record any skipped verification explicitly.
- Slice 4: new contract tests green + `npm run lint`.
- Slice 5: `npm run lint`, `npm run typecheck`,
  `npm run build --workspace @kardata/backend`, full backend suite
  (`TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1 npm run test
  --workspace @kardata/backend`).
- Highest-risk step: slice 1 gauge wiring — the wrapped pool must
  still satisfy `Db`/`TransactableDb` structurally; typecheck plus the
  traces suite are the tripwire.

## Risks / Rollback

- Wrapped-pool typing: `wrapPool<T extends Db>` already abstracts the
  driver; stats read from the factory registry, not the handle, so no
  signature changes. Rollback per slice via `git revert`.
- Env-var sprawl: three vars, all documented in one place
  (`documentation/db.md`); anything more needs a new decision.
- Compose Postgres flags differ in prod: values marked dev-only, prod
  sizing stays an explicit later task.

## Open Questions

None. Scope (no PgBouncer, no domain tables, no guesswork tuning) was
set in discussion; agent paths were verified in-repo.
