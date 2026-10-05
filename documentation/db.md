# DB

Durable supervision uses `backend/src/db/reconciliation.ts` for bounded keyset
thread reads and matched-state finding recording inside existing workspace/
durable transaction locks. Migration0021 adds retained execution intents, a
per-thread epoch head and private active epoch/workflow/execution lease fields.
Only exact terminal execution proof with unchanged head/lease and no unresolved
starts permits recovery failing; legacy/unknown ownership remains advisory.
Acting responses (nudge, pause, stop, cancel, fail, alert) run through the same
fences; every action writes an `alerts` row (migration0025). No research
content or execution history is deleted. Sector health limits reads to that sector's
persisted session/thread IDs. See [supervision](agents-supervision.md).

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
  `KARDATA_DB_POOL_SERVER`, `KARDATA_DB_POOL_WORKER`,
  `KARDATA_PG_STATEMENT_TIMEOUT_MS`. Invalid values throw at startup.
- Startup guard: server and worker validate their pool max against the
  server's `max_connections` (`validatePoolBudget`); over budget fails
  fast naming the env var, unreachable DB only warns (boot continues).
- Pool pressure reports via `kardata_pg_pool_total/idle/waiting`
  (`poolStats()` in the factory); `KardataPoolExhaustion` pages on
  sustained waiting. Slow queries surface in Postgres logs
  (`log_min_duration_statement = 1000` in compose).

## Connection budget

Parallel query dynamic shared memory has a separate deployment budget: the
matching Compose runtime provides1GiB rather than Docker's64MiB default.
Pool/connection ceilings below still apply. Shared-memory exhaustion is an
infrastructure failure, never a reason to weaken contention tests or classify
healthy queued agents as dead. See the deployment authority and recorded
isolated concurrency evidence before selecting a supported operating envelope.

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
| `db.attach_sector_document` / `db.list_sector_documents` / `db.read_sector_document` / `db.query_document` | `attachSectorDocument` / `listSectorDocuments` / `readSectorDocument` / `querySectorDocument` | shared backend semantic attachment orchestrates durable PDF jobs through the layer; context list/read/TOC/chunks retain scoped DB functions |
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
| `db.get_sector_plan` | `readSectorPlan` | bound-sector plan for sector chats; Karbot denied |
| `db.get_research_progress` | `readResearchProgress` | bound-sector progress for sector chats; Karbot denied |
| `db.list_sector_sessions` | `listSectorSessions` | sector chats with kind/title/updatedAt/threadKeys incl. agent:* |
| `db.read_sector_thread` | `readSectorThread` | bounded cross-chat read (fromSeq/limit ≤ 100); subagents stay isolated |
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

## What is stored where

| Data | Store | Notes |
|---|---|---|
| Event log | `events` (+`trace_id`, `client`) | append-only; knowledge types never cold-move |
| Execution journal | `t.execution.recorded` events | request/response/tool bytes via archive refs |
| Rounds / tool calls | `execution_rounds`, `tool_calls` | projected from `t.provider.round` / `t.tool.call` |
| Documents / units | `sector_documents` (+`author_thread`), `sector_document_units` | direct writes, never events |
| Artifacts | `t.artifact.*` events + archive bytes | referenced across sessions by key |
| Companies / work | `companies`, `research_work` | projected from company.* events |
| Cold pointers | `cold_event_pointers` | one row per moved operational event |
| Alerts | `alerts` | supervision findings, resolved_at nullable |
| Thread failure reason | `threads.state_reason` | supervisor kind (closed-owner, ...); cleared on next state |
| Evaluation | `v_thread_cost`, `v_research_quality`, `v_agent_reliability` | read via `GET /v1/sectors/:id/evaluation` |

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
- 0025: `events.trace_id`/`client`, `alerts`, `execution_rounds`,
  `tool_calls`, `sector_documents.author_thread`, `cold_event_pointers`,
  and the three evaluation views.

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

File-processing creation may receive a trusted execution source thread from the
shared attachment helper. The layer validates its scoped owning session and sector
binding before archive/publication. An immutable source event records each actual
job/thread association; caller-provided names never grant this provenance or any
research/approval authority. Repeated uploads retain the same file/job identity.

