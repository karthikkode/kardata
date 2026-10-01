# DB

Postgres schema, migrations, and the single access layer. No seeds
pretending to be live data.

## Layout

- `db/migrations/*.sql` — versioned migrations, each with `-- migrate:up`
  and `-- migrate:down` sections. Applied in filename order; every migration
  must round-trip down then up on an empty database. Schema only: no
  application code lives in top-level `db/`.
- The migrator is `backend/src/db/migrate.ts` (transaction per file,
  `schema_migrations` bookkeeping). Tests: `tests/backend/db.migrations.test.ts`.
- The access layer is `backend/src/db/` (B7.1): per-aggregate
  repositories plus the pool factory, exported through the `db/index.ts`
  barrel. It is the only product code allowed to import `pg` (eslint
  `no-restricted-imports`); every other module — routes, activities,
  projectors, and later MCP tools — reaches the database through it.

## Access-layer rules

- One table never spans two repositories; see the repo map below.
- Every public function validates input with zod and throws
  `DbContractError` on misalignment. No raw SQL outside the layer.
- Pool settings (max, timeouts, per-process budgets) live in
  `backend/src/db/pool.ts` and nowhere else.

## Hardening contracts (2026-10-01)

- Event and outbox sequence allocation uses the shared transaction-scoped
  durable-stream advisory lock. Sequence order must match commit order or
  projector/SSE cursors can skip a delayed transaction. Workspace transactions
  acquire this lock before aggregate locks. Never hold a transaction across
  provider/archive IO or call the projector from inside a workspace transaction.
  Proved by `db.commit-order.test.ts` (both original failures reproduced).
- Migrations serialize across processes with a dedicated session lock before
  schema bookkeeping. Connect timeout: 10 seconds; lock wait: 30 seconds;
  statement timeout: five minutes. Client close releases the lock. Concurrent
  migrators are tested on fresh isolated databases, never the shared base URL.
- Sector discovery ids include sector and normalized domain. Legacy ids are
  adopted only in their owning sector. Discovery registers ledger candidates
  without overwriting researched verdicts; intentional research updates remain
  the separate upsert operation.
- New file version digests include original bytes, extraction units
  and upload/artifact provenance. Different scans with the same filename cannot
  alias through empty OCR text. Historical hashes and approvals stay unchanged.
- `commitThreadCompaction` atomically updates the summary and parked working
  view using context-version/checkpoint comparison. Active or changed work
  rejects stale replacement. Visible transcript rows remain immutable.
- Thread directory reads use `listThreadHeaders`; authority reads use
  `getThreadHeader`. Neither loads entire child transcripts. Full history reads
  remain explicit operations.

## Read-path paging (thousand-row rule)

`listCompanies`, `listSectorCompanies`, and `sectorActivity` take an
optional `paging` window (`limit` 1-500 default 100, `offset` >= 0
default 0) and return `{ rows, total }` (`{ companies, total }`,
`{ entries, total }`): the window plus the truthful full count, so no
caller mistakes a page for the whole table. Invalid windows throw
`DbContractError` before any SQL. `researchHealth` reads the tail
window (total first, then the last 200) because health signals come
from the latest entries. Routes and MCP tools pass `limit`/`offset`
through and answer totals alongside windows; the frontend filters
server-side and counts from totals, never window lengths.

## Pool budgets

- One factory (`createDbPool`), one shared worker pool
  (`workerPoolFromEnv`, cached per connection string, lazy). No
  per-module pool copies.
- `SERVER_POOL_BUDGET` (max 10): HTTP server, serves routes plus
  projector catch-up. `WORKER_POOL_BUDGET` (max 5): each worker
  process; activities are I/O-light event/heartbeat writes. Both carry
  a 30 s statement timeout as a runaway backstop. Starting values;
  retune against measured contention, not vibes.
- Env overrides (compose sets them; unset means the code default):
  `KARDATA_PG_SERVER_MAX`, `KARDATA_PG_WORKER_MAX`,
  `KARDATA_PG_STATEMENT_TIMEOUT_MS`. Invalid values throw at startup.
- Pool pressure reports via `kardata_pg_pool_total/idle/waiting`
  (`poolStats()` in the factory); `KardataPoolExhaustion` pages on
  sustained waiting. Slow queries surface in Postgres logs
  (`log_min_duration_statement = 1000` in compose).

## Connection budget

Every pool max below must sum under the compose Postgres
`max_connections = 100` (explicit in `deployment/compose.yaml`).

