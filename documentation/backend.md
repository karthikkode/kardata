# Backend

TypeScript + Fastify service, Temporal durability from day one, Postgres as
the everything-log. Plan: `documentation/plans/2026-09-25-backend-build.md`.

## Public surface

- `GET /healthz` — build sha + uptime (see `docs/environments.md`).
- Shared envelopes (`backend/src/app.ts`): `{ ok: true, data }` and
  `{ ok: false, error: { code, message } }`. Every later route uses these;
  no ad-hoc shapes.
- `buildApp()` builds the instance; `server.ts` only listens. Tests import
  the app and use `inject` — never a bound port.

## Private

- Everything else until each phase lands per the plan. `agents/` stays the
  pure domain core; backend adapts it, never forks its rules.

## Status

- B0.1 done: workspace scaffold, health + 404 envelope, `tests/backend/`
  harness, gates green.
- B0.2 done: `backend/openapi/v1.yaml` (34 operations, envelopes, SSE resume,
  idempotency, denied paths) with a parity table in `backend/src/contract.ts`
  covering all 19 mock/scenario/UI shapes; contract tests green.
- B0.3 done: `db/migrations/0001_init.sql` (events, heartbeats, outbox,
  projections) + transactional migrator; up/down round-trip, duplicate
  idempotency rejection, and idempotent re-apply proven against Postgres.
- B0.4 done: `deployment/compose.yaml` (Postgres, Temporal + UI, backend,
  Loki/Promtail/Prometheus/Grafana, all digest-pinned) cold-boots to green;
  backend self-migrates; reachability smoke proven against the live stack.
- B0.5 done: pino JSON logger with join keys + fail-closed secret scrub,
  W3C traceparent propagation with a Fastify plugin; trace join and scrub
  (including an unlisted variant) proven by tests.
- B1.1 done: `appendEvent` (validated envelope, idempotent replay, redaction
  hook, partition replay) proven against Postgres, including concurrent
  duplicate appends landing one row.
- B1.2 done: transcript projection (`routeSend`, `projectBatch`,
  `rebuildFromEvents`) with `@name` routing, per-thread queues, and
  `missed_steer`; replay equivalence proven against Postgres.
- B1.3 done: usage/cost ledger (decimal-string costs, NUMERIC sums,
  half-up `formatCents`, idempotent replay + rebuild) proven cent-exact
  against Postgres; migration 0002 links rows to source events.
- B1.4 done: retention job + cold-archive targets (real GCS target, local
  target for tests/dev); archive-then-delete ordering and hot+archive replay
  proven; schedule wiring deferred to B2.1.
- B2.1 done: lane topology + worker factory + Temporal connectivity; crash-path
  redelivery and lane isolation proven against the real server.
- B2.2 done: session-run workflow (signals, queries, pause/resume/cancel
  mid-tool, no orphans, replay-from-events) proven against the real server;
  agents `/loop` subpath rule recorded for workflow bundles.
- B2.3 done: per-lane timeout table (`backend/src/temporal/timeouts.ts`,
  heartbeat < start-to-close < schedule-to-close per lane) pinned by unit
  tests; silent-attempt redelivery strictly inside the attempt budget and
  cancel-mid-turn with zero orphans proven against the real server
  (`tests/backend/temporal.heartbeats.test.ts`, needs `KARDATA_TEMPORAL_TEST=1`).
- B2.4 done: six subagent ops as child workflows
  (`backend/src/temporal/workflows/subagents.ts`, isolation record per
  launch, parent sees delegation call + one completion entry, never
  intermediates) proven against the real server, including cooperative
  parent-cancel propagation
  (`tests/backend/workflows.subagents.test.ts`, needs `KARDATA_TEMPORAL_TEST=1`);
  contract notes in `documentation/agents-subagents.md`.