OCR transcript units share the2,000-character text-unit cap. Image and scanned-PDF
transcripts split in reading order with sequential ordinals, retaining OCR kind,
confidence and uncertainty on every chunk. Owner-required PDF completion supersedes
the former ten-image/scanned-only limit. Every page retains its native text and every
embedded image is sent individually, in reading order, through the existing configured
AI provider OCR adapter. Calls are sequential; native text never suppresses image
processing. A PDF with no images still indexes its native text. Completed image work
must remain durable across retry/restart so recovery does not repeat a paid provider
response. Original bytes, per-image evidence and extraction-version identity remain
retained; incomplete work must expose a recoverable processing/failure state and
cannot masquerade as a complete index. Each provider/storage operation is bounded
by deadline/byte limits and attributable retries; no arbitrary image-count document
truncation applies. This is the approved target contract, not a claim that current
implementation is complete. Archive receipt/checkpoint binding and mixed-PDF real
parser/provider verification remain requirements before activation.
OCR failure details expose only stable reason codes and safe HTTP status; transport
exceptions, endpoint URLs, credentials and response bodies stay out of document
details. OCR boundaries log start/done/error with code and latency only.
HTTP OCR responses stream under the existing8MiB document byte budget before JSON
parsing. The existing request deadline covers headers and body reads, including an
abort-ignoring injected transport; oversized/non-success/late bodies are cancelled.
All OCR adapters must return finite confidence from0 to1. Only absent HTTP confidence
uses the historical default1, inferred from the adapter source rather than measured
OCR confidence; malformed values never silently become confident text
or JSON-null provenance. Each OCR transcript and the aggregate scanned-PDF transcript
share the8MiB byte cap; overflow retains original upload bytes as Needs OCR without
publishing a partial index. These per-operation caps do not establish100-concurrent
file capacity, extraction/parser peak memory or a deployed OCR endpoint limit.
`file-pipeline.test.ts` pins these limits with injected OCR/PDF doubles; these are
not deployed OCR/provider or genuine-document evidence.

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

Bound MCP mutation intents and successful replies use the existing event log via
`operation-receipts.ts`. Receipt keys hash caller/operation identity; the payload
retains the validated thread, semantic authority fingerprint and exact successful
reply. Recording precedes response-cache completion. An exact authorized retry
can reconstruct that cache from the durable reply, including after completed-cache
retention. Intent-only, conflicting and legacy-unproven records retain their guard.
Scoped inspection returns status/reason only, never arguments or response content.

HTTP replay completion/release passes the request fingerprint to the quota
repository. These paths compare both fingerprint and in-progress state before
changing a claim. A changed guard remains intact and the route reports conflict;
legacy DB-tool adapters keep their existing optional-argument contract.

Migration0020 records file exposures and independent parent/child dependency
snapshots in thread context, exact source references in proposals, and dependencies
for changed global sections, summaries and working checkpoints. File lineage is
validated by hash/unit identity through indexed sector-library ownership; unit
validation reads ordinal metadata instead of repeatedly loading extracted text.
Null legacy receipts do not certify old context as file-free. Owner histories stay
stored; agent assembly parks on hidden, changed or unknown dependencies.

Approver-only safe rebuild fences version and active leases, preserves original
operation/budget/steering/archive records, journals the replaced summary, and
covers old transcript/outbox ranges without deleting them. It cannot erase source
lineage beneath unresolved mutation arguments. Agents cannot invoke this operation.

The migration marks pre-existing conversations' historical provenance unknown,
including those without an earlier thread_context row. An empty new dependency
array is not evidence that their old transcript was file-free. Explicit owner
rebuild establishes a safe current context and fences historical agent reads.

Coordinator transport reads bounded state rather than full ledger bodies: scoped
counts/domains, the existing deterministic50-company sample, exact individual
work records and100-reference retry pages. Work details remain unchanged in DB.
Candidate receipt lookup uses existing primary-key work identities in batches20;
no additional index or custom cache. Publication cap checks read counts/accepted
identity under the existing workspace lock. Plan reads filter event types before
fetching payloads; raw partition/history APIs retain their original complete data.

General-session references keep their existing alias behavior. A sector import
copies the verified indexed artifact through the existing target archive/index
pipeline, then indexes extraction units in the destination sector before returning
indexed success. The original source reference remains recorded as provenance.
Destination copies have independent library visibility. Partial archive/unit
failures remain processing and retries reuse the same file identity; missing or
corrupt source bytes never produce a successful import reference.

Execution inspection records use the existing immutable event journal plus verified
content-addressed archive references. Each record binds session/thread, logical
turn, attempt lease, round and kind. The journal transaction validates the session
binding and current lease; stale attempts cannot publish current execution records.
Archive IO occurs before that transaction. Unreferenced bytes after a failed commit
are retained for reconciliation; no DB pointer certifies unverified content.
Records describe normalized adapter inputs/results, not raw vendor HTTP payloads.
Every karbot turn round journals request/response/tool-result in production,
including in-turn compaction rounds (marked `roundKind: compaction`; recovery
replays turn requests only). Keyed owner inspection
(`GET /v1/threads/:threadKey/execution-records`) and the ExecutionInspector UI
read the same journal.

`listSectorLibrary` orders uploaded and generated metadata together by arrival,
descending, then file ID. A single scoped aggregate reads artifact arrival times
from existing events; document timestamps come from the existing document rows.
No new column or API property is introduced. The keyed HTTP regression in
`files.library-order.test.ts` places a new generated report before 2,000 older
upload metadata rows and verifies stable ordering for tied timestamps.