| Process | Pool | Max | Count | Total |
|---|---|---|---|---|
| backend (server) | `SERVER_POOL_BUDGET` | 10 | 1 | 10 |
| worker | `WORKER_POOL_BUDGET` | 5 | N | 5N |
| migrator / tests | ad-hoc | ≤5 | transient | ≤5 |
| headroom (superuser, replication, bursts) | — | — | — | remainder to 100 |

Rule: adding a worker costs 5 connections. Past ~15 workers, revisit
(PgBouncer is the documented next step, not more max).

## Agent connection contract

Three paths exist; everything else is a bug:

1. Runtime activities → `workerPoolFromEnv()` (shared worker pool).
   Workflows never touch the DB (Temporal SDK restriction).
2. External and harness agents → keyed HTTP routes → layer functions.
3. Future MCP tools → the binding table above, one tool per function.
   `publishOutboxFrame` stays projector-only except ephemeral `delta`
   frames published by provider activities (never projected, never
   replayed as history); `runCheckpointTx` never becomes a tool.

Agents never receive `DATABASE_URL` or any database credential. The
connection string exists only in server/worker/migrator process env.
Enforced by the `pg` lint ban plus the factory caching contract test.

## Repository map

| Repository | Tables |
|---|---|
| `events.ts` | `events` (log reads/writes, session reads, retention read/delete — sessions have no table of their own; artifact reads, cross-session references, tenant artifact listing) |
| `sectors.ts` | `sectors`, `companies` (event-sourced domain projections; writes append sector.*/company.* events, the projector upserts) |
| `threads.ts` | `threads`, `thread_messages` |
| `ledger.ts` | `ledger_entries` |
| `heartbeats.ts` | `heartbeats` |
| `outbox.ts` | `outbox` |
| `keys.ts` | `api_keys` |
| `quotas.ts` | `rate_windows`, `idempotency_records` |
| `workspace.ts` | `sector_workspace`, `workspace_changes`, `workspace_files`, `thread_context`, `research_work`, `thread_instructions` (sector workspace: shared global context with approvals, per-thread local memory, steering, file library) |
| `checkpoints.ts` | `projection_checkpoints` |

(`schema_migrations` stays migrator-only.)

## MCP binding table

When the MCP server lands, each tool is pure wiring over one layer
function below. Function names are stable and verb-first; the server
adds auth, transport, and tool schemas, never SQL.

