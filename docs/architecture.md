# Architecture

Backend behavior and boundaries. Area mirror: `documentation/backend.md`.
Plan: `documentation/plans/2026-09-25-backend-build.md`.

## Service layout

- `backend/src/app.ts` builds the Fastify instance and fixes the shared
  envelopes: `{ ok: true, data }` / `{ ok: false, error: { code, message } }`.
- `backend/src/server.ts` only listens. Tests use `inject`, never a port.
- `backend/src/contract.ts` is the parity table: every live UI wire shape maps to
  a v1 counterpart or to an explicit deferral with an owner task.

## API contract (B0.2)

- Spec: `backend/openapi/v1.yaml` (OpenAPI 3.1, `info.version` 1.x).
- Versioning: additive changes stay on v1; any breaking change ships a new
  major version. Clients send no version header; the path carries it.
- Envelopes: success wraps `data`; errors use `code` from the `ErrorEnvelope`
  enum (`not_found`, `permission_denied`, `rate_limited`, `conflict`,
  `validation_failed`, `overload`). Denied is a 403 with `permission_denied`,
  never an empty state.
- Mutations (session create + all POST commands) accept `Idempotency-Key`;
  identical retries replay the first result with one effect, key reuse for
  a different request is 409. Sends to finished children return
  `missed_steer`, never a silent relaunch.
- Threads follow `documentation/frontend-thread-contract.md`: session id and
  `agent:<child-id>` keys, `@name` routing, per-thread queues with
  `acceptingSteer` + depth, SSE resume via `lastSeq`.
- Strictness posture: every object schema names `required`; wire-level
  unknown-field rejection lands with route validation (B3.1).
- Deferred shapes (not in v1, owned): research-domain resources (B3.1),
  file index (B4.3).

## Provider and model selection (Phase 1)

- Meta Spark 1.3 and 1.3 Contributor route per-session turns over the
  existing Responses adapter. With a selected reasoning effort, it requests
  `reasoning.summary: auto` and streams summary deltas over the existing
  reasoning outbox frames. Meta keeps raw chain of thought private; Chat
  Completions cannot provide a readable trace. The other Meta catalog
  models stay on Chat pending a verified Responses path. An explicit
  `KARDATA_META_MODE=responses` operator setting still overrides the
  catalog mode.

- `PATCH /v1/sessions/{sessionId}/model` stores `{provider, model, reasoning}`
  as an append-only `t.session.model` event in the session partition
  (operator role, `Idempotency-Key` honored, unknown session 404s, unknown
  model 400s); `GET /v1/sessions/{sessionId}` reads back the latest selection
  on the session's `model` field (absent until set). History is never
  rewritten: latest event wins.
- `GET /v1/providers` serves only Meta when its key is configured. It fetches
  current IDs from Meta `/models`, intersects them with the verified
  capability profiles in `backend/src/providers/registry.ts`, and returns
  exact wire IDs with no key material. A failed lookup returns 503; no stale
  fallback catalog is shown. `PATCH` checks the same live list.
- Default model: `muse-spark-1.3-contributor` with high reasoning effort.
  Existing stored session choices remain explicit bindings. Unlisted or
  unavailable models are not selectable even when named by an env variable.
- Gateway (`resolveEffectiveSelection`): the session's stored Meta model wins;
  unset selection defaults to Meta. Removed or unknown providers and models
  throw `provider_unknown`, missing keys stay the explicit
  `provider_key_missing` from adapter resolution. The resolved model
  overrides the adapter model; `providerChatActivity` accepts the same
  per-message `model`/`reasoning` pin. Contract: `backend/openapi/v1.yaml`
  (`SessionModel`, `ProviderCatalog`, `setSessionModel`, `getProviders`).

## Models tab (Phase 4 frontend)

- Sidebar `Models` section (`frontend/src/components/ModelsPanel.tsx`,
  mounted from `App.tsx`): a session picker, one card per provider, and
  the current-session binding banner. `GET /v1/providers` feeds the
  cards (Live/Unconfigured pills from `hasKey`, a server-default marker
  from `defaultProvider`); each card carries its own model picker, and
  the reasoning checkbox stays disabled where the selected model
  reports capability `none`. Saving PATCHes `{provider, model,
  reasoning}` for the picked session (reasoning forced to false where
  the capability is `none`); the banner reads the stored triple back
  from the session and announces it through a polite live region.
- Client validation (`frontend/src/data/staging-api.ts`): the catalog,
  the session `model` field, and the PATCH input/output validate with
  zod against the OpenAPI counterparts; an unvalidatable shape throws
  `invalid_response` instead of reaching the UI. No new routes, so the
  OpenAPI file is unchanged. Key material never leaves the server and
  never appears in the client: only `hasKey` booleans cross the wire.

## Event log (B0.3 schema, B1.1 write path)

- Migration: `db/migrations/0001_init.sql` (`-- migrate:up` / `:down`
  sections), applied by `backend/src/db/migrate.ts` in one transaction per
  file with `schema_migrations` bookkeeping. `TEST_DATABASE_URL` gates the
  live-DB tests; without it they skip explicitly, never silently.
- `events` is append-only: global `seq`, `idempotency_key` unique (duplicates
  reject, one effect), `partition` + `seq` ordering per scope, `redacted`
  flag, JSONB payload.
- Write path rule (B1.1): `backend/src/events/append.ts#appendEvent` is the
  only writer. Envelope Zod-validated before any SQL runs; duplicates replay
  the first `seq` (`duplicate: true`); `redacted` payloads pass through the
  B0.5 secret scrub before touching disk. `readPartition` replays a scope in
  `seq` order.
- Test isolation: DB-touching suites each own a database (`kardata_test`
  for migrations, derived siblings for appends/threads/ledger), so files stay
  parallel-safe and order-independent. `TEST_DATABASE_URL` gates them;
  without it they skip explicitly.
- Ledger rules (B1.3): `t.usage.recorded` carries tokens plus cost as a
  decimal string; `ledger_entries.cost` is NUMERIC so sums stay exact.
  `formatCents` renders half-up to cents. Re-projection never double-counts:
  rows carry `event_seq` (unique guard) and rebuild truncates before replay.