Execution journal writes reject a ref outside
`execution-records/<sha256(sessionId)>/<hash>.json` before publication. The matching
active lease row supplies actual workflow/execution IDs and canonical epoch;
conflicting supplied workflow/execution metadata is rejected. Trusted SDK values
are a legacy fallback only when those DB columns are null. These immutable IDs
survive active-lease cleanup. Scoped keyset reads cap metadata pages at100 and
keep private archive references inside the backend read layer.

### Intake owner decisions

`reviewResearchWork` is an approver-route-only scoped repository operation. It
locks the sector workspace and selected work receipt, compares a SHA-256 receipt
digest and latest approved plan version, and rejects live candidate leases or
unresolved execution starts. Migration0022 admits `excluded` without rewriting
old rows; rollback requires no excluded rows. Only unresolved discovery intake
receipts are eligible. The event `sector.research.work_reviewed` stores exact
previous work, plan version, decision, owner key and reason. Retry retains the
receipt fields and counters; exclusion preserves them too. Work updates cannot
overwrite completed/excluded receipts. No company publication occurs here.

## Scoped in-app supervision alert reads

`backend/src/db/alerts.ts` reads the `alerts` table (migration 0025): one row
per action with kind, severity, subject, thread/sector attribution and an
explicit resolved timestamp. Raises dedupe to the open row per
kind/severity/subject/thread/sector; every raise needs a thread or a sector so
reads stay scope-checkable. Exclusive descending sequence pages fetch at most
limit+1 (limit1–100). Thread alerts scope through thread → session → owner
event and exclude deleted sessions; sector alerts scope through the sector row.
Reads use logOp; private execution fields and unbounded reason bodies never
enter output. HTTP shapes/roles are authoritative in
`documentation/backend.md`; liveness semantics are in
`documentation/agents-supervision.md`.

Durable file processing retains stored processing/failed/needs-ocr status on all
document and library reads. Agent document queries expose no text, units or TOC
until atomic indexed publication; processing metadata is not readable knowledge.
Original archive bytes remain owner-readable through the scoped file surface.

## Durable PDF jobs and paid receipts

Approved design: `documentation/plans/2026-10-01-pdf-ingestion.md`. Migration0023
adds file-owned jobs, ordered image identities and immutable attempt rows. Original
SHA256(base64) and source/settings identity pin the file; final extraction digest
is separate. Paid replies stage exact serialized normalized responses plus parsed
JSON before archive completion. New provider requests are admitted at most two
concurrently through a shared DB transaction lock. Request-start receipts cannot
be treated as pre-effect failures; absent durable response proof requires explicit
approver retry with possible duplicate paid work acknowledged. Retries retain
prior attempts, original bytes and completed image work. No rollback may drop
nonempty processing receipts. Final publication atomically reveals ordered capped units with page/image provenance
only after sealed manifest completeness. WIP batches remain unreadable knowledge. Hidden
files cannot dispatch new images, retry or publish. Model/agent code cannot approve
retries or acquire DB/archive authority through tool arguments.

### Streamed full-document publication

Version1 manifests remain supported. Version2 holds scoped/hash-verified references
to bounded version1 record parts, preserving all pages and image placements.
`streamFileProcessingUnits` yields ordered native/image units; production uses
`stageAndPublishFileProcessingJob`, not the array inspection helper. Batches of
at most100 units commit behind the sector workspace advisory lock without the
global durable-event lock and without archive IO inside a DB transaction.
Incomplete rows remain hidden from every agent/document query until statusindexed.

Retry may replace nonpublic derived staging units and remove an obsolete staged
tail for this exact file/revision. Original bytes, manifest parts and every paid
attempt remain retained, so knowledge is not discarded. The final short workspace
transaction validates revision, manifest, completed image ownership and staged
coverage/digest before publishing indexed visibility and its durable event.
Canonical streaming digests/checkpoints and complete character counts are retained.
Document text becomes a bounded64,000-code-unit preview; full content stays in
indexed units and the access-controlled archives, with explicit truncation metadata.
File metadata listing reads counts rather than transporting full text bodies.

Document chunk budgets are finite integers1..2000 UTF-16 code units. Chunk cuts
never divide a supplementary Unicode code point into unmatched surrogate halves;
a one-unit budget cannot hold such a pair and fails explicitly. Paragraph packing
remains unchanged. This preserves valid JSONB units for emoji/native/OCR text.

### Queued file admission bindings

File jobs persist private dispatch_state(unreserved/reserved/confirmed/uncertain),
nonce, canonical workflow ID and exact execution ID. Reserve commits before RPC;
only the owning nonce/revision may record its outcome. Immutable reserve/outcome
events retain previous heads after owner retry resets admission at a new revision.
Reserved NOT_FOUND is not proof that a late RPC had no effect. Exact execution
proof may clear only dispatch-specific uncertainty with no hidden or unknown
provider work; old acknowledgements cannot reset a successor. These fields are
never public progress, model authority or approval grants. Maintenance behavior
and bounds are in `documentation/agents-supervision.md`.