| Future tool | Layer function | Notes |
|---|---|---|
| `db.append_event` | `appendEvent` | idempotent write; returns seq + duplicate flag |
| `db.read_partition` | `readPartition` | paginated by afterSeq |
| `db.find_event` | `findEventByKey` | exactly-once lookup |
| `db.read_events_after` | `readEventsAfter` | projector catch-up batches |
| `db.create_session` | `createSession` | server-generated id; binds tenant |
| `db.rename_session` / `db.delete_session` | `renameSession` / `deleteSession` | rename keeps history; remove is a tombstone (hidden, history kept); unknown sessions are contract errors |
| `db.pause_run` / `db.resume_run` / `db.cancel_run` | `pauseThreadRun` / `resumeThreadRun` / `cancelThreadRun` | run controls over the messenger runner (fail-closed); resume is approver-gated |
| `db.get_session` / `db.list_sessions` | `getSession` / `listSessions` | scope-filtered reads; bare list is general sessions only, `sectorId` narrows to one sector pool |
| `db.list_sectors` / `db.get_sector` | `listSectors` / `getSector` | scope-filtered reads with live company counts |
| `db.list_companies` / `db.list_sector_companies` | `listCompanies` / `listSectorCompanies` | scope-filtered reads |
| `db.sector_activity` | `sectorActivity` | timeline derived from the sector partition |
| `db.create_sector` | `createSector` | appends sector.created; id server-generated |
| `db.attach_sector_document` / `db.list_sector_documents` / `db.read_sector_document` / `db.query_document` | `ingestSectorDocument` / `listSectorDocuments` / `readSectorDocument` / `querySectorDocument` | context file attach, list, full-text read, and dual-mode TOC summary / targeted chunk query; visibility passes through the owning sector |
| `db.get_global_context` / `db.propose_global_context` | `readGlobalContext` / `proposeGlobalContext` | versioned shared sector context read + proposed edits (normal chats need owner approval; research writes via parent commit) |
| `db.commit_child_context` | `commitChildContext` | research parent commits a child finding or open question (scope/decisions/file inclusion need owner approval) |
| `db.list_sector_files` / `db.propose_file_context` | `listSectorLibrary` / `proposeFileContext` | visible indexed sector files; owner approval to include exact file units in global context |
| `db.get_local_context` | `readThreadContext` | per-thread working memory (summary + covered seq + notes) |
| `db.set_sector_state` | `setSectorState` | appends sector.state_changed |
| `db.start_sector_research` | `startSectorResearch` | draft → queued + sweep start; compensates to draft on failure; optional `sessionId` records the research pin |
| `db.pause_sector_research` / `db.resume_sector_research` | `pauseSectorResearch` / `resumeSectorResearch` | running ↔ paused owner transitions (state-only) |
| `db.mark_company_found` | `markCompanyFound` | appends company.found |
| `db.set_company_stage` / `db.set_company_state` | `setCompanyStage` / `setCompanyState` | appends stage/state transitions |
| `db.list_artifacts` / `db.create_artifact` | `listArtifacts` / `createArtifact` | session files menu (own + referenced); create stores bytes, indexes, and serves immediately (unknown sessions fail before any write) |
| `db.reference_artifact` | `referenceArtifact` | cross-session attach, indexed-only |
| `db.resolve_artifact_scope` | `resolveArtifactScope` | owning scope for serve |
| `db.list_tenant_artifacts` | `listTenantArtifacts` | tenant attach discovery |
| `db.find_launch_parent` | `findLaunchParentWorkflowId` | finished-child steer routing |
| `db.get_thread` / `db.list_threads` | `getThread` / `listThreads` | projection reads |
| `db.project_batch` | `projectBatch` | projector use; not for ad-hoc writes |
| `db.record_heartbeat` / `db.list_heartbeats` | `recordHeartbeat` / `listHeartbeats` | liveness signal |
| `db.read_outbox` | `readOutboxBacklog` / `latestOutboxSeq` | stream replay |
| `db.publish_outbox_frame` | `publishOutboxFrame` | projector use only |
| `db.subscribe_outbox` | `subscribeOutbox` | single LISTEN client per stream |
| `db.project_usage` / `db.run_totals` / `db.fleet_totals` | `projectUsage` / `runTotals` / `fleetTotals` | exact-decimal costs |
| `db.find_key` | `findKeyByHash` | hash lookup; auth stays in backend |
| `db.check_rate` | `checkRate` | fixed-window counter |
| `db.claim_idempotency` / `db.complete_idempotency` / `db.release_idempotency` | claim / complete / release | mutation exactly-once |
| `db.run_checkpoint_tx` | `runCheckpointTx` | projector use only; owns lock + commit |
| `db.kb_search` | `searchKb` | FTS over curated corpus; cite source_path |
| `db.ledger_upsert_company` / `db.ledger_get_company` / `db.ledger_list_companies` | `upsertLedgerCompany` / `getLedgerCompany` / `listLedgerCompanies` | master-ledger company record |
| `db.ledger_record_problem` / `db.ledger_list_problems` | `recordLedgerProblem` / `listLedgerProblems` | one row per researched problem |

## Current schema (0001–0019)

- 0009–0013: sector drafts, document units index, context selection
  (notes + unit exclusions), research session pin, planning states.
- 0014–0017: sector workspace (`sector_workspace` + `workspace_changes`
  approvals, `workspace_files` library, `thread_context` local memory,
  `research_work`, `thread_instructions` steering). Repo map row above.

- 0018–0019: workspace lookup/value guards and active-attempt lease fencing.

- 0008: `kb_documents` / `kb_chunks` (versioned product corpus, GIN FTS),
  `ledger_companies` / `ledger_problems` (cross-run master ledger).

- 0001: `events` (append-only log), `heartbeats` (per-operation),
  `outbox` (SSE), `threads`, `thread_messages`, `ledger_entries`
  (projections). See `docs/architecture.md` for the diagram and rules.
- 0002: `ledger_entries.event_seq` uniqueness guard (idempotent
  re-projection).
- 0003: `projection_checkpoints` (projector high-water marks).
- 0004: outbox notify plumbing.
- 0005: `api_keys` (key hash, tenant/project, roles).
- 0006: `rate_windows` (fixed-window counters), `idempotency_records`
  (mutation claims + replays).
- 0007: `sectors`, `companies` (sector research projections over
  sector.*/company.* events; state/stage CHECKs mirror the product vocab).

Reserved, currently unwritten by product code: `heartbeats.attempt`
(future per-op attempt counting) and `outbox.delivered_at` (future
publisher claiming). Kept intentionally; removal is one migration if
they stay unused.

Plan-write retries return their original event-derived version even after later
plan writes. A concurrent newer plan never changes an earlier operation result.