- `heartbeats` keyed by `(run_id, op)` for per-operation stall detection.
- `outbox` feeds SSE; `delivered_at` claims a row for a publisher.
- Projections (`threads`, `thread_messages`, `ledger_entries`, `sectors`,
  `companies`) rebuild from events; replay-from-events is a phase-exit
  check. Sector/company events project through the same batch; only
  thread-affecting writes publish outbox frames.

```
events ──project──▶ threads / thread_messages / ledger_entries
   │                 sectors / companies
   │                      │
   └──── outbox ──▶ SSE ──┘
heartbeats ──sweep──▶ findings + responses (B5.3)
events ──retention──▶ cold archive (GCS) ──replay──┘
```

## Retention and archive (B1.4)

- `runRetention` (`backend/src/archive/retention.ts`) archives events older
  than the window to the cold target, then deletes them hot — never the
  reverse. Replay reads hot (`readPartition`) plus archive (`readArchive`).
- Targets (`backend/src/archive/targets.ts`): `GcsTarget` is real on staging
  and prod (bucket + prefix from env, credentials from
  `GOOGLE_APPLICATION_CREDENTIALS`); `FilesystemTarget` is unit-test and
  offline-dev only. Same interface, same key layout
  (`events/<partition>/<seq>.json`).
- Proposed windows (still OPEN: the B5.6 soak was synthetic and did not
  measure Loki disk burn): events hot 90 days, heartbeats 30 days,
  outbox until delivered + 7 days.
- Landed separately: `node backend/dist/db/cli.js sweep [days]` (B6, default
  90 days) deletes outbox frames, completed idempotency replay records, and
  heartbeat rows older than the window — in-progress claims are never
  swept. Schedule it externally; the events-hot/archive windows above stay
  OPEN.
- The Temporal schedule invoking `runRetention` lands with the worker fleet
  (B2.1); this task delivers the job body plus the replay proof.

## Artifact pipeline (B4.3)

- `backend/src/artifacts/pipeline.ts`: task/session-scoped `store`, `index`,
  `serve` over the archive targets (`artifacts/<session|task>/<id>/<artId>`
  keys). Store writes bytes plus `t.artifact.stored`; index records
  `t.artifact.indexed` with byte count and sha256; serve requires the index
  row and re-verifies the hash — stored-but-unindexed bytes are unservable,
  tampered bytes fail closed. Bodies cap at 8 MiB (staging bound).
- Every store carries provenance: a required `reason` (`subagent_output` |
  `user_upload` | `report` | `proposal`) plus the producing run/thread key.
  Reason-less writes are rejected before any byte lands; indexing a stored
  payload without provenance fails as corrupt. `storeAndIndex` is the one
  production path, so every file is indexed structurally.
- Files are referenceable across sessions without byte copies:
  `t.artifact.referenced` links an indexed file into another session's
  artifact partition (display fields snapshotted, owning scope recorded);
  serve resolves through the owner's index gate. Agents read files with the
  `artifact.read` tool (same gate); users read through the body route.
- Index events live in `artifact:<session|task>:<id>` partitions, keyed
  `artifact-stored:` / `artifact-indexed:` / `artifact-referenced:` for
  idempotent store, index, and attach plus durable replay. Logs carry
  shapes only, never artifact text.
- Proposals travel the same three operations as every other kind: the
  pipeline exposes no apply/mutate operation, so the proposal path
  structurally writes zero company mutations (proven: every key under
  `artifacts/`, every event an artifact lifecycle event).
- Proven by `tests/backend/artifacts.test.ts` (index gate, hash failure,
  no-mutation proof, idempotent re-store, provenance rejection,
  store-then-index), `tests/backend/db.artifacts.test.ts` (reference flow,
  scope resolution, tenant listing), and the body/reference cases in
  `tests/backend/api.artifacts.test.ts`.

## Logging contract (B0.5)

- `backend/src/observability/logging.ts`: pino JSON, join keys on every line
  (`trace_id`, `run_id`, `op`, `attempt`, `tenant`). `childLogger` narrows
  context per operation; base pino fields (`pid`, `hostname`) are untouched.
- Secret scrub is fail-closed at write time (`formatters.log`): any key
  matching `api[_-]?key|secret|passwd|password|token|auth|bearer|credential|
  private[_-]?key|session[_-]?key` (case-insensitive) becomes `[Redacted]`,
  including unlisted long-form variants. Bare `key` alone is an identifier
  (thread keys, idempotency keys) and stays visible. Proven by probe tests,
  not by inspection.
- `backend/src/observability/trace.ts`: W3C `traceparent` extract/inject.
  Missing or malformed headers mint a fresh trace; `tracestate` is a
  documented deferral (single-vendor traces until B5.2). `tracePlugin`
  (fastify-plugin wrapped, so root registration covers root routes) sets
  `request.traceContext` and echoes `traceparent` on the reply.
- Fastify v5 trap, recorded so nobody re-learns it: `Reply` is thenable, so
  `await reply.header(...)` deadlocks the hook. Header calls stay synchronous.

## Temporal topology (B2.1)

- Lanes `turn`, `tool`, `research`, `sweep` partition task queues
  (`kardata-<lane>-v1`); per-lane worker/activity concurrency in
  `backend/src/temporal/lanes.ts` (starting values, held by B5.6 — no
  retune at synthetic scale).
- `connectWorker`/`connectClient` honor `TEMPORAL_ADDRESS` (default
  `localhost:7233`) and `TEMPORAL_NAMESPACE` (default `default`).
  `createLaneWorker` builds one Worker per lane; tests override the queue.
- Proven against the real server (`tests/backend/temporal.lanes.test.ts`,
  gated on `KARDATA_TEMPORAL_TEST=1` with the compose stack up): an attempt
  that goes silent is redelivered after the heartbeat timeout and completes
  on a fresh worker; a saturated tool lane leaves the turn lane unaffected.
- Heartbeat timeouts drive fast retry; the DB sweeper ports the agents
  `supervision.ts` finding kinds (B5.3).

