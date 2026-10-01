# Tests

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
