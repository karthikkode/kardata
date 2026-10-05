# Tests

Durable supervision gates:

- `npm test -w @kardata/backend -- observability.reconciliation.test.ts heartbeat-recovery.test.ts observability.stall.test.ts observability.stall-activity.test.ts` runs policy/throttle/correlated-log checks; live repository/projector cases explicitly skip without `TEST_DATABASE_URL`.
- With `TEST_DATABASE_URL`, that command creates UUID-isolated databases and tests newer-attempt races, unchanged ownership/continuation, UI notice projection, scoped health, unavailable owners and heartbeat/progress separation.
- `KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=... npm test -w @kardata/backend -- temporal.reconciliation.test.ts` uses owned queues/workflow IDs and isolated Postgres to test actual owner descriptions and recovery after three exhausted page retries. The next 30-second pass must retain its cursor and succeed; no timeout is weakened. It cancels only its owned supervisor. No provider, pilot discovery or shared worker rollout is claimed.
- `KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=... npm test -w @kardata/backend -- execution-epochs.test.ts temporal.execution-epochs.test.ts` covers canonical signal adoption, concurrent unknown starts, exact terminal parking, manual-pause protection, same-ID restart before event/lease, actual continue-as-new, and server-proven child launch rejection. These use UUID-isolated DBs/namespaces and scripted provider work. Unknown launch stays guarded; fixture task-failure cleanup targets only its owned workflow.

Mirrors the area covered: `tests/frontend/...`, `tests/backend/...`.
Framework per area doc; frontend uses Vitest + Testing Library (jsdom) for
components and Playwright for critical flows. Coverage via
`npm run test:coverage -w frontend` (istanbul provider; thresholds ratchet,
never drop).

## The one rule

Every behavior change ships with a test that fails without the fix and passes
with it. No test, no merge : the handoff must name the test file.

## Isolation for deep checks

