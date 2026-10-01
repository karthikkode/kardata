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
require reconciliation and never permit automatic repeat effects. The agent
checkpoints original operation identities before dispatch, parks unconfirmed
results and exposes pending status through the scoped local-context endpoint.
Resume rechecks the original receipt under the same execution authority before
allowing another provider round. Genuinely unprovable in-progress/legacy effects
remain parked; automated repair of those effects is still a release requirement.

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

### Browser execution ownership

Browser sessions have opaque UUID identities and retain the trusted caller identity
for their lifetime. MCP derives that identity from tenant/project, key ID and the
validated execution thread; model arguments cannot select an owner. Snapshot, act,
screenshot and close check that identity before touching Chromium. A caller cannot
close another execution's session. Internal retrieval callers must pass the same
caller on close as on navigation; anonymous internal sessions stay anonymous.

Opening publishes a session only after page creation, navigation and the initial
bounded snapshot succeed. Failures close the owned browser or sidecar context and
release the pool slot only after confirmed cleanup. Close/idle cleanup logs
start/done/error and propagates failures. Context/page creation and cleanup have
30-second caller deadlines. Uncertain cleanup retains capacity, denies further
use, and permits owner-matched Close retry; late confirmation releases the slot; this does not establish restart orphan recovery or
network/DNS destination admission, which remain preflight requirements.

Source fetch and initial browser navigation share literal URL admission: http(s),
no userinfo, no localhost (including trailing-dot/subdomains), private/reserved IPv4,
IPv6 local/mapped/documentation/transition ranges. WHATWG URL normalization precedes
IP classification, so integer/hex IPv4 cannot bypass it. Node's built-in BlockList
handles subnet classification; no dependency is added. This is not resolved-DNS
pinning or subresource/popup/redirect/browser network isolation. Those remain
mandatory preflight work.

Browser actions also have a 30-second outer deadline, including keyboard/wheel
operations. An uncertain action blocks further operations until it settles; Close
remains available. Completion is not inferred from elapsed time or timeout.

For CDP contexts, cleanup confirmation is the actual context `close` event. The
first cleanup receipt is retained across deadlines/errors; repeated Close observes
that receipt instead of invoking a Playwright close method that may return a no-op
while closing. A late event releases retained capacity. No event means uncertain
capacity remains retained, even if a repeated SDK method could resolve.

After a real CDP context-close receipt, dispose its client connection with
Playwright browser.close, then release capacity. The pinned CDP adapter closes
the transport (not the shared Chromium process); live independent-client survival
is still required to establish deployed behavior. A hung/failed disposal retains
capacity and its original receipt.

CDP close receipts are registered as soon as context acquisition resolves,
including late acquisitions, so an earlier navigation failure/external close
cannot make cleanup miss an already emitted close event.

### Pinned source DNS transport

Production public-source fetch resolves all DNS answers and rejects empty, invalid
or non-public/mixed answers before connection. Each hop uses a fresh native HTTP(S)
connection whose lookup returns only the checked address; the original URL host
and HTTPS certificate name remain intact. Cancellation after late DNS resolution
cannot open a connection. The existing full-request deadline and byte limits apply.
Gzip/deflate/Brotli decoding is streamed; both encoded and decoded bodies are
bounded, and decoding failure propagates. Injected test fetches are not available
as MCP arguments. This does not protect Chromium subresources, clicks or popups;
those remain mandatory preflight work.

### Browser network guard contract

Agent browser contexts use an authenticated HTTP proxy on the existing backend
listener. This is an internal execution transport, not a product REST tool, new
service or raw DB surface. Credentials are short-lived, domain-separated HMAC
capabilities derived by trusted execution code; they grant only bounded public-web
transport and cannot authenticate /v1 or approve anything. No model arguments
select a proxy, secret or execution owner. Ordinary /v1, /mcp and health routes
retain their existing authority.