## REST parity route catalogue (B3.1)

- `GET /v1/sessions` → newest-first session list; empty array when no
  sessions exist. `POST /v1/sessions {title}` → 201; blank title is 400
  `validation_failed`. `GET /v1/sessions/{id}` → one session or 404.
  `POST /v1/sessions/{id}/rename {title}` → 200 with the renamed session;
  unknown ids 404, blank titles 400. Renames append `t.session.renamed`
  and reads resolve the latest title, so history is preserved.
  `not_found`. `DELETE /v1/sessions/{id}` → 200 with `{deleted:true}`;
  the session workflow is cancelled first so no turn lands after the
  tombstone, unknown ids 404. Session reads are event-sourced (no
  projector involved).
- `GET /v1/sessions/{id}/threads` → session thread plus one thread per
  subagent (B2.4 isolation records project to `agent:<child-id>` threads;
  completions close them). `GET /v1/threads/{key}` → meta with live
  `acceptingSteer`/queue depth, or 404. `GET .../messages?afterSeq&limit`
  → ascending page plus `nextAfterSeq` (also the SSE resume token in B3.2);
  empty threads return `data: []`. Launch-notice records are routing
  metadata, not chat, and are skipped by message pages. Thread reads project
  first via the request-scoped projector (advisory lock + checkpoint).
- `GET /v1/runs[?sessionId]` → summary list from Temporal describe (no
  per-run queries). `GET /v1/runs/{runId}` → detail with live query state
  and research `stageCursor`, or 404. Session runs address threads by
  session id; research/guarded runs are self-scoped (`research:<runId>`).
  Budget ratios read 0 until B5.x wires ledger/telemetry.
- `POST /v1/commands/send|steer {threadKey, text}` → 202
  `accepted`/`missed_steer`. `@name` in session text routes to that
  subagent's thread. Unknown threads and missing runs are 404; sessions
  that cannot take steer are 409 `conflict`; steers to finished children
  resolve the parent through the launch isolation record and report
  `missed_steer`, never relaunching.
- `POST /v1/commands/pause|resume|cancel {runId}` → 202; unknown runs 404;
  run types without the path (guarded pause, research cancel) are 409.
  `resume` accepts `extendedBudgetMs` (applies to guarded runs).
  `POST /v1/commands/approve` records the decision event and answers 202.
- `GET /v1/sessions/{id}/artifacts` → stored/indexed artifact metadata
  for the session scope (files menu); viewer-readable, session-scoped,
  empty array when none.
- `GET /v1/sessions/{id}/artifacts/{artifactId}/body` → indexed bytes plus
  provenance meta; viewer-readable. Unknown ids are 404, stored-but-unindexed
  bytes are 409 `conflict`, tampered bytes fail closed. Served through the
  app-held archive target (`resolveArchiveTarget`: GCS with a bucket, else
  filesystem).
- `POST /v1/sessions/{id}/artifacts/references {artifactId, fromScope}` →
  201 cross-session attach without byte copies (operator only, idempotent);
  unknown or unindexed files are 404. Session-owned sources need
  same-tenant possession.
- `GET /v1/artifacts` → tenant-wide file listing with owning session ids
  for attach discovery (viewer-readable, authed keys only).
- `GET /v1/sectors[?state=&query=]` → sector researches with live
  company counts; `GET /v1/sectors/{id}` → sector plus its companies and
  server-derived activity timeline; `GET /v1/companies[?sectorId=&state= &
  query=]` → companies with owning sector names (all viewer-readable,
  scope-filtered; unknown ids 404). `POST /v1/sectors` creates a sector
  (default `draft`: attach files, start later); `POST
  /v1/sectors/{id}/start` moves draft → queued explicitly — creation never
  queues research, anything past draft is 409 `conflict`. `POST
  /v1/sectors/{id}/documents` attaches one context document
  (.md/.txt/.csv/.json/.pdf/.docx as base64, text extracted server-side);
  `GET .../documents` lists metadata for viewers. `POST
  /v1/sectors/{id}/restart` → failed-to-running transition for operators
  (idempotent); non-failed sectors are 409 `conflict`. Reads project
  first; writers read the projection, so mutations apply to projected
  rows only.
- Denied behavior: role 403s on resume/approve arrive with B3.3 auth.
  Without pool/gateway the routes fail closed with 503 `overload`.
- Rate limits + mutation idempotency (B3.4). Fixed-window per-key budgets
  on `/v1/*` (`rate_windows`; `/healthz` exempt for probes); breaches are
  429 `rate_limited` with `Retry-After` and a `http.rate_limited` log line.
  All twelve mutating routes honor `Idempotency-Key` (`idempotency_records`,
  caller-scoped): the six command POSTs, session create/rename/model/delete,
  sector restart, and artifact references — plus `POST /mcp`. Identical
  retries replay the stored status/body with one effect, key reuse for a
  different request (or a twin in flight) is 409 `conflict`.
  Sustained-boundary bursts up to 2x are accepted staging semantics; the
  token-bucket upgrade is a B5.x option.
- Proven by `tests/backend/api.rest.test.ts` (contract matrix over inject
  with the fake gateway), `tests/backend/api.live.test.ts` (real
  gateway against live sessionRun workflows), and
  `tests/backend/api.idempotency.test.ts` (429 + `Retry-After` + breach
  log, replay without re-execution, 409 reuse, caller scoping).

## Streaming contract (B3.2)

- `GET /v1/threads/{key}/events?lastSeq=` serves `text/event-stream`.
  Validation/404 use envelopes before the headers go out; after that the
  socket owns the contract. Frames are the spec's `StreamEvent`
  (`message` with the REST-identical `ThreadMessage` payload, `state` with
  the full `Thread`, ephemeral `delta` with `{runKey, text}` token text;
  `finding`/`error` arrive with later phases).