New artifact bodies use content-addressed archive references. Conflicting ID
replays cannot overwrite winning bytes or re-index altered content. Legacy flat
references remain readable. Imports check source tenant/project ownership and
source visibility before recording a destination reference.

Artifact creation emits the shared start/done/error boundary logs and pipeline
operation records; operational output includes identities/counts, never bodies.

### Document ingestion atomicity

Archive acceptance precedes DB publication. A document row, its extracted units,
and its original-byte reference publish in one SQL statement, or not at all.
New uploads derive their document ID from a 48-hex-character sector/version
hash prefix (53 characters including `sdoc-`, within the existing 64-character
unit-reference contract); the full stored version hash guards collisions.
concurrent identical uploads coalesce through the existing primary key. Existing
matching IDs are adopted to retain old links. No legacy rows or bytes are removed.
A successful archive write followed by DB failure may retain unreferenced bytes;
it never publishes a pointer implying a complete index. Retrying repairs the full
index for the same version. No new table, index, or transaction service is added.

### Outbox subscription cleanup

A subscription owns one pooled LISTEN client. Failed LISTEN setup destroys that
lease and rethrows the original error. Callback registration is idempotent;
registration after close is ignored. Concurrent/repeated close shares one cleanup
result, removes every handler, and releases the client exactly once. Failed
UNLISTEN destroys the client rather than returning residual subscription state to
the pool; the failure is logged and propagated. Subscribe/unsubscribe emit the
shared start/done/error operation triple. This fixes lifecycle safety, not pool
capacity: one held client per stream remains a measured scalability requirement.

A leased client has an explicit error supervisor before LISTEN begins. A socket
failure destroys its lease once and notifies consumers, including a consumer
registered after the failure. SSE waiters wake and fail; MCP waits reject rather
than report a healthy timeout. Operational logs record connection failures without
connection strings or payloads. An isolated DB drill terminates only its own
inventoried listener PID and asserts stream rejection, pool recovery, and a healthy
subsequent query.

### Owner-authorized key provisioning

`registerApiKey` is an administrative DB-layer operation, not an HTTP or MCP
capability. It accepts a key ID, SHA-256 hash, tenant/project scope and a validated
role. Raw credentials never reach Postgres. Exact repeats are idempotent; a
conflicting ID/hash/scope/role cannot overwrite an existing credential. Provision
only under explicit owner instruction; model execution cannot invoke this door.
The owner authorized a dedicated approver credential for the final UI test on
2026-10-01. Keep the prior operator key unchanged and store raw new material only
in ignored local configuration. Boundaries log outcomes without hashes/tokens.

`readSectorExecutionState` is a scoped DB-layer lifecycle guard. It reads the
latest committed sector-state event rather than assuming the projection is up
to date. Intake publication calls it within the existing durable transaction
lock, after archive work. A committed owner pause therefore blocks publication
even when the projector is lagging; no projector runs inside that transaction.

Discovery review events persist validated decisions and verified content-addressed
source references before publication. They remain in the sector event partition
when a terminal turn clears its working continuation. Exact source text lives in
the established archive; event refs carry hashes/session provenance rather than
large bodies. Publication still has its independent approved-plan/lifecycle/cap
transaction. A durable review receipt does not imply its candidate was accepted.

### Active attempt fencing

Each production turn receives an independent DB attempt lease. Checkpoint writes,
steering consumption, terminal checkpoint cleanup and active-state release must
match that lease. A cancelled or expired attempt cannot overwrite or clear a
replacement attempt, even when both carry the same logical operation ID. The
lease is additive transient state; durable summaries/transcripts/continuations
remain intact. Internal manual context repair remains separately version-checked.

Attempt fencing also applies to automatic summary persistence inside its existing
transaction. Reading a newer context version does not let an older attempt
replace that summary. Manual owner edits retain the version-checked API. All
production continuation hydration uses verified session-scoped, cancellable,
bounded archive reads, including restart checkpoints.

Research work upserts fence conflict updates by sector and plan version. Reusing
an identity from another sector is denied; reusing it under another version
conflicts. Completed receipts are immutable and replay emits no false state
notification. The conflict predicate is atomic, including competing inserts.

Plan edit and approval use the workspace transaction/durable-stream lock and the
committed lifecycle seam. Stale approvals fail; concurrent twin approvals pin once.
Compatible discovery retention uses a single bulk insert, preserves original rows
and journals source/destination versions plus prefixes/count in the same approval
transaction. Lower limits and changed scope/criteria cannot silently discard or
bless prior work. Retention never converts blocked/failed receipts to completion.