`ensureTestDb` validates a `kardata_test_<suite>` name and creates a fresh
UUID-suffixed database per invocation. The configured `TEST_DATABASE_URL`
is a connection template only, never the target of migration down-tests.
Do not reuse databases from interrupted tests or automatically purge them.
Migration round-trips own isolated databases just like other live suites.
With `TEST_DATABASE_URL`, Vitest prepares one schema-only PostgreSQL template
before worker test clocks start. Its identity binds a fresh verification-run UUID
to the ordered migration filenames and bytes. Bootstrap holds an advisory lock;
only a fully migrated, empty, owned source with the matching identity may be
sealed (`ALLOW_CONNECTIONS false`) and cloned. Every invocation still creates a
fresh UUID database, using PostgreSQL's default WAL_LOG clone strategy. Partial,
contaminated, unsealed or differently owned templates fail closed and are left
for inspection, never reused or deleted. The configured base is never modified.
Direct harness callers without the Vitest run identity retain fresh migration
setup. Clones do not inherit database-level settings or grants; migrations must
remain schema-local. Migration round-trip tests still execute the real migrator.
Template preparation and fresh database creation emit coded start/done/error
boundary logs without connection strings or exception bodies. Connections use
the migrator's 10-second connection, 30-second lock and 300-second statement
bounds. Every clone checks the migration set and absence of application rows
before being returned, including externally contaminated, resealed sources.
The pattern follows [PostgreSQL CREATE DATABASE](https://www.postgresql.org/docs/16/sql-createdatabase.html)
and [template database rules](https://www.postgresql.org/docs/16/manage-ag-templatedbs.html).
Workflow queries and persisted thread state are separate observation boundaries:
recovery tests wait for both within their existing deadline before sending Resume.
Projector catch-up alone cannot prove that an in-flight event activity committed.
Routine tests write evidence to ignored test-results directories.
Destructive recovery drills must use isolated test resources; the UI-driven
Meta pilot preserves its research records. The approved hardening contract
is [the repo-hardening plan](plans/2026-09-30-repo-hardening.md).

## Component tests (Vitest + Testing Library)

- Test how the component is used: render it, interact with `user-event`, assert
  what the user sees. Per the Testing Library guiding principles, utilities
  should encourage tests that use components the way they're intended to be used.
- Query priority: `getByRole` → `getByLabelText` → `getByText`. No class-name
  or test-id queries unless nothing user-visible identifies the element.
- Assert states, not internals: rendered text, disabled attributes, dispatched
  callbacks (`vi.fn()`), accessible names. Never assert props, state, or markup
  structure. No snapshot tests of rendered HTML.
- Each async state the component claims (loading, empty, error, denied) gets
  its own test case.
- Keep tests with the area they cover: `tests/frontend/<area>/<name>.test.tsx`.
  Test setup (jsdom, jest-dom) lives in `frontend/src/test/setup.ts`; do not
  duplicate it.

## Flow tests (Playwright)

- Only critical user paths (sign-in, core create/read flows). Config in
  `frontend/playwright.config.ts`; specs in `tests/frontend-e2e/`.
- Flow tests prove reachability and key content, not every state : states belong
  in component tests.
- Browser smoke runs Vite on port 5174 with an isolated staging test key and
  intercepts `/v1/*` responses. It proves browser rendering and interaction,
  not provider, Temporal, or database connectivity. Live stack checks remain
  separate and must be stated explicitly when skipped.
- UI revamp v2 specs live in `tests/frontend-e2e/v2/` (one spec per page
  plus `primitives`, `motion`, and `audit`) and run on owned port 15174:
  `cd frontend && CHOKIDAR_USEPOLLING=1 KARDATA_E2E_PORT=15174 npx
  playwright test v2/`. Never run v2 specs against the owner's 5173/5174
  servers.

## Browser support helpers (v2)

One shared kit in `tests/frontend-e2e/support/`; specs compose it, never
hand-roll routes or screenshots:

- `fixtures.ts`: one deterministic dataset (8 sectors across all states,
  2,000 seeded companies, sessions/threads/messages, plans, progress,
  global context, files, subagents, alerts, runs, providers). Realistic
  invented names only, never "TEST".
- `api.ts`: `serveApi(page, overrides?)` intercepts `**/v1/**` with
  `{ ok: true, data }` envelopes from fixtures; state flags `loading`
  (delay), `error` (500), `denied` (403), `offline` (abort), `empty`.
  SSE streams expose a `pushFrame(page, frame)` hook for live-turn
  scenarios.
- `shot.ts`: `shot(page, id, state, { widths, themes, anchors })`
  captures `<ID>-<state>-<theme>-<width>.png` per theme/width (default
  light/dark x 1440/390) under `frontend/test-results/v2/`, waiting for
  fonts and network idle with anchors asserted first and animations
  disabled. `capture.ts` wraps multi-state page captures.
- `audit.ts`: `auditPage(page)` runs the automated style audit
  (weights, sizes, overflow, names/targets, contrast, hover geometry,
  raw-text guard, focus rings, shell alignment, plan-rail clearance)
  and `writeAuditReport` stores per-page JSON under
  `frontend/test-results/v2/audit/`; `audit.spec.ts` fails on any
  violation. `color.ts` holds the contrast math.
- Playwright wipes `frontend/test-results/` at the start of every run:
  chain the archive into the same command
  (`... ; cp test-results/v2/*.png tests/evidence/<area>/`), review
  from `tests/evidence/`, and never expect two invocations' outputs to
  both survive.

## What never counts as verification

- Re-running your own scratch script, or tests that encode the same assumption
  as the fix. The oracle must be independent: a failing-before/passing-after
  maintained test, an existing suite, or observed app behavior.
- A passing suite you never watched fail on the broken code (for bug fixes:
  observe the failure first when runnable).
- A count-asserting suite that can reach the network: stub every leg or fail
  closed without one. A live fallback answering behind a stub silently moves
  the expected number (observed: sweep e2e counted 14 instead of 2 when
  empty keyed pages fell through to live keyless search).

## Fleet seed (thousand-company scale runs)

`tests/backend/fleet-seed.ts` generates deterministic TEST rows:
`generateFleet(seed, companyCount, docCount)` with a seeded PRNG, so
reruns are free and goldens stay stable. Every name and filename
carries its TEST label (`TEST ...`, `test-fleet-*.md`, `TEST DATA`
marker in text); generated rows can never pass as live data, and
live seeds run in the `test-fleet` tenant scope, never the default
view. Docs span the 2000-char chunker cap on purpose (small singles
plus multi-unit files). Proven by `tests/backend/fleet-seed.test.ts`:
hermetic determinism/label/count/stage checks always run; the live
case (own database via `ensureTestDb`, projector catch-up exactly
like the routes) seeds 1000 companies plus 12 documents.

## Scale tiers (what "stress tested" means here)

- Unit soak: 100-entity fleet drills on stepped clocks (subagents, claims,
  appends) with mixed fates — stalled, cancelled, steered — proving
  detection plus exactly-once behavior. No network; milliseconds.
- Live-DB contention: twin storms, rate races, pool queues, statement
  timeouts under `TEST_DATABASE_URL` (`db.concurrency.test.ts`).
- UI overflow: past-cap lists (50/60/120 rows) assert the true total plus
  filter reachability, never exact rendered counts (`OverflowList` suites).
- Live stack (gated, stated when skipped): Temporal workflows under
  `KARDATA_TEMPORAL_TEST=1`, compose smoke under `KARDATA_COMPOSE=1`,
  provider probes with keys. These prove wiring; hermetic suites prove
  logic. Neither substitutes for the other.
- Fleet load (`tests/backend/workflows.fleet-load.test.ts`, needs both
  Temporal flag and `TEST_DATABASE_URL`): 10/50/100/1000 subagents
  against a throwaway database plus an in-process backend over real
  HTTP MCP. Scripted provider steps (zero tokens) with real tool
  execution, so completions mean DB rows. Child ids derive from the
  run-unique session: reruns never collide with still-running children
  from an aborted run (which correctly reject as duplicates).

## Tiers and commands (Phase 2 plan)

| Tier | Proves | Command |
|---|---|---|
| unit | Logic, jsdom components, fake provider | `npm test` |
| db | Real Postgres, per-suite DB | `TEST_DATABASE_URL=… npm test -w @kardata/backend` |
| temporal | Real Temporal and DB, scripted provider | add `KARDATA_TEMPORAL_TEST=1` |
| e2e | Real browser | `npm run test:e2e -w frontend` |
| fault | Injected failures | `TEST_DATABASE_URL=… TOXIPROXY_URL=… npm run test:fault` (needs `KARDATA_FILE_TEMPORAL_ADDRESS`) |
| stress | Data volume, DB concurrency | `TEST_DATABASE_URL=… npm run test:stress` |
| live | Real Meta, isolated stack | `npm run test:live` (lands in Phase 5) |
| ui-review | Graded screenshots | `npm run ui:review` (`-- --changed` limits to the branch diff) |

Full gates: `npm run verify` (pr:verify + quality + the registry gate,
which rides inside the backend suite); `npm run verify:full` adds the db,
temporal, and full Playwright tiers. It needs `TEST_DATABASE_URL` in env
(fails fast without it) and sets `KARDATA_TEMPORAL_TEST=1` itself for the
temporal tier.

CI runs a separate pinned Postgres/Temporal integration job. Its databases are
UUID-suffixed isolated resources; it runs the live DB suite then session, child,
planning and coordinator workflows. Paid Meta and full stress remain separate
release gates. Browser outputs are uploaded even on failure. The single local
mechanical entrypoint remains `npm run pr:verify`; live database tests use
`TEST_DATABASE_URL=... npm test -w @kardata/backend`, Temporal tests additionally
set `KARDATA_TEMPORAL_TEST=1`. Never run migration tests against a shared DB.

The isolated file-browser journey uses the existing backend on an ephemeral
loopback port with a fresh test database and filesystem archive. It runs upload
failure, retry, preview, exact-byte download and duplicate upload through browser
controls. Only chat SSE is stubbed; provider/Temporal/authority coverage is not
claimed by this open-mode file test. Run with `TEST_DATABASE_URL` and
`npm run test:e2e -w frontend -- files-db.spec.ts`; the integration CI job runs it
with its existing isolated Postgres service and uploads the visual artifacts.

Historical replay is a read-only separate gate: `KARDATA_LEGACY_REPLAY=1 npm test
-w @kardata/backend -- temporal.legacy-replay.test.ts`. It fetches up to three
histories per declared workflow type before the main-baseline cutoff and replays
current bundles without starting activities/workflows. Optional
`KARDATA_REPLAY_CUTOFF` declares another dated baseline; do not shift it merely to
obtain green results. Missing histories fail explicitly. Counts, IDs and hashes
are retained in ignored `backend/test-results/legacy-replay.report.json`; payloads
are not copied into reports. Controlled baseline fixtures or archived histories
remain necessary where retained server history is unavailable.

The general-chat context browser gate (`agent-context-db.spec.ts`) uses real HTTP,
Temporal, MCP, Postgres and the production turn activity with a scripted provider.
It prestarts only its own UUID session on an isolated task queue, then sends via
UI controls, captures actual tool responses, waits for the durable terminal reply
and cleared Stop control, and cancels only that owned workflow in cleanup. It
proves existing-session interaction, not first-send workflow creation or Meta
behavior. Run with `KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL` and
`npm run test:e2e -w frontend -- agent-context-db.spec.ts`. Provider request/result
persistence remains a separate release requirement; the visible transcript's tool
summary is not described as an exact stored provider response.

The scripted real-agent browser journey also drills graceful stream disconnect:
only its captured idle LISTEN PID in the isolated DB is terminated. It asserts a
new browser request/DB listener, retained draft, one terminal answer, and cleared
Stop control. Database cleanup failures and disconnect-during-backlog races have
focused maintained regressions; the existing independent review remains required.

The file catalogue and functionality matrix retired 2026-10-05
(see `docs/deep-checks/README.md`): every edit had reset reviews to
`pending`, taxing each change with regen commits for a gate that stayed
permanently red. The release gate is `npm run pr:verify` plus CI;
independent evidence review remains mandatory.

`browser.isolation.test.ts` exercises all foreign-owner browser operations, scoped
MCP key/tenant isolation, UUID session identities, and page/snapshot/close failure
cleanup. It uses a mocked Chromium transport and the real tool bindings/pool; it
does not prove public-network admission or live browser behavior. The real browser
suite retains its separate `KARDATA_BROWSER_TEST` gate.

Browser isolation additionally covers general/sector parent/child tool operations,
hung page creation, hung cleanup with late confirmation, and quarantine/Close retry.
`retrieval.destinations.test.ts` denies private/reserved/numeric/IPv6/userinfo/scheme
literal destinations and private redirect hops before transport. Both transports
are mocked: no denied destination is actually contacted. No DNS-rebinding/browser
subresource claim follows from those tests.

Hung keyboard/wheel regressions assert bounded failure, denial of an overlapping
action, and restoration after actual late completion, rather than assuming timeout
means cancellation. A hung owned-context regression checks confirmed cleanup.

CDP-path tests use an owned loopback discovery HTTP fixture and mocked Chromium.
They cover late context creation, context-close failure, preservation of the shared
browser, and a repeated close no-op that cannot release capacity without the actual
close receipt. They are not real CDP/Chromium lifecycle proof.

The gated live pool test asserts a second independent browser client still
snapshots after closing the first. Mock-path tests prove disposal ordering and
accounting; they do not substitute for live shared-browser survival.

retrieval.dns.test.ts exercises the default production fetch transport with DNS
and native HTTP(S) doubles: private/mixed/empty denial, pinned repeated lookups,
redirect resolution, late-DNS cancellation, compression and expanded/broken-body
failures. It does not establish live TLS, real DNS or Chromium network behavior.

Opt-in KARDATA_RETRIEVAL_TEST=1 runs the maintained real HTTPS source check in
retrieval.test.ts. It establishes DNS/TLS/body wiring for one public source, not
Chromium isolation, company qualification or the Meta UI pilot.

Browser network suites: browser.proxy.test exercises the existing HTTP listener,
admission/auth/expiry/overload/limits, late DNS and raw CONNECT socket supervision.
browser.proxy-auth.test pins exact-origin proxy-only auth. browser.network.test
requires KARDATA_BROWSER_TEST=1 and launches owned isolated Chromium, source HTTP
fixtures and the existing backend listener. Only test transports map admitted
public fixtures into owned loopback peers; this is not a private-address admission
exception. It checks private redirect/fetch/image/frame/popup/TURN-TCP denial,
site-auth capability secrecy, and independent CDP-client survival. Additional
KARDATA_RETRIEVAL_TEST=1 exercises a real public HTTPS source through production
DNS/CONNECT and Chromium TLS. No owner sidecar/research data is disrupted.

Source-backed intake: `npm test -w @kardata/backend -- discovery.intake.test.ts`
checks missing/forged/foreign evidence, identity names, invalid shapes and honest
rejection/uncertainty. `KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=... npm test -w
@kardata/backend -- workflows.coordinator.test.ts` exercises real isolated
Postgres/Temporal with scripted retrieval/reviewer fixtures. It is not a Meta
pilot or evidence that a fixture company exists.

Controlled legacy coverage: opt-in `KARDATA_BASELINE_REPLAY=1
KARDATA_BASELINE_ROOT=/absolute/unchanged/baseline npm test -w @kardata/backend --
temporal.baseline-replay.test.ts` verifies the checkout is exactly unchanged main
`e454d44e1625c28b117a227c0650a891532cd39f`, executes its actual workflow bundles
with explicitly scripted activities in a fresh Temporal namespace, and replays
captured histories with current code. Build/install the baseline's existing
workspaces first. No shared worker queue is polled outside that isolated
namespace. Retain history bytes, hashes and a controlled-baseline manifest in
ignored backend/test-results; never relabel these as pre-cutoff user histories or
live provider/data-layer evidence. Historical replay remains a separate gate.

The historical gate may use `KARDATA_BASELINE_REPLAY_REPORT=/absolute/path/to/the
retained/manifest.json` plus `KARDATA_BASELINE_ROOT` only for workflow types with
no pre-cutoff history. It checks manifest/history hashes, exact workflow types,
the unchanged baseline commit and reproducibly rebuilt baseline bundle hashes.
Available historical histories must replay; failures never fall back to fixtures.
Results label historical and controlled-baseline origins separately. Missing
coverage without this explicit verified fallback still fails.

Historical cutoff overrides must resolve to the exact pinned baseline instant.
Earlier dates cannot hide available user histories behind controlled fixtures.

Archive source gates: `archive.targets.test.ts` covers multi-megabyte outcome
serialization, exact hydration, missing/corrupt/foreign refs, URL/session/version
identity, uncertain writes, byte limits and bounded filesystem/GCS reads.
The isolated coordinator suite now transports archive refs through actual
Temporal and validates hydrated quotes in production parent activities. Its
retrieval/provider bodies remain explicitly scripted fixtures.

Live-DB backend suites run at two file workers against the established local
100-connection budget. Databases remain independent. Within-file concurrent
migrators, transaction contention and explicit stress tiers retain their original
fan-out; no timeout/test assertion is relaxed. Unit-only file scheduling is
unchanged.

`TEST_DATABASE_URL=... npm test -w @kardata/backend -- mcp.operation-receipts.test.ts`
uses an isolated database and actual HTTP/MCP dispatch to fail response-cache
completion after a real session mutation. It verifies exact-result repair without
repeat effects, changed-argument conflict, scoped inspection, absent-proof parking
and changed-authority denial. The provider is not involved; this is not Meta pilot
or live business discovery evidence.

`npm run test:e2e -w frontend -- files-scale.spec.ts` is maintained synthetic-HTTP
browser evidence for 2,005 uploaded/generated metadata records. It checks bounded
file windows, full-library search, keyboard preview and focus return, hidden-file
reveal, long filenames, mobile/desktop light/dark and reduced motion, plus loading,
empty, error, denied and offline/retry states. It records screenshots, traces and
videos in the selected Playwright output directory. It does not prove a live file
server, indexing, DB, Temporal or provider capability. The component regression
is `tests/frontend/workspace-files-scale.test.tsx`.

`archive.storage-config.test.ts` verifies backend/worker target and volume parity
from the maintained Compose configuration. It fails on disposable worker evidence
storage; passing it is configuration proof, not a deployed container restart or
actual GCS credential/network verification. Runtime archive integrity and isolated
HTTP/activity round trips remain separate suites.

`KARDATA_ARCHIVE_CONTAINER_TEST=1 npm test -w @kardata/backend -- archive.container.test.ts`
uses the existing runtime image and current compiled backend on an owned retained
fixture volume. After its writer is removed, separate server and replacement-worker
containers verify exact normalized execution JSON and fetched-source text through
the production archive APIs. Only owned ephemeral containers are removed; the
volume remains. This proves isolated filesystem persistence across those container
roles, not matching shared deployment, GCS, genuine fetched content or the Meta UI
pilot. Build the backend first; no stale compiled fallback is accepted.

Owner inspection gates: `execution.inspection.test.ts` exercises real keyed HTTP,
isolated Postgres and filesystem refs for authority, keyset paging and integrity.
`execution-inspection.test.tsx` covers client validation, UI states, paging,
observed-version labels and bounded long JSON. `execution-inspection.spec.ts` is
synthetic-HTTP browser proof for mobile/desktop themes, keyboard/focus, retained
drafts, complete downloads, long escaped input and resource recovery. Captures
include source hashes and explicitly do not certify a live provider or archive.

`TEST_DATABASE_URL=... npm test -w @kardata/backend -- turn.paid-response-recovery.test.ts`
checks actual HTTP/MCP, activity, Postgres and filesystem paths using a scripted
provider. Storage faults cover lost archive acknowledgement, tool-result recording
after a multi-argument mutation, and repeated late finalizer failures. Assertions
pin one paid provider response/effect, original wire arguments, usage and producer
metadata, and stable archive identity. These are isolated fixtures, not Meta pilot
evidence.

`KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=... npm test -w @kardata/backend -- temporal.owner-resume.test.ts`
tests approver Resume of confirmed-terminal session and delegated-child turns
through real HTTP, Temporal, Postgres and archive storage. A scripted provider
and late-finalizer fault pin one provider response, user message and final reply;
operator denial and checkpoint clearing remain explicit assertions. This is not
a browser or live Meta gate. `turn-recovery-contract.test.ts` covers exact
scheduled-contract authority, repeated recovery, bounded history and checkpoint
fences in isolated Postgres. `recovery.palette.test.ts` verifies the frozen tool
ceiling and unchanged transport authority independently.

Owner intake review gates: `work.review.test.ts` uses a UUID-isolated Postgres
and real keyed loopback HTTP for authority, exact receipt/plan fences, conflicting
owner decisions and immutable exclusion against a late checkpoint. Its companies
and evidence are explicitly TEST fixtures. `work-review.test.tsx` covers exact
review content, draft retention, denied/stale state and explicit latest review.
`work-review.spec.ts` is synthetic HTTP browser proof on both shared entry points
at390/1440px, light/dark and reduced motion; captures include screenshots, traces
and videos. None establishes live Meta discovery or genuine company evidence.

`workspace.spec.ts` also pins the exact767/768px session-rail and1279/1280px
resource-rail boundaries in both themes. Each case asserts the correct visible
rail/drawer controls, keyboard Enter/Escape and restored trigger focus, reachable
composer and absence of document horizontal overflow, with screenshots/video/trace.
These are synthetic HTTP fixtures, not live research. The isolated file journey
stops its owned page and waits for routed reads before closing its owned backend
and pool; late UI polling must not race fixture disposal. Cleanup still runs when
page navigation fails. Browser closure evidence is in
`docs/deep-checks/browser-closure.md`.

## Matching isolated deployment UI gate

`KARDATA_RUNTIME_PREFLIGHT_URL=http://127.0.0.1:15173 npm run test:e2e -w frontend -- runtime-preflight.spec.ts` operates an already running, owner-isolated production stack. The UI must already carry its dedicated local test credential. It creates only labeled test sectors/chats/context/files through UI controls, verifies exact downloaded bytes and retained drafts, and leaves records intact for inspection. It never intercepts routes, starts research, calls Meta or populates companies. The gate explicitly skips without its target and denies the ordinary shared UI port5173. Do not use it against pilot data. Retained deployment details: [runtime proof](../docs/deep-checks/runtime-preflight.md).

## In-app alert and OCR gates

`TEST_DATABASE_URL=<owned-isolated-base> npm test -w @kardata/backend -- alerts.test.ts` covers authenticated scope, paging, exact recovery warnings and historical/superseded observations using production DB functions. It explicitly skips without the DB gate. `npm test -w frontend -- supervision-alerts.test.tsx alerts-api.test.ts` covers readable states, permission handling, keyed validation and paging controls. `npm run test:e2e -w frontend -- alerts.spec.ts` captures mobile/desktop, light/dark, reduced-motion, long-reference, paging and denied/retry fixtures; it is synthetic HTTP evidence, not live supervision or external notification proof.

`npm test -w @kardata/backend -- file-pipeline.test.ts ocr.test.ts` pins safe OCR failure details, unit/response/transcript limits, confidence validity and deadlines with injected adapters and PDF doubles. Original archive bytes remain intact. Deployed OCR service and simultaneous parser/RSS limits remain separate gates.

## Durable PDF recovery verification

Approved behavior: [complete PDF ingestion](plans/2026-10-01-pdf-ingestion.md).
`TEST_DATABASE_URL=<owned-isolated-base> npm test -w @kardata/backend -- file-jobs-recovery.test.ts`
uses fresh UUID databases, actual filesystem storage and maintained TEST PDF
bytes. It checks exact original/paid reply retention, JSONB serialization,
superseded attempts, signed fallback integrity, incomplete/unsolicited outputs,
hidden and foreign scope, complete manifest coverage, Unicode-safe chunks,
committed staging invisibility, bounded storage/provider operations and retained
results across failed publication. The activity factory uses scripted providers;
this is not live Meta evidence or an actual SDK worker test. Injected short
deadlines pin cancellation behavior without weakening production deadlines.
Storage timeout preserves uncertainty: a late write is not proof of failed effect,
and cannot publish an original-byte pointer after its caller has failed.

`KARDATA_TEMPORAL_TEST=1 KARDATA_FILE_TEMPORAL_ADDRESS=<owned-server> TEST_DATABASE_URL=<owned-isolated-base> npm test -w @kardata/backend -- workflows.file-processing.test.ts`
additionally uses real SDK workers, unique queues/namespaces and keyed loopback
HTTP. Only the file runner's queue choice is injected; its dispatch reaches the
actual server. Cases cover worker replacement after archive acknowledgement loss,
ID-only history/replay, hidden pause/reveal and scoped approver acknowledgement
for an unknown paid outcome. Providers remain scripted. Declare the owned server
explicitly; no default server fallback exists. Cleanup cancels only its captured
owned workflows and closes owned clients/workers; DB/archive records remain.

Fault drills (`tests/fault/`) inject network cuts and latency through Toxiproxy
(`tests/fault/toxiproxy.ts`, fetch-based, tests-only): provision the server with
`npm run stack:toxi -- up` (docker, host network, `127.0.0.1:8474`), pass
`TOXIPROXY_URL=http://127.0.0.1:8474`, and point `TEST_DATABASE_URL` plus
`KARDATA_FILE_TEMPORAL_ADDRESS` at owned infra. Drills create per-test proxies
(pg `127.0.0.1:15433`, Temporal `127.0.0.1:17233`) and delete them in `finally`;
each records detection and recovery time. Drills skip without `TOXIPROXY_URL`.
The25-second storage cases distinguish preparation health from finalization:
each asserts its own activity attempt stays at1 and no heartbeat timeout occurs.
`KARDATA_FILE_TEST_DISABLE_FINALIZE_HEARTBEAT=1` is an explicit test-fixture-only
control for the finalize oracle. It suppresses SDK reporting without changing
production code; the maintained healthy assertion must fail under that control.
Matching deployed PDF processing, real Meta output quality and decoded-memory/
fleet measurements remain separate evidence tiers.

`mcp.file-ingestion.test.ts` checks the shared HTTP/MCP attachment boundary with
DB doubles: PDF capability/input preflight, role/grant/bound-sector denial, trusted
source-thread copying, queued versus indexed state, current dispatch-failure/fast
completion metadata and stable concurrent admission identity. Transport cases use
actual Fastify/MCP dispatch; they do not prove database or worker behavior.
`TEST_DATABASE_URL=<owned-test-base> npm test -w @kardata/backend -- mcp.file-ingestion-db.test.ts`
uses a UUID-isolated Postgres, filesystem originals and keyed HTTP/MCP to check
scope, actual child provenance, coalescing and failure inventories. Its runner
records admission only; no provider or Temporal execution is claimed. Missing
DB configuration skips these cases explicitly. Real worker gates remain above.

The existing Playwright harness supports `KARDATA_E2E_PORT` (default5174, valid
integer1024..65535), with Vite strict-port startup. Use an alternate owned port
when5174 belongs to another app rather than stopping that app or reusing its
server as test evidence. PDF UI evidence used15174 while the owner's mockup
server remained on5174. The real-HTTP browser fixtures derive CORS from the configured test origin, so
the alternate port preserves the same authority assertions.

Actual Meta PDF UI preflight: `pdf-meta-preflight.spec.ts` requires explicit
KARDATA_PDF_META_PREFLIGHT_URL and KARDATA_PDF_META_PREFLIGHT_FILE. It uses the
retained owned app, no route interceptions or backend data population, uploads a
labeled synthetic maintained PDF, observes durable file progress, checks native
and AI-derived text, and verifies exact original download bytes. It creates no
companies or research plan. Without both inputs it skips explicitly. Provider
billing/access errors remain acceptance gaps; never substitute mock completion.
Actual-key browser traces are private ignored evidence and must be redacted before
sharing; test keys or provider credentials never belong in committed artifacts.

For final owned-DB campaigns, preserve prior UUID test databases and use a
separate owned instance of the existing pinned Postgres test service when a
retained instance's checkpoint/file-sync work affects fixture deadlines. Keep
1 GiB shared memory, the 100-connection budget and the original two-file Vitest
worker limit. Capture checkpoint and host I/O pressure alongside hashes/results;
allow owned checkpoints to finish before the next campaign. Stop only a named
owned instance with explicit scoped authorization and a graceful shutdown;
retain its container/volume. Never purge retained data, alter shared services or
increase test deadlines to hide resource contention. This operating evidence
proves an isolated test campaign, not production fleet or RSS capacity.

The synthetic 1000-agent soak seeds its baseline in one owned fixture transaction:
the same controlled heartbeat rows and production appendEvent calls keep their
order, IDs, ages and payloads. Commit/rollback/release governs only setup; the
actual sweep, projection, metrics, budget and timing assertions run unchanged.
Fresh empty clones need no prior-run delete/truncate resets. Fixture commit costs
are outside the measured pipeline and do not imply live fleet throughput.

## Live Meta suite (sector backend v1)

`tests/backend/live/` proves sector features against the real Meta provider on
an isolated stack: per-suite databases (`kardata_live_<suite>`), the
`kardata-live` Temporal namespace (the owner's workers on `default` never see
these tasks), the app with auth on port 3102, and in-process lane workers from
the same `createDevWorkers` factory as the dev worker. It never touches the
owner's `kardata` database, compose containers, or ports 5173/5174/3001.

Run command (keys load from `agents/.env` via the loader, never printed;
never `set -a; . agents/.env` — values holding `|` break shell sourcing):

```
KARDATA_LIVE_META=1 KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=<compose pg url>/kardata node scripts/with-env.mjs npm test -w @kardata/backend -- live/ --no-file-parallelism
```

Files run sequentially (`--no-file-parallelism`): 10 min per test, 30 min per
file. Re-run one test with `-t "<ID>"`. Spend is read back from the archived
execution records via the harness `spend()` helper and reported per test.
The battery and the browser stack below refuse to run concurrently:
each probes the other's port (3102/3101) and exits before doing any work,
because both poll the same namespace and the second starter's worker
steals activities and fails them against the wrong database (sector-backend-v1
handoff bug 13). Terminate namespace residue (`temporal workflow terminate`
on test workflows) before reusing a live database, or orphaned events wedge
the projector (handoff bug 17).

The live browser stack (`scripts/live-stack.sh`, stop with
`scripts/live-stack-stop.sh`, which kills only its recorded PIDs) serves the
same isolated namespace/database on backend port 3101 for the
`tests/frontend-e2e/live/*.live.spec.ts` specs (gated by `KARDATA_LIVE_UI=1`,
Vite on 15174, no route interception). Live screenshots go to
`tests/evidence/sector-backend-v1/` and are not committed.