- Source of truth is the `outbox` table, written by the projector
  (one frame per thread-affecting event: message events publish message
  frames, lifecycle events publish state frames; launch notices publish
  nothing). Provider activities additionally publish ephemeral `delta`
  frames with live token text; deltas are never projected and the terminal
  message event supersedes them, so a reconnect replays persisted messages
  only. The resume token is the outbox seq. Replay-then-tail gives no
  gap (catch-up re-select after `LISTEN` subscribes) and no duplex (every
  frame advances the token). An `AFTER INSERT` trigger
  (`notify_outbox`, migration 0004) wakes listeners with the new seq;
  the stream re-selects the row, so the 8000-byte NOTIFY limit never binds.
- Snapshot-overflow rule (named): backlog past the token longer than
  `SNAPSHOT_THRESHOLD` (200) opens with one `state` frame carrying the
  live thread plus the latest token instead of replaying history. The
  client re-renders from the snapshot and tails from its token.
- Liveness: `: ping` comments every 15 s; one `LISTEN` connection per
  stream, released with `UNLISTEN` on close. A mid-stream failure closes
  the connection and the client resumes from its last good token, which is
  always a fully-written frame.
- Backpressure posture: the server never buffers unbounded history for a
  slow reader — past-threshold readers get the snapshot rule, live readers
  get at-most-one-backlog-drain per wake. Fleet-scale fan-out is B5.x.
- Proven by `tests/backend/api.sse.test.ts` (live delivery, drop+resume
  without gap or duplex, snapshot rule, REST/SSE payload identity,
  exactly-once publishing).

## API auth and tenancy (B3.3)

- Service API keys only (no JWT/OAuth): `Authorization: Bearer` carries the
  key, the server hashes (SHA-256) and looks it up in `api_keys`
  (migration 0005; plaintext never stored). Absent, unknown, and
  under-roled callers all answer 403 `permission_denied` — one code, so
  callers cannot distinguish missing keys from wrong roles.
- One role level per key, each including the levels below: `viewer` reads,
  `operator` adds creates/sends/pauses/cancels, `approver` adds
  resume/approve. Cross-tenant and cross-project misses answer 404, never
  403, so tenants stay unprobbable.
- Tenant binding is written into `t.session.created` at create time;
  pre-tenancy sessions carry no tenant and stay hidden under auth. Reads
  filter by tenant (and selected project); session runs scope through
  their session. Ad-hoc research/guarded runs carry no tenant binding, so
  under auth they 404; the B5.5 inspector only resolves session-bound runs
  (`session-run-<id>` or raw session id) from events, so unbound runs stay
  hidden. Approval
  decisions are role-only until B4.2 binds approvals to sessions.
- `X-Tenant` must equal the key's tenant and `X-Project` must stay inside
  the key's project binding (null project means all projects); mismatches
  are 403. Without the `auth` app flag the routes stay open and unscoped
  (B3.1 behavior); `server.ts` always enables it, so production fails
  closed on an empty key table.
- Proven by `tests/backend/api.auth.test.ts` (denied paths, ladder,
  tenant/project boundaries, header mismatches, run hiding).

## MCP tool boundary (Phase 2)

- `POST /mcp` serves the agent tool boundary over Streamable HTTP
  (`@modelcontextprotocol/server`, stateless, JSON responses: 65 tools
  covering the MCP binding table in `documentation/db.md` — rows bundle
  read/write pairs, so tools outnumber rows — with projector-only
  `publishOutboxFrame`/`runCheckpointTx` excluded). The seven retrieval
  tools (`web_search`, `web_fetch`, `browser_navigate`,
  `browser_snapshot`, `browser_act`, `browser_close`,
  `browser_screenshot`) bind to the retrieval modules
  (`backend/src/retrieval/`), not the db layer; the parity test resolves
  both namespaces. Reads (`web_search`, `web_fetch`,
  `browser_snapshot`) are viewer-readable; browser verbs
  (`browser_navigate`, `browser_act`, `browser_close`,
  `browser_screenshot`) need `operator`. `db.delegate_subagent`
  (Karbot-only, `operator`) launches a leaf researcher through the runs
  gateway; steering launched children stays approver-gated
  (`db.send_message` / `db.steer_thread`).
- `browser_screenshot` is on-demand pixels for what the aria snapshot
  cannot show (visual layout, canvas, CAPTCHA state): viewport JPEG with
  a 400 KB cap (full pages refused over budget), sha256 receipt for
  text-consumable "screenshot, act, screenshot, compare" verdicts. The
  tool description steers snapshots-first — screenshots ride history as
  base64 and cost context every later turn until compacted. Proven by
  `tests/backend/retrieval.test.ts` (validation without launch; capture
  shape behind `KARDATA_BROWSER_TEST=1`).
- Containerized Chromium: compose runs headless Chrome in the `browser`
  sidecar (digest-pinned `zenika/alpine-chrome`, no host ports) and the
  `worker` service beside the backend, so turns, sweeps, and browser
  sessions never execute on the laptop. App code connects over CDP
  (`KARDATA_CHROME_CDP_URL`) with manual discovery — Chrome's DevTools
  server rejects non-IP Host headers and advertises an unroutable ws
  host, so discovery uses a loopback Host override and rewrites the
  websocket hostname. Sidecar sessions are unowned (fresh context each,
  close drops only the context) so one session can never strand or kill
  another's pages. `KARDATA_CHROME_PATH` local launch remains the laptop
  dev fallback. Proven live against the sidecar (navigate, snapshot,
  screenshot, act, close, zero leaked targets) plus no-launch unit tests
  for bad-scheme and dead-endpoint URLs.
  Thin route in `backend/src/mcp/routes.ts`, bindings in
  `backend/src/mcp/tools.ts`, zod input schemas in
  `backend/src/mcp/schemas.ts` generated from the db layer schemas; no
  SQL and no `pg` import anywhere under `backend/src/mcp/`.
- Auth reuses the API-key gate (403 `permission_denied` before dispatch;
  scope and role bind into every tool call); reads need `viewer`, writes
  and projector/plumbing tools need `operator` (denied calls answer MCP
  `isError`). `Idempotency-Key` replays the exact JSON-RPC response;
  without a pool the route 503s. Spec: `mcpRpc` in
  `backend/openapi/v1.yaml`.