- Delegation door: `db.delegate_subagent` (Karbot-only, operator)
  launches leaf researchers through the gateway
  (`delegation-<sessionId>` parent on the turn lane, goal fed as first
  work, depth 0 / maxDepth 0); the turn worker loads the turn-bundle
  aggregator (run.js plus subagents.js — one Worker serves one bundle).
  Live proof: real child replied through the tool path in ~30s
  (`tests/evidence/pilot-01/delegate-live.json`). Steering stays
  approver-gated; launch-to-approver waits on approval cards.
- B2.5 done: deep-research pipeline workflow
  (`backend/src/temporal/workflows/research.ts`, evidence indexed before
  presentation, refusal branch with logged reason, pause/resume preserves the
  stage cursor with zero re-executed activities) proven against the real
  server, including report equality with the agents assembler over
  event-sourced findings
  (`tests/backend/workflows.research.test.ts`, needs `KARDATA_TEMPORAL_TEST=1`);
  contract notes in `documentation/agents-research.md`.
- B2.6 done: research loop + time guards
  (`backend/src/temporal/workflows/loopguards.ts`, shared pure rule in
  `backend/src/temporal/guards.ts`, per-visit attempt counters in events,
  suspend with logged reason, approved-only resume) proven against the real
  server — A→B→A loop suspends in bound, over-budget suspends, unauthorized
  resume denied (`tests/backend/workflows.loopguards.test.ts`, needs
  `KARDATA_TEMPORAL_TEST=1`); rules + bounds table in `docs/architecture.md`.
- B3.1 done: REST parity (sessions/threads/runs/commands per OpenAPI v1,
  Zod I/O, envelope errors; request-scoped projector with checkpoint;
  Temporal runs gateway with @name routing and missed_steer via launch
  records) proven by contract matrix (`tests/backend/api.rest.test.ts`) and
  live HTTP→Temporal proof (`tests/backend/api.live.test.ts`); route
  catalogue in `docs/architecture.md`. 403 roles → B3.3, idempotency
  replay → B3.4, SSE → B3.2, research-run inspector views → B5.5.
- B3.2 done: SSE thread streams from the Postgres outbox (projector
  publishes one frame per thread-affecting event, NOTIFY wakes listeners,
  resume token is the outbox seq, named snapshot-overflow rule past 200
  frames) proven by `tests/backend/api.sse.test.ts` (live delivery,
  drop+resume without gap or duplex, REST/SSE payload identity,
  exactly-once publishing); streaming contract in `docs/architecture.md`.
- B3.3 done: API-key auth with tenant/project scoping and role levels
  (`backend/src/auth/keys.ts`, `api_keys` table, fail-closed server;
  cross-tenant misses 404, ad-hoc research runs hidden pending B5.5
  tenancy) proven by `tests/backend/api.auth.test.ts` (denied paths,
  role ladder, tenant/project boundaries, header mismatches); auth section
  in `docs/architecture.md`, key seeding in `docs/environments.md`.
- B3.4 done: per-key rate limits + mutation idempotency
  (`rate_windows`, `idempotency_records`); 429 + replay + 409 reuse
  proven by `tests/backend/api.idempotency.test.ts`.
- B4.x done: provider gateway + live probes, plan/task tool activities
  with approvals (`POST /v1/commands/approve`), artifact pipeline
  (store/index/serve) plus `GET /v1/sessions/{id}/artifacts` metadata
  reads (gap-closure audit).
- Phase 1 done: per-session provider+model selection
  (`PATCH /v1/sessions/{id}/model` appends `t.session.model`,
  `GET /v1/sessions/{id}` reads it back), verified Meta capability profiles
  (`backend/src/providers/registry.ts`) intersected with Meta's live
  `/models` endpoint (`backend/src/providers/catalog.ts`). The sole default
  is `muse-spark-1.3-contributor` with high effort; the endpoint fails
  closed instead of advertising a stale model list. `GET /v1/providers`
  serves Meta only with a key-presence boolean; gateway per-message
  resolution has a Meta default
  (`resolveEffectiveSelection`, model override, explicit key-missing
  error); spec parity in `backend/openapi/v1.yaml`, proven by
  `tests/backend/api.session-model.test.ts`,
  `tests/backend/providers.registry.test.ts`, and
  `tests/backend/providers.selection.test.ts` (fake/di doubles, no keys).
