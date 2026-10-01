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
Workflow queries and persisted thread state are separate observation boundaries:
recovery tests wait for both within their existing deadline before sending Resume.
Projector catch-up alone cannot prove that an in-flight event activity committed.
Routine tests write evidence to ignored test-results directories. Catalogue
refresh is an explicit maintenance command, never an ordinary test side effect.
The operational feature/review map and release gate are described in
[the hardening catalogue](../docs/deep-checks/README.md).
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

Final acceptance uses both maintained hardening suites. Export enumeration includes
interfaces/types/defaults/barrels as declarations; wildcard entries identify their
source module rather than inventing resolved runtime capability. The functionality
matrix also records OpenAPI/MCP/UI surfaces. Explicit maintenance regenerates only
the pending enumeration; ordinary tests never rewrite records or declare coverage.
Enabled release checks require reviewed mappings and verified/excluded scenarios,
with resolvable structured artifact and tested-source hashes. Independent evidence
review remains mandatory. See docs/deep-checks/README.md for the complete command.

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
unchanged. Refresh the catalogue first, then the dependent acceptance matrix in
separate invocations; loading both refreshes concurrently can read old inventory.

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