- Proven by `tests/backend/mcp.tools.test.ts` (tool/layer parity,
  role floors, transport auth, idempotent replay; fake/di doubles, no
  live keys).
- Browser boundary: the staging UI runs on a different origin than the API,
  so every authorized browser call preflights first. `registerCors`
  (`backend/src/http/cors.ts`) reflects an exact allow-list origin
  (`KARDATA_CORS_ORIGINS`, default the local vite dev origins) and answers
  preflights with exactly the headers the client sends (`Authorization`,
  `Content-Type`); unknown origins get 403 with no echo, never a wildcard.
  Without this the browser blocks the call and the UI can only report a
  connection failure. Proven by `tests/backend/api.cors.test.ts`.

## Session-run workflow (B2.2)

- `backend/src/temporal/workflows/run.ts#sessionRun` is the turn loop as
  durable state. States mirror `agents/loop.ts` exactly; every transition is
  checked with `isLegalTransition` (imported via the `@kardata/agents/loop`
  subpath — workflows never import the barrel, which pulls `node:http`).
- Signals `runSend/runSteer/runPause/runResume/runCancel`, query `runState`
  (`{ state, sessionId, pending }`). Cancel sets CANCELLING and cancels the
  running turn's scope; a finished turn that loses the race is discarded, so
  cancelled runs present nothing more. Cancelled runs land FINISHED with a
  `run cancelled` message plus `t.thread.finished`, never ERROR.
- Cancellation surfaces two ways and both mean operator-cancelled: bare
  `CancelledFailure`, or `ActivityFailure` with a cancelled cause. Error
  events record the cause string for the inspector.
- History is the event log (`t.session.created`, `t.message.appended`,
  `t.thread.finished` via `appendEventActivity`); the full run replays from
  events alone (proven in `tests/backend/workflows.run.test.ts`).
- Idle close: a RUNNING run with an empty inbox for `idleTimeoutMs`
  (default 24 h) finishes itself (`idle-timeout`, `t.thread.finished`) so
  abandoned runs never persist as open workflows.
- Turns run through `karbotTurnActivity`
  (`backend/src/temporal/activities/turn.ts`), not the retired scripted
  `runTurnActivity`/`runChildTurnActivity` (still exported for history,
  never called from a workflow): no seeded or fake reply is reachable from
  any mounted chat path. See `## Karbot turn (Phase 3)` below.

## Karbot turn (Phase 3)

- On a session send, the workflow persists the user message before the turn
  activity starts. The activity reads recent projected user/agent text through
  the db layer (20 prior turns plus the current message once). The provider
  therefore receives conversational context rather than a single isolated
  prompt. Operational MCP plumbing is omitted from Karbot's advertised tool
  set; product tools remain available. The system prompt asks for direct
  answers when no live data is needed and grounded explanations when tools
  are used. No temperature override is set: the missing context and broad
  tool instruction were concrete causes of irrelevant answers. Product
  questions route to the curated corpus via `db.kb_search` with
  `[source_path]` citations (migration 0008, `knowledge_base/`); the prompt
  carries standing facts (managed-data-layer offer, free wedge, $3–6k/mo
  targeting band never quoted) and the research discipline (breadth over
  single-symptom fixation, MECHANISM-or-COST evidence bar, skeptic
  question). The cross-run company master ledger (`ledger_companies` /
  `ledger_problems`) is the canonical company record; the sector-scoped
  `companies` projection stays the per-run view. Same-round tool calls
  dispatch in parallel (`Promise.all`; history order stays deterministic);
  turn logs carry `firstToolMs`/`firstReasoningMs`/`firstDeltaMs` as the
  streaming TTFT budget. Agent replies render house markdown (`Markdown.tsx`,
  GFM subset, no raw HTML); the prompt contracts the format. Sending with
  no session creates one first (start-on-send); offline sends short-circuit
  before any request.
- Context harness on the live turn (`runKarbotTurn` `harness`, agents
  `context.ts`/`condense.ts`/`budgets.ts`): every round checks token, tool-
  call, wall-clock, and stall budgets before any provider call and halts
  with a user-visible `haltNotice` on trip (cost untracked until a price
  table exists); repeated tool actions halt on replan/blocked; each round
  emits a hash-chained context snapshot (prompt content-hash, skill-grant
  provenance, mode policy) logged as `snapshotRounds`/`snapshotHead`;
  histories over the size/token cap condense through the turn adapter with
  a linked summary (in-turn safety net; cross-turn compaction needs
  workflow write-back, deferred). `estimateTokens` (4 chars/token heuristic)
  and `describeSegments` power the UI context meter; billed usage always
  comes from provider counters. Meta prefix caching is automatic (no flags;
  `dev.meta.ai/docs/prompt-caching`), so stable-first ordering is the only
  client lever and `cached_tokens` lands in `cacheReadTokens`. Proven by `agents/src/turnRunner.test.ts`
  (harness) and `tests/backend/karbot.turn.test.ts` (halt, condense,
  lineage logging).
- `session-user-before-turn-v1` guards the activity-order change with
  Temporal `patched()`. Old recorded turns replay provider-before-user;
  newly executed turns record the user first. The guard remains while any
  old workflow history can be resumed.
- Tool-failure honesty: the base prompt contracts that a failed tool is
  a source gap (say what failed, retry at most once narrower, never fill
  from parametric knowledge), and every evidence-code isError
  (`unconfigured`/`blocked`/`fetch_failed`) carries the same no-guess
  directive in its text — the model reads the failure mid-research, and
  a bare code is what it used to paper over. Other error codes stay
  bare. Proven by `tests/backend/karbot.turn.test.ts` (prompt contract)
  and `tests/backend/mcp.tools.test.ts` (directive present/absent over
  the wire). Live-model honesty still needs a keyed probe; the tests pin
  the signal, not the model's obedience.
- The provider SSE reader emits both LF and CRLF framed deltas as they arrive.
  Delta `runKey`s include the provider round number; a later round replaces
  transient pre-tool text instead of appending it to the final answer.
  The frontend reconciles REST and SSE messages by thread sequence, keeps
  pending text below settled history, and puts tool calls plus any genuine
  provider reasoning into one compact Activity disclosure before the answer.
