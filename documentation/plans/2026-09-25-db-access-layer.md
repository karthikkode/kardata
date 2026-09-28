# Plan: DB access layer (single standard path, MCP-ready)

## Goal

All product-code database access flows through one typed layer. Every
table gets covered functions (reads and writes); no route, activity,
projector, or agent path touches Postgres directly. The layer validates
every input at its boundary and rejects misaligned requests. Its
function signatures are the documented binding contract the future MCP
server will expose as tools.

## Success Criteria

- `pg` is imported in exactly one product directory (`backend/src/db/`)
  plus test helpers. An eslint rule fails the build otherwise.
- Each of the 10 data tables is reachable only through named, zod-
  validated layer functions; there is no raw SQL outside the layer.
- One pool factory owns connection settings; the four scattered
  `poolFromEnv`/ad-hoc pools are gone, with per-process budgets
  documented.
- Every repository has contract tests including rejection cases
  (bad shape, unknown key, tenant mismatch where applicable).
- `documentation/db.md` describes the layer plus the MCP binding table;
  `README.md`'s `db/` row and `docs/architecture.md` point at it.
- Full gates green: `npm run lint`, `npm run typecheck`,
  `npm run build --workspace @kardata/backend`,
  `TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1 npm run test
  --workspace @kardata/backend`.

## Context And Current Facts

- Tables (11 in `db/migrations/`, from `CREATE TABLE` inventory):
  `events`, `heartbeats`, `outbox`, `threads`, `thread_messages`,
  `ledger_entries`, `projection_checkpoints`, `api_keys`,
  `rate_windows`, `idempotency_records`, plus migrator-owned
  `schema_migrations` (stays migrator-only, no layer functions).
- 23 product files import `pg`/pool helpers; raw `.query(` lives in 9
  files (scope: routes, projector, sessions/query,
  observability, streams, auth, http/limits, activities).
- Pool creation is scattered 4 ways: `backend/src/server.ts` (inline
  `new Pool`), `temporal/activities/turn.ts`, `research.ts`, and
  `loopguards.ts` (each with its own `poolFromEnv`).
- Partial precedent exists: `events/append.ts` validates via
  `EventEnvelope`; `METRIC_LABEL_ALLOW` allow-lists metric labels;
  heartbeat writes are throttled. The plan generalizes these.
- Constraints from standing rules: `documentation/db.md` currently says
  "Nothing else lives here" about top-level `db/`; `README.md` maps
  `db/` to "Migrations and schema. Nothing else." Both need amending.
  No MCP infrastructure exists (no directory, server, or docs page —
  only a README aspiration), so the MCP server itself is out of scope
  per owner decision; the layer ships an MCP-ready seam instead.
- Tests each own a database (`tests/backend/db-helper.ts`), so repo
  moves are parallel-safe.

## Constraints And Non-goals

- No schema changes, no SQL rewrites, no performance tuning: code moves
  home, queries do not change. Behavior-neutral refactor.
- No MCP server, tools, auth, or deployment in this plan.
- `schema_migrations` stays migrator-only.
- Tests may use a `db/testkit` seeding helper (raw SQL allowed there
  only); product code may not.
- Small diffs per slice; no drive-by refactors (AGENTS.md control rules).

## Key Decisions

1. **Layer lives at `backend/src/db/`** (repositories + pool factory);
   schema stays in top-level `db/migrations/`. Rejected: TS access code
   in top-level `db/` — it would split lint/typecheck/build gates and
   contradict the language-neutral schema directory. `documentation/db.md`
   and the `README.md` map are amended to the new role.
2. **Per-aggregate repositories, not per-table files**: `events.ts`
   (`events`), `threads.ts` (`threads`, `thread_messages`),
   `ledger.ts` (`ledger_entries`), `heartbeats.ts`, `outbox.ts`,
   `keys.ts` (`api_keys`), `quotas.ts` (`rate_windows`,
   `idempotency_records`), `checkpoints.ts`
   (`projection_checkpoints`). One table never spans two repos.