Every plain HTTP request and HTTPS/WebSocket CONNECT target must use port80/443,
pass shared literal policy, and resolve entirely to admitted public addresses.
Connections pin a checked address; redirects/new destinations pass the proxy
again. Proxy credentials never reach destination headers or logs. Default bounds:
128 total connections,16 per capability,15-second connection deadline,60-second
idle timeout,120-second total lifetime,2-MiB request/response byte ceiling.
Cancellation and backend shutdown close owned sockets and release capacity once.

Contexts remove Chromium's implicit loopback bypass and use service-worker blocking.
Owned and CDP browsers must demonstrate required no-QUIC/no-unproxied-UDP flags
before navigation; missing configuration fails closed. Existing browser tools keep
their schemas, ownership and lifecycle. HTTP proxy verification, real Chromium
redirect/subresource/popup/WebSocket/private-address denial and two-client survival
are distinct required tests. Private/CDP/proxy control endpoints are trusted
configuration, never untrusted page destinations.

Browser proxy capability issuance logs its hash on the trusted MCP logger;
transport logs carry the same hash for request/workflow correlation. Access logs
normalize proxy traffic to browser.proxy, never a raw credential-bearing URI.
Proxy sockets retain quota until their actual close receipt, including rejected
CONNECT peers that leave a write half open. Accepted socket errors are supervised;
backend shutdown cancels owned sockets. Teardown has a one-second flush bound.

Playwright's generic proxy-password option also supplies unscoped site HTTP auth.
The guard therefore uses a page CDP auth interceptor: only a Proxy challenge from
the exact configured control origin receives the capability. Site challenges and
repeated/foreign challenges are cancelled. No proxy password is installed as site
credentials. Idle contexts expire independently after five minutes, with a
30-minute absolute lifetime; uncertain cleanup retains capacity.

Trusted CDP discovery also has a full-response deadline and64-KiB response cap.
Response/request errors clear timers and destroy owned requests; websocket origin,
port and transport derive from configured control origin, not advertised hosts.

### Discovery intake before publication

New discovery coordinators use the `research-source-intake-v1` Temporal marker.
Search results are candidates, never companies. At most two leaf reviewers run
concurrently using only `web_fetch`; assignments require basic identity,
geographic and sector checks, not company deep research. Every accepted check
requires an exact fetched quote on the candidate domain; the identity quote
contains the returned business name. Cross-domain redirects remain uncertain
until explicitly reviewed. Unknown business size stays unknown.

The parent validates structured results, indexes an inspectable intake receipt in
the sector library, then atomically records company publication and work receipts
under the sector transaction. Publication checks the current approved plan,
running lifecycle and approved scope again. Discovery never overwrites an existing
master-ledger verdict. Rejected candidates are completed screening work; uncertain
or failed screening remains blocked and prevents 100% completion. Cursor state
tracks screened domains separately from accepted-company counts. Settled intake
receipts are reused after restart. Existing histories retain their original
contract; no shared rollout is authorized merely by passing fixture tests.

Intake reports have per-workflow-attempt identities, stable across activity
retries. Explicit same-plan restarts retry interrupted screening before skipping
completed search directions; settled receipts and screened domains prevent
relaunching recovered work on repeated pages. Semantic `uncertain` results still
require owner review, not automatic acceptance. A reviewer that finishes during
pause is removed from the live-child signal set before the parent parks. Paused
publication defers using the saved outcome and does not launch another reviewer.

The accepted-company ceiling applies on recovery as well as normal dispatch.
Publication counts current-version company work under the sector transaction;
idempotent already-published domains can replay, but a new domain cannot exceed
the approved ceiling. Excess interrupted work stays blocked for owner review.
Screened domains include earlier rejected/uncertain receipts across completed
query directions. Search pages are not truncated by accepted-company capacity
before basic screening; a rejected candidate does not hide the next valid hit.

### Durable fetched-source receipts