- `karbotTurnActivity` also publishes ephemeral `tool` frames to the outbox:
  `{runKey,id,name,state}` when the provider starts a call, when its parsed
  name arrives, and when MCP settles. The browser upserts the in-flight row
  by call id, so it is visible during argument streaming and execution.
  Durable tool message frames replace this temporary status after the turn;
  no arguments or results enter the ephemeral frame.

- `agents/src/turnRunner.ts` is the turn as a dependency-free library: no
  credentials, no database, no environment reads. `runKarbotTurn` streams
  one model/tool loop over an injected provider adapter, executes tool
  calls through an injected `TurnRunnerMcpClient`, and forwards every text
  delta to an injected sink (max 5 turns by default, hard cap 10).
  `StreamableMcpClient` speaks MCP Streamable HTTP (stateless JSON-RPC
  with a tolerant `initialize` hello, SSE-or-JSON responses) over an
  injected endpoint plus Bearer token; the token never appears in errors.
  `createClosedMcpClient` lists no tools and errors every call. Exported
  from `agents/src/index.ts`; proven by `agents/src/turnRunner.test.ts`
  (fake provider plus in-memory MCP/sink doubles, no network).
- `karbotTurnActivity` wires the library into the worker: the stored
  per-session model (Phase 1, latest `t.session.model` wins) resolves via
  the B4.1 gateway with env fallback, deltas publish as ephemeral `delta`
  outbox frames keyed by the workflow-supplied `runKey` (superseded by the
  terminal `t.message.appended`, never projected as history), heartbeats
  run on the 5 s cadence, and cancellation races the turn so the workflow
  sees `CancelledFailure`. Logs carry shapes and counters only
  (`karbot.turn` with provider/turns/latency/code) — never prompt, reply,
  or token material. The pure core `executeKarbotTurn` takes its side
  effects as deps and is proven by `tests/backend/karbot.turn.test.ts`
  without a worker or database.
- The session workflow (`sessionRun`) and the child workflow
  (`subagentRun`) both call `karbotTurnActivity`: per-session model for
  session threads, the parent session's model for child threads (children
  carry no model of their own), each in its own partition and thread key.
  `runKey` reuses the pre-turn nonce, so it is deterministic across
  replays and unique per turn. Test-only `fakeSteps` ride the workflow
  inputs (never set in production) so the Temporal suites prove the
  thread-send path on fake/di doubles, including cancel-mid-turn via the
  fake provider's `delayMs` dwell.
- Tool transport: the activity builds a `StreamableMcpClient` against
  `KARDATA_MCP_URL` with the caller-scoped `KARDATA_MCP_TOKEN` (per-call
  `mcpEndpoint`/`mcpToken` input overrides exist for hermetic tests).
  Without an endpoint and token the turn runs on the closed client —
  model replies, no tool calls, every attempted call an error result —
  and says so in the result. Deployment must set both vars to enable
  tools; provider keys stay in the agents live config (env/secret store),
  never in code, logs, transcripts, or fixtures.
- Workflows import agents runtime code via the `@kardata/agents/loop`
  subpath only (the barrel pulls `node:http`); the `FakeStep` shape used
  for test-only inputs is a type-only barrel import, which erases at
  bundle time like the other agents shapes in `subagents.ts`.

## Product-knowledge harness (Phases 1–6)

- Prompt seam: `composeSystemPrompt` (`agents/src/prompt.ts`, called from
  `karbotTurnActivity`) assembles the system prompt in order — standing
  facts, skill prompt blocks, mode posture, then preloaded reference
  chunks. Slash skills live in the registry (`agents/src/skills.ts`,
  mirrored for the API by `backend/src/skills.ts`): `brainstorm` (open
  posture, KB preload, read-only tool grant) and `sector-draft`
  (sector-drafting tool grant). `GET /v1/skills` advertises names and
  capability tiers; `POST /v1/commands/send` accepts an optional skill
  name plus an optional turn `mode` (`default` precise answering vs
  `brainstorm` open sampling) and up to 10 preload chunks. Proven by
  `agents/src/skills.test.ts`, `tests/backend/karbot.turn.test.ts`, and
  `tests/backend/mcp.tools.test.ts` (per-skill tool grants).
- Sector lifecycle: `POST /v1/sectors` creates `draft` (migration
  `0009_sector_drafts.sql`); `POST /v1/sectors/{id}/documents` attaches
  one context document (base64, classified by magic bytes: text family,
  PDF, docx, png/jpg/webp/gif); `POST
  /v1/sectors/{id}/start` moves draft → queued explicitly, and the
  gateway starts one `sectorSweep` workflow per sector (idempotent by
  workflow id `sector-sweep-{sectorId}`) with sweep compensation on
  start failure. Anything past draft is 409 `conflict`. Proven by
  `tests/backend/sector-documents.test.ts` and
  `tests/backend/workflows.sweep.test.ts`.
- File pipeline (`backend/src/db/file-pipeline.ts`, migration `0010`):
  raw bytes never reach a provider. Text is read directly, text-PDFs and
  docx extracted, images and image-only PDFs OCRed through the vision
  model over the existing Meta credential (`backend/src/ocr.ts`, no new
  key; a dedicated endpoint via `createHttpOcrAdapter` stays available).
  No OCR backend means an explicit `needs-ocr` status, never silent loss;
  low-confidence spans marked `uncertain`.
  Every file is indexed into `sector_document_units` (ord, kind
  text/ocr/table/heading, confidence) chunked on paragraph boundaries;
  turns include units cited `filename:ord` (repeats as `name (2)`; storage
  ids never reach model-visible prose). Re-uploads alias on content
  hash. Proven by `tests/backend/file-pipeline.test.ts` and
  `tests/backend/db.document-units.test.ts`.
- Sector digest + turn preload (`backend/src/db/sector-context.ts`,
  `executeKarbotTurn`): the digest is read-computed from live rows on
  every read (brief, doc hashes/status, note/exclusion counts; versioned
  by content hash, the version in its own field and never inside the
  model-visible text), so sibling sessions always share world-state with no
  invalidation. Sector chats load digest + included units through the
  prompt seam after KB preload, capped at 24k chars; general sessions
  skip it; sector reads fail closed to context-free turns. Proven by
  `tests/backend/sector-context.test.ts` and `tests/backend/karbot.turn.test.ts`.