- Meta Spark 1.3 and 1.3 Contributor use the already-supported Responses
  wire for per-session turns, so their requested reasoning summaries can
  reach the existing `reasoning` outbox channel. Other Meta models retain
  Chat mode until that path is verified for them. The operator's explicit
  Responses mode remains an override.
- Session chat turns now append the user message before provider execution.
  The activity reads the projected thread through `backend/src/db/`, sends
  the latest 20 prior user/agent text turns plus the current message once,
  and excludes tool payloads from chat history. Karbot advertises the
  product-facing MCP tools, not the operational database plumbing. A
  direct answer needs no tool call; live data claims use tool evidence.
  `sessionRun` guards this activity-order change with Temporal's
  `session-user-before-turn-v1` patch. Existing workflow histories replay
  the old order; newly executed turns use the new order. The guard stays
  until every old run has closed.
- Karbot tool calls publish ephemeral `tool` outbox frames at provider
  call-start (provisional name), call-end (real name), and MCP completion
  (`runKey`, call id, name, state). Arguments and results stay out
  of the frame. The workflow still appends durable tool rows after the turn;
  those rows replace the live status in the frontend.
- B5.x done: structured logs + Loki, OTel traces + Prometheus, stall
  sweeper + findings, fleet boards + alerts, read-only run inspector
  (`GET /v1/debug/runs/{runId}`, events-only), 1000-agent soak report
  (`tests/backend/soak.report.md`).
- B7 done: single DB access layer (`backend/src/db/`, per-aggregate
  repos, `pg` ban enforced by lint); connection management (pool
  gauges, env budgets, budget table, agent contract) in
  `documentation/db.md`.
- Browser pool (`backend/src/browserPool/`, facade `facade.ts`): every
  agent browser request crosses one entry — bounded 0–16 slots (lazy,
  `KARDATA_BROWSER_MAX` clamped 1–16, default 8), FIFO queue (64),
  per-caller cap (4), one in-flight request per host, saturation
  rejects `overload` without evicting holders. Query pages cache 5 min
  and documents 10 min (500 entries each, in-flight dedup), so cursors
  live outside slots and page 2 never redoes page 1. Tool names,
  schemas, roles, and `via` tags unchanged. Proven by
  `tests/backend/browser-pool.test.ts` (7 tests, stub legs, no
  Chromium); ops budget in `docs/environments.md`, wire behavior in
  `docs/architecture.md`.
- Sector/company backend resources are live: `GET /v1/sectors`,
  `POST /v1/sectors` (draft-first create), `GET /v1/sectors/{sectorId}`,
  `POST .../start` (explicit draft → queued), `POST/GET .../documents`
  (multi-format context attach), `POST .../restart`, and `GET
  /v1/companies` (`backend/src/routes/sectors.ts`); ad-hoc research runs
  stay hidden pending B5.5 tenancy. Approval UI binding is B6.1 client
  work. See the gap-closure plan.
- Sweep lifecycle honesty (`backend/src/db/sector-lifecycle.ts`): pause
  cancels the sweep workflow before recording paused (cancel-first, so a
  halt that never lands never relabels); resume and restart start the
  workflow before recording running (a closed run restarts under the
  same id, a live one is accepted, never duplicated). Without a runner
  every path fails closed; worker-down maps to `overload` (503).
  Cancelled runs propagate instead of writing `failed` over the pause
  (`isSweepCancellation` in `backend/src/temporal/sweep-rules.ts`).
  Proven by `tests/backend/sector-lifecycle.test.ts` (stub-DB order +
  fail-closed), `tests/backend/workflows.sweep.test.ts` (live cancel),
  and `tests/backend/api.sectors.test.ts` (route lifecycle).