3. **Single pool factory** `db/pool.ts` ( Pool config, statement
   timeout, max connections in one place). Separate processes (server,
   workers) still hold separate pools — the factory standardizes
   settings and documents per-process budgets; it does not merge
   cross-process concurrency, which stays a sizing concern.
4. **Reject at the boundary**: every public function parses input with
   zod and throws a typed `DbContractError` on misalignment (bad shape,
   empty idempotency key, over-long partition, negative limit). Callers
   map it to existing envelopes (400/404/409); no new HTTP semantics.
5. **Enforcement is mechanical**: eslint `no-restricted-imports` bans
   `pg` outside `backend/src/db/` and `tests/backend/db-helper.ts` /
   `db/testkit`. A `db/index.ts` barrel is the only import surface;
   deep imports into repos fail lint.
6. **MCP seam without MCP**: `documentation/db.md` gains a binding table
   (layer function → future tool name → notes). Function names are
   chosen stable and verb-first (`appendEvent`, `readPartition`,
   `recordHeartbeat`, …) so the later MCP slice is pure wiring.

## Recommended Approach

Move aggregate by aggregate, leaves first, each slice green before the
next. Within a slice: relocate the queries into the repo, validate
inputs with zod, repoint callers at the barrel, move/extend the tests,
run the slice checks. Keep query text identical; any behavior delta is
a bug in the slice, not scope.

## Work Plan

1. **Scaffold + rules**: `backend/src/db/{index,pool,errors}.ts`;
   eslint ban on `pg` elsewhere (product code) as warn during migration;
   amend `documentation/db.md` + `README.md` map. Validate: `npm run lint`.
2. **Events repo**: move `events/append.ts` logic → `db/events.ts`
   (`appendEvent`, `findEventByKey`, `readPartition`); repoint ~10
   callers; move tests. Validate: targeted vitest files + `typecheck`.
3. **Keys + quotas repos**: `auth/keys.ts` DB fns → `db/keys.ts`;
   rate/idempotency stores → `db/quotas.ts`. Validate: auth +
   idempotency suites.
4. **Heartbeats + outbox repos**: from `observability/heartbeats.ts`
   and `streams/outbox.ts`. Validate: stall + SSE suites.
5. **Threads repo**: projection writes + `sessions/query.ts` reads →
   `db/threads.ts` (largest slice; threads + messages stay together).
   Validate: threads + rest + SSE suites.
6. **Ledger + checkpoints repos**: `ledger/project.ts` →
   `db/ledger.ts`; projector checkpoints → `db/checkpoints.ts`.
   Validate: ledger + retention suites.
7. **Pool consolidation**: server + 3 activity-local pools → factory;
   document per-process budgets in `db.md`. Validate: full backend
   suite (activities run live against Temporal here).
8. **Binding table + final sweep**: MCP binding table in `db.md`;
   escalate the `pg` ban from warn to error; repo-wide grep proves no
   stray `pg`/`.query(`; full gates green.

## Validation Plan

- Per slice: `npx vitest run <moved-suite>` with
  `TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1`, plus
  `npm run lint` (ban enforced from slice 1) and `npm run typecheck`.
- Slice 7–8: `npm run build --workspace @kardata/backend` and the full
  backend suite (`TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1 npm run
  test --workspace @kardata/backend`), expected 32 files / 159+ passed.
- Black-box check: `GET /v1/debug/runs/:runId` and one command round-
  trip against compose unchanged (same envelopes, same bodies).
- Highest-risk step: slice 5 (threads) — most callers, projection
  writes; the suite's rebuild-equality test is the tripwire.

## Risks / Rollback

- Import churn breaks callers: mitigated by one aggregate per slice and
  the full suite per slice; rollback is `git revert` of the slice.
- Circular imports (`db/` must never import routes/workflows): lint
  barrel rule + `typecheck` catch it; repos depend only on `db/pool`,
  `db/errors`, zod.
- Activity startup semantics: factory keeps lazy init (no connect at
  import); slice 7 runs the live Temporal suites as proof.
- Scope creep into query tuning: forbidden by Non-goals; query text
  diffs in review are rejectable on sight.

## Open Questions

None. MCP-server scope was decided pre-draft (layer + seam now, server
later). Table inventory and touch points were verified in-repo.