- Sector context endpoints (migration `0011`): `GET
  /v1/sectors/{id}/context` returns the exact assembled payload behind the
  Context button — verbatim system/references segments with
  `describeSegments` estimates, files with unit include/exclude flags,
  user notes. `PATCH` (operator, idempotent) excludes/re-includes whole
  documents (`ord` absent) or single units and appends notes; exclusions
  compose (document OR unit row hides the unit). Proven by
  `tests/backend/sector-context.test.ts` (stub-DB assembly) and
  `tests/backend/api.sector-context.test.ts` (gated live routes).
- Sector chat: the detail page is a workspace grid (chat left, files over
  context right, companies below; stacked on mobile), separate from the
  global Karbot panel. The sector chat reuses `ChatPanel` segments
  (tool groups, reasoning, timestamps) and renders them through the shared
  `chat-parts` shells (centered agent mark, gap dividers, tinted user /
  muted agent bubbles; Karbot layout unchanged) with Stop/Retry, a sessions popover
  with rename/delete and the pinned research session first, a sticky-bottom
  single-pill composer with a per-session `ModelToolbar`, and a research
  strip with owner pause/resume; it never links out to the global panel.
  There is no summary strip and no activity timeline: research starts
  from the chat strip (Start on drafts, shared `startSectorResearch`
  sequence with draft compensation; an optional `sessionId` records the
  research pin on the sector, and anything past draft conflicts so no
  second session can start it) or through the
  `db.start_sector_research` MCP tool. Lifecycle honesty holds on every
  path: pause cancels the sweep workflow before recording paused,
  resume and restart start it before recording running (see the
  lifecycle entry in `documentation/backend.md`). Owners drive all four
  from the chat strip (`POST /v1/sectors/:id/start|pause|resume|restart`)
  or via `db.pause_sector_research` / `db.resume_sector_research`.
  Session pools are separate by contract:
  bare `GET /v1/sessions` lists general sessions only, sector chats list
  through `GET /v1/sessions?sectorId=` (same for `db.list_sessions` with an
  optional `sectorId`). Sessions link via `sectorId` on `t.session.created`
  (event payload); the research pin is a `sector.research_started` event
  projected to `sectors.research_session_id` (migration 0012).
  Turns reuse the commands/send + thread-stream path; only the session
  pool is scoped. The chat section is a fixed flex column: header, strip,
  and composer stay put while only the message list scrolls
  (stick-to-bottom with a Latest pill), and turns render echo, live tool
  rows, the thinking trace, then the reply. Proven by `tests/backend/api.session-sector.test.ts`,
  `tests/backend/api.sectors.test.ts` (pause/resume),
  `tests/backend/sector-start.test.ts`,
  `tests/frontend/SectorChatPanel.test.tsx`, and
  `tests/frontend/SectorDetailPage.test.tsx`.
- Retrieval (`backend/src/retrieval/` behind `backend/src/browserPool/facade.ts`,
  the single agent entry): `web_search` calls the
  provider endpoint (`KARDATA_WEB_SEARCH_URL`, default Brave) with
  `KARDATA_WEB_SEARCH_KEY` and fails closed `unconfigured` without a
  key; `web_fetch` enforces an SSRF blocklist (localhost, loopback,
  link-local, cloud metadata) with a 2 MB / 15 s cap; `browser_*` drives
  Chromium (`KARDATA_CHROME_PATH` or system binary, sidecar over CDP in
  compose) through the bounded pool (0–16 slots, `KARDATA_BROWSER_MAX`,
  per-host politeness, `overload` instead of eviction) with aria
  snapshots. Pool hits share query pages (5 min) and documents
  (10 min) plus in-flight dedup, so overlapping agents pay each leg
  once. Pure rules in
  `backend/src/temporal/sweep-rules.ts` bound effort and temperature per
  sweep. Templates fan out per English-speaking region by default (US,
  UK, Canada, Australia; `ENGLISH_REGIONS` in sweep-rules.ts, base order
  stable, capped at 30): one region's index never stands in for the whole
  market, and non-English results stay out by query construction. Proven by `tests/backend/retrieval.test.ts` (doubles by
  default; live suites behind `KARDATA_BROWSER_TEST=1`),
  `tests/backend/browser-pool.test.ts` (bounds, cache, routing; stub
  legs, no Chromium), and
  `tests/backend/sweep.rules.test.ts`. Leading TEST scaffolding markers
  are stripped before shaping (`stripTestMarkers`), so test sectors
  search clean subjects.
- Sweep fallback chain (`searchWebPageActivity` delegating to the facade's
  `pooledSearchWebPage`): keyed Brave API first,
  keyless engine pool second (`backend/src/retrieval/keyless.ts`:
  DuckDuckGo html/lite plus Mojeek, best-effort — direct HTTP to these
  endpoints is routinely challenged, so each engine is skipped on any
  failure), real-Chromium browser leg last (navigates the DDG html
  endpoint past the anomaly wall, extracts snapshot links, always closes
  the session; page 0 only so templates terminate). Query pages cache,
  so a cached page serves with zero legs hit; pool saturation
  propagates `overload` (retry later), never a false exhaustive miss.
  Every hit carries
  `via` (`keyed`/`keyless`/`browser`) plus the keyless engine name, so
  the ledger never mistakes a fallback hit for a keyed one; exhaustion
  on all legs fails loudly. The MCP `web_search` tool stays keyed and
  fail-closed — the chain lives in the sweep, not the tool contract.
  Proven by `tests/backend/sweep.search.test.ts` (fixture doubles and
  stub legs, no network). Live proof 2026-09-28 from this machine and the
  worker: keyless DDG-html returns hits, browser sidecar navigates +
  snapshots + closes, webFetch extracts text; keyed stays fail-closed
  with no key configured. Karbot's palette carries the full hound set
  (`web_search`, `web_fetch`, all five `browser_*`); sector chats carry
  `web_search` + `web_fetch` (web reads, no DB writes) while browser
  action stays Karbot-only. Proven by `tests/backend/karbot.turn.test.ts`
  (grant advertisement + stacking order).