Fetched evidence is retained as exact text in the existing archive, addressed by
SHA-256 of URL plus text under the source session's hashed namespace. Shared
source persistence verifies archive content before returning a durable reference;
missing or corrupt content cannot become a successful DB pointer. The same
implementation serves turn checkpoints and discovery intake. Archive failure
parks publication without deleting transcripts, earlier receipts or source bytes.
Intake review events retain the exact validated decision, source references,
plan version, source thread and timestamp, independently of terminal continuation
cleanup. Operational logs contain hashes/counts, not source bodies or secrets.
This source receipt is distinct from full provider request/response inspection,
which remains a separate acceptance requirement.

Production turn activity results transport source references, not full fetched
pages, to stay within Temporal payload limits. The parent hydrates verified
session-scoped source text in its validation activity; legacy inline outcomes
remain readable for replay and explicit fixtures. Turn source-receipt events
persist before continuation cleanup. Corrupt/missing/foreign archive references
fail validation and cannot publish a company or successful evidence verdict.

Source archive reads use optional byte limits: filesystem reads stop at cap+1
before full buffering; GCS reads request a bounded byte range and verify the
returned length. Source text is capped at the existing retrieval2 MiB limit.
Integrity/scope/limit failures have explicit codes; operational read/write
boundaries emit start/done/error without bodies. Exact existing sources are
adopted rather than overwritten, including a write whose acknowledgement was
lost. Source references retain the established URL-plus-text hash convention.

Source storage exchanges have a60-second deadline and honor activity cancellation.
Production filesystem and GCS source paths abort owned I/O; late injected-target
completion cannot produce a reference or DB checkpoint. Terminal source archival
remains inside the activity's cancellation/heartbeat supervision. Checkpoint,
steering and cleanup mutations carry the independent attempt lease (migration19)
so cancelled same-operation attempts cannot corrupt a replacement continuation.

Acceptance and company-verdict publication check cancellation after archive work
and again inside the serialized DB boundary. Final acceptance also rechecks the
approved plan/scope and committed lifecycle. Pause defers publication using saved
review outcomes; resume does not repeat reviewers. Terminal lifecycle writes do
not override a committed owner pause. Previously completed same-plan acceptance
can be reused after an explicit restart; a revised scope still needs reapproval.

Search HTTP now shares the existing DNS-pinned public-source transport. Each
search page has a15s deadline through headers, redirect handling and streamed
body consumption. Keyed JSON is capped at1MiB and keyless HTML at512KiB before
parsing; encoded native-transport limits remain in force. Credentialed search
rejects redirects so subscription headers cannot reach another destination.
Keyless redirects are bounded to five and revalidate every destination. Rejected,
late and oversized bodies are cancelled. Operational triples record coded errors
without queries, subscription keys or body contents. Malformed keyed results fail
closed rather than pretending discovery exhausted successfully.

All search legs validate the existing MCP pagination contract before networking:
count1-20, page0-100, both integers; defaults10/0. Invalid numbers never produce
a remote request or an apparently successful empty page.

Brave pagination uses page offsets0-9, not result-row offsets. Keyed requests
send the requested page directly and fail before networking above9; the existing
sector discovery fallback may then use keyless/browser search. Keyless engines
retain row offsets. Nullable descriptions yield an empty snippet; absent/null
web content counts as exhausted only with explicit more_results_available=false.
Contract authority: [Brave pagination](https://api-dashboard.search.brave.com/app/documentation/web-search/codes)
and [response schema](https://api-dashboard.search.brave.com/api-reference/web/search/post).

Plan edit/approval serialize through the workspace transaction and committed
lifecycle, rejecting older versions. POST sector approve optionally accepts
contextVersion; the workspace always passes the displayed version and stale
context conflicts before mutation. Approval receipts additionally pin protected
Decisions text, with legacy reads remaining supported. Exact-compatible completed
work is retained transactionally; scope/decision changes require eligibility
review. Current provenance is readable in the shared progress response.