- Sector context citations are human-readable (`backend/src/db/sector-context.ts`):
  reference units cite `filename:ord` (repeats take a stable `name (2)`
  suffix via `citationLabels`), notes cite `[note:1]` by creation order,
  and the digest text carries no content hash (the version travels in its
  own field). Storage ids, selection refs, and tool args still use the
  `sdoc-*`/`snote-*` ids; only model-visible prose changed. Proven by
  `tests/backend/sector-context.test.ts` (stub-DB) and
  `tests/backend/api.sector-context.test.ts` (live).

## Overflow recovery hardening

Overflow state frames carry `historyRefresh: true`. The client reloads durable
messages through bounded 200-row REST pages before accepting the snapshot token;
hidden launch notices advance the REST cursor even when a page is empty. A failed
reload retains the previous stream token so the snapshot is retried. Snapshot
capture reads the outbox token before the thread view to keep concurrent commits
in the tail. Transient reasoning/tool frames are cleared on hydration; durable
messages decide completion. Large transcript rendering remains a separate gate.

Most API contract tests still use Fastify inject. The isolated file-browser
integration binds the existing backend to an ephemeral loopback port so browser
file actions cross real HTTP, Postgres, and the filesystem archive. It creates
no new product service and makes no provider or Temporal claim.

A session-filtered run directory describes only its recorded parent/child IDs,
plus its explicitly requested legacy self-scoped research ID. It does not scan
unrelated Temporal histories. Missing SDK histories remain absent; child pause
state remains authoritative from its thread header. The unfiltered fleet directory
is a separate performance/coverage requirement.

Mutation handlers retain their idempotency guard when handler execution or
completion recording throws with an uncertain outcome. Response headers label
`x-kardata-operation-state: uncertain`; correlated logs carry an operation hash.
Only explicitly proven pre-effect results release the guard. Uncertain records
require reconciliation and never permit automatic repeat effects. Recovery UI
and bounded uncertain-operation reconciliation remain release requirements.

Outbox socket failure wakes the waiting stream and closes its response for client
reconnect; it cannot leave an idle leased client with an unhandled error. The
connection is destroyed once. This uses the existing resume/history contract;
stream-pool capacity and browser disconnect drills remain separate release gates.

New coordinator histories select basic company-result metadata screening through
`research-basic-filter-v1`. Its activity flag is internal, not a product request
argument. Old histories omit the flag and retain the recorded extraction contract.
Junk-result pages still permit search pagination; only empty raw pages exhaust.
This gate alone is not fetched-source/geography verification.

The final acceptance audit found public-web fetch still clears its timeout after
headers and checks byte size only after full buffering. Fetched-source intake
must not adopt that path as verified until full-body deadlines/streaming byte caps,
redirect/network-destination protection and source provenance are exercised.
These remain explicit acceptance gaps, not silently accepted operating limits.

### Full-response source-fetch bounds

Public source fetch keeps its15-second deadline through headers, redirects and
body reads, cancels above the2-MiB streaming cap, and follows at most five redirects
with URL checks before each hop. Final provenance names the final fetched URL.
Blocked/non-text/error bodies are cancelled. Body/header failures are logged by
code and rethrown; this does not claim resolved-DNS pinning or browser network
admission, which remain separate mandatory gates before the pilot.

HTML text extraction uses the shared linear scanner in retrieval/html.ts. It
ignores script/style/comment content, respects quoted attribute delimiters and
omits unterminated markup/content. An isolated time/memory-bounded child regression
covers malformed bodies near the fetch cap, so parsing cannot monopolize the
shared HTTP process through repeated regex backtracking. It is text extraction,
not DOM execution or a claim of advanced company qualification.