## Research loop and time guards (B2.6)

- `backend/src/temporal/workflows/loopguards.ts#guardedResearchRun` ports the
  agents A11.3/A11.4 rules onto the B2.5 pipeline. Route visits run as
  `runGuardedStageActivity` (each execution logs `t.research.stage_attempt`
  with its Temporal attempt number); after each stage `detectLoopActivity`
  judges the visit history with the shared pure rule in
  `backend/src/temporal/guards.ts#decideLoop`.
- Loop rule: a revisit (a stage seen before) that adds zero new evidence is
  fruitless; genuine new evidence resets the streak. `maxFruitlessRevisits`
  consecutive fruitless revisits suspend with a `repeated-calls` (acted) or
  `no-progress` (never acted) finding logged as `t.research.loop_finding`.
  Verdicts reuse the `supervision.ts` sweep finding kinds.
- Time rule: unit and run wall-clock budgets race each active span as durable
  `sleep` timers in nested cancellation scopes. A fired timer cancels its
  scope (never orphans the activity) and suspends the run with the reason
  logged as `t.research.suspended`. No wall clock exists in workflow code, so
  each resumed span receives the approved budget window; the cursor never
  advances past unlogged work, and idempotency keys plus content-hash dedupe
  keep retries row- and finding-exact.
- Suspend parks everything: no span timer or scope is pending while
  suspended. `guardResume{ approved }` resumes; `{ approved: false }`
  appends `t.research.resume_denied` and stays suspended. Approved resume
  after a loop suspend restarts the detector window as an operator
  override; budget extensions (`extendUnitMs`/`extendRunMs`) apply to the
  next span. A suspend with no resume for `suspendTimeoutMs` (default 1 h)
  expires with `t.research.suspend_expired` and closes through the terminal
  tail (partial report, or refused when there is no evidence).
- Query `guardState` (`{ status, cursor, suspendKind?, suspendReason? }`).
  Proven against the real server
  (`tests/backend/workflows.loopguards.test.ts` for the three acceptances,
  `tests/backend/loopguards.rules.test.ts` for the pure rule matrix).
- Like the other workflows, only type-only agents shapes cross the sandbox
  boundary (erased at bundle time); the barrel runtime is never imported.

### Guard bounds (starting values, held by B5.6)

| Bound | Research lane default | Guarded-run input | Breach lands |
| --- | --- | --- | --- |
| Stage heartbeat | 30 s (`timeouts.ts`) | — | retry within start-to-close |
| Unit wall-clock | — | `unitBudgetMs` per run | `suspended` (`unit-budget`) |
| Run wall-clock | — | `runBudgetMs` per run | `suspended` (`run-budget`) |
| Fruitless revisits | — | `maxFruitlessRevisits` per run | `suspended` (`loop`) |
| Resume authorization | — | `guardResume.approved` | `resume_denied`, stays suspended |
| Suspend wait | — | `suspendTimeoutMs` (default 1 h) | `suspend_expired`, terminal tail |

## Telemetry pipeline (B5.1–B5.6 built)

- Logs: pino JSON on every line with join keys (`trace_id`, `run_id`, `op`,
  `attempt`, `tenant`); per-request access lines (method, route pattern,
  status, latency, level by status); workflow-signal lines (names/ids only)
  via the SDK sink; worker/activity lines through `createWorkerLogger`.
  Secret scrub is fail-closed at write time. Query cookbook lives in
  `docs/environments.md`.
- Traces: OTel API + SDK (`backend/src/observability/tracing.ts`) with
  W3C-compatible ids — the ingress `trace_id` is the OTel trace id, so
  access lines join spans with no map. Request spans (SERVER, route
  pattern), pg spans (CLIENT, engine + SQL verb, never raw SQL) via
  `wrapPool`, activity spans (`activity.providerChat`, `activity.toolCall`).
  Implicit parenting rides AsyncLocalStorage entered by the Fastify hook.
  Export is JSONL through the app logger into Loki (same Promtail
  pipeline); the OTLP upgrade keeps every call site and changes only the
  span processor.
- Metrics: `GET /metrics` serves `http_requests_total` +
  `http_request_duration_seconds`, fleet gauges, plus pool pressure
  (`kardata_pg_pool_total/idle/waiting`, summed over process pools,
  `KardataPoolExhaustion` pages on sustained waiting) plus Node
  process defaults
  (`backend/src/observability/metrics.ts`), scraped by the compose
  Prometheus. Label names are allow-listed per metric and values stay
  bounded (route patterns, never ids; unmatched paths collapse to
  `*unmatched*`); series budget 10,000, enforced by test. Temporal SDK
  metrics export through `workerTelemetryOptions` when the fleet wires
  `Runtime.install`.
- Sinks (compose): Loki (7-day retention, compactor-enforced), Promtail
  (docker socket, `level`/`msg` labels), Prometheus, Grafana with Loki +
  Prometheus provisioned. No vendor log bill; the soak measures provider
  token spend only.
- Shipped: stall sweeper + findings (B5.3), dashboards + alerts with
  runbooks (B5.4), read-only run inspector (B5.5), synthetic 1000-agent
  soak with tuning report (B5.6, `tests/backend/soak.report.md`). Disk
  burn per agent/day stays unmeasured (synthetic soak has no Loki burn).
- Run inspector (B5.5): `GET /v1/debug/runs/:runId` (operator role,
  session scope, `session-run-<id>` or raw session id) returns event
  count, last thread states, paginated timeline, decided approvals joined
  across `session:` and `approval:` partitions, stall findings from the
  session partition, stored/indexed artifacts, and distinct idempotency
  keys. It never contacts Temporal — no workflow
  queries or describes — so answers reflect the durable log and can lag
  live workflow truth. Viewers get 403, cross-tenant callers get 404 with
  no payload. Proven by `tests/backend/api.inspector.test.ts`.
