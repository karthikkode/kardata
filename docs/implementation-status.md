# Implementation status

The full browser matrix exposed a company pagination bug: its five-second poll
replaced 600 loaded rows with the first 100. Polling now reloads the requested
window, while query changes reset it. A named browser journey crosses the poll
and checks refreshed rows plus retained totals; pagination failures are visible
instead of swallowed. This is a product fix, not a timing exemption.

Worker startup now activates the existing redacting logger and SDK metrics;
Prometheus configuration targets worker:9464. Structured errors omit private
bodies/stacks, and SDK task tokens are redacted. This wiring still needs its
local deployment/scrape gate; no live activation is claimed from unit checks.
The live UI pilot is waiting on an owner-configured approver credential: the
current UI key is operator and was not granted new permissions.

Archive regressions reproduced conflicting-ID overwrite, concurrent corruption,
unsafe keys and swallowed listing errors. Content-addressed references now keep
winning bytes immutable and validate stored/index hashes; legacy flat records
stay readable. Cross-tenant source imports and scoped MCP event plumbing were
also reproduced and denied. Former unit fixtures claiming scoped platform
access now explicitly test internal unscoped bindings; HTTP scope-denial
regressions remain the product authority gate.

Fresh reviewer recovery findings now have maintained regressions: delayed setup
is raced immediately against heartbeat failure/cancellation, and tool dispatch
checks owning cancellation before completion frames or further checkpoints.
Cumulative coordinator active-operation time now has durable sector checkpoints
and appears in progress; the real Temporal suite verifies pause exclusion and
revised-plan replacement (28 combined recovery/planning cases passed).

Plan-write replay returned the newest version rather than the original result
when later edits existed. The live `api.sectors` regression failed before the
fix; version results now count plan events through the stored operation seq.
Terminal empty-ledger copy likewise has failing-before/passing-after UI proof.

The isolated fleet test passed 10/50/100/1,000 logical child tiers in 536.79s
using scripted providers with real HTTP MCP, Temporal, Postgres and indexed
artifacts. This is not a provider-capacity benchmark; the later measured run and explicit
limits are recorded in `deep-checks/README.md`. MCP transport now bounds headers/body
and propagates activity cancellation. Reviewer operations include workflow run
identity; live reused-reviewer regression passed.

Independent hardening review identified blank-quotation acceptance and transcript
hydration through the MCP thread directory. Both now have regressions: normalized
blank quotes are rejected and directory reads return headers only. Acceptance
reports explicitly qualify sampled evidence. Review remains changes-required
until the wider live gates and release catalogue are complete.

## Repo hardening: initial correctness/recovery slices (2026-10-01, ongoing)

- Working branch remains `codex/deep-checks-sector-hardening`; no merge or
  deployment/pilot completion is claimed. File catalogue release gate still
  refuses pending reviews. Primary-source comparisons are in
  `deep-checks/opensource-comparison.md`.
- Reproduced/fixed: executable plan loss on text edits; workspace queued-send,
  EOF and draft races; failed heartbeat throttling; cyclic scrub/token-counter
  redaction; provider timeout late frames; SQL error values in trace export;
  concurrent migrator races; projector/outbox cursors overtaking uncommitted
  sequence numbers; scan filename aliasing when OCR was unavailable.
- Real DB authority tests now cover invalid execution signatures, cross-tenant
  thread/run access, denied leaf delegation, protected deletion before cancel,
  normal proposal approval, parent autonomy and child proposal routing.
- Independent reviewer found child lifecycle key reuse, missed steering,
  queued-request loss during reconnect, oversized-continuation repair, false
  discovery completion and pagination exhaustion defects. Follow-up fixes and
  maintained regressions added; fresh final review remains required.
- Real Temporal checks passed for context park/resume, reused child identities,
  planning transcript/terminal output, and discovery acceptance. Discovery
  reviewers use ten-entry cohorts (at most two active) because a 50-fetch turn
  cannot fit the existing 25-tool budget. Acceptance report is indexed only
  after fetched-source/criteria/sample validation.
- Red test root causes: initial discovery/replay tests used wrong helper
  signatures; corrected to the repository contracts. Planning test created
  then read a sector without projector catch-up; now projects and creates a
  genuine research session, with isolated turn/research queues. OCR-version
  fixture initially lacked image magic; corrected synthetic image fixture,
  then observed the maintained test fail on original alias logic and pass on
  the fix. Reviewer fixture included an unsupported name field; corrected to
  strict result shape. Browser heading query matched both Discovery and
  Australian discovery; exact accessible heading now pins its intended anchor.
- Generated soak output moved to ignored backend/test-results rather than
  rewriting a tracked report. No shared database cleanup was performed.
- Whole-file audit, durable per-round inspection/evaluation, production
  reconciliation, full stress envelope, live-provider UI pilot and PR checklist
  remain acceptance gaps. Current successes are recorded slice by slice.

## Repo hardening: database test isolation (in progress, 2026-09-30)

- Branch: `codex/deep-checks-sector-hardening`; approved contract in
  `../documentation/plans/2026-09-30-repo-hardening.md`.
- Root cause: migration round-trips used `TEST_DATABASE_URL` directly,
  dropping the shared base schema. Other suites reused fixed database names,
  including potentially half-migrated leftovers after interrupted runs.
- Fix: validated test-only names, fresh UUID-suffixed database per harness
  invocation, round-trips on their own databases. No automatic cleanup or
  shared database mutation. Six unsafe-name regressions failed before the
  fix and pass after it. Hermetic harness/migration suite: 8 passed, 2
  live-gated skipped. Live proof is still pending.
- The overall hardening, catalogue, UI evidence, recovery/scale gates and
  Meta pilot remain unfinished. This entry records one slice only.

## Deep-check round on frontend-revamp (2026-09-30)

- Four independent audit subagents (contract/parity, deep-check
  conventions, migrations/DB, frontend rigor): deep-check PASS clean;
  contract PASS with 5 WARNs (3 pre-existing state-enum drifts left
  untouched, workspace wire shapes now pinned in PARITY/EXPECTED_TYPES);
  frontend + DB FAILs below all remediated on the branch.
- Frontend (auditor BLOCKERs): journey tests use `user-event`
  (navigation-url, research-staging, SectorDetailPage); new
  `documentation/frontend.md` sector-workspace section (landing → Open
  → chat, rails, WorkspaceOverlay, ResourceNotice).
- DB layer: scope now threads through `workspaceReferences` (route path;
  worker calls stay job-scoped like the surrounding reads),
  `indexSectorArtifact`, `notifyWorkspace`, `proposeFileContext`
  validate up front, propose/commit are idempotent replays
  (`ON CONFLICT` + winner-select; `parent-commit:` short-circuit), raw
  `Error`s became `WorkspaceError`. Proven by
  `db.workspace-idempotency.test.ts` (4/ 4 fail-before, pass-after).
- Schema: new `0018_workspace_hardening` (3 lookup indexes + 4 CHECKs;
  FKs deliberately omitted — thread local memory is authoritative, must
  survive `rebuildFromEvents` truncation and session-delete projection,
  orphans cleaned in `t.session.deleted`). `0015:down` now removes its
  legacy rows (down never ran outside empty test DBs; stated here).
  Live migration round-trip incl. 0018 green.
- E2E: 11 obsolete drawer-era specs rewritten to workspace equivalents
  (matrix landing shots, workspace pins/hover/dark, rail thinness,
  landing visuals); scroll-chaining test retired (no nested scroller
  pair in the new UX). Suite: 40 passed, 4 skipped, exit 0.
- Live-battery incident: first full parallel run wedged 33 throwaway
  DBs (0015 columns present, version unrecorded — migrator cannot heal
  that state). Dropped all `kardata_test_*` DBs, re-ran bounded
  (maxWorkers=4): 78 files / 480 tests green, exit 0. Lesson: drop (never
  repair) wedged throwaway DBs; keep live batteries bounded. Open
  follow-up: `db.migrations.test.ts` runs DOWN against the shared base
  URL instead of `ensureTestDb` — a parallel-run footgun.
- Gates on the merged tree: `npm run pr:verify` exit 0, e2e exit 0,
  backend live battery exit 0, frontend 276 + agents 195 green.
  Screenshots/clips + pilot journey remain PR-gate items.

## Workspace "no route" fix on frontend-revamp (2026-09-30)

- Screenshot showed `no route GET /v1/sectors/:id/global-context` and
  `.../files` in all three workspace panels. Diagnosis: routes exist in
  the branch (`backend/src/routes/workspace.ts`, registered in `app.ts`,
  11 ops specced) but the running image predated them (built Sep 29
  22:26, routes landed Sep 30). Reproduced the exact 404 against the
  live backend before touching anything.
- Added `tests/backend/api.workspace.test.ts` (8 live tests: global
  read + v0 fallback, layer-404 vs no-route, files list, approver floor,
  proposal/decision flow, research-session idempotence, thread
  read/compact no-op, progress). 8/8 green on compose PG.
- Rebuilt + restarted backend and worker images. Live probe now answers
  (`permission_denied` without creds, not `no route`); entrypoint
  migrated compose DB through 0017 (all workspace tables present).
  Note: recreate once failed on host port 5432 (`finbuddy-db` holds it);
  reran with `KARDATA_PG_PORT=5433`. No data touched (`kardata_pgdata`
  intact).
- Spec hygiene: `v1.yaml` had duplicate `&a1/&a2/&a3` anchors (strict
  parsers reject the contract). Renamed the param anchor to `&a0`,
  dropped the two unused component anchors. Strict-parse valid, 48
  paths, aliases resolve identically, contract suite green.

## Antigravity + Codex workspace merge on frontend-revamp (2026-09-30)

- Merged stash `antigravity-revamp-wip-1aaed160` (29 files) into
  `frontend-revamp` (codex `01a0f17a`) via `git apply --3way`: 17 files
  clean, 12 conflicted. Codex P0 throughout; Antigravity's older
  query/create/compact variants dropped where PR #34 or Codex superseded
  them (deterministic compact keys, `includes` 404 mapping, `owningSectorId`
  visibility, exact-optional invokers all kept).
- Kept from Antigravity: `TurnMode 'plan'` + `plan` skill
  (`agents/src/prompt.ts`, `skills.ts` + test), Karbot universal-driver /
  query-document / session-files prompt paragraphs, `tokenCap` 120k,
  generic `modePromptFor(parsed.mode)`, `db.create_session` +
  start/pause/resume research in `PRODUCT_TOOLS`, approval-cards UI +
  Context Studio + 4-pillar copy (`SectorChatPanel`, `SectorContextDrawer`,
  `ChatPanel` files hub, `research-parts`, `frontend.md`), attach/query
  binding row (previously undocumented).
- Added in this merge (Codex gaps): `db.md` binding rows + repo-map row +
  schema entries for the 6 workspace/context tools and 0014–0017 tables.
- Red-suite findings fixed test-side (product behavior is the P0 arbiter):
  migration file pins extended to 0014–0017; `sector-context` stub answers
  `workspace_files` (hiding is live behavior); `sector-start` stub serves an
  approved executable plan (layer now requires one); 5 App journey tests
  rewritten for landing → Open → workspace (old suite expected direct chat
  regions). One-line `cause` fix for the `preserve-caught-error` lint error
  in `coordinator.ts`.
- Follow-ups (not this merge): sector activity timeline has no renderer in
  the workspace UX (dropped one assertion; coverage stays in
  `RunConsole.test.tsx`); `SectorDetailPage` workbench graft lives in a
  file the App shell no longer routes (shared `CompanySection` still used
  by the landing); 0009–0013 tables predate the repo map.
- Gates on the merged tree: backend lint/typecheck clean, agents
  lint/typecheck + 195 tests green, backend 323 passed (56 files, live
  suites skip), frontend 276 passed (33 files), live migration up +
  down/up round-trip green incl. 0014–0017. Full live-stack + e2e left for
  the PR gate.

## Frontend & Agent Engine Revamp: Universal Karbot, 4-Pillar Workbench, and Swarm Visibility (2026-09-30)

- Universal Karbot Driver & Session Files Hub:
  - Added Session Files view in `ChatPanel.tsx` with live artifact listing, in-app body preview (`getArtifactBody`), download action, and file creation dialog (`createArtifact`).
  - Added Plan Mode toggle in composer (`/plan` prefixed turns) and mid-run Steer button (`steerThread`) for real-time steering of running agents and subagents.
  - Hermes-grade thinking placeholder pill with animated pulse and live elapsed clock (`Thinking · Xs`), plus tool cards with duration badges and expandable inputs/outputs.
- Sector Chat Thought Partner & Global Context Approval Cards:
  - `SectorChatPanel.tsx` updated with Global Context Update Approval Cards (`patchSectorContext`), allowing operators to approve or dismiss proposed sector notes before syncing to the global sector context.
  - Added mid-run steer action in sector chat composer.
- Context Studio & 60% Compaction Limit:
  - `SectorContextDrawer.tsx` updated with a 60% compaction limit indicator on `MeterBar`, raw verbatim context digest inspector with copy action, and `compactSectorContext` trigger.
- 4-Pillar Sector Detail Workbench:
  - `SectorDetailPage.tsx` updated with Linear-grade Command Header and 4-pillar view switcher (`Workbench (All)`, `Research Activity`, `Sector Chat`, `Context Studio`, `Files Hub`), keeping 100% test compatibility.
- Backend & Agent Grants:
  - Added `TurnMode = 'default' | 'brainstorm' | 'plan'`, `createArtifact`, `querySectorDocument`, `compactSectorContext`, `POST /v1/sessions/:sessionId/artifacts`, `POST /v1/sessions/:sessionId/compact`, `POST /v1/sectors/:sectorId/context/compact`.
  - Pinned auto-compaction cap at 60% window (120k tokens).
- Verification:
  - All 31 frontend test files passed (260/260 tests passed).
  - All 54 backend test files passed (315/315 tests passed).
  - All 31 agents test files passed (189/189 tests passed).
  - Typecheck, ESLint, no-em-dashes, and production build 100% green.

## Sweep robustness: TEST-marker strip + walled-run findings (2026-09-28)

- `stripTestMarkers` in sweep-rules.ts: leading TEST tokens/clauses go
  before shaping (the TEST-named proof sector had searched literal
  sweep-testing companies). Failing-first test + 6/6 rules green.
- Live re-proof attempt: restarted the proof sweep on the rebuilt
  worker (EN templates live); 8 min with no new hits past the first 9,
  paused gracefully via the pause route (200). Two measured facts:
  (1) the marker fix was not yet in the worker image, so queries were
  still poisoned; (2) without a search key every template burns ~30 s
  on the walled browser leg, so keyless-only operation at 30 templates
  is infeasible at 1000-company scale. Key provisioning is now
  load-bearing, not optional. Same-change doc: architecture retrieval
  paragraph.

## Hound at fullest: palette + EN regions + live-leg proof (2026-09-28)

- Karbot palette gains `web_search`, `web_fetch`, all five `browser_*`;
  sector palette gains `web_search` + `web_fetch` (web reads only,
  browser action stays Karbot-only). Proven failing-first in
  `karbot.turn.test.ts` (grant advertisement + stacking order intact).
- Sweep templates fan out per EN region by default (`ENGLISH_REGIONS`:
  US/UK/Canada/Australia; base order stable, cap 30). Proven
  failing-first in `sweep.rules.test.ts`.
- Live proof, no code: keyless DDG-html returns hits from here;
  worker→sidecar CDP navigates + snapshots + closes; webFetch extracts
  text; keyed fails closed (no key configured). An earlier browser-probe
  hang was a stale-dist artifact, cleared by the current image.
- KB completeness verified for the ICP bar: all 7 migration DROPs are
  old-stack internals/retired drafts (none touch ICP, qualification,
  problems, offer, pricing); corpus accuracy 15/15 live. The corpus is
  a starting hypothesis by design (icp.md says it evolves from
  evidence), complete as a bar, not frozen truth.
- Same-change docs: `docs/architecture.md` retrieval paragraphs.

## Thousand-scale proof: 1000 subagents + 1000-row UI (2026-09-28)

- Fleet-load file gains the thousand leg (own 1000-company sector,
  `maxInFlight` override path exercised, `stageCount` walks pages past
  the 500 cap): launched 1000 children in 4.5 s, all 1000 real company
  outputs in 293 s, 1000/1000 completed, zero rejected, zero missed,
  zero tokens, zero orphans left running. Scaling is linear
  (~0.3 s/output/child; launches serialize in the parent loop).
- New `tests/frontend-e2e/scale.spec.ts`: stubbed 1000-company detail
  walked through all ten Show-more windows with truthful totals at
  every step in 1405 ms, button gone at 1000.
- Same-change docs: `documentation/tests.md` fleet line,
  `docs/frontend-verification.md` scale row (below).

## Show-more company windows (2026-09-28)

- `useStagingCompanies` appends 100-row windows via `Show more
  (X of Y)` (id-dedupe by row id, `Loading more…` disabled state,
  button gone at the total, filter change resets to window one) on
  both the Researches full list and the sector detail section.
- Proven failing-first (no button, first window only), then 21/21
  detail tests and 13/13 Researches tests incl. 250-row three-window
  walks on both surfaces. Same-change doc: `documentation/frontend.md`
  window paragraph. One red item caught locally: a sync setState in
  the append effect tripped the react-compiler lint (moved into the
  click handler).
- External flake during the gate (not this diff): the live Meta probe
  suite intermittently fails with HTTP 503 from the provider (two
  different probe tests across runs; hermetic agents suite stays
  183-184 green) and passes on retry in isolation (40 s, same usage
  shape). No provider code in this change; recorded as external, not
  product. CI skips live probes (no keys).

## Fleet load runs: 10/50/100 subagents, real outputs (2026-09-28)

- `tests/backend/workflows.fleet-load.test.ts` (new, live-gated
  Temporal + TEST_DATABASE_URL): throwaway DB + in-process backend
  over real HTTP MCP (own operator key, test-fleet scope), so not one
  byte touches real data. Each child runs scripted provider steps
  (zero tokens) with real tool execution: read the sector, advance its
  companies' stages. Per-leg sectors with fixed ids plus a Filter
  reset make legs disjoint and rerun-proof; the suite asserts
  launched == completed == N, zero rejected, zero missed steer, and a
  negative control (no outputs before steering).
- Numbers (compose server, 5433, two consecutive full-file greens):
  10 in 3.7 s, 50 in 18 s, 100 in 35 s; launch ~1 s at 100; zero
  orphan workflows left running. Same-change doc:
  `documentation/tests.md` fleet-load paragraph.
- Red-suite account: the first composed run stalled (outputs never
  landed). Investigation found rerun collisions (fixed child ids hit
  still-running children from the aborted run and correctly rejected)
  plus 163 stale running fleet workflows on the server, terminated via
  tctl batch. Fixed with run-unique child ids, per-leg sectors, and
  the reset baseline; two consecutive 3/3 greens since. The initial
  stall's trigger beyond the collision was not isolated; the suite is
  now collision-proof by construction, which is the stated guard
  against recurrence.

## Subagent fan-out cap with backpressure (2026-09-28)

- `delegateParent` takes `maxInFlight` (default 50): delegations
  arriving with that many children running reject as
  `t.subagent.rejected` (`max in-flight children N reached`) instead
  of starting; slots free on `parentNoteDone`. No product starter
  passes it yet, so the default stands unchallenged and the change is
  purely additive.
- Proven failing-first on live Temporal (compose server): the new
  test timed out waiting for a rejection before the fix; 10/10 in
  `workflows.subagents.test.ts` after. Same-change doc:
  `documentation/agents-subagents.md` close-guarantees paragraph.

## Paged company/activity reads with server totals (2026-09-28)

- `listCompanies`, `listSectorCompanies`, `sectorActivity` take
  `{ limit 1-500 default 100, offset }` and return `{ rows, total }`;
  invalid windows throw before SQL. Routes parse `limit`/`offset`
  (detail answers `companiesTotal`/`activityTotal`; `/v1/companies`
  answers `{ companies, total }`); MCP schemas/handlers pass them
  through; `researchHealth` reads the tail window (total first, then
  the last 200). Frontend company lists filter server-side via their
  own `useStagingCompanies` windows with counts from totals; the
  Dashboard preview counts `View all` from the total and labels
  window-scoped searches honestly. Spec: openapi `CompanyList` /
  `SectorDetail` plus limit/offset params updated.
- Proven failing-first (paging hit SQL before validation), then live
  on 5433: db.sectors + api.sectors + fleet-seed 18/18 (fleet seed
  now asserts default page 100 rows + total 1000, second page 500).
  Frontend 232 passed; e2e stubs serve paged shapes.
- Red suites root-caused (all test side): skipped projector catch-up
  before seed reads; non-idempotent seed keys doubling rows on rerun
  (fixed with deterministic company ids + keys; DB reset once);
  array-shape assertions on the new paged returns; and a CI e2e miss
  where the runs-only stub in `visual.spec.ts` served the old array
  shape for `/v1/companies`, crashing the client and hanging nav
  (fixed the stub, proved 33/33 locally before re-push).
- Correction to the earlier gap analysis: live web search/fetch
  EXISTS (`backend/src/retrieval/web.ts`, MCP `web_search` /
  `web_fetch` with SSRF guards, sweep activity wired) but
  `KARDATA_WEB_SEARCH_KEY` is unconfigured here (fail-closed), and
  the agents research `Retriever` seam is still stub-only. The
  remaining retrieval gap is wiring the seam to the existing module
  plus key provisioning, not a from-scratch build.

## Fleet seed for thousand-company runs (2026-09-28)

- `tests/backend/fleet-seed.ts` (new): deterministic TEST generator
  (seeded PRNG, TEST labels on every name/file/marker, `test-fleet`
  tenant scope, docs spanning the chunker cap). Proven by
  `tests/backend/fleet-seed.test.ts` (failing-first on the missing
  module; 5/5 after): hermetic determinism/label/count/stage
  checks plus the live case (own DB, projector catch-up like the
  routes) seeding 1000 companies + 12 docs on 5433 in 1.5 s
  (appends 1248 ms, projection 154 ms, 4 multi-unit docs).
- Red suite root-caused (test side wrong): first live run failed
  `unknown sector` because the test skipped the projector
  catch-up between `createSector` and `markCompanyFound`; fixed
  to mirror the routes. Same-change doc: `documentation/tests.md`
  fleet-seed section (a replaced header was caught on read-back
  and repaired).

## First live sector research + recorded pack (2026-09-28)

- Ran the research workflow against the real Meta provider
  (muse-spark-1.3-contributor, chat wire) over an 8-doc fintech
  corpus via a scratch runner (deleted after the run, never
  committed). Three bounded runs: run 1 timed out at 300 s
  (provider latency was unknown); the single-call probe then
  measured 33.7 s; run 2 (6 calls, 27-47 s each, 241 s, ~8.9k
  in / ~1k out tokens) blocked on `research loop` with zero new
  evidence; run 3 with a lean retrieval-only registry reported
  in 239 s (5 calls, 2 units, 1 finding).
- Reported outcome: `reported`, 1 finding (Acme Pay founded
  2020, doc-1, https://example.com/acme), recorded as
  `agents/src/fixtures/research-fintech-live.json` via
  `createResearchPack` + `validateResearchPack`. The per-pack
  replay loop in `research.pack.test.ts` replays every
  `research-*.json` hermetically (network cut, byte-identical
  report); a sabotaged live golden was observed to fail and
  pass after restore. Suite now 6/6 in that file.
- Two findings for the owner, no product code changed: (1) live
  provider latency is 26-85 s per call, so research wall
  budgets must be sized in minutes, not seconds; (2) the full
  unit registry (plan/task tools included) lets the model burn
  its bounded turns on `plan.create` and starve
  `evidence.capture` (observed tool trace both blocked runs),
  while the lean retrieval-only registry researches cleanly.
  Fix direction (lean unit registry, more turns, or prompt
  change) needs owner sign-off.

## Research pack cassette foundation (2026-09-28)

- `agents/src/researchPack.ts` (new, barrel-exported):
  `createResearchPack` (re-hashes via `captureFinding`, assembles
  report), `validateResearchPack` (re-derives scope hash, every
  content hash, report byte-identical; throws on mismatch),
  `CassetteRetriever` (pack docs through the `Retriever` seam,
  unknown ids throw, zero network of its own). First pack
  `agents/src/fixtures/research-fintech-acme.json` (2 docs,
  2 findings).
- Proven failing-first by `agents/src/research.pack.test.ts`
  (failed on missing module before the fix; 4/ 4 after):
  replay with `fetch` stubbed to throw, end-to-end workflow
  report byte-identical to the golden, `createResearchPack`
  round-trip equality, four tamper rejections, secrets scan.
- Same-change doc: `documentation/agents-research.md` pack
  section. Gates: agents lint/typecheck clean, 182 passed;
  `pr:verify` green (frontend 231/6 skipped, backend 262/174
  skipped live-gated).

## Merge gate hardened with owner rules (2026-09-28)
- `documentation/pr-checklist.md` now encodes the owner's 8 merge rules
  as checkable items (scenario + stress tiers, observability triples,
  db-layer persistence, full suite incl. live-gated suites, frontend
  shots + clips + in-browser contracts, docs routing, independent
  subagent verdict) plus agent additions (secrets/safety scan, merge
  hygiene with rollback note). Enforcement note states the honest
  ladder: process + subagent verdict now, branch protection + CI once a
  remote exists. Docs-only change; verified by read-back.
- Red suite on first CI run (2026-09-28): `verify` failed resolving
  `@kardata/agents` because its runtime entry is `dist/`, which a fresh
  `npm ci` never builds; the gate only ever passed on machines with a
  stale local `dist`. Fixed the pipeline side, not product: `pr:verify`
  now builds `@kardata/agents` first (reproduced locally by deleting
  `agents/dist`, green after rebuild). Checklist wording updated to match.

## Remote live with enforced merge gate (2026-09-28)

- Repo `karthikkode/kardata` created private, checkpoint pushed, then made
  public per owner instruction (tracked-tree secret scan clean before the
  flip; only the documented dev-only compose password is visible).
- PR #1 (`docs/merge-gate-rules`) merged under the new rules: checklist in
  description, CI green, subagent PASS pasted, squash-merge.
- `main` branch protection active: strict required checks `verify` + `e2e`,
  PR required, force-push and deletion blocked, admins included. Direct
  pushes to `main` are now server-blocked, not just process-blocked.

## Context citations without ids + drawer pins (2026-09-28)

- Backend: `getSectorContext` cites `filename:ord` (stable `name (2)`
  suffix on repeats), notes `[note:N]` by creation order, digest text
  without the version hash (field retained). Storage ids stay on
  selection/reads/tools; only model-visible prose changed, so the
  sector-evidence contract (tools first, digest is the header, never
  invent versions) is untouched.
- Frontend drawer: sticky meter + add-note (the drawer's own
  `overflow-y-auto` was trapping the pins, removed), wheel chaining on
  unit islands (containment removed), filename unit labels, units-count
  summaries, indexed notes, offset single ring on the composer.
- Proven by stub-DB sector-context tests (4 failed before, pass after),
  live sector-context 4/ 4 on 5433, drawer unit tests 7/7, polish e2e 4/ 4
  with `polish-drawer-*` shots reviewed light + dark. Chaining test
  verified to fail with the trap restored.
- Open decision: AI-generated display names for uploads (provider,
  prompt versioning, storage, backfill) still needs owner sign-off; the
  filename-citation fix stands alone. Evidence-contract tests keep
  filename-style markers.
- Redeploy (2026-09-28): the live stack was serving the pre-fix image
  (containers started 04:49 UTC, fix landed 12:15+ UTC), so the drawer
  still showed `[digest:hash]` / `[sdoc-*:N]`. Rebuilt and recreated
  `backend` + `worker` from the current tree (same image; db volume and
  data untouched, booted with `KARDATA_PG_PORT=5433` since 5432 belongs
  to `finbuddy-db`). Verified healthy `/healthz` and `citationLabels`
  present in both containers' `backend/dist/db/sector-context.js`.
  Citations are read-computed per read, so the new format shows on
  refresh with no backfill.

## Frontend Wave 5: scrollbars everywhere (2026-09-28)

- Global thin token-matched base + `scroll-slim` utility in `index.css`
  (10px main / 8px dense, rounded thumbs, transparent tracks, contained
  overscroll); idle thumbs muted-foreground 45% via `color-mix`, hover full
  muted. True scrollports carry `scroll-slim`; nested islands that must
  chain the wheel (drawer units, drawer content) stay containment-free on
  the global thin base (see the Wave 6 entry for why).
- Proven by `tests/frontend/scrollbars.test.ts` (3/3 failed before, pass
  after) and `tests/frontend-e2e/scrollbars.spec.ts` (5 overflow shots,
  hook + computed thin asserted). Catches: substring anchors, faint
  border-thumb fixed with muted mix, overlay auto-hide noted.
- Gates: lint 0 errors, typecheck clean, 229 passed / 6 skipped, build
  clean, e2e 29/29. Shots `scroll-*` reviewed on disk; rows in
  `docs/frontend-verification.md`.

## Frontend revamp Wave 4: accent palette + formatter revamp (2026-09-28)

- Accent: restrained indigo primary + matching ring + categorical chart hues
  (token pairs in `index.css`, AA-kept); neutrals stay on surfaces, color on
  actions only. Formatter: content-sized scrolling tables with scoped
  headers, tinted quotes, bordered code, accent links, breathing lists.
- Proven by new `formatter.spec.ts` (table-heavy durable reply, light + dark
  + mobile shots) and a table-headers unit test. Your screenshot's exact
  failure (mid-token filename/status/id breaks) is gone: columns size to
  content and scroll instead.
- Gates: lint 0 errors, typecheck clean, 226 passed / 6 skipped, build
  clean, e2e 24/24. Shots `formatter-light-1440/dark-1440/light-390`
  reviewed on disk; rows in `docs/frontend-verification.md`.

## Frontend revamp Wave 3: full matrix, clips, reduced motion (2026-09-28)

- Matrix spec walks 6 surfaces in light + dark x 1440 + 390 (24 shots);
  transition spec records dock, section-switch, and menu-Esc clips (3 webm);
  reduced-motion test pins nav focus + dock Esc with motion collapsed.
- Live catches: zero-width row names on 390px (rows wrap now),
  dark shots rendering light (suite reloads after toggle — fixed),
  menu Esc missing its handler after autofocus removal (focus-into-menu
  contract + unit test), mid-fade blanks (frozen stills).
- Gates: lint 0 errors, typecheck clean, 225 passed / 6 skipped, build
  clean, e2e 21/21. All 34 PNGs + 3 clips reviewed on disk; rows in
  `docs/frontend-verification.md`. Remaining skips stated there.

## Frontend revamp Wave 2: lists, detail, runs, chat polish (2026-09-28)

- Filtered counts everywhere: `ResearchesPage` (filtered overflow total, no
  more base-count chip), `SectorDetailPage` companies (count line +
  viewport-relative columns + eye tooltips).
- `RunsPanel`: `CANCELLING` tones paused-amber, cancel failures alert with
  recovery copy. `SectorContextDrawer`: open unit lists scroll in place.
- Chat polish: shared user-bubble tint/shape/wrap, polite Karbot log,
  composer Enter/Shift+Enter hints, no-focus-steal model search, tighter
  mobile pill. Markdown keeps real heading levels.
- Checked and kept: `SubagentsPanel` buttons, `ModelsPanel` selects,
  button-proxied attach input (all already meet the bar; recorded in the
  area doc instead of churned).
- Caught live: mid-fade blank screenshots (Playwright visibility ignores
  opacity) — visual shots now freeze animations; motion stays with clips.
- Gates: lint 0 errors, typecheck clean, 224 passed / 6 skipped, build
  clean, e2e 13/13 (dark + mobile + runs shots reviewed on disk; rows in
  `docs/frontend-verification.md`).
- Docs: `documentation/frontend.md` wave-2 section added.

## Frontend revamp Wave 1: shell + lists (2026-09-28)

- `App.tsx` dock exit unified onto `useExitState` (bespoke timer removed);
  main column capped at `max-w-6xl`.
- `Sidebar.tsx` sticky full-height with desktop collapse toggle; `Emails`
  disabled as coming-soon instead of a dead route.
- `TopBar.tsx` Overview-scoped placeholder plus keyboard-reachable clear
  button; responsive padding.
- `Dashboard.tsx` truthful filter counts (`Showing X of Y matching`,
  live region); `View all N` keeps the unfiltered total.
- Proven by new tests (`TopBar` clear, `Sidebar` collapse/disabled,
  `Dashboard filtered counts` ×3, updated `Navigation` Emails contract;
  2 initially failed on stale expectations, fixed on the test side) plus
  extended `visual.spec.ts` (2 new shots). Gates: lint 0 errors,
  typecheck clean, 219 passed / 6 skipped, build clean, e2e 10/10.
  Screenshots reviewed on disk; rows in `docs/frontend-verification.md`.
- Docs: `documentation/frontend.md` shell-and-lists section added.

## Owner proposals resolved (2026-09-28)

1. AGENTS.md `logOp` rule: narrowed to the met bar (tool-boundary triple;
   ingress/egress plus error-with-trace elsewhere; new long ops add the
   triple). Code already met it; the rule now says what we enforce.
2. Run pause/resume/cancel MCP tools: built as `db.pause_run` /
   `db.resume_run` / `db.cancel_run` over a widened `ThreadMessenger`
   (fail-closed; floors mirror routes — pause/cancel operator,
   resume approver + sensitive). Proven by messenger doubles, floor
   tests, parity loops, and live (`tools/list` serves 64; ghost-run
   pause answers `not_found` as `isError`, never a throw-through).
3. Empty `common/` + `mcp/` dirs: removed (nothing referenced them) and
   the README map corrected — the MCP boundary lives in
   `backend/src/mcp/`, shared contracts in `backend/`; both area docs
   remain authoritative.
4. Poisoned context file: attached an honest
   `speciality-foods-brief.md` (770 chars, 1 unit) and excluded the stale
   meta-document from context. Live turn now lists both files, quotes the
   brief via the read tool, zero contradictions. Old file stays stored
   (tombstones for documents don't exist — proposed only if needed).
5. Node 22: installed (22.23.3) and verified — full `pr:verify` exit 0
   under it (frontend 213, agents 178, backend 425 passed / 8 skipped,
   build clean). The Node advisory is closed.
6. Dev servers: the Sep-26 vite still holds 5173 (left alone — serves
   current files from disk); review over 5173/5174 as convenient.

## Deep-check program complete (2026-09-28)

All phases executed, all gates green on the final tree (`npm run
pr:verify` exit 0 with full gates: frontend 213 passed / 6 skipped,
agents 178, backend 423 passed / 8 skipped, e2e 8/8, lint 0 errors,
typecheck clean, frontend build clean). Deployed images rebuilt from the
final tree and verified live (61 MCP tools incl. rename/remove; live
rename → remove → tombstone drill green). Detail per phase in the
entries below; open owner proposals live in the Phase 7 entry.

## Phase 7 quality: dedup ladders, mappers, headers + pr:verify (2026-09-28)

- Removed three real duplications: the role ladder (`mcp/tools.ts` kept
  its own copy — now `roleLevelAtLeast` in `auth/keys.ts`, the single
  home), credential hashing (`http/limits.ts` duplicated `auth/keys.ts`
  `hashKey` — now imports it, re-exported for compat), the header lookup
  (`mcp/routes.ts` copy — now exported from `routes/http.ts`), and four
  identical API error-status mappers (ChatPanel, ModelsPanel,
  ModelToolbar, research hooks — now `apiErrorStatus` in
  `data/staging-api.ts`).
- New `npm run pr:verify` (root): lint + typecheck + test (all
  workspaces) + frontend build in one command; the checklist references
  it for mechanical proofs while scope/design/Nielsen stay human.
- Checked and kept: client/server zod mirrors (intentional, documented),
  `overload` as the only 5xx code (OpenAPI-pinned), double projection
  (different callers, cheap no-op).
- Formerly open proposals, all resolved in "Owner proposals resolved"
  above: the AGENTS.md `logOp` rule was narrowed, the empty dirs removed
  with the map corrected, and run pause/resume/cancel tools built with
  route-mirroring floors (resume approver + sensitive).

## Phase 6 testingthon: storm, overflow, and the test contract (2026-09-28)

- New `db.concurrency` case: 100 twin `appendEvent` storms elect one row
  and share its seq (live-DB, ~2 s).
- New sector overflow case: 120-company section keeps the truthful `120`
  total chip with every row filter-reachable.
- Contract (`documentation/tests.md`): count-asserting suites must prove
  they cannot reach the network (the sweep-internet lesson), plus explicit
  scale tiers — unit soak, live-DB contention, UI overflow, gated live
  stack — so "which level missed it" is mechanical for every future bug.

## Phase 5 logging: route errors join the trace (2026-09-28)

- Gap: `route()` mapped throws to envelopes without logging — a 500 left
  only a status line (requestLog) with no error detail, so Loki had
  nothing to join on except the code. Now the catch logs `http.route.error`
  with route + trace_id + code + sliced message through the app logger
  (fail-closed scrubber applies; no logger means the route still answers).
- Proven by `logging.test.ts` (envelope stays shape-only `overload`,
  one log line carries route/trace/code).
- Verdict on the deferred `logOp` rule, with evidence: literal
  start/done/error on every cross-module call exists only at the MCP tool
  boundary; everything else has boundary logging (requestLog
  ingress/egress incl. 5xx error lines, Temporal signal logs, heartbeats,
  stall sweeps). Rewriting ~50 call sites to `logOp` buys log volume, not
  debuggability. Proposal (owner call, AGENTS.md untouched): narrow the
  rule to "triple for tool calls and long operations; ingress/egress plus
  error-with-trace everywhere else" — the codebase already meets that.
- Gates: logging suite green (10), backend lint + typecheck clean.

## Phase 4 MCP: session rename/remove tools + parity docs (2026-09-28)

- Gap: Karbot could create sessions but not rename or remove them —
  everything the owner does in the UI. New `db.rename_session` /
  `db.delete_session` (operator floor, Karbot palette only — destructive
  ops stay out of the sector palette), wired 1:1 over the db layer with
  unknown sessions as contract errors, following the runner pattern
  (role floors, capability tiers, fail-closed).
- Proven by `mcp.tools.test.ts` parity loops (schemas, layer table,
  valid/invalid, role floors) plus the stacking-order suite. The no-SQL
  guard caught "Delete" in a description — reworded to "Remove".
- Docs: binding table (`documentation/db.md`), tool list + true count
  (`documentation/mcp.md`, `README.md`: 45 was stale two changes ago —
  now 61). Deploy-drift guard added to `docs/environments.md` (verify
  `tools/list` count after every rebuild).
- Deferred (safety proposal, owner call): run pause/resume/cancel tools
  would extend `ThreadMessenger` — a model stopping other runs needs an
  explicit confirmation rule first.

## Phase 3 backend: single-decision approvals + CORS wiring + honest runs (2026-09-28)

- Fix (`routes/commands.ts`): approvals are single-decision — a distinct
  second verdict for one approvalId is 409 conflict (same-decision
  repeats replay idempotently). An approval carrying both verdicts was
  unanswerable for every future consumer (inspector reads decided events;
  no lane gates on them yet). Pinned in `api.rest.test.ts`.
- Fix (`http/cors.ts`, `routes/threads.ts`): the SSE route re-parsed env
  for its hijacked-socket CORS headers, diverging from injected origins;
  `registerCors` now stores the list on the app and the stream reads it
  (env parse is the fallback). Pinned in `api.cors.test.ts`.
- Honesty (`RunsPanel.tsx`): the row rendered `budget 0% · context 0%`
  from backend zeros that are documented placeholders ("until B5.x").
  Removed until the backend measures; API fields stay (contract).
  Pinned in `runs-staging.test.tsx` (values present, nothing rendered).
- Checked and kept: double projection per command (both serve different
  callers — HTTP threadCheck vs MCP-direct gateway; the second is a cheap
  checkpoint no-op under the advisory lock), `overload` as the only 5xx
  code (OpenAPI-pinned; the missing piece is error logging with trace
  context, carried to Phase 5).
- Gates: rest/cors suites green (23), runs-staging green (4), backend +
  frontend lint/typecheck clean.

## Phase 2 db layer: projector catch-up + bounded outbox reads (2026-09-28)

- Fix (`backend/src/projector.ts`): `projectNewEvents` applied one 500-row
  batch and returned `caughtUp: false`, which all ~20 call sites ignored —
  reads past a 500-event backlog served stale projections. It now loops in
  committed 500-row batches to convergence, capped at 20 batches (10k
  events) with `caughtUp: false` past that; the next read continues from
  the stored mark, so staleness is bounded, never stuck.
- Fix (`backend/src/db/outbox.ts`, `streams/outbox.ts`, `mcp/`): the
  initial backlog SELECT was unbounded — the snapshot decision loaded the
  whole backlog to count past 200. `readOutboxBacklog` takes an optional
  validated limit; the stream passes 201; `db.read_outbox` exposes an
  optional limit (capped 5000). No OpenAPI change (tool args are zod-only).
- New tests: multi-batch catch-up (`projector.catchup.test.ts`, live-DB:
  1102 events converge in one call, threads visible, second call clean)
  and snapshot overflow (`outbox.snapshot.test.ts`: 250-frame backlog
  opens with one state frame). Contract cases for bad limits.
- Checked and cleared: idempotency replay encoding (jsonb column, passing
  replay tests prove it), ModelsPanel N+1 (single active-session fetch
  only), `X-Project` free-form scope (isolated empty namespaces by
  design — no projects registry exists; noted, unchanged),
  `livePools` growth (two pools in prod; test-only).
- Gates: backend lint + typecheck clean. No area-doc change (batching and
  limits are internal; no contract moved).

## Phase 1 agents layer: budget accounting + fleet soak (2026-09-28)

- Fix (`agents/src/turnRunner.ts`): per-round budget accounting ran after
  the tool loop, so the final reply-only round broke before `noteTurn` /
  `noteTokens` / `noteCost` — trips landed one round late. Accounting now
  runs for every round before the no-tool break; repetition screening is
  untouched (tools only).
- New tests: final-round accounting pin (`turnRunner.test.ts`, verified
  failing pre-fix by temporary revert) and a 100-child fleet soak
  (`subagents.soak.test.ts`): 60 active / 30 stalled / 10 cancelled on a
  stepped clock — mid-run steer queues 90 and rejects 10 into missed
  steer, the sweep flags exactly the 30 stalled as missing-heartbeat with
  suspend decisions, and every summary carries counts, never thread
  content. Runs in ~130 ms, no network.
- Verified by read (no code change): pause/resume issues no
  re-verification turn — resume flips PAUSED to RUNNING and the loop
  takes the next inbox item (`workflows/run.ts:122`); re-verification is
  model behavior bounded by budgets + repetition halt, both pinned.
- Gates: 29 files / 178 tests green, lint + typecheck clean. No area-doc
  change (accounting order was never documented; no contract moved).

## Karbot dead-stream wedge + sector chat cleanup (2026-09-28)

- Symptom: Thinking could spin indefinitely beside a delivered reply —
  the Karbot tail swallowed stream errors (`if (snapshot.error) continue`)
  while the hold-open server tail never ends on its own, so a turn that
  died with no terminal message wedged Replying forever. Sector chat
  already threw on stream errors; Karbot did not.
- Fix (`frontend/src/components/ChatPanel.tsx`): three consecutive error
  snapshots break the tail; one re-read follows (the reply may have landed
  without a frame); if no fresh agent message arrived, Replying clears and
  the send failure shows with the sent text restored for retry.
- Sector chat cleanup in the same pass: composer model pill uses the
  generic `Model` label (full names live in the menu; no truncated ids
  crowding the input), Files help collapses to one caption line, and the
  message list shows a loading skeleton while the sector pool loads.
- Proven by `tests/frontend/chat-staging.test.tsx` (dead stream →
  visible failure, Replying gone, retry present; fails pre-fix by timeout),
  `tests/frontend/SectorChatPanel.test.tsx` (generic pill label, loading
  skeleton), and a scoped `SectorDetailPage.test.tsx` fix (processing-row
  assertion now scoped to the files region). Full frontend suite: 212
  passed / 6 skipped; lint 0 errors; typecheck clean. Light + dark
  verified live via screenshots with zero page errors.
- Area-doc update: dead-stream bound recorded in
  `documentation/frontend.md`.

- Symptom: sector chat "can't see indexed files in context" — the model
  reported tools return metadata only, and quoted a stale embedded digest
  (`5885dfddbcfe`, "no documents") from inside the file against the live
  header (`695a93756eca`, file indexed).
- Root causes, both live-reproduced: (1) the compose `backend` image
  predated the repo — `db.read_sector_document`, `db.research_health`,
  `db.send_message`, `db.steer_thread` existed in code and tests but not
  on the wire (55 vs 59 tools on `tools/list`); (2) the context file
  itself is a meta-document describing the context system with an outdated
  embedded digest, so injected references argued against the header.
- Fix: `docker compose up -d --build backend worker` from current code
  (59 tools live), then a live quote test — the turn called
  `db.read_sector_document` and quoted the file verbatim (seq 28–29 on the
  Speciality Foods sector thread). No repo code changed; this was deploy
  drift, not a code bug.
- Boot trap found on the way: plain `up` bounces `db`, which dies on the
  host-5432 conflict (`finbuddy-db` holds it) and takes backend+worker
  down with it. Recovery is the documented 5433 remap (volumes untouched,
  data safe). Exact boot command added to `docs/environments.md`.
- Follow-ups: a live-tool-parity check so deploys can't silently trail the
  repo (Phase 4); replace `speciality-foods-context.md` with real sector
  content instead of context-system meta-documentation (data fix, owner call).

## Sweep e2e leaked to the live internet (2026-09-28)

- Symptom: full-gate backend suite red — `workflows.sweep.test.ts:129`
  `expected 14 to be 2`, deterministic across three consecutive runs.
- Root cause (test, not product): the 09-27 sweep-fallback chain sends empty
  keyed pages to the live keyless pool. The e2e stub returned results only
  on offset 0, so pages 1+ of every template fell through to real
  keyless search over the open internet: 2 stubbed companies + 12 live
  hits. Timing corroborates — the failing run spent ~3 s in-test (live
  HTTP), the fixed run 389 ms (all stubbed). Empty-page exhaustion stays
  pinned in `sweep.search.test.ts` with fixture doubles; the e2e contract
  is determinism, so the stub now serves the same two companies on every
  page and per-page dedupe terminates each template.
- Fix: `tests/backend/workflows.sweep.test.ts` stub ignores offset plus a
  comment stating the internet-leak mechanism. No product code changed.
- Proven by two consecutive green single-file runs under
  `TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1`. Full-gate suite at the
  time: 417 passed, 1 failed (this test), 8 skipped.
- Lesson for the program: any suite asserting exact counts must prove it
  cannot reach the network — stub every leg or fail closed without one.

## Stale-worker 403 outage (2026-09-28)

- Symptom: "I could not complete that reply. Please try again." on
  tool-requiring turns, intermittently: the same question failed and
  succeeded minutes apart.
- Root cause (operational, not code): a forgotten laptop dev-worker (from
  Sep 27, pre-rotation token in its shell) raced the compose worker on the
  same `kardata-turn-v1` queue. Its token matches no `api_keys` row, so
  every `tools/list` it attempted got HTTP 403 across 3 activity attempts
  (Temporal history: `karbot turn failed: mcp request 'tools/list' failed
  with HTTP 403`). Turns it stole failed; turns the compose worker (valid
  token) won succeeded. Proven by hashing each worker's presented
  credential against `api_keys`: compose resolves to `worker-1`
  (operator), the stale one to zero rows.
- Fix: stop the stale local worker; recreate (never plain-restart) the
  compose worker after a token rotation
  (`docker compose up -d --force-recreate worker`).
- Durable guard: `checkWorkerMcpAuth` in
  `backend/src/temporal/activities/turn.ts` runs at worker boot
  (`dev-worker.ts`) and logs `[FATAL] worker mcp auth` with the recreate
  remediation when the credential does not resolve; polling continues so
  digest-answerable turns keep working. Proven by
  `tests/backend/worker.mcp-auth.test.ts` (403 names the remediation,
  token never leaks into the reason).

## Sector document read-back tool (2026-09-28)

- Gap: `db.list_sector_documents` returns record metadata only (id,
  filename, chars, status), and no other MCP tool returned file text, so a
  worker asked to quote a document back could not do it through the tool
  boundary. Reproduced live: Speciality Foods
  `speciality-foods-context.md` (status indexed, 2354 chars) has its full
  text stored twice over (`sector_documents.text` plus 2 indexed units)
  while the tools exposed none of it.
- Fix: new `db.read_sector_document` tool (viewer floor) returning one
  document with its full extracted text; advertised in both the Karbot
  (`PRODUCT_TOOLS`) and sector-chat (`SECTOR_TOOLS`) palettes. The Karbot
  system prompt now states the list carries metadata only and directs
  quote-inside-a-file requests to the read tool.
- Proven by `tests/backend/mcp.read-document.test.ts` (attach then read
  the exact text back through `invokeTool` dispatch as a viewer; unknown
  document/sector contract errors; schema validation before any query;
  both palettes retain the tool; failed pre-implementation on all four).
  Parity entries added to `tests/backend/mcp.tools.test.ts`.

## Karbot monitor + steer tools (2026-09-28)

- Three new MCP tools. `db.research_health` (viewer, Karbot + sector
  palettes): one read-only snapshot per sector — state, timeline depth,
  session threads with liveness, and a `stale` flag when running claims no
  open thread. Fleet heartbeat beats were deliberately excluded after a
  test caught them attributing one sector's liveness to another.
- `db.send_message` / `db.steer_thread` (approver + sensitive, Karbot
  palette only): queue onto a thread (runSend) or interrupt a running turn
  (runSteer) through the runs gateway, which rides the tool context like
  SectorSweepRunner and fails closed when absent. Gateway misses surface
  as `not_found` / `conflict`, never throw-throughs.
- Proven by `tests/backend/mcp.tools.test.ts` (messenger doubles, role
  floors, capability tiers, error mapping, plus a live-DB health block:
  live vs stalled vs draft vs unknown sector).

## Server-side tool-grant enforcement (2026-09-28)

- Grants were client-side only: the worker filtered `listTools`, but the
  keyed `/mcp` boundary never saw the grant (the old comment claiming
  server re-enforcement was wrong). Now the worker sends its effective
  palette (product ∩ sector ∩ skill) on `x-kardata-tool-grant`, and the
  server enforces it: granted tools are the only ones registered
  (unlisted tools fail at the wire), `invokeTool` re-checks per call, and
  role floors still apply on top — a grant narrows, never widens. Unknown
  grant names fail the request with 400.
- Proven by `agents/src/turnRunner.test.ts` (header sent/trimmed/omitted)
  and `tests/backend/mcp.tools.test.ts` (list narrowing, wire-level block
  outside the grant, invoke-level `permission_denied`, unknown-name 400,
  no-header behavior unchanged).

## Temporal live fleet: 3 newly-gated failures fixed (2026-09-28)

- Full backend with every gate open (live Postgres + live Temporal):
  65 files, 404 tests, 0 failed. Opening `KARDATA_TEMPORAL_TEST=1`
  exposed three suites that always skipped before.
- Real product bug: sweep activities ended the process-shared worker pool
  (`pool.end()` in `finally` over `workerPoolFromEnv()`), so the first
  finished activity killed every later one (`Called end on pool more than
  once`). Removed in all three sweep activities; every sibling activity
  already treats the pool as worker-owned. Proven by the sweep e2e.
- Test bug: the missed-steer case sent `childMessage` with no `fakeSteps`,
  so the fake provider was empty and the child turn could never run
  (out-of-steps is a test bug per `agents/src/fake.ts`). One scripted step
  added, matching every sibling case.
- Test isolation bug: the sweep stub served static domains while company
  ids hash from the domain, so a repeat run's projection no-ops on
  `ON CONFLICT DO NOTHING` against the reused database. Stub domains now
  carry a per-run tag; verified green twice consecutively. Open modeling
  note: one domain found in two sectors stays bound to the first sector's
  row.
- Timing bound: heartbeat redelivery floor is ~20 s by construction, so the
  20 s bound had ~300 ms of slack on a real server (observed 36.5 s under
  docker scheduling). Widened to 45 s, still far inside the 60 s
  start-to-close it discriminates against.
- Scrutiny honesty note: a mid-debug manual `projectBatch` replay
  populated the sweep DB and masked the isolation bug until the DB was
  reset; throwaway probes stay out of the deliverable and shared test
  databases get reset, not replayed into.

## Screenshot visual matrix + stale smoke fix (2026-09-28)

- New runnable suite `tests/frontend-e2e/visual.spec.ts`: overview empty,
  researches list, sector detail with context, chat with model picker open.
  Every shot asserts its anchors before capturing, so regressions fail
  instead of drifting; PNGs land in `test-results/visual` (gitignored).
- Full e2e is green (8/8). One smoke expectation was stale: it demanded the
  full model name in the chat trigger, but the chat picker intentionally
  uses the generic label (pinned by `models-staging.test.tsx`). The smoke
  test now asserts the pinned contract (trigger `Model`, menu carries the
  live catalog).

## Sector chat stuck-thinking fix (2026-09-28)

- Symptom: Thinking counted forever beside an already delivered reply.
- Root cause: the server SSE tail replays then holds the socket open by
  design (`backend/src/streams/outbox.ts`), so the send loop's `for await`
  never ended and `busy` never cleared. The thinking indicator is
  `busy`-gated, so it spun indefinitely.
- Fix: `SectorChatPanel.sendText` breaks the tail on a fresh terminal
  agent message (seq past the pre-send id basis, nothing in flight), then
  follows the normal settle/refetch path. Mirrors the ChatPanel
  `awaitingReply`-basis pattern.
- Proven by `tests/frontend/SectorChatPanel.test.tsx` (held-open stream:
  reply visible, Thinking gone, composer usable; fails pre-fix by timeout).
- Follow-up fix: the timestamp-divider test used absolute 2026-09-27 dates
  and rotted the moment both stamps aged past the 24h bucket (all three
  clocks rendered "1d", count 3 vs 2). Now uses stamps relative to
  `Date.now()` ("3h"/"2h" forever) and scopes the count to the thread via a
  new `aria-label="Chat messages"` landmark on the message list (also keeps
  same-hour session-list ages out of the assertion).

## Sector-chat MCP palette split (2026-09-28)

- Sector-linked turns now run behind `sectorMcpClient` (12 tools: own
  session/thread, sector reads, document attach/list, artifact list/reference,
  KB search). Cross-sector writes, tenant-wide reads, and ledger mutations
  stay Karbot-only. `db.get_thread` joined the Karbot palette so the sector
  stack (`sector(product(transport))`) never lists an uncallable tool.
- Scope fail-open is deliberate at the worker edge (a missed session lookup
  runs unscoped, never fails the chat); role floors still enforce per call
  at the keyed MCP boundary. Server-side sector-grant enforcement (grant
  traveling with the worker call) is open follow-up work.
- Proven by `tests/backend/karbot.turn.test.ts` (sector list/call gating,
  full stacking-order survival).

## Known-red sector/context suites fixed at root cause (2026-09-28)

- Full backend suite is green: 373 passed, 0 failed (37 gated skips:
  Temporal/compose/live-provider). The 6 pre-existing failures are gone.
- `db.document-units`: the test never caught up the projector, so the fresh
  sector was invisible to the projection read and every ingest 404d. The
  attach route calls `projectNewEvents` first; the test now does the same.
- Both unit-count failures (`db.document-units`, `api.sector-context`):
  test content was shorter than the pinned 2000-char chunker cap, so
  extraction correctly produced one unit while the tests demanded two. The
  product behavior is pinned by `file-pipeline.test.ts`; the tests now send
  over-cap content. No product code changed.

## DB concurrency proofs under live Postgres (2026-09-28)

- New gated suite `tests/backend/db.concurrency.test.ts` (skips explicitly
  without `TEST_DATABASE_URL`): 20 twin idempotency claims elect exactly one
  winner with replay/clash after completion, 50 concurrent rate increments
  count exactly 1..50, a max-2 pool queues 10 slow queries instead of
  failing, and a 200ms statement timeout kills `pg_sleep(5)`.
- Live evidence this session (compose `db` on `:5433`): soak harness
  (1000-agent fleet) green, `db.contract`, `db.migrations`, `db.pool`
  green alongside the new suite.

## Tool-execution logging triple (2026-09-28)

- `logOp` in `backend/src/observability/logging.ts` wraps async work with
  start/done/error lines carrying join keys plus op, latencyMs, outcome;
  errors are logged with code and rethrown, extra fields pass through the
  fail-closed scrubber.
- `invokeTool` emits the `tool.call` triple when `McpToolContext.logger` is
  present; `/mcp` builds a request-scoped child logger (ingress trace +
  tenant) from the app logger in `backend/src/mcp/routes.ts`. No logger
  means tools still run silently (unit-test path).
- Proven by `tests/backend/logging.test.ts` (triple, rethrow, scrub) and
  `tests/backend/mcp.tools.test.ts` (success/error/no-logger paths).

## Files list context toggles + processing row (2026-09-27)

- Each file renders as a card: type icon (image/spreadsheet/text), name,
  and a meta line (`Indexed · 2 units · 2.4k chars`, `Needs OCR`, plus
  `excluded from context` with dimming). The card carries the same
  whole-document include/exclude toggle as the context drawer
  (`PATCH /v1/sectors/:id/context`), with an `excluded`-state fetch so the
  row never guesses. Attaching shows a pending card with the filename and
  a `Processing…` status until the pipeline answers. Proven by
  `tests/frontend/SectorDetailPage.test.tsx` (toggle round-trip, pending row).

## Agent-started research with chat pause/resume (2026-09-27)

- The sector summary card (found count, state pill, Start/Restart) and the
  Activity timeline are removed from the detail page. Research starts only
  when the owner asks the agent in a sector chat: `db.start_sector_research`
  takes an optional `sessionId`, validates it belongs to the sector, and
  records a `sector.research_started` event projected to
  `sectors.research_session_id` (migration 0012); anything past draft still
  conflicts, so no second session can start it. The recorded session pins
  first in Chats with a Research marker.
- Pause/resume moved into the chat window research strip (state-only, like
  restart — not a Temporal signal): `POST /v1/sectors/:id/pause|resume`
  plus `db.pause_sector_research` / `db.resume_sector_research`.
- Session pools are separate by contract: bare `GET /v1/sessions` (and
  `db.list_sessions` without `sectorId`) lists general sessions only;
  sector chats list through `?sectorId=`.
- Evidence (live-db where gated): `tests/backend/api.sectors.test.ts`
  (pause/resume 403/ 404/ 409/200), `tests/backend/db.sectors.test.ts`
  (pin projection), `tests/backend/sector-start.test.ts` (pin record,
  unknown/foreign session, pause/resume tools),
  `tests/backend/api.session-sector.test.ts` (bare list excludes sector
  chats), `tests/frontend/SectorDetailPage.test.tsx` (no summary/activity,
  chat pause/resume/errors), `tests/frontend/SectorChatPanel.test.tsx`
  (chat strip, pin order). Live run: 356 backend passed; 6 pre-existing
  failures in `api.sector-context` / `db.document-units` (untouched
  extraction/test-projection paths) plus a fixed `rebuildFromEvents`
  TRUNCATE (dependent projection tables broke every live rebuild).
  Pause is owner-intent state; the in-flight sweep receives no signal.

## Sector chat, separate from Karbot (2026-09-27)

- The detail-page "Open chat" opened global Karbot with a sector label:
  shared session pool, no sector link, no sector context. Now the
  detail page embeds its own Sector chat section backed by
  sector-linked sessions: `sectorId` rides `t.session.created`
  (no table migration), `POST /v1/sessions` verifies the sector (404
  otherwise), `GET /v1/sessions?sectorId=` filters server-side, and
  the panel creates `{name} chat` sessions, streams turns through the
  same send/thread-stream path, and never lists general chats.
- Evidence: `tests/backend/api.session-sector.test.ts` (live-db:
  create side-by-side, read-back, filter isolation, unknown-sector
  404, blank filter 400), `tests/frontend/SectorChatPanel.test.tsx`
  (scoped list URL, linked create body, send threadKey, streamed
  reply), plus a detail-page section pin. Sector topic/document
  preload into turns is follow-up work, not this change.

## Sector chat revamp: overflow-safe shared rows (2026-09-27)

- Long reply tokens (sector UUIDs, filenames) overflowed agent bubbles:
  bubbles now wrap anywhere, `Markdown` inline code breaks anywhere, links
  wrap anywhere; `pre`/tables keep their scroll. The panel renders through
  new shared `frontend/src/components/chat-parts.tsx` shells (centered agent
  mark, >5-minute time dividers, shrink-wrapped tinted user / muted agent
  bubbles, pill research strip); placeholder, strip controls, and composer
  behavior are unchanged, and Karbot keeps its layout.
- Evidence: `tests/frontend/chat-parts.test.tsx` (gap logic, shells, mark),
  `tests/frontend/SectorChatPanel.test.tsx` (divider rendering, wrap
  regression, shared replying status), plus the staging-browser pass below.

## Sector chat turns show their work (2026-09-28)

- The chat section no longer scrolls as one box: header, research strip,
  and composer are fixed and only the message list scrolls, with
  stick-to-bottom autoscroll and a Latest jump pill (`useChatStick`, shared
  in `chat-parts.tsx`). Turns render the full live recipe the stream already
  carried: optimistic echo with Sending, live tool rows with elapsed age,
  the streaming thinking trace, then the reply; the placeholder mounts only
  on true silence. `ActivityGroup` groups consecutive calls under a summary
  with per-call status icons; `ToolRow` shows spinner/check/X instead of the
  status dot. Cut from the plan before delivery: approval cards — the
  `approval` wire shape exists but no lane emits approval thread messages,
  so there is nothing to render yet (follow-up is backend emission).
- Evidence: `tests/frontend/SectorChatPanel.test.tsx` (live tools +
  reasoning, echo, Latest jump), `tests/frontend/chat-parts.test.tsx`
  (group summary), updated `chat-staging.test.tsx` group label, plus the
  staging-browser pass below.

## Worker token shadowing killed all tool calls (2026-09-28)

- Root cause beneath the confabulation: `deployment/compose.yaml` set
  `KARDATA_MCP_TOKEN: ${KARDATA_MCP_TOKEN:-}`, and compose `environment`
  wins over `env_file` — so the worker always ran with an empty token, a
  closed MCP client, and zero tool calls in every turn it ever served
  (verified: zero `tool` rows DB-wide; the model truthfully reported no
  tool access). The line is removed so `agents/.env` delivers the token as
  `docs/environments.md` always promised. First verified tool turn:
  `db.list_sector_documents` + `db.get_sector` (done), reply grounded with
  exact file id, status, and chars, no phantom digest.
- Evidence: live thread tail (seq 16-18), `/mcp` 200s from the worker.

## Model must verify sector contents via tools (2026-09-28)

- Turns answered file questions from the injected digest while inventing a
  contradictory "detail view" (phantom digest, zero tool calls DB-wide).
  The system prompt now contracts sector evidence like product knowledge:
  file/document/company/state questions call `db.get_sector` or
  `db.list_sector_documents` first; the digest is the header, never the
  detail; digest versions and counts are never invented.
- Evidence: `tests/backend/karbot.turn.test.ts` (sector-evidence
  verification contract).

## Stuck replies reconcile after the tail (2026-09-28)

- A turn whose stream ended before the terminal append landed left the chat
  empty with no error: the single post-tail refetch predated the reply.
  `sendText` now settles — re-reading until a fresh agent reply lands (45 s
  budget, skipped when the tail itself delivered one) — so late replies
  appear instead of a stuck thread.
- Evidence: `tests/frontend/SectorChatPanel.test.tsx` (reconciles a reply
  that lands after the stream ends; observed failing before the fix).

## Context drawer shows the full assembled context (2026-09-28)

- Diagnosis first: the "0 files" claim was model confabulation, not a data
  bug — `GET context` and `GET documents` agree (1 file indexed, 0 notes,
  digest `695a93756eca`; no second digest exists server-side), and zero
  `tool` rows exist DB-wide because recent turns ran single-round text
  replies despite the `kb_search`-first rule (tool path itself verified
  working end to end). The drawer now renders every segment verbatim:
  meter as `used / 1,000,000 · percent of context`, system, pinned
  reference texts, files with full units, history, tail, then notes.
- Evidence: updated `tests/frontend/SectorContextDrawer.test.tsx` (meter
  caption, verbatim sections), plus the staging-browser pass below.

## Create/start failures now surface (2026-09-27)

- Reported: the Create draft button did nothing. Two causes: the live
  backend predated `POST /v1/sectors` (log showed 404; recreated from
  the current image on `KARDATA_PG_PORT=5433`, route now answers the
  auth gate), and the UI swallowed every mutation error — create,
  start, and restart had no catch and no error display.
- Fix: `createError`/`actionError` states with role=alert display on
  the form and under the detail buttons; start/restart wrappers now
  announce success only, reasons come from the alert.
- Evidence: new display tests in `ResearchesPage.test.tsx` and
  `SectorDetailPage.test.tsx`. Note: the stack had drifted (db/backend
  down after a recreated project graph met finbuddy on 5432) — data
  was safe in `kardata_pgdata`; restore with the documented 5433 remap.
- Follow-up blank page on the new draft: the vite dev transform cache
  served a mid-edit module (call site without its destructure →
  `actionError is not defined`, whole tree unmounted). On-disk code was
  correct and committed tests green; fixed by invalidating the
  transform (`touch`) and verified with a headless load of the real
  sector (full detail, zero page errors). No repo test can pin dev-cache
  staleness; the new display tests cover the behavior itself.

## Containerized browser + worker (2026-09-27)

- Compose runs headless Chromium in a `browser` sidecar
  (digest-pinned `zenika/alpine-chrome`, no host ports) plus a `worker`
  service, so turns, sweeps, and browser sessions never execute on the
  laptop. App code connects over CDP (`KARDATA_CHROME_CDP_URL`) with
  manual discovery (loopback Host override for Chrome's rebinding guard,
  ws hostname rewritten to the sidecar); sidecar sessions are unowned —
  fresh context each, close drops only the context.
- Verified live: in-container navigate/snapshot/screenshot/act/close
  through the sidecar, then two concurrent sessions opened and closed
  with zero leaked targets. An isolation probe caught sessions sharing
  the default context stranding pages — fixed by always minting a fresh
  context. `docker compose config` renders; backend and worker both
  point at `http://browser:9222`.
- Evidence: `tests/backend/retrieval.test.ts` (CDP bad-scheme and
  dead-endpoint, no launch). The compose worker needs `KARDATA_MCP_TOKEN`
  in `agents/.env`; full stack re-up (`up -d`, worker included) still
  pending user action.

## Tool-failure honesty (2026-09-27)

- Observed behavior: when a tool call fails (e.g. search), the agent
  fills the gap from parametric knowledge and proceeds. Two levers:
  `KARBOT_SYSTEM_PROMPT` now contracts failure-as-source-gap for every
  mode, and evidence-code isError text carries a no-guess directive
  (`Do not fill this gap from memory: report what you could not verify,
  or retry once with a narrower query`) — other codes stay bare.
- Evidence: prompt-contract test plus a wire-level
  present/absent test in `tests/backend/mcp.tools.test.ts`. Honest
  limit: these pin the signal reaching the model, not a live model's
  obedience — that needs a keyed live probe, still deferred.

## Browser screenshots on demand (2026-09-27)

- `browser_screenshot` MCP tool (operator): viewport JPEG + sha256 for
  what snapshots cannot show, capped at 400 KB with a retry-viewport
  error over budget. Snapshots stay the default per the tool
  description; the turn loop is text-only, so pixels ride history as
  base64 (context cost documented) and sha hashes give text-consumable
  change verdicts. MCP grows 51 → 52 tools.
- Evidence: `tests/backend/retrieval.test.ts` (no-launch validation;
  capture shape in the gated live test), `tests/backend/mcp.tools.test.ts`
  parity loops. Full vision loop (image content parts through the
  provider adapters) deliberately deferred.

## Sweep fallback: keyless pool + browser-on-blocked (2026-09-27)

- `searchWebPageActivity` now chains keyed Brave → keyless engine pool
  (`backend/src/retrieval/keyless.ts`: DDG html/lite, Mojeek) →
  real-Chromium browser leg (page 0 only). Live probes showed direct
  HTTP keyless challenged everywhere (Qwant captcha, Mojeek 403, DDG 202
  anomaly-modal), so the browser leg is the real fallback, not the pool.
  Hits carry `via` + engine name; all-legs exhaustion fails loudly.
  MCP `web_search` stays keyed and fail-closed by design.
- Evidence: `tests/backend/sweep.search.test.ts` (8 tests, fixture
  doubles + stub legs). Gated Temporal sweep suite unaffected (sets a
  key, so the keyed leg serves as before).
- Deferred: live keyless/browser-leg sweep under compose (the `browser`
  sidecar now exists, but no pilot sector has run through it); keyless
  hits inherit the v2 caveat that no-key backends claim no search-engine
  ToS compliance — best-effort fallback, never the default.

## Product-knowledge harness: skills, sectors, retrieval (2026-09-27)

- Phases 1–6 implemented: server-side prompt seam (`composeSystemPrompt`
  in `agents/src/prompt.ts`), skill registry with capability tiers and
  per-skill tool grants (`brainstorm`, `sector-draft`; `GET /v1/skills`),
  slash dispatch on `POST /v1/commands/send`, brainstorm mode with KB
  preload, sector draft/create/start with multi-format context documents
  (migration `0009_sector_drafts.sql`), and the web/fetch/browser sweep
  (`backend/src/retrieval/`, `workflows/sweep.ts`, `sweep-rules.ts`).
  MCP grows 45 → 51 tools; `browser_snapshot` is viewer-readable, the
  other five retrieval tools need `operator`.
- Guards held: no-SQL rule tightened to word boundaries (`selector` field
  is not a statement), layer-parity resolves db + retrieval namespaces,
  SSRF blocklist allow-listed in the no-hardcoded-staging test.
  Frontend `SectorResearch` gains backend-returned
  `createdAt`/`updatedAt` (build was red on the detail refetch dep).
- Evidence: `agents/src/skills.test.ts`, `tests/backend/mcp.tools.test.ts`,
  `tests/backend/karbot.turn.test.ts`,
  `tests/backend/sector-documents.test.ts`,
  `tests/backend/sweep.rules.test.ts`, `tests/backend/retrieval.test.ts`,
  `tests/backend/workflows.sweep.test.ts`. Gates green: 157 frontend /
  165 agents / 194 backend tests, lint, typecheck, frontend build.
- Sector context harness (Phases A–E): magic-bytes file pipeline with
  model OCR over `KARDATA_META_KEY` (`backend/src/db/file-pipeline.ts`,
  `backend/src/ocr.ts`, migration `0010` units index), exact-context
  endpoints `GET/PATCH /v1/sectors/{id}/context` with exclusions + notes
  (migration `0011`), read-computed versioned digest shared across
  sessions, sector refs preloaded into turns (24k-char cap, fail-closed),
  Context drawer + meter + upload statuses in the detail page. Evidence:
  `tests/backend/file-pipeline.test.ts`,
  `tests/backend/db.document-units.test.ts`,
  `tests/backend/sector-context.test.ts`,
  `tests/backend/api.sector-context.test.ts` (gated),
  `tests/backend/ocr.test.ts`, `tests/frontend/SectorContextDrawer.test.tsx`.
  Gates green: 167 frontend / 175 agents / 227 backend tests.
- Deferred: live draft-to-sweep run under compose (no
  `KARDATA_WEB_SEARCH_KEY`, no pilot sector; acceptance script in
  `docs/environments.md`), live browser suite (`KARDATA_BROWSER_TEST=1`,
  needs Chromium + network), Temporal suites under compose. Live vision
  check for `muse-spark-1.3-contributor` image parts (shape proven by
  cassette; model acceptance unproven). Web search
  and browser tools fail closed without keys/binaries — documented as
  degraded mode, not live capability.

## Backend gap review: orphans, tracking, robustness (2026-09-27)

- Authz hardening (Wave 1): SSE thread stream authorizes before fetching
  (anonymous probes 403 on missing threads too); MCP `db.append_event`
  refuses `t.approval.*` at every role; `db.find_key` and
  `db.project_batch` raised to `approver`; MCP idempotency tools namespace
  keys per caller (`<keyId>:<key>`). New tests in
  `tests/backend/mcp.tools.test.ts` + `tests/backend/api.auth.test.ts`.
- Retention sweepers (Wave 2a): `pruneOutbox`, `sweepIdempotency`
  (completed only — the B6 sweeper migration 0006 promises), and
  `pruneHeartbeats`, wired to `node backend/dist/db/cli.js sweep [days]`
  (default 90 days). Contract + behavior tests, no live DB needed.
- Workflow close guarantees (Wave 2b): session-run idle close
  (`idleTimeoutMs`, 24 h default), delegation-parent idle close
  (`parentIdleTimeoutMs`, cancel-then-finish children,
  `t.subagent.parent_expired`), cancelled-child finish close
  (`childFinishTimeoutMs`, 1 h), guarded-suspend expiry
  (`suspendTimeoutMs`, `t.research.suspend_expired` → terminal tail).
  Gated Temporal tests added; Temporal/DB suites skipped locally (no
  infra) — run under compose before calling them proven.
- Robustness (Wave 4): duplicate delegation for a running child rejects
  as `t.subagent.rejected` (plus `parentNoteDone` liveness protocol);
  steer-before-delegation priority and guarded pause path documented.
  Deferred: research/guarded cancel signals, child redirect forwarding,
  closed-run refused/blocked mapping, listRuns query-filter pagination.
- Visibility (Wave 3): inspector already carries lastSeq/lastEventAt and
  documents the events-only lag trade; provider failure detail stays
  log-free deliberately (adapter detail may carry key material). Broader
  surfaces (budget ratios, inbox depth, stage cursors in listings,
  research/child inspector partitions) deferred.
- Contract + docs (Wave 5): `GET /v1/debug/runs/{runId}` added to
  `backend/openapi/v1.yaml` (29 operations); fixed sector/company, op
  count, MCP tool list, idempotent-route count, tool/row wording, DELETE
  sessions, runbook poisoned-lane playbook, `KARDATA_PROVIDER` values.

## Checkpoint hardening: coverage + regression tests (2026-09-27)

- Coverage is measurable: `@vitest/coverage-istanbul` (the v8 provider
  needs the uninstalled `@vitest/browser`, so istanbul instead),
  `npm run test:coverage` in frontend, config in `vite.config.ts`.
  Baseline 75.18% lines → 76.07% after this pass (152 tests green).
- Approval decision: backend `POST /v1/commands/approve` producer is real
  (appends `t.approval.decided`), so `decideApproval` stays with new
  client tests (`tests/frontend/approval.test.ts`); the ChatPanel comment
  covers message rendering only and stands.
- New regression tests: offline send/create short-circuit (no doomed
  request, draft preserved), SSE resume after socket death/idle/garbage
  (lastSeq progression, no loss/dup), TopBar search + chat toggle,
  unknown-section fallback, dark toggle, `closeChat` timer hygiene.
- Deleted dead code: `ui/dialog.tsx` (158 lines, zero importers).
- Created the missing `docs/design-system.md` (AGENTS.md map referenced it):
  canonical home for all UI rules moved verbatim from
  `documentation/frontend.md`, plus house markdown; frontend.md keeps
  anatomy/behavior with a pointer.

## House markdown formatting (2026-09-27)

- Agent replies render GFM as rich text (`frontend/src/components/Markdown.tsx`:
  `react-markdown` + `remark-gfm`, `skipHtml`, tight allow-list,
  http(s)-only links, house token styles). The system prompt contracts the
  format (bold lead-ins, bullets, tables for counts, code citations, no raw
  HTML). Live probe on "what's going on in our system" returned a bold
  lead-in, count table, bullets, and code spans. Proven in
  `tests/frontend/markdown.test.tsx` (incl. hostile input) and a bubble
  test in `chat-staging.test.tsx`.
- Drive-by fix: backend `typecheck` was red on 6 pre-existing
  `LaneTimeouts` errors (long-form durations vs the SDK's `ms`-typed
  `Duration`; masked by `| tail` in gate output). Table converted to
  short forms with `Duration`-typed fields; timeout pin/test updated.

## Streaming responsiveness: TTFT budget + parallel tools (2026-09-27)

- Measured on the live SSE wire (knowledge question with tool rounds):
  accept +0.1s, first tool frame +2.9s, first reasoning +7.2s, first text
  delta +8.9s with all 16 deltas in a 0.6s provider flush, terminal +9.7s.
  The pipeline forwards incrementally; the silence is provider TTFT plus
  one full latency per tool round — not app buffering.
- Turn logs now carry `firstToolMs` / `firstReasoningMs` / `firstDeltaMs`
  (`KarbotTurnLogFields`; `tests/backend/karbot.turn.test.ts`). Same-round
  tool calls dispatch in parallel via `Promise.all` in `runKarbotTurn`
  (history order stays deterministic; proven in
  `agents/src/turnRunner.test.ts`).
- Instant ack: a Thinking placeholder with an elapsed clock mounts on
  accept while no frames have arrived (stable "Agent is replying"
  aria-label); live running tool rows show in-flight age ("Running · 4s")
  from client-side first-seen stamps — wire frames unchanged. Covered in
  `tests/frontend/chat-staging.test.tsx`.
- Default lane already routes Spark 1.3 models through Responses with
  reasoning summaries; the Activity disclosure narrates tool-only turns.

## Product knowledge corpus + master ledger (2026-09-26)

- Curated corpus in `knowledge_base/` (offer, pricing, icp, problems,
  qualification, funnel, voice) rewritten from the donor repo pinned in
  `third_party/manifest.yaml`; `_migration_map.md` records every source
  disposition. Key encodings: $3–6k/mo is a targeting band never quoted,
  diagnostic entry is the only quotable figure, breadth over
  single-symptom fixation (out-of-stock ads are one example, never the
  research), MECHANISM-or-COST evidence bar, skeptic question per problem.
- Served from Postgres (migration 0008: `kb_documents`/`kb_chunks` with
  GIN FTS, recall-first OR rank with title/topic weight) via the
  `db.kb_search` MCP tool; `node dist/db/cli.js kb-ingest` records
  SHA-pinned versioned batches with supersede history. Cross-run company
  master ledger (`ledger_companies`/`ledger_problems`, one row per
  researched problem) with five `db.ledger_*` MCP tools.
- Corpus accuracy 15/15 on the fixed grounded-retrieval set
  (`tests/backend/kb.eval.test.ts`). Karbot prompt routes product
  questions to `db.kb_search` with `[source_path]` citations. Live
  2026-09-26: "What does Kardata sell and what does it cost per month?"
  executed two `db.kb_search` calls and answered with cited offer/pricing
  facts (proof sessions deleted afterward).

## Meta-only catalog and default (2026-09-26)

- The product no longer lists or accepts the unconfigured second provider.
  Its adapter, config fields, public export, and live probe were removed.
  `GET /v1/providers` queries Meta `/models` and intersects the returned
  IDs with locally verified capability profiles; lookup failure is an
  explicit 503, not a hardcoded fallback. The model PATCH validates against
  that same live availability.
- New unbound chats default to `muse-spark-1.3-contributor`, high effort.
  The picker and Models tab seed high from the server default. Existing
  session bindings remain stored choices until the user changes them.
  Evidence: catalog/route/client tests plus a live Meta `/models` probe.

## Chat quality and streaming follow-up (2026-09-26)

- Tool activity now streams from the provider's tool-call start through MCP
  completion. The turn sink emits a provisional running frame, updates the
  parsed name, then emits a done/failed frame; the
  outbox SSE route carries only call id, name, state, and run key. Chat shows
  an open Activity row before the terminal reply and swaps to durable tool
  rows when projection catches up. Proven with a held MCP call in
  `agents/src/turnRunner.test.ts`, backend frame tests, and frontend
  follower/component tests. These tests use fakes and a test database;
  they do not claim a live provider sent a tool call during verification.

- Recovery: a live session stalled with Temporal nondeterminism after the
  provider and user-message activities were reordered. The
  `session-user-before-turn-v1` patch now replays old history in its recorded
  order and uses user-first for new turns. The affected run resumed, wrote
  its terminal reply, and answered `runState` again. The frontend's
  Replying state now compares message sequences; the prior count comparison
  stayed stuck when SSE resumed with only a short tail. The regression test
  failed before the client fix and passed afterward.

- User messages now persist before the turn activity. Karbot receives up to
  20 prior user/agent text turns from the projected thread plus the current
  message once; it no longer answers each send without conversation history.
  The prompt favors direct answers and grounded tool use, and the advertised
  MCP palette excludes database operations plumbing.
- Provider SSE parsing handles CRLF as well as LF frames incrementally.
  Round-scoped delta keys replace transient text after a tool round, so the
  pending answer does not contain a previous round's pre-tool commentary.
  The chat merges REST pages with SSE messages by thread sequence, so a slow
  history fetch cannot erase a streamed reply. Pending text follows the
  settled messages; a pre-token reply state shows after send acceptance.
  Tool activity and actual provider reasoning share one compact disclosure
  ahead of answer text. Meta's chat wire still supplies no separate
  reasoning trace in the prior live probes, so no Thinking block is invented.
- Evidence: `tests/backend/karbot.turn.test.ts`,
  `agents/src/adapters.test.ts`, `tests/frontend/chat-staging.test.tsx`.
  Live Meta probes on 2026-09-26: Chat first text delta at 9.6 s of a 9.7 s
  turn (2 deltas); Responses first delta at 8.5 s of an 8.7 s turn
  (3 deltas). Neither wire emitted reasoning deltas. The app now has
  incremental SSE parsing and a visible pre-token working state; these
  probes show the selected provider mostly delivers its short reply at the
  end. The adapters now emit a terminal usage event on stream completion.
  `tests/backend/workflows.run.test.ts` passed 5/5 against the live Temporal
  server and a test database after the workflow change. The cancellation
  case now asserts the user request remains in history while the cancelled
  provider reply does not.
- Meta reasoning follow-up: the earlier zero-trace probes used Chat mode or
  Responses mode without requesting a summary. Meta's private raw reasoning
  remains unavailable. The Responses adapter now requests and streams
  `reasoning.summary: auto` for a listed effort, and the registry routes
  Spark 1.3 and 1.3 Contributor through it. Live Contributor probes returned
  summary deltas on a multi-step question (2 deltas) and a tool call plus
  reply completed in 2 rounds. A simpler question returned no summary, so
  the UI shows Reasoning only when a summary actually arrives.

Backend build plan (`documentation/plans/2026-09-25-backend-build.md`):
phases 0–5 implemented; Phase 6 (real frontend cutover) is next.
Sector research surfaces are cut over behind `VITE_STAGING_API=1`
(plan `documentation/plans/2026-09-25-sector-domain.md`); chat is cut
over too (`frontend/src/components/ChatPanel.tsx` reads sessions,
threads, messages, files, and runs from the API and sends through
commands, with empty states when the flag is off — no mock rows
anywhere on the path). The stats strip is an explicit not-connected
notice with no numbers (`Dashboard.tsx`); no approvals surface exists
yet (chat renders text/tool rows only, and the approve command has no
card renderer). Phase 6 (real frontend cutover) finishes the rest.
Behavioral detail lives in `docs/architecture.md`; this file records
scale claims with evidence links.

## Phase 2 backend MCP server

- `POST /mcp` (Streamable HTTP, stateless JSON) with 45 tools over the db
  layer (`backend/src/mcp/`: thin route, bindings, zod schemas from the
  layer schemas), existing API-key auth with per-tool role floors,
  `Idempotency-Key` replay, projector-only functions unbound, no SQL in
  the server; spec parity via `mcpRpc` in `backend/openapi/v1.yaml`.
- Evidence: `tests/backend/mcp.tools.test.ts` (11 tests, fake/di doubles).
  No live keys in any environment: everything above runs without provider
  credentials or network calls.

## Phase 1 provider/model selection

- Per-session `PATCH /v1/sessions/{id}/model` (append-only `t.session.model`,
  read-back on `GET` session), verified Meta capability profiles and live
  `/models` availability, `GET /v1/providers` (catalog + key
  booleans only), and gateway per-message resolution with env fallback.
- Evidence: `tests/backend/api.session-model.test.ts` (6 tests, live DB),
  `tests/backend/providers.registry.test.ts` (8),
  `tests/backend/providers.selection.test.ts` (10); OpenAPI parity via
  `tests/backend/contract.test.ts`. No live keys in any environment:
  everything above runs on fake/di doubles.

## Phase 3 Karbot turn

- `agents/src/turnRunner.ts` (exported from the barrel): dependency-free
  streamed model/tool loop over injected provider + MCP client + delta
  sink (`StreamableMcpClient` over injected endpoint/credential,
  `createClosedMcpClient` fallback); `backend/src/temporal/activities/turn.ts#karbotTurnActivity`
  wires it into the worker with the per-session model (Phase 1), ephemeral
  `delta` outbox frames, heartbeats, cancellation, and key-free logging.
  `sessionRun` and `subagentRun` both call it; the scripted
  `runTurnActivity`/`runChildTurnActivity` are retired (exported for
  history, unreachable from mounted chat). No OpenAPI change (no routes).
- Evidence: `agents/src/turnRunner.test.ts` (7 tests, fake + in-memory
  doubles), `tests/backend/karbot.turn.test.ts` (5 tests, injected deps),
  Temporal suites on `fakeSteps` doubles (`workflows.run`,
  `workflows.subagents`, `api.live`, `temporal.heartbeats` — gated by
  `KARDATA_TEMPORAL_TEST=1`). Deployment enables tools with
  `KARDATA_MCP_URL` + `KARDATA_MCP_TOKEN`; the live MCP handshake is
  integration-verified later, not unit-proven.

## Session chat live (2026-09-26)

- First send starts the session workflow: `temporal/gateway.ts`
  signal-with-starts `sessionRun` (`session-run-<id>`, turn lane) instead of
  404ing; child targets keep the strict signal. Proven by
  `tests/backend/temporal.session-start.test.ts` (2 tests) and a live
  send → 202 → persisted user + genuine Meta reply on the thread.
- Dev worker: `backend/src/temporal/dev-worker.ts` (`npm run worker`),
  turn lane only; manual process, see `docs/environments.md`. Provider keys
  reach Compose via `env_file: ../agents/.env` (`deployment/compose.yaml`).
- Meta catalog mirrors the provider's own `GET /v1/models` (live-verified
  2026-09-26): exact wire ids as display names, reasoning `native` only
  where live usage showed reasoning tokens; transcription and SAM image
  models are excluded from chat.
  The old chat/responses duplicate entries (same id twice) are gone.
- Reasoning effort (2026-09-26): Meta Spark models list
  `minimal/low/medium/high/xhigh` (live-verified token scaling; `none`
  rejected by the provider). Effort flows
  catalog → `PATCH /v1/sessions/:id/model` (validated, 400 on unlisted)
  → stored event → `resolveEffectiveSelection` (default `high`) →
  `runKarbotTurn` → `reasoning_effort` wire field.
  Chat picker shows an Effort section for effort-models, the Models tab an
  Effort select; both UIs render any provider generically from the
  endpoint, with no per-provider branches.
- Meta adapter fix: empty system prompts no longer send a content-less
  system message (live-verified Meta 400); regression in
  `agents/src/adapters.test.ts`.
- Browser CORS (2026-09-26): the hijacked SSE thread stream skipped the
  CORS hook, so browsers blocked it and sent messages never appeared (no
  local echo by design); `corsHeadersFor` now reflects the allow-list on
  the raw socket, and `PATCH` joined the preflight allow-methods (the
  model picker is the UI's only PATCH, and could never save). Proven with
  headless Chrome: stream flows, model PATCH 200s, trigger rebinds.
- Enter-while-replying (2026-09-26): the Stop button replaces Send, so
  Enter died silently; `composerKeys` now sends explicitly in that state
  only (native submit owns Enter otherwise — no double-post).
- Session delete (2026-09-26): `DELETE /v1/sessions/:id` stops the
  session workflow (best-effort cancel) and appends `t.session.deleted`;
  list/get/rename/model/send hide or 404 the tombstone while history
  stays in the log. Header trash button plus per-row trash in the Chats
  list (hover/focus reveal, two-step confirm each). Proven by
  `api.rest.test.ts` (cancel signal, hidden reads, 404s, double-delete)
  and live create → delete → 404. Preflight allow-methods covers PATCH
  and DELETE (browser-verified row delete end to end). Cancelling a
  closed workflow handle reports the run gone instead of 500ing
  (`signalRunCancel`, unit-proven; also fixes run Cancel on dead runs).
- Stuck Replying after replacement runs (2026-09-26): event idempotency
  keys were `session:scope:nonce` with the nonce restarting at zero, so a
  replacement run (signalWithStart after the previous run finished)
  reused the old run's keys and its fresh user/reply messages were
  swallowed as duplicates — the terminal `message` frame never arrived,
  so the stream's pending text never cleared. Keys are now
  `session:runId:scope:nonce` (`backend/src/temporal/workflows/run.ts`);
  regression in `tests/backend/workflows.run.test.ts`, live-proven with a
  real Meta turn after cancel (cancel → send → both replies persisted).
- Lazy outbox projection (2026-09-26): the projector is request-scoped
  with no background worker, so `t.message.appended` events sat
  unprojected until an unrelated read ran — a live tail received deltas
  but the terminal message frames only minutes later (measured 3 min on
  live-005), wedging Replying. `appendEventActivity` now projects
  immediately after appending (both sides idempotent); live-measured
  send → terminal frame in ~4 s. Regression in
  `tests/backend/workflows.run.test.ts` (frame in outbox with no read).
- Chat streaming + status truth (2026-09-26): the provider wires
  buffered the whole SSE body before parsing, so replies flushed at turn
  end instead of streaming (`readSseData` now parses incrementally in
  `agents/src/transport.ts`, shared by the responses wire); streamed tool
  rows dropped their name/detail/state client-side and rendered as
  nameless permanent "Running" rows (`toLiveMessages` passes them
  through); the echo caption read "Sending…" even after accept (now only
  while the POST is in flight). Covered by streaming tests in
  `agents/src/adapters.test.ts` and echo/tool tests in
  `chat-staging.test.tsx`. Live-measured first delta mid-turn.
- Chat responsiveness + tool order (2026-09-26): the sent message now
  echoes instantly with a Sending caption and hides when the confirmed
  copy lands (count-based dedupe, never a duplicate); turn tool calls
  append chronologically (user, tools, reply) instead of trailing at the
  bottom; consecutive tool rows fold into one collapsible "N tool calls"
  group with aggregate status; the Thinking block gets an icon header.
  Covered in `chat-staging.test.tsx` (echo, grouping) and
  `workflows.run.test.ts` (append order).
- Turn heartbeat race (2026-09-26): 5 s beats against a 5 s lane
  heartbeat timeout, so every tool-using turn (two provider rounds, 7 s+)
  spuriously timed out, retried healthy attempts (ghost deltas from
  orphaned attempts), and errored the run (`Activity task timed out` on
  the long status reply). Turn lane is now 20 s with the 5 s cadence
  pinned as `TURN_HEARTBEAT_MS`; margin guarded in
  `tests/backend/temporal.timeouts.test.ts` (≥3x). Live-proven with a
  9.6 s two-turn MCP reply, attempt 1, no retry.
- Stalled tail after idle (2026-09-26): a browser SSE connection that
  went half-open during an idle gap delivered deltas but never the
  terminal `message` frames, so the sent message stayed invisible and
  Replying never cleared (backend had everything). `openThreadStream`
  now aborts a tail silent past `STREAM_IDLE_TIMEOUT_MS` (30 s; the
  server pings every 15 s) and `followThread` resumes from its last
  token — the missed frames replay and the terminal message clears the
  state. Regression in `tests/frontend/staging-sectors.test.ts`
  (silent-stream reconnect).
- Thinking blocks (2026-09-26): the pipeline only renders genuine
  provider traces (`reasoning_delta` → reasoning outbox frames → Thinking
  block; covered in `karbot.turn.test.ts` and `chat-staging.test.tsx`).
  Live-verified that Meta Spark on the chat wire emits no separable
  trace at low or high effort (deltas carry `content`/`role` only; its
  step-by-step stays inline in the reply), so no Thinking block appears
  there. Meta Responses summaries now render when the provider emits them.

## Phase 4 frontend Models tab

- `Models` sidebar section (`frontend/src/components/ModelsPanel.tsx`,
  mounted from `App.tsx`): session picker bound to the active session,
  provider cards with Live/Unconfigured key state, per-provider model
  picker, reasoning control disabled where the capability is `none`,
  and save through `PATCH /v1/sessions/{id}/model` with the stored
  triple read back on the banner. Full
  loading/empty/error/denied/offline states; no mock data.
- Chat header toolbar (`frontend/src/components/ModelToolbar.tsx`,
  mounted in `ChatPanel.tsx` under the session header): picker menu bound
  to the open session — trigger shows the current provider + model with a
  Thinking badge, the menu groups every catalog model by provider with
  search, checkmark, key state, and a Thinking switch (disabled where the
  model has no reasoning capability). Hovering or focusing a model row
  opens a portal side flyout with its effort levels (viewport-anchored,
  never clipped or overlapping the list; collapses on scroll-out);
  effort lives only there, not in the menu footer. Seeded from
  the stored binding, every
  change saved immediately through the same PATCH route. Hidden until a
  session is active; stays out of thread views.
- Client: `listProviders` + `setSessionModel` in
  `frontend/src/data/staging-api.ts` with zod validation against the
  OpenAPI `SessionModel`/`ProviderCatalog` shapes; `Session` gains the
  optional `model` field. No OpenAPI change (existing routes only).
- Evidence: `tests/frontend/models-staging.test.tsx` (8 tests, stubbed
  fetch), `tests/frontend/models-api.test.ts` (6 tests, stubbed fetch);
  frontend `typecheck`, `test`, `build` green and the new files `lint`
  clean (repo lint stays red on pre-existing `set-state-in-effect`
  errors in `ChatPanel`, `RunsPanel`, `research.ts`). No live keys in
  any environment: everything above runs on stubbed fetch.

## Scale claim (B5.6)

- 1000-agent synthetic soak: 105/105 induced stalls detected, 0 missed,
  0 false positives on healthy agents; sweep p99 1ms against a 10s budget;
  fleet usage and cost exact to the token/cent; fleet gauges match ground
  truth. Thresholds held at defaults (no retune).
- Evidence: `tests/backend/soak.report.md` (numbers), produced by
  `tests/backend/soak.harness.test.ts`.
- Boundary: harness-seeded heartbeats/usage; no live Temporal fleet.
  Live-fleet behavior stays covered by
  `tests/backend/temporal.lanes.test.ts`.

## Browser pool (facade, 0-16)

- Single entry for every agent browser request
  (`backend/src/browserPool/facade.ts`): MCP retrieval tools and the
  sweep chain route through it; tool names, schemas, roles, and `via`
  tags unchanged. Bounded slots (0–16, `KARDATA_BROWSER_MAX` default 8,
  FIFO queue 64, per-caller cap 4, one in-flight per host),
  saturation rejects `overload` without evicting holders. Query pages
  (5 min) and documents (10 min) cache with in-flight dedup; cursors
  live outside slots. Direction source: owner antibot research
  (tier-escalation, profile/proxy tiers deferred — P1 is Chromium-only
  on existing legs, no new deps/services).
- Evidence: `tests/backend/browser-pool.test.ts` (7 tests, stub legs);
  `tests/backend/sweep.search.test.ts` gains cache/pool isolation in
  setup (red-to-green: first-test cache answered later stub tests);
  retrieval + mcp.tools suites green unchanged; backend lint/typecheck
  green. Live browser proof still gated on `KARDATA_BROWSER_TEST=1`.

## Browser pool live proof (2026-09-30)

- Hermetic: `tests/backend/browser-pool.test.ts` 9 tests (stub legs).
- Live: `KARDATA_BROWSER_TEST=1` retrieval suite caught real drift —
  example.com dropped its "Example Domain" heading, so the test now
  pins the structural iana.org link + non-empty snapshot instead of
  third-party copy (test side fixed, product side correct). New gated
  test holds 2 real Chromium sessions at max 2, rejects the 3rd with
  `overload`, serves holder snapshots under saturation, closes back to
  0 — 10/10 live green.
- Full live backend (DB + Temporal + compose + browser gates):
  453 passed, 2 load-flaky (compose Loki /ready, loopguards attempt
  bound — both green isolated, matching the documented flaky
  categories), 1 skipped. Agents live probes 3/3 on the real Meta key.
- Still open: live sweep discovery needs `KARDATA_WEB_SEARCH_KEY`;
  UI-driven journeys J1–J8 need the monitoring harness (planned, not
  built).

## Pilot 01 live UI walk (2026-09-30)

- First live journey on the staging stack (vite 5173 + compose
  backend, zero interception): Researches paint 268ms, draft create
  102ms, detail open 38ms; zero console errors, zero failed /v1/*
  requests. Proof: `tests/frontend-e2e/pilot-live.spec.ts` (gated on
  `KARDATA_LIVE_JOURNEY=1`, skips cleanly otherwise) plus
  `tests/evidence/pilot-01/journey.json`; shots stay local per
  `.gitignore` (repo convention: zero PNGs tracked).
- Obvious issue #1 confirmed live: the create form says "research
  starts only when you press Start" but no Start button exists
  anywhere (startSector/restartSector are client-only dead code).
  Fix lands next as Start (draft) + Restart (failed) buttons.

## Pilot start button + follow poll (2026-09-30)

- Dead-end Start closed: the chat strip now offers Start (draft) and
  Restart (failed) beside Pause/Resume, wired through the previously
  dead `startSector`/`restartSector` client calls. Obvious issue #2
  fixed in the same pass: the detail page froze at "queued" because
  nothing re-read — detail + company window now poll every 5s while
  queued/running and stay quiet otherwise.
- Live journey proof: draft → Start → running visible in 5.4s →
  Pause → paused in 75ms, zero console errors, zero failed requests,
  light + dark strip shots. Evidence: `tests/evidence/pilot-01/`
  (journey.json committed, PNGs local per convention).
- Gates: SectorChatPanel 24/24, SectorDetailPage 23/23 (failing-first
  both), full frontend 238 passed, lint 0 errors (5 pre-existing
  warnings), typecheck + build clean.

## Sweep lifecycle honesty (pause halts, resume/restart ensure)

- Live pilot finding: Pause only relabeled — the sweep kept running and
  flipped to failed; Restart relabeled failed→running with no run
  behind it. Now pause cancels `sector-sweep-{id}` before recording
  paused, resume/restart start the workflow before recording running
  (closed runs restart under the same id, live ones accepted, never
  duplicated). Cancelled runs propagate instead of writing failed over
  the pause. Runner-less and worker-down paths fail closed (overload).
- Evidence: `tests/backend/sector-lifecycle.test.ts` (8 stub-DB order +
  fail-closed tests), `isSweepCancellation` in sweep-rules (+matrix),
  live Temporal cancel test (sector never failed), route lifecycle
  assertions in `tests/backend/api.sectors.test.ts`, MCP pause/resume
  re-pinned in `tests/backend/sector-start.test.ts`.

## Delegation door (db.delegate_subagent)

- Production could run subagents but nothing could launch one
  (parentDelegate had zero production signalers; Karbot had no tool).
  Now the Karbot-only operator tool launches leaf researchers:
  gateway signal-with-starts the session parent on the turn lane,
  waits for the child, feeds the goal as first work (an empty inbox
  idles forever — proved live during development). Depth 0/maxDepth 0:
  pilot children research, never delegate.
- Two live-caught issues fixed in the pass: one Worker per task queue
  per process is illegal — the turn worker loads a turn-bundle
  aggregator instead of a third worker; worker MCP unreachable at boot
  was a backend-not-ready race (per-turn resolution is unaffected).
- Evidence: `tests/backend/subagent-delegate.test.ts` (5 hermetic),
  `tests/backend/workflows.delegate.test.ts` (live Temporal+DB, fake
  provider), live single-child proof via the real tool path
  (`tests/evidence/pilot-01/delegate-live.json`: goal in, 'door live
  ok' out in ~30s on the first poll).

## Bing keyless engine (free discovery unblocked)

- Live probe 2026-09-30: DuckDuckGo times out at network level and
  Mojeek serves challenge pages from both local networks, but Bing
  serves full result pages (200, real cites) from both. Google serves
  a result-less shell to plain fetch. New `bing` engine first in the
  keyless pool (redirect-wrapper decode with version-prefix tolerance,
  hostname fallback titles, Bing hosts excluded from candidates).
- Two live-caught parser bugs fixed in the pass: the challenge regex
  rejected good pages on ordinary copy ("challenge") and on Bing's own
  element ids (cf-turnstile-wrapper) — markers now name bot-wall
  machinery only, with zero-hits as the backstop.
- Evidence: fixture test (both wrapper variants) + live keylessSearch
  (5 Bing hits in 403ms, real titles and decoded URLs).

## Pilot complete: 20/20 verdicts (2026-09-30)

- Sweep (Bing engine, laptop worker): COMPLETE, 100 companies in ~2
  min — precision 0% on audit (gambling spam, blogs, media pages).
  Templates too broad + zero relevance gate. Follow-up: relevance-gate
  PR + template shaping before any production discovery.
- Instruction obeyed (10 delegate calls) but 20 children ran: turn
  re-execution duplicated the fan-out. Follow-up: turn idempotency +
  timeout analysis with workflow history.
- Vendor saturation: 20 concurrent research turns -> mass
  provider_failed; 2/20 succeeded. Recipe that works: one company per
  child, terse reply, max 6 tools, max 2 concurrent — verdicts land in
  ~1-2 min. Follow-up: paced fan-out with vendor semaphore.
- Empty replies on oversized briefs (ok:true, no text); tiny briefs
  land. Follow-up: research-turn output budget review.
- Grading: 20/20 form-compliant (7 headings, <150 words, uncertain
  marked, zero invented facts). Distribution 20 no — the
  mechanism-or-cost bar working as designed. Depth tracks readability.
- Evidence: `tests/evidence/pilot-01/` (journey, companies, run-notes,
  verdicts.md, 20 verdict files, delegate-live proof).

## Relevance gate for sweep precision

- Pilot audit: 100 sweep companies, ~0% precision (gambling spam,
  blogs, media). Templates were broad and extraction recorded every
  domain. Now `sectorSignals` derives match vocabulary from the topic
  (never the name stamp; stopwords/numerics dropped, plurals folded,
  capped at 12) and `extractNewDomains` keeps only hits evidencing a
  signal across title, snippet, URL, or domain tokens. Unsignaled
  extraction stays unfiltered (back-compat); brand-only empties drop
  (documented recall cost).
- Evidence: `tests/backend/sweep.rules.test.ts` (signals + keep/drop/
  back-compat), live Temporal `tests/backend/workflows.sweep.test.ts`
  (gated sweep still lands 2/2 via snippet matching; off-topic sector
  records 0 and completes honestly).

## Turn budgets fit agentic turns (fix for 20-for-10 duplication)

- Workflow history proof: the pilot's 10-delegate turn ran
  karbotTurnActivity TWICE (60 s start-to-close vs minutes-long fan-out
  + 26–85 s provider rounds) and each attempt launched 10 children.
  Turn lane now allows 15 m start-to-close / 20 m schedule-to-close
  (heartbeat stays 20 s for dead workers). Crash-duplication remains
  possible but rare; turn-level tool idempotency is the follow-up.
- Note: a root-owned stale worker (pid 2503187, pre-fix code) squats
  the turn lane and cannot be stopped without sudo — live proof turns
  may land on it until it is gone; history attempt-counts tell which
  worker served each turn.

## Vendor pacing: turn activities capped at 4 per worker

- Pilot: 20 concurrent research turns saturated the live provider
  (mass provider_failed, 60–190 s latencies); 2-way succeeded. Turn
  lane now runs 4 concurrent activities per worker — queued turns wait
  inside their schedule-to-close windows instead of storming the
  vendor. Workflow tasks stay at 50 (cheap orchestration).
- Evidence: `tests/backend/temporal.vendor-pacing.test.ts` (pin) +
  fleet-load 10/50/100/1000 green through the cap in the author live
  run 2026-09-30 (paced thousand-scale throughput with scripted
  provider). Raise only with measured provider headroom.

## Research wall clock 300s to 600s

- Pilot evidence: successful research turns ran 160–327 s; the 300 s
  wall cut the tail. RESEARCH_TURN_WALL_MS (600 s) pinned in
  `tests/backend/karbot.turn.test.ts`. Empty replies on oversized
  briefs stay open (brief discipline is the proven recipe); the budget
  decides run length, not writing.
- Live proof: second independent Tyro verdict under the new ceiling
  (agreement datum against the pilot's first).

## Restart policy for app services (sidecar death)

- Pilot: the browser sidecar died (exit 132) and stayed dead — no
  service in compose had a restart policy. backend, worker, and
  browser now carry `restart: unless-stopped`; infra (db, temporal,
  observability) keeps its operator-managed lifecycle.
- Live proof: SIGTERM to the sidecar init (the pilot's internal-crash
  shape) restarted it automatically (restarts=1, running). Note:
  daemon-level `docker kill` cancels the restart manager by design —
  that path is operator action, not a crash, and stays down.

## Signal pruning (precision follow-up)

- Live gate-check sweep: 9 companies, ~1/9 payment-relevant — the
  `sme` signal admits chambers, ministries, and medical schools.
  Generic tokens now prune when specific signals exist (never to
  empty); `business`/`class` survive the plural fold (`ss` guard).

## Signal pruning A/B: reverted (recall stage wins)

- Pruned gate (`payment`-only) live: 1 company, 0 intent-relevant —
  starves the funnel. Unpruned gate: workable candidate sets the
  research verdicts grade precisely (20/20 pilot verdicts, all honest).
  Sweep stays the recall stage; verdicts are the precision arbiter.
  Bing block-parse with snippets kept (recall aid that survived).

## Plan-mandatory states (P1)

- SectorState gains planning/planned/approved (migration 0013, CHECK
  round-tripped live); SECTOR_TRANSITIONS pins the full lifecycle with
  draft→queued kept only as the P4 interim (approval enforcement
  removes it). Frontend types/labels/tones + OpenAPI enums updated;
  companies filter unchanged (companies never plan).
- Live proof: draft→planning→planned→approved→queued walk on Postgres
  with projections + state filters; migration down/up round-trip.

## Planning run: route, workflow, artifact, read (P2)

- POST /v1/sectors/:id/plan (operator, idempotent): creates a visible
  "Research plan" sector chat, moves draft/failed to planning via the
  planSectorResearch protocol (pin-checked, fail-closed, compensating),
  starts one sectorPlan workflow per sector. GET /v1/sectors/:id/plan
  reads the versioned artifact (empty until planned); OpenAPI carries
  both routes plus PlanVersion/SectorPlan shapes.
- sectorPlan: sector context, one Karbot turn in the planning chat
  with the six-heading brief, artifact write (idempotent versions),
  terminal planned/failed; cancellations propagate without state
  writes. Research lane serves a research-bundle aggregator (sweep +
  plan) the same way the turn lane serves its turn-bundle.
- Evidence: stub-DB protocol tests, brief-shape tests, live Temporal
  planned + empty-failed branches, live route tests (visible chat,
  conflict, empty/read/ 404).

## Plan panel + strip rewiring (P3)

- Strip is plan-mandatory: draft/failed offer Plan, approved offers
  Start, planning/planned/queued show labels. Plan panel renders the
  versioned artifact (loading/empty/error/denied/offline states),
  re-reads while planning, and offers Plan on drafts/failed.
- Live journey plan-01: draft → Plan → planning → planned in 85 s
  with a readable v1 artifact (scope/shards/shapes with uncertain
  marks), zero console errors, zero failed requests, light + dark.
- Two live-caught integration gaps closed in the pass: plan turns must
  route to the turn lane explicitly (research worker has no turn
  activities), and the gateway must forward the planning sessionId.

## Plan approval + start enforcement (P4)

- updateSectorPlan (operator tool, both palettes): versions edits on
  planned sectors; edits after approval re-open review to planned
  (approval always pins the exact text seen). approveSectorPlan:
  route-only by design (owner presses in UI) — pins an existing
  version, planned to approved; unknown versions fail loudly.
- startSectorResearch now requires approved (P1 interim removed from
  the map); compensation returns to approved. GET plan carries
  approvals + approvedVersion; OpenAPI covers approve + shapes.
- Evidence: stub-DB update/approve tests, rewritten start tests,
  live route plan→approve→start flow, MCP parity (66 tools).

## Run console + steer composer (P5)

- RunConsole on the detail page: timeline from the followed detail,
  sector-wide steer targets (every chat pool session plus subagent
  threads, capped at 20 sessions), Send/Steer composer behind an
  explicit Review step with missed_steer honesty. Threads failures
  degrade to inline notes; the timeline always stands.
- Live proof plan-02: real 265-company timeline, target picker,
  dispatch accepted, zero console errors, zero failed requests.

## CI e2e flake on PR #32 (scale 1000 walk, 5 s visibility timeout)

- First CI run failed scale.spec.ts (final 'Showing 1000 of 1000'
  not visible in 5 s after ten 100-row windows); local run 34/34
  green and CI rerun green with no code change. Root cause: CI
  slowness under windowed loads, not the console (which adds only
  sessions/threads reads and degrades inline). No product change;
  recorded per the red-suite rule.

## Plan approval UI + full lifecycle journey (P6)

- Panel Approve (planned, per version) and edit box (planned/approved,
  re-opens review); App approve/edit handlers; strip unchanged.
  PATCH /v1/sectors/:id/plan route + OpenAPI for owner edits.
- Live journey plan-03: create → plan (75 s) → edit to v2 → approve
  → start (5 s) → steer dispatch → pause → resume → complete
  (10 s sweep), zero console errors, zero failed requests, shots at
  every state. Evidence: tests/evidence/plan-03/.

## Session files + document query + compaction (backend slice of antigravity revamp)

- `querySectorDocument` layer + `db.query_document` (viewer, both
  palettes): TOC summary default, query/ords chunk slicing; visibility
  always passes through the owning sector (unscoped ids resolve the
  owner first). Proven by stub-DB tests + MCP parity samples.
- `createArtifact` layer + `db.create_artifact` (operator, both
  palettes) + `POST /v1/sessions/:id/artifacts` (201, idempotent):
  unknown sessions fail before any byte lands. Archive target plumbs
  through `kardataArchive` into the MCP server. Proven by hermetic
  layer tests + live route tests incl. serve round-trip.
- `compactSectorContext` + `POST /v1/sectors/:id/context/compact`
  (operator, idempotent): multi-note merge into one bounded summary
  (truncation marked); single-note reruns report compacted:false.
  `POST /v1/sessions/:id/compact`: extractive marker over condense
  with a deterministic key (retries replay, never duplicate); short
  histories report honestly.
- Spec: three POST ops with ids + idempotency keys (contract suite
  green). Docs: binding rows + this entry in the same change.
- Finding (pre-existing, not this change): PATCH context maps unknown
  sectors with `startsWith('unknown sector')` but layer messages carry
  the `db contract:` prefix, so it answers 400 instead of 404. The new
  compact route matches with `includes`. PATCH fix is a follow-up.
- Deferred to the agents pass: `TurnMode 'plan'` prompt/skill text
  (gateway union widened already), tokenCap retune, frontend
  surfaces (Files tab, Plan mode, approval cards, pillar tabs stay in
  the stashed revamp tree).

## Hardening regressions: report attempts and stream overflow (2026-10-01)

- Immutable report IDs now include the owning workflow run, so a new acceptance
  attempt after an archive-success/checkpoint-failure window preserves the earlier
  report instead of conflicting with its bytes. The isolated real-DB activity
  recovery regression passed; this proof does not exercise a live Meta provider.
- Company polling retains loaded windows and de-duplicates overlapping IDs while
  paging by raw row offset. Three hook regressions and the browser polling
  regression passed.
- Overflow snapshots previously skipped terminal messages while advancing the
  stream token. Recovery now drains 200-row REST pages, including hidden-only
  pages, and advances the token only after hydration. The stream recovery battery
  passed 21 cases. UI evidence is captured by the
  maintained workspace overflow scenario; The full browser matrix passed 50 cases with 4 explicitly live-gated skips;
  release-wide verification remains open.
- The gate caught two ref writes during render in company-window reset. Resets
  now run in a query-identity effect; all three window regressions pass.

- Independent review found cursor-only EOF recovery lost steering receipts and
  streamed prefixes. The resumed follower now retains the full accumulator.
  Review also found overflow skipped receipts: a scope-checked durable receipt
  page endpoint now restores consumed/missed outcomes before snapshot acceptance.
  Focused frontend recovery tests passed 13; scoped HTTP/contract battery passed
  29 against isolated Postgres. Full gates are rerun after these changes.

- Latest complete local gates: pr:verify frontend 301/6 skipped, agents 202,
  backend 373/243 skipped; Postgres battery 555/59 skipped; selected real
  Temporal recovery/planning 28 passed; browser matrix 52/ 4 live-gated skips.
  Backend build passed separately. Independent reviewer verified 13 isolated
  DB/HTTP cases and cleared both stream findings after fresh recovery tests.
  No deployment, merge, complete audit, or Meta pilot is claimed.

- The release catalogue gate was watched fail on 431 pending file reviews.
  This is an explicit unfinished acceptance requirement, not a weakened gate.
  Curated UI binaries remain local under the existing ignore convention; remote
  PR binary attachments remain outstanding.


## Document publication recovery (next slice, 2026-10-01)

- Real Postgres fault injection reproduced a visible document and partial units
  after the second unit failed. Twenty concurrent identical uploads produced 13
  separate IDs. Both tests failed before the fix; archive-offline denial passed.
- Document row, units, and archive reference now publish atomically in one SQL
  statement. New IDs derive from sector/version identity; legacy matching IDs
  are adopted without deleting duplicates or history. No new index/schema.
- The focused live battery passed 19 cases and typecheck passed. The new DB
  trigger tests use only their fresh isolated database and retain archive bytes.
  UI upload/retry verification and wider gates remain required for this slice.

- The full battery caught a compatibility error in the first atomic-ingest draft:
  a 69-character derived ID exceeded the existing 64-character unit-reference
  contract. IDs now use a 48-hex-character prefix (53 total), with the full hash
  checked on conflicts. The existing context include/exclude route test remains
  unchanged as the independent contract oracle.

- The stricter real-HTTP browser gate caught first-load initialization being
  marked complete by an abandoned React request. Only confirmed denied ensures
  are cached now; idempotent concurrent ensures can both return their binding.
  The same browser heading guard that failed before now passes before upload.
- Legacy random-ID/partial-index repair regression passed, preserving the exact
  old ID and filename while completing its units and original-byte reference.
- The original draft commit's cloud verify, e2e and isolated integration jobs
  all passed. The additional file-browser CI step is not claimed green until
  its next remote run completes. Deployment/provider/release gaps remain open.

- The concurrent full-DB run hit the unchanged 10-second synthetic soak setup
  deadline while browser/build gates competed for host resources. Sequential
  live DB verification then passed 559/59 gated skips in 15.80 seconds. No test
  deadline or assertion was weakened. Run live DB gates sequentially on this
  development host; the contention failure remains recorded.
- Latest browser matrix passed 53/ 4 live-provider skips; pr:verify passed 876
  deterministic cases/253 gated skips. Independent review repeated mechanical
  gates and eight isolated ingestion/context cases successfully.

- Screenshot review exposed a generic "internal error" upload banner. The exact
  recovery-copy browser assertion failed before the UI fix; server upload errors
  now explain choosing the file again and retaining existing files. Technical
  failure codes remain in backend logs. The file state is still checked against
  real HTTP status, Postgres rows, and downloaded bytes.


## Read-only historical replay availability (2026-10-01)

- Added a maintained read-only SDK replay gate pinned to main baseline e454d44's
  timestamp (2026-09-30T16:44:46Z). It never starts workflows or activities.
- Initial harness path incorrectly doubled backend/ under npm workspace cwd;
  fixed to resolve the repository from the test module, not process.cwd().
- Three pre-baseline sessionRun and three subagentRun histories replayed with
  current code. They are historical test runs, not owner Meta-pilot evidence.
- companyResearch, sectorPlan, sectorSweep and sectorCoordinator had no retained
  pre-baseline histories in the queried namespace. Four checks fail explicitly
  on this unavailable evidence; no compatibility pass or worker rollout is
  claimed. The cutoff was not relaxed to collect newer hardening-test histories.
- The file-ingestion follow-up's cloud verify, e2e and integration jobs passed,
  including standalone browser typecheck and production HTTP/DB/archive journey.
  CI browser artifacts are linked from PR #36; the full release remains blocked.


## Karbot context-read parity (next slice, 2026-10-01)

- Two real MCP/HTTP regressions failed before fixes: general Karbot could not
  read its own local context and the global-context tool accepted no sector
  selector for general chats. Local reads now use validated own-thread identity;
  explicit sector selection reads approved scoped context only. Sector actors
  cannot select another sector; pending proposals remain source/parent-private.
- No approval, owner decision, or research authority is gained from arguments.
  Focused gates and UI-driven agent verification remain required for this slice.

- The MCP text-only SQL guard flagged the English verb "select" in the new
  description. The description now says "provide sectorId"; no SQL boundary or
  test was weakened. All production reads continue through the DB layer.

- Context-tool MCP/HTTP battery passed 40 cases; backend typecheck passed.
- The real chat UI journey passed over HTTP/Temporal/MCP/Postgres with a scripted
  provider. Both real tool responses contain the expected scoped context, and
  both durable tool summaries are done. Send returns only after the terminal
  message, while the server stream remains open. It is not a Meta journey.
- Harness failures were root-caused: wrong Open-chat button label, closed-page
  teardown aborting resource cleanup, and checking DB projection before terminal
  commit/catch-up. Cleanup is now nested and projection catches up before reads.
  One exact inventoried test-owned orphan (isolated queue, UUID/run ID verified)
  was terminated after the failed teardown; no shared workflow or data was deleted.

- The full agent browser matrix exposed a slow composer bootstrap. Inspection
  showed session-filtered run reads enumerated/described the entire Temporal
  namespace, including thousands of unrelated stress-test histories. A bounded
  directory regression failed on that enumeration before the gateway fix. Session
  reads now describe their recorded graph and retain legacy self-scoped research
  compatibility. Full browser and gateway gates are being rerun.

- Scoped run-directory regressions passed two cases without network dependencies:
  no unrelated fleet enumeration and preserved explicit legacy research identity.
  The full browser matrix then passed 54/ 4 Meta-gated skips within the unchanged
  interaction deadline. Unfiltered fleet enumeration remains an operating-limit
  gap; no whole-system scalability claim is made.


## MCP replay and general-child authority (2026-10-01)

- Two transport regressions failed before fixes: a cached read returned private
  context despite an invalid execution signature, and a retry of a completed
  mutation conflicted solely because its JSON-RPC ID changed.
- Bindings/grants are checked before replay lookup; reads are fresh, mutations
  use semantic request plus authority identity, and reply IDs are rebound. A
  repeated hidden-file read after UI hide is denied. Legacy records lacking
  authority identity are not silently replayed; reconciliation/rollout remains
  an explicit gap before worker deployment.
- A general-chat child could read its parent transcript because isolation only
  applied to sector-bound parents. The maintained test failed before the fix;
  own-thread/parent-session checks now also apply without a sector binding.
- Focused HTTP/DB/transport/gateway battery: 53 passed. Fixtures were corrected
  to use a real mutation for replay (reads intentionally re-evaluate visibility)
  and to parse the existing string RPC builder rather than spreading its bytes.
  No test authority/visibility rule was weakened.

- Independent review found parent renaming still allowed for general children
  and missing-runner failures cached permanently. Both regressions failed before
  fixes. Child naming is now owner/parent-only. Only explicit server-typed
  pre-dispatch dependency failures release replay guards; ordinary uncertain
  mutation errors remain recorded and do not execute again. Existing DB-contract
  error compatibility is retained while the wire marks the retry-safe condition.

- Independent review found completion-record failure could release a guard after
  a real committed mutation. Two fault-injection regressions failed before the
  fix (completion-store loss and handler error after commit). Unknown outcomes
  now retain guards, emit correlated uncertain-operation logs, and return an
  uncertainty header; the same operation does not run again. Explicit typed
  pre-effect failures still recover safely. Focused six-file battery: 70 passed.
- The wider battery caught a changed missing-runner phrase; restored the pinned
  "no sweep runner" wording without weakening its fail-closed assertions.
  Uncertain-operation reconciliation/UI and legacy replay migration remain
  acceptance gaps; an in-progress guard is not claimed to be an active worker.

- Final watched follow-up gates: deterministic 878/269 gated skips; Postgres
  571/65 skips; browser 54/ 4 Meta skips; backend build and contract 18 passed.
  The matching OpenAPI now describes semantic MCP replay, fresh reads, uncertainty
  headers and the actual 409 error envelope. Independent focused guard review
  passed 55 cases. Full audit, legacy-history/cache compatibility, uncertain-operation
  reconciliation/UI, scale failure envelope, telemetry activation and Meta pilot
  remain open. No merge/deployment or complete-release claim is made.

### Outbox resource lifecycle follow-up (2026-10-01)

- Maintained regressions reproduced three defects: failed LISTEN leaked a leased
  client, duplicate callbacks delivered twice while leaving an untracked handler,
  and failed UNLISTEN silently returned a subscribed client to the pool. Repeated
  close also had no single-release guard. The four-case lifecycle suite now passes
  with setup/cleanup failure destruction, idempotent registration/close, and
  preserved cleanup errors. No shared database or data was changed by these tests.
- This is not stream scalability acceptance: each subscription still consumes one
  server-pool lease. Real PostgreSQL SSE verification, higher concurrency capacity,
  and independent review remain required before release.
- Independent review found a further P1 in the same surface: a leased pg client
  lacked an error handler, so socket failure could crash the HTTP process. The
  event-emitter regression failed first; supervision now destroys once and wakes
  SSE/MCP consumers. An isolated real-Postgres drill terminated only its captured
  LISTEN PID; the waiter rejected, the lease returned to zero active clients, and
  a subsequent query succeeded. Latest focused live battery: 14 passed. This is
  backend recovery evidence, not a browser or deployed-service claim.
- Follow-up independent review found a failure-wake race during an awaited
  backlog read. A maintained test held that query, disconnected the listener,
  then completed the query; the stream stalled before the fix and now rejects
  before entering its idle wait. A test typecheck also exposed pg's overloaded
  connect ReturnType resolving to void; the fixture now uses explicit PoolClient.
  Neither deadline nor assertion was weakened.
- The UI disconnect drill initially failed: Karbot's persistent background tail
  silently ended on graceful EOF despite backend recovery. A shared-follower
  regression also failed first. Karbot now opts into EOF reconnection with its
  last accepted token. Browser journey passed through real HTTP/Temporal/MCP/DB
  with scripted provider; draft and one terminal reply survived reconnect.
- Applying persistent-tail semantics to the legacy one-shot sector send broke its
  pinned post-EOF settling test. That flow retains its existing terminal refetch;
  only Karbot's persistent tail opts in. The assertion was not weakened.
- Independent frontend verification exposed cross-test stream interference. The
  root cause was concrete: cancellation during reconnect delay still dispatched
  one more fetch, allowing a stale follower to touch the replacement transport.
  A maintained cancellation regression observed two fetches instead of one before
  the fix. The follower now checks abort before dispatch and its delay responds
  immediately to abort. No assertion or deadline was relaxed.
- Final watched gates for this follow-up: pr:verify passed (frontend 303/6 gated
  skips, agents 202, backend381/264 gated skips; lint/typecheck/frontend build),
  isolated Postgres578/65 gated skips, full browser54/ 4 Meta-gated skips, backend
  build and standalone browser typecheck passed. Independent DB/stream16 and
  frontend69 plus both typechecks passed. Existing lint/bundle warnings remain.
  No merge or worker deployment; full release audit, compatibility, reconciliation,
  scale envelope and UI Meta pilot remain open.

### Final acceptance preparation and basic metadata screening (2026-10-01)

- Owner approved a UI-only Australian electrical/plumbing/HVAC discovery campaign,
  target2000, basic filtering retained and deep research/advanced qualification
  deferred. Final design contract and pending acceptance matrix are recorded.
- Initial keyword-only extraction admitted articles/directories/jobs; three new
  maintained regressions failed before strengthened opt-in metadata screening.
  New coordinator histories select the gate through a patch; legacy activity
  arguments remain unchanged. One path regex initially classified a brand host
  as a job path; the unchanged positive case caught it and path-only matching
  repaired it. Rules15 passed; real Temporal/isolatedDB coordinator9 passed,
  including a keyword-junk page followed by a legitimate company page.
  Geography/fetched-source proof, rejection inspection and the live pilot remain
  open; this is not a full basic-quality acceptance claim.
- Independent review caught inventory gate gaps: exported interfaces/types/defaults/
  barrels were omitted, evidence could be placeholder strings, and the documented
  release command omitted scenario acceptance. A failing export-form regression
  reproduced omission. Enumeration now includes those forms, proof is structured
  and artifact/commit/source/test hashes are validated at release, and the canonical
  command runs both gates. All pending surfaces/scenarios intentionally block it.
- Owner explicitly authorized creating test approval keys. Dedicated approver was
  provisioned through the DB layer in the prior UI tenant/project, with raw material
  only in ignored local files and old operator untouched. No model/HTTP/MCP key-
  creation tool was added. A10-twin provisioning test exposed a separate-unique-
  index race; conflict-safe insertion plus exact subsequent identity read fixed it.
  Three isolatedDB key tests passed. Config roles were verified without displaying
  keys; health200 and Meta catalog200 with5 available models were read-only checks,
  not deployed-branch or provider-research proof. Running backend identifies itself
  as dev-compose; final compatibility/rollout preflight remains required.
- Final matrix now has22 pending functionality groups/82 scenarios and 1653 pending
  declared surfaces (1494 exports,60 HTTP,74 MCP,25 UI). Required evidence tiers
  are explicit per scenario, so unit-only evidence cannot fulfill browser/stress/
  live-provider requirements. Independent initial review6 structural checks and
  administrative key3 live cases passed; release remains intentionally blocked.
- Watched preparation checks: pr:verify894 passed / 275 gated skips; full isolatedDB
  589 passed/67 gated skips; coordinator9 passed. The combined enabled release
  command fails both file and functionality gates as expected on pending reviews.
  Retrieval inspection found the header-only timeout and post-buffer byte cap;
  source/geography intake must remain unverified until those paths are hardened.
- Live UI Models screen confirmed five Meta choices and the unchanged contributor/
  high-effort default. Screenshot retained locally; no session/model mutation.
  Historical Overview candidates include government/news/guide pages. They were
  not deleted or counted toward a new campaign. Product browser navigation also
  lacks a public-network admission check; record this with fetch body/deadline,
  network-destination and ownership hardening before the live pilot.
- Final independent preparation review passed24 cases, backend types and diff
  whitespace. Critical required tiers are pinned independently of status entries;
  verified surface mappings must include their actual source file. Final mechanical
  gate repeated894 passed / 275 declared gated skips. No source/network intake,
  historical rollout, full audit, Meta inference campaign or2000-company outcome
  is claimed by this slice. PR remains draft/unmerged.

### Full-response retrieval bounds follow-up (2026-10-01)

- Three maintained regressions failed on the original implementation: a body
  stalled indefinitely after headers, size rejection happened only after reading
  all bytes, and redirect destinations were not inspected before network access.
  Fetch now holds one15-second deadline through headers/redirects/body, cancels at
  the2-MiB streamed cap and validates each of at most five redirects. Final URL is
  actual fetched provenance. Late header responses are cancelled even when an
  injected transport ignores abort. Raw bodies/URLs do not enter operational logs.
- Focused retrieval/pool suite24 passed/2 real-browser gated skips, including a
  controlled real-HTTP body that never finishes (15-second cancellation). Loopback
  routing is explicit test transport injection, not DNS-admission proof. Private-
  CIDR/DNS pinning, browser ownership/admission, basic source/geography publication
  and full live campaign remain open. No company records were populated.
- Independent review found the old HTML regexes were quadratic on malformed
  script/style/tag openings. A source-evidence regression failed before repair;
  quote-aware linear extraction now drops ignored/unterminated content and hidden
  attributes/comments. An isolated child test processes nearly2MiB malformed HTML
  with64MiB heap and2-second process bound. The real HTTP regression now observes
  its socket close before forced teardown; it cannot pass merely through cleanup.
  Focused four-file battery27 passed/2 browser-gated skips. DNS/private networks,
  browser scope/admission, source intake and full campaign remain unverified.
- Further independent parser review found Unicode lowercasing could expand string
  length and corrupt closing-tag offsets. Mixed-case script/style with expanding
  Unicode content failed first; offset-preserving ASCII tag folding repaired it.
  The near-cap isolated CPU test remains green. No deadline/assertion was weakened.
- Final watched retrieval gates: pr:verify905 passed / 275 declared gated skips,
  backend build, browser54 passed/ 4 Meta-gated skips. Independent19 focused cases,
  backend types and whitespace passed; no further concrete defect in this slice.
  Public-network/DNS/browser controls and actual basic intake/pilot remain required.

## 2026-10-01 browser ownership preflight

The audit found predictable process-local browser IDs and no ownership check on
snapshot/action/screenshot/close. Failed page creation leaked a host slot; a failed
initial snapshot could publish a session without returning its ID. Three maintained
regressions failed before the fix (the leaked slot also caused the following same-
host open to time out). Ownership is now scope/key/validated-thread derived at MCP,
checked by all session operations, and IDs use UUIDs. Publication follows successful
initial snapshot; confirmed cleanup releases slots and cleanup is logged/rethrown; uncertain cleanup retains capacity.
Focused four-file tests: 51 passed, 3 explicitly gated skips. These are mocked
Chromium/tool-boundary checks, not live browser or DNS/network validation.
Remaining preflight includes network admission, source-backed basic intake, legacy
replay/cache compatibility and recoverable uncertain operations; pilot not started.

Independent review caught a namespace collision: child guards treated a browser ID
as a parent conversation ID. Two maintained child tests failed before the DB-only
namespace fix; general/sector parent/child own-operation tests now pass. Review
also found Playwright creation/cleanup had no deadline: caller waits are now bounded
at 30 seconds. Uncertain cleanup retains physical-capacity accounting, rejects
further use, and accepts an owner-matched Close retry or late confirmation. Open
context cleanup uncertainty is logged, not mislabeled successful resource release.

Literal-destination regressions exposed private/reserved/numeric IPv4, IPv6 and
non-http browser admission; 32 cases failed before the shared literal policy.
Chromium and fetch are mocked in this denial suite. An initial browser test run
was interrupted and replaced with an explicit fail-closed Chromium mock; it is not
verification evidence. DNS pinning, browser redirects/subresources and orphan
reconciliation remain acceptance gaps. The first mechanical gate caught an unused
catch binding in the new open handler; it was removed without weakening lint.

The full gate also caught the staging-literal scanner's two obsolete blocklist
exceptions after the denial policy changed shape. Its exceptions now match only
the exact localhost-denial expressions; the environment/default scanner remains
enforced for every other occurrence. This is a guard-fixture update, not permission
to introduce localhost service defaults.

Independent review found keyboard/wheel SDK operations also use unbounded waits.
The action wrapper now bounds the full action and blocks overlaps while completion
is uncertain. Maintained press/wheel late-completion tests and hung-context tests
pass alongside ownership/cleanup tests (14 focused cases). CDP late-context cleanup
and restart-orphan recovery remain separately unverified.

CDP mock-path checks now exercise late-context cleanup and close failure without
closing the shared browser. Independent review then found that repeated Playwright
context.close can resolve without completing physical cleanup. The maintained
no-op-close regression fails when the receipt fix is removed and passes with it:
release now observes the original context close event; retry never treats a no-op
as confirmation. The fixture serves real owned loopback discovery HTTP and mocks
Chromium; actual CDP/browser/network recovery remains a live verification gap.

Final watched browser-slice gates: pr:verify: 959 passed / 275 live-gated skips
(frontend 303, agents 202, backend 454), backend build, and 16 isolated-Postgres
HTTP authority cases passed. Focused 100 passed / 3 gated skips. No new frontend
layout was changed, so no new visual/browser matrix is claimed; real Chromium,
Meta, full stress and historical replay remain unrun for this slice.

Independent installed-SDK review found context-only cleanup leaked one CDP client
connection per navigation. Cleanup now chains client transport disposal after the
actual context-close receipt and releases only after both complete. The pinned
Playwright CDP implementation disposes its transport rather than sending Chromium
Browser.close. The live pool test now checks the second client survives closing
the first; it remains explicitly gated/unrun, so no shared-browser safety proof
is claimed from mock tests or SDK inspection alone.

A further receipt timing gap was repaired: listeners now register at context
acquisition, rather than first cleanup. The early-close regression confirms an
already observed close releases on owner Close. The mock now models async context
creation, matching Playwright; an interrupted synchronous-mock run is not proof.
The18 browser cases pass; latest receipt/disposal changes require fresh full gates.

Final browser preflight-slice checks on Node 22.23.3 passed: pr:verify
(frontend 303, agents 202, backend 455; 960 passed / 275 explicitly gated skips),
separate backend build and 16 isolated Postgres HTTP authority cases. Independent
review /root/independent_review passed 18 focused cases, backend types and diff
checks on Node 22; no further concrete defect found in covered DI paths. Real
Chromium/second-client survival, DNS/network admission, Meta, full stress and
historical replay remain unverified for this slice. PR remains draft and no
backend/worker rollout or pilot launch has occurred.

## Source DNS preflight continuation

The previous checkpoint named unfinished implementation/verification as blockers;
none required a merge or owner permission. Four production-default DNS regressions
failed before the fix: DNS aliases to private IPv4/IPv6, mixed addresses and empty
resolution were not checked. Fetch now resolves once per hop, admits all answers
and pins native connection lookup while preserving original Host/TLS authority.
Late DNS cannot start a cancelled request. Response compression remains supported
with streamed encoded/decoded limits. A test edit initially joined two statements
and failed parsing; the newline was repaired, not skipped. Native transport/DNS
doubles are not real network or browser admission proof.

DNS focused battery passed 64 cases with one browser-gated skip; backend lint/types
passed on Node 22.23.3. Maintained KARDATA_RETRIEVAL_TEST=1 HTTPS check passed
(9 retrieval cases / 1 browser skip), exercising actual DNS/TLS/body consumption.
The earlier browser commit eecc235 CI completed successfully. Native transport
doubles, a single real source and earlier CI do not establish new full-release
readiness or browser-network admission.

Source-DNS slice full Node 22 gates passed: frontend 303, agents 202, backend 466
(971 total / 276 explicit gated skips), lint/types/frontend and backend builds.
Independent reviewer found no concrete defect in 11 DNS cases/types/diff. Its raw
compressed-byte coverage finding now has a 12th case using valid gzip metadata
with tiny decoded output; removing the raw guard makes that maintained test fail,
and restoring it passes. This added test is focused proof, not a new full-battery
count. The entire preflight and real UI pilot are still incomplete.

## Browser network guard preflight (in progress)

Network admission now lives on the existing backend HTTP listener, with ephemeral
HMAC capabilities, literal/DNS admission and pinned connections. No extra service
or dependency was added. Browser contexts use verified QUIC/WebRTC policy flags,
service-worker blocking and removal of loopback proxy bypass. Installed Playwright
inspection exposed that generic proxy credentials also authorize site HTTP auth;
custom exact-origin/proxy-only CDP auth avoids that leak. Real isolated Chromium
checks pass for private page traffic/redirects/popup/TURN-TCP and malicious site
auth. A controlled shared test browser proves one client's disposal preserves the
other and leaves zero task contexts after both close. A real public HTTPS source
also passes through authenticated CONNECT, DNS and Chromium TLS.

Independent review found raw CONNECT half-open peers escaping cleanup and accepted
socket errors that could crash Node. Close-receipt accounting, bounded flush,
shutdown tracking and accepted/late error supervision now have maintained tests.
The first half-open test incorrectly waited for the client to close its own write
half; the corrected oracle asserts the SERVER socket close before test-peer cleanup.
A missing enable-automation flag prevented runtime inspection and failed closed;
local/sidecar flags now match. Type/lint errors in typed CDP parameters, HTTP spy
overloads and an unnecessary assignment were fixed without relaxing gates.

Focused proxy/auth/expiry/DNS suites passed; full repository and browser matrices,
new independent review, intake validation and legacy/recovery gates are still
pending. These are real isolated browser/network checks, not the UI Meta pilot.
Existing shared backend/worker/browser images remain unchanged; no pilot launched.

CDP control-discovery truncation now clears its deadline and releases its slot;
maintained headers-plus-partial-JSON peer-close regression passes. The broader
gate caught a prefer-const error in the new control timer; fixed without lowering
lint. Actual Chromium checks now total5: private page/redirect/popup/TURN-TCP and
site-auth secrecy, isolated2-client CDP survival, and real public HTTPS viaCONNECT.
These are separate from the unstarted UI Meta campaign.

Final watched Node 22 transport gates: pr:verify 989 passed / 281 explicit gated
skips (frontend 303, agents 202, backend 484), lint/types and both builds; four
isolated-Postgres HTTP/MCP authority suites: 48 passed. Owned Chromium network
suite: 5 passed, including production DNS/CONNECT to a public HTTPS peer.
Browser matrix and latest independent control-discovery verification pending.
No shared rollout, pilot company population, main merge or data purge occurred.

Browser matrix passed 54 cases / 4 explicitly Meta-gated skips with real isolated
HTTP/DB/Temporal file/context journeys enabled. Independent reviewer passed 35
proxy/auth/isolation cases, backend types and diff on Node 22.23.3; control timer
finding resolved, no new concrete defect found in reviewed paths. Its checks do
not independently rerun the author's live browser, DB or full-suite results.

### 2026-10-01 — source-backed basic intake preflight

New discovery runs now review candidates before company publication, using at
most two fetch-only children. Each accepted company has independently required
identity/geography/sector quote fields. Rejected candidates are screening work;
uncertain checks remain blocked. Receipts are retained in sector files and work
progress. No company deep research or outreach is added.

Independent review found and corrected: immutable report ID collision after an
archive-success/publication-failure restart; skipped interrupted intake on a
same-plan restart; duplicate review on an uncheckpointed repeated page; signaling
a finished child after pause; and publication using a stale lifecycle projection.
The last guard now reads committed state under the existing DB transaction lock.
All have maintained regression scenarios, including archived receipt preservation
and pause without projector catch-up.

Watched Node 22.23.3 evidence: 8 intake validator tests; real isolated
Postgres/Temporal coordinator plus sector repository battery 26 passed
(17 coordinator, 9 repository cases), /tmp/kardata-intake-temporal-db-final.log.
Retrieval/reviewers in this battery are explicit scripted fixtures, not Meta.
The earlier mechanical gate passed 997 tests with 288 declared gated skips;
later DB lifecycle/lag additions require the final refreshed gate below before
handoff. No shared deployment, manual population, pilot or merge has occurred.
Two first rejection fixtures incorrectly supplied a valid company on page 1;
the fixtures were corrected to their declared rejection-only population rather
than weakening publication assertions. All subsequent fixtures passed.

Replay baseline preparation uses an isolated managed worktree at e454d44. No
baseline source edits, shared worker rollout or resource deletion has occurred.
Compatibility, uncertain-operation recovery, full functionality acceptance and
the actual UI-driven Meta campaign still remain unfinished.

Controlled legacy recovery evidence: six exact-baseline workflow types replayed
with current bundles. The combined gate then replayed six retained user histories
(three sessionRun and three subagentRun) plus verified controlled baseline
histories for four missing types. It does not move the historical cutoff or
claim fixtures are historical user runs. Baseline worktree source/commit and
bundle hashes are checked. Evidence: /tmp/kardata-baseline-replay.log and
/tmp/kardata-historical-and-baseline-replay-2.log, retained hashed manifests under
backend/test-results. The SDK JSON replay helper failed on installed protobuf
Type identity; generated SDK History.fromObject decoding passed without changing
dependencies or histories. Cutoffs unequal to the pinned baseline instant now fail validation. Independent
review found that earlier cutoffs could hide available historical coverage;
maintained pure guard regressions deny both earlier and later dates.

Further intake findings: recovery now obeys the accepted-company ceiling, also
checked atomically under concurrent publication. Semantic rejection does not
truncate the next valid source on a page. Rejected domains survive completed
query-direction checkpoints. The first cap-count assertions also counted the
completed discovery direction's explanatory text; predicates now select intake
identities, while company-row and accepted-count ceilings remain exact.

Final watched slice checks on Node 22.23.3: mechanical pr:verify997 passed /
300 explicit gated skips, lint/typechecks/frontend build; backend build passed.
Real isolated coordinator/sector-repository battery30 passed (21 coordinator +9
repository). Final validator plus combined replay gate14 passed. Intake receipts
are readable markdown with named fit checks/source quotes. Required Meta/UI,
full-scale mixed-failure, complete file/functionality review and shared rollout
remain unverified; legacy mutation-cache and uncertain-operation recovery are
still preflight work. No release acceptance status was promoted automatically.

The cutoff correction passed18 focused validator/replay/guard cases and a fresh
full mechanical gate:1001 passed /300 explicitly gated skips, lint/types and
frontend build. No test was disabled to obtain these results. Historical proof
retains the fixed cutoff and origin distinctions; no release waiver is implied.

### 2026-10-01 — durable source/attempt/steering preflight continuation

Production turn results now return verified source archive refs rather than
multi-megabyte pages through Temporal. Source and review receipts persist in
Postgres before continuation cleanup; original text is verified under the source
session namespace. Source exchanges have60s deadlines, byte caps, cancellable
filesystem/GCS I/O and coded integrity/scope/limit errors. Existing URL-plus-text
hashes/paths remain readable. No additional service, framework or dependency.

Migration19 adds per-attempt leases. Late same-operation checkpoints, summaries,
steering and cleanup cannot overwrite or clear a replacement. Archival remains
inside cancellation/heartbeat supervision; source validation activities keep
heartbeats separate from semantic completion. New child histories preserve their
assignment on followup and return the latest steered outcome, not a superseded
initial answer. Terminal failure/count reporting is versioned for legacy replay.

Independent review found and corrected: unbounded/unscoped continuation hydration,
unfenced automatic summaries and detached acceptance/verdict publication after
cancellation. Final acceptance now checks committed pause/approved scope under
transaction and resumes saved reviews; final lifecycle cannot overwrite pause.
Watched Node22 checks so far:23 archive cases; isolated migration/initial lease9;
latest real Temporal/PG31 (25 coordinator +6 compaction/lease cases). Scripted
retrieval/provider bodies remain fixture evidence, not the Meta pilot.

Two source-ref fixture errors were corrected without weakening assertions: the
competing publisher changed citation URLs without minting matching archive refs;
the no-inline-body assertion treated its short quote as the entire source body.
The fixture now uses verified ref identities and distinct body/quote content.
The pause-state test waited only for signal receipt before reading projection;
it now waits for applied state, preserving the intentional pre-projection guard.
All subsequent heavy regression cases passed. Full current gates and replay are
still being run; no shared migration/worker rollout, pilot population or merge.

Broad verification findings: the activity-lifecycle double returned no lease;
it now supplies and asserts the actual cleanup attempt token. Concurrent catalogue
and matrix refresh raced the matrix's import-time inventory read; refreshes now
run sequentially as documented. Full DB battery710 passed /95 gated skips with
one migration5s timeout under default high file fan-out. Test infrastructure now
bounds DB file workers to2 within the existing connection budget; all stress
fan-out, migrator races, timeouts and assertions stay intact. A full rerun follows.

Current source slice final evidence: bounded full Postgres battery711 passed /95
explicit gated skips; exact production activity→scripted HTTP MCP→real Postgres /
filesystem source journal passed1 case and retained refs after terminal cleanup.
Independent re-review confirmed scoped/deadlined continuation hydration, summary
lease CAS and post-archive publication cancellation guards;23 focused archive
cases, types and diff checks passed independently. Retained historical/controlled
replay10 cases and report recovery1 passed. No Meta/provider/pilot claim follows.

Final watched mechanical source gate:1012 passed /308 explicitly gated skips;
lint/typechecks/frontend build and separate backend build passed on Node22.23.3.
The new production activity fixture's SDK generic result required an explicit
TurnOutcome type; typecheck caught and fixed that test declaration. No gate was
weakened. Browser/full-stress/Meta campaign evidence remains a separate release
requirement; uncertain operation and legacy cache recovery is next preflight work.

### 2026-10-01 — uncertain-operation recovery preflight

The agent now parks an unconfirmed mutation rather than treating a lost reply as
ordinary model feedback. Working checkpoints retain original tool arguments,
operation identity and an execution-authority fingerprint outside compactable
history. Resume checks the original operation before another provider round;
changed credentials/grants/thread binding cannot replay it under fresh authority.
Denied retries retain the original uncertainty. New tasks cannot overwrite an
unresolved checkpoint. Prepared identities persist before dispatch, covering
worker cancellation and failed result-checkpoint writes. No blind guard deletion,
new operation ID or automatic assumption of success is used.

Local context exposes readable pending-operation status and expandable identity;
OpenAPI and client validation include the same additive fields. Temporal recovery
is versioned; operation and compaction failures have distinct messages. Completed
cached replies replay safely; genuinely unprovable in-progress/legacy receipts
remain parked. Automated proof of an unjournaled historical effect is not claimed.

Watched focused checks:40 runner cases; real HTTP/MCP/Postgres activity test1
(lost post-commit reply, role revocation/restoration, new-task denial, compaction,
exactly one created session);8 real Temporal workflow cases;21 workspace component
cases;4 browser cases desktop/mobile/light/dark with reduced motion, long identity,
focus restoration and screenshots/videos. The first prepared-receipt HTTP run
used the stale agents build and failed the pre-dispatch assertion; rebuilding the
workspace package made the exact same assertion pass. Browser evidence uses
explicit routed fixtures, not Meta or a populated live campaign.

Work-item upserts now fence conflicts atomically by sector and plan version.
Foreign-sector identity reuse is denied, another version conflicts, and completed
replay publishes no false state notification. Three isolated Postgres cases prove
cross-scope denial, immutable completion and a competing two-sector claim.

The initial broad mechanical run correctly failed stale catalogue surfaces;
sequential inventory refresh corrected the evidence without promoting reviews.
Subsequent mechanical gate passed1027 tests /310 explicit gated skips with lint,
types and frontend build. This count preceded the final work-authority addition;
current full DB, replay and final mechanical gates are being rerun. No shared
rollout, pilot or merge occurred. Unresolved release requirements remain explicit.

Latest mechanical gate after work-authority/browser additions:1027 passed /313
explicit skips; lint/typechecks/frontend build passed. The full DB run failed a
stale inventory load (new test added before refresh) and the1000-agent usage
projection exceeded its unchanged5s test deadline during overlapping gates.
The isolated soak rerun passed4 cases with the original deadline; full isolated
DB rerun is sequential. This is an unresolved measurement until that rerun passes,
not a timeout waiver. Browser re-review bounded the long ID;4 rerun cases passed.

Sequential full DB rerun passed716 /96 explicit gated skips with unchanged test
limits. Independent review then reproduced a prepared-checkpoint authority bypass
and duplicate assistant tool calls on successful prepared recovery. Both are
fixed with exact checkpoint regressions: changed authority dispatches zero tools
and provider requests; one/three recovered calls preserve one original assistant
block with exactly one result per call. Runner43 cases pass. These were missed by
the earlier lost-reply-only checkpoint shape and are now maintained regressions.

Independent final runner recheck passed43 cases and confirmed both prepared
checkpoint fixes; no further concrete defect found in this bounded review.
Historical/controlled replay passed10 cases (all six workflow types plus cutoff
contract guards). Controlled fixtures remain labeled separately from historical
production runs. Fresh mechanical/workflow gates follow the final review fixes.

Current workflow battery33 passed (25 discovery coordinator +8 session recovery),
full routed workspace browser suite22 passed, retained legacy replay10 passed.
Operation IDs now hash header-unsafe Unicode/control/edge-whitespace values while
preserving valid short legacy identities;46 focused runner cases passed. Current
backend build passed. Remaining preflight includes bounded search bodies/deadlines,
version-retained eligible discovery and unprovable legacy operation reconciliation;
complete release audit/stress/provider evidence and matched rollout remain open.

Sealed recovery mechanical gate on Node22.23.3:1033 passed /313 explicit gated
skips, lint/typechecks/frontend build. Source files remained fixed throughout
that run. Existing five hook lint warnings and bundle-size warning stay visible.
This verified recovery slice is reviewable separately; it is not full preflight
or release completion and the PR remains draft.

### 2026-10-01 — bounded search transport continuation

Keyed/keyless search formerly cleared its deadline at headers, then read entire
bodies before applying caps. Both now use one bounded search-page helper over
DNS-pinned public transport:15s whole-page deadline,1MiB keyed/512KiB keyless,
five public-checked keyless redirects, no credentialed redirects, late/error body
cancellation and coded operational triples. Shared pagination validates the
existing count1-20/page0-100 contract before networking.

Primary Brave docs exposed a faulty existing assumption: offset is a page0-9,
not page multiplied by count. Corrected the production parameter and regression;
keyed pages past9 fail explicitly for discovery fallback. Provider-null snippets
remain empty; missing/null web data needs an explicit exhausted flag rather than
silently claiming no companies. Source: official pagination and response-schema
links in documentation/backend.md. No provider/service/dependency was added.

Focused bounds/DNS/compatibility cases pass; a test spy initially omitted its
fetch signature and typecheck caught tuple indexing, corrected with typeof fetch.
Independent bounded review found no concrete transport defect:30 cases passed,
2 browser-gated skips, backend types and diff check. Later pagination/schema
changes are undergoing recheck. No live keyed-search or Meta-pilot claim yet.

Updated focused search battery51 passed /2 explicit browser skips; backend lint
and types passed. Real public HTTPS source retrieval passed under DNS-pinned
transport (9 cases/1 browser skip in that command). Independent pagination/schema
recheck42 passed /2 browser skips; no concrete defect found in its bounded pass.
A maintained opt-in keyless availability journey now queries actual public
engines without storing candidates or creating company records. Its results are
separate from source-backed intake and the Meta/UI pilot.

Production recovery follow-up: source collection wrapped the MCP client without
forwarding its authority fingerprint. Corrected the wrapper and extended actual
HTTP/MCP/Postgres regression with a newly registered API-key identity plus worker
credential rotation, retained original hash, blocked replay and exactly one effect
on restored authority.26 activity/unit cases pass. Independent read-only review
confirmed propagation and the regression oracle; no new defect found. This fixes
a gap missed by the earlier runner-only authority tests, not an owner waiver.

Live keyless availability passed10 cases including actual candidate retrieval,
without storing results. Basic source-backed intake and the UI/Meta2000-company
campaign remain separate requirements. No junk candidate was accepted into the DB.

Sealed search mechanical gate passed1055 cases /314 explicit gated skips with
lint/typechecks/frontend build; separate backend build passed. Search contracts
and native DNS regressions ran on the production paths with deterministic doubles;
public source and keyless availability were additionally exercised live. No
acceptance record was promoted wholesale and no matching shared rollout occurred.

### 2026-10-01 — plan revision consistency work

Approval previously allowed an older stored version despite a newer edit; edit
and approval also checked only projected lifecycle and did not serialize shared
scope decisions. Both mutations now share the workspace transaction and committed
state seam. Stale approvals conflict; one concurrent approver wins.

Exact-compatible discovery revisions copy completed source-backed company and
settled intake receipts with original evidence/child provenance. Identical query
completion is retained only without company-capacity/target changes, avoiding
false exhaustion after expanding the queue. Changed scope/acceptance/brief is not
silently deemed compatible. Lower limits below retained companies roll back the
whole approval. Cumulative budget remains sector-owned. Explicit owner-reviewed
retention across a changed scope is still a separate preflight requirement.

The transaction change exposed incomplete unit doubles (connect returned no
query/release; lifecycle SELECT received plan payloads). Doubles now implement
transaction query/release and distinguish committed state reads; the original
assertions pass. Real isolated DB tests verify retained evidence/child IDs,
capacity expansion, changed criteria/scope, stale/twin approval and rollback.
No test timeouts were increased and no pilot data was mutated.

Independent review found that copied completed directions could hide unresolved
intakes if only settled receipts were retained. Fixed by carrying intake identities
and states/attempts, not upgrading them. Real Temporal/PG regression1 passed:
one accepted and one uncertain candidate; compatible v2 still fails acceptance,
keeps the uncertain blocker and never displays100%, while cumulative budget stays.
Protected Decisions are now pinned in additive approval metadata and must match
for automatic retention; legacy unknown decisions are not guessed. Current
workspace pins displayed contextVersion; stale context conflicts before mutation.

Browser tests initially assumed denied context still exposed the research Plan
tab and assumed an invented generic503 banner. Actual denial hides the conversation,
and the503 banner carries the server's message. Assertions now check unavailable
approval in the real denied state and disabled approval after fresh context fails.
The error transition passed with the unchanged5s poll and10s assertion deadline.
Routed fixture evidence is not a live-user approval or Meta campaign.

Sealed compatible-retention checks: full DB747 passed /98 explicit gated skips;
real coordinator26 passed (including the unresolved-revision regression); full
workspace browser29 passed; mechanical1056 passed /324 explicit gated skips,
lint/types/frontend build. Measured2000 synthetic receipt approval/retention:
47.66ms,158,531,584 bytes runner RSS at end, zero pool waiters at end on Node22,
16 logical CPUs and98,794,881,024 bytes host memory. Raw hashes/measurement remain
in backend/test-results/retention.load.json. No real companies were created by
that measurement. Independent lightweight recheck13 passed; no remaining concrete
defect found in its bounded retention review. Shared rollout and pilot remain open.

Next identified scale check: coordinator checkpoints currently return full work
and context history repeatedly. Temporal's documented per-event blob limit and
history growth require bounded transport/state reads before the2000-company pilot;
small fixtures do not establish this capability. Explicit owner eligibility
selection across changed scope and unresolved-operation reconciliation also remain.

### Durable reconciliation source slice (2026-10-01)

Owner terminal session recovery now has an actual HTTP→Temporal→activity→DB/
archive proof: `/tmp/kardata-owner-resume-live-1.log` passed2 cases in3.91s
(session restore plus full-UUID delegation). A late finalizer failure retains a
paid reply; after isolated termination, operator Resume is denied and approver
Resume adopts original checkpoint/manifest/model under a new epoch. It produces
one user message, one final reply and one provider call. The final parameterized
session and delegated-child terminal restore gate then passed2/2 in5.26s
(`/tmp/kardata-owner-resume-final.log`). Both use actual owner HTTP commands,
Temporal executions, Postgres and archive storage, with a scripted provider;
neither is live Meta/pilot evidence. Backend typecheck and scoped recovery/logging
lint passed after the fixture corrections. Negative-contract corrected fixtures
still require inclusion in the final full DB gate.

Negative original-contract tests plus palette ceiling passed4/4 in1.85s
(`/tmp/kardata-recovery-negatives-live.log`): foreign SDK scheduled input denied
despite matching prompt, nested original grant/mode preserved on repeated
recovery, bounded history pages, changed-checkpoint ownership denial and no new
tool dispatch/authority fingerprint change. Subsequent fixture corrections use
actual persisted JSONB checkpoint hashes and ToolDefinition.parameters; final
full checks must include these versions.

HTTP ingress review found missing start logs: only onResponse emitted a line,
leaving held requests absent. Source now emits ingress and coded errors with the
same trace as egress; matched patterns or *unmatched* replace raw paths. Held
handler/error/privacy regressions passed in20 lightweight logging checks with
two explicit integration skips (`/tmp/kardata-http-ingress-tests.log`).

The initial advisory prototype described below is superseded in source by
execution-epoch fencing (migration0021). Provider-owning gateway and child starts
reserve first; SDK receipts/validated attempts bind a canonical execution chain.
The recovery transaction checks current epoch, exact run, lease and every
unresolved concurrent intent. Legacy and unknown metadata stay advisory. A new
private attempt supersedes only tagged recovery pause, preserving manual pause.
No shared image/database rollout is implied.

Verified `/tmp/kardata-epoch-focused-final-2.log`:10 passing focused cases in5.60s
(seven isolated-PG, three real Temporal/isolated-namespace cases). Actual gateway
start is held after reserve but before RPC/event/lease to reproduce the previous
false-positive race; old recovery is denied. Its exact terminated successor is
safely parked. An actual continue-as-new chain preserves canonical epoch while
advancing its run, rejecting older callbacks/observations. SDK duplicate-start
rejection settles no-effect failure; typed unknown launch stays uncertain and
emits a conversation notice. Ordinary signals and older concurrent unknown RPCs,
manual pause, pre-dispatch failure, deadline expiry and observe→park journal
transitions are pinned. Scripted provider work is not Meta/pilot evidence.

Red findings were preserved: helper initially imported the failure class from
the wrong SDK export; fixed to the supported common export. The unknown-outcome
fixture initially threw generic Error, which retries workflow tasks rather than
closing an execution. It failed its unchanged60-second test deadline; changed
only that fixture to the intended nonretryable ApplicationFailure. Its sole
owned stuck workflow was inventoried then terminated, without deleting history.

That failed fixture exposed native SDK console leakage: configuring the JS Pino
logger does not forward Core logs. Source now explicitly forwards native logs
through a constrained diagnostic serializer, retaining severity/target/IDs/hash
and excluding raw error/message/span/entry bodies. Existing SDK filters and
Prometheus metrics remain unchanged. Local SDK runtime-options/runtime-logger
sources establish the independent-console behavior. Focused logger regression
and final verification results are recorded separately; older deployed images
have not been activated with this fix.

Added a singleton existing-lane Temporal supervisor with bounded cursor pages,
RPC deadlines, bounded per-page retries, failure recovery on subsequent passes
and continue-as-new history rotation. It records correlated findings and an
execution.recovery notice for observed closed owners. Working context, summaries,
leases, lifecycle state and pending instructions remain intact. Scoped sector health
provides recent historical observations. This source is not activated in the
older shared worker image, and it is not the Meta pilot.

Concrete defect: five-second heartbeat throttling suppressed busy→idle changes,
leaving completed operations falsely busy. The previous live test asserted that
incorrect outcome. Identical-state writes remain throttled; transitions and
clock rollback now write immediately, with a focused regression and corrected
real repository assertion. No timeout or resource bound was weakened.

Initial prototype gates passed19 pure/isolated-PG cases and two real Temporal/
isolated-PG cases in39.19 seconds, including recovery after exactly three page
failures on the next30-second pass. Subsequent review identified a cross-system
race: a latest terminal Temporal description plus unchanged local lease does not
fence a same-ID restart before lease acquisition. Automatic parking was removed;
current terminal observations never clear leases or change thread status. A
durable pre-start epoch across gateway and workflow-owned launches is required
before automatic abandoned-lease recovery can be enabled. Final source gates:
23 pure/logging/isolated-PG tests pass in3.00s, including retained ownership,
notice deduplication, scoped health, paused availability and planning attribution.
Two real Temporal/isolated-PG tests pass in39.21s: exactly three exhausted page
attempts recover at the next30-second pass with the same cursor; a real same-ID
workflow restart remains RUNNING after an old terminal observation, with its
local lease/status untouched. Production Pino worker logging redacts SDK task
tokens and sanitizes errors in retained evidence. Backend typecheck and changed
source/test lint pass. Evidence is retained locally, ignored, in
`backend/test-results/kardata-reconciliation-db-final.log` and
`backend/test-results/kardata-reconciliation-temporal-redacted.log`.

Independent review found a planning ownership attribution defect: a persistent
research-session thread executes planning under sector-plan-ID, while generic
session threads normally use session-run-ID. The resolver now checks the planning
run key against the session's durable sector binding, reads the actual plan's
heartbeat, and leaves unprovable bindings unknown. A live repository regression
pins planning ownership and mismatch denial in the passing23-case gate.

No inferred lease TTL, age-based agent kill, parent/child ancestry recovery,
browser-process restart recovery, full-fleet operating envelope, outbound alert
delivery, rollout, pilot or merge proof is claimed by this slice.

### Coordinator pilot-scale transport and history (2026-10-01)

The synthetic2000-company/4000-intake production activity+PG regression failed
before the fix:9,531,704 serialized bytes, above Temporal's2MB default blob limit.
Compact snapshots nowmeasure71,272 bytes and routine checks1,241 bytes; all6000
receipts and their full intake reasons remain stored. Raw hashes/result:
backend/test-results/coordinator.transport.json. This is synthetic transport proof,
not2000 live companies or completed pilot. Existing PK receipt lookup replaces
repeated rejected-domain command lists; plan reads fetch only plan-event payloads.
Publication cap checks no longer load the entire ledger under the transaction lock.

Real forced history continuation passes and preserves company identities/budgets.
Independent review foundthree edge failures: committed pause restored only intent,
empty-page exhaustion could resume the next raw page, and retry pages after100
lost attempt increments. Fixed and pinned by3 real Temporal/PG regressions, including
101 interrupted attempts5 becoming6. A test counted the wrong intake run-key shape;
corrected its prefix oracle without changing the no-duplicate assertion. Excess
capacity candidates retain exact hydrated receipts and remain blocked.

Full coordinator battery initially28 passed/2 red tests: old assertions demanded
rejected/accepted domains inside workflow transport lists. New contract moves that
dedup to scoped DB IDs. Both maintained regressions now assert empty transport
lists, lookup of the exact durable intake ID, and unchanged/no-repeated reviewer
counts; focused rerun2 passed. Fresh full coordinator/mechanical/replay gates follow.
No source record was deleted and no test deadline increased. Independent bounded
transport review18 lightcases passed andfoundno furtherconcrete defect.

Sector Files scale review reproduced the all-row rendering defect with the
maintained `files-scale.spec.ts` browser oracle: the initial view mounted 2,004
visible-file buttons instead of a bounded fifty-row window. The pre-fix browser
log is `/tmp/kardata-files-scale-browser-before.log`; two component regressions
also failed in `/tmp/kardata-files-scale-unit-before.log` (72.25s). The minimal fix
uses fifty-row increments with truthful filtered totals and a fixed footer, plus
search/hidden-filter resets. Fresh Node22 gates passed: three component checks,
312 frontend tests with six explicit skips, frontend lint/typecheck/build, and
14 maintained browser cases in15.1s. The final browser gate adds actual list
scrolling with a stationary Global context panel, keyboard/focus reachability,
metadata-refresh preservation, mobile/desktop themes and reduced motion, and
loading/empty/error/denied/offline recovery. Screenshots, traces, videos and
per-case source hashes are retained in `/tmp/kardata-files-scale-browser-final`;
the run log is `/tmp/kardata-files-scale-browser-final.log`. All fixtures identify
synthetic TEST evidence, not live ingestion or full file-layer verification.
The follow-up mixed-library regression reproduced uploaded-first grouping: two
isolated Postgres tests failed in `/tmp/kardata-files-order-before.log`. The
existing library now combines both sources newest first with a deterministic
file-ID tie-break, using internal timestamps and no wire-shape changes. Both
cases passed in2.15s in `/tmp/kardata-files-order-after.log`, including a real
newly archived/indexed generated report visible first over keyed HTTP among
2,000 older synthetic upload metadata records. This is scoped ordering evidence;
the bulk upload rows are fixtures and do not certify 2,000 ingestion operations.

CI at de2e54c passed mechanical/browser jobs but exposed a session recovery test
race: workflow PAUSED was queryable before its state-event activity committed,
so immediate projector catch-up read IDLE. The maintained test now waits for both
the workflow query and durable projected PAUSED within the original30-second
deadline before resume. It retains original-operation and exactly-one-user-message
assertions. This corrects the test synchronization contract; fresh real Temporal
verification remains pending. Log: /tmp/kardata-ci-retention-failed.log.

Current epoch integration:38 real session/coordinator cases passed217.41s;
legacy replay10 passed3.27s (historical and controlled-baseline origins retained).
These gates preceded provider-record wiring and do not establish that new slice.
New normalized execution callbacks49 agent cases and archive26 cases passed.
Core record tests initially failed2 because the backend imported the previous
built agents package; rebuilding the existing package made27 core cases pass.
Model metadata's optional SDK field also produced a type error; normalized missing
model to explicit null. Full workspace typecheck then passed. Production archive/
DB callback and owner inspection verification remain pending. No pilot or rollout.

Preflight deployment audit caught a real archive durability mismatch: backend
mounted archive-data at /var/kardata/archive, but worker had neither that mount
nor matching archive/GCS environment. New worker-written source/execution records
would be isolated in disposable storage and unreadable by owner HTTP inspection.
Maintained archive.storage-config.test observed2 failures before the fix and2
passes afterwards. Compose now shares the existing volume/target and read-only ADC
settings; no service/dependency/new product volume added. Read-only inventory of
three known old worker archive roots found0 files/0 bytes. Matching deployment
round-trip/restart proof remains pending; no container was replaced in this audit.

Owner execution inspection passed5 real keyed HTTP/Postgres/FS cases in2.37s
(/tmp/kardata-execution-inspection-http.log):22-record keyset paging, exact body
reads, body/key omission from metadata, role denial including open mode, tenant
and same-tenant conversation isolation, invalid cursor boundaries, corrupt archive
409 and foreign namespace rejection before journal publication. Contract suites18
passed. Synthetic records are TEST-labeled; no Meta/pilot capability is claimed.

### Unresolved intake owner review (2026-10-01)

Pilot blocker: source-backed uncertain/failed candidates had no owner action and
could remain acceptance blockers indefinitely. The missing UI/HTTP boundary was
not covered by the earlier intake verdict tests. Added scoped approver review of
an exact work/plan receipt at a paused or failed nonexecuting candidate boundary.
Retry retains identity/attempts/evidence/reason/budget usage; exclusion is a
separate immutable state, never completed company/direction/acceptance work.
Owner decisions retain the entire old receipt and explicit reason in the journal.
Contract: documentation/agents-research.md, backend.md, db.md and frontend.md.

Observed original PlanProgress regressions fail2/2 (no Review intake control),
then fixed6/6 component and2/2 client tests pass. Actual isolated Postgres and
keyed loopback HTTP observed4/4 fail with the former absent route, then4/4 pass
with the route restored. Cases cover authority/scope, exact receipt/plan fences,
concurrent contradictory decisions, child leases/unresolved starts, retained
counters/reason, exclusion versus late checkpoints and scoped journal marker.
Migration gates pass4/4 including concurrent migrators and empty down/up.
Their stale exact enumerations previously stopped at0019; they now include the
actual0020/0021/0022 migrations without relaxing the oracle.

Both shared UI entry points pass8/8 maintained browser scenarios at390/1440px,
light/dark and reduced motion: keyboard opening, long-content bounds, denied
save/draft retention, stale reload/explicit latest review, exclusion and truthful
counts. Screenshots/traces/videos: frontend/test-results/work-review-2026-10-01.
A reviewed mobile dark screenshot shows wrapped source/reason content and
reachable controls within the dialog. Backend logs and source-hash manifest are
retained under backend/test-results/work-review-2026-10-01 (ignored evidence).
These are TEST fixtures, not genuine company/source or Meta campaign proof.
The parent Temporal exclusion/publication and paused-retry rotation gates are a
separate coordinated slice; no pilot, release or merge completion is claimed.

Owner Files/context/inspection closure: the maintained32-case browser batch first
passed28 and failed4 (`/tmp/kardata-owner-files-recovery-inspection-final.log`).
Three failures proved the rebuild conflict alert was clipped after context/layout
refresh; centering it and repeating the scroll/focus on version/busy changes fixed
the product. The fourth was an incorrect exact-alert assertion that included the
existing retry-button text; the corrected test checks the message and full viewport.
The final unchanged-source32 cases passed in26.7s:
`/tmp/kardata-owner-files-recovery-inspection-closure.log`. Captures, videos, traces
and physical per-case source-evidence JSON files remain in the matching directory.
Visual review confirms the mobile conflict, stale-source warning and fixed actions
are visible together, plus bounded escaped JSON and complete normalized download.

The owner inspector is keyed/approver-only, scoped and paginated; namespace,
hash and byte checks precede serving archived content. Metadata omits storage keys;
actual IDs derive from the matching lease row and remain in immutable journals.
Normalized JSON displays64,000 characters initially and explicitly offers complete
download. Observed shared-plan labels do not claim assignment-plan identity.
Client/UI focused40 and contracts18 passed; full frontend332 passed/six explicit
skips, workspace lint passed (five existing frontend warnings), frontend build
passed (existing chunk warning). The concurrent workspace typecheck found only a
coordinator test's narrowed nullable-child fixture, handed to its owner for repair.
Post-provider storage recovery, live Meta campaign, archive-container restart and
whole-release acceptance remain separate gates. Synthetic UI data is never claimed
as live provider, research or file-ingestion capability.

Root coordinator review integration passed4 real Temporal/Postgres cases19.69s
(/tmp/kardata-owner-review-coordinator.log): explicitly retried uncertain receipts
retain attempts/history, excluded candidates never publish/relaunch, paused owner
retry forces checkpointed history rotation and dispatch, and a late accepted
assessment cannot override exclusion. New intake claims carry exact receipt CAS;
late callbacks cannot overwrite reviewed work. A racing publication fixture now
prepares its own work receipt rather than borrowing another candidate authority.
Private original-turn adoption validates hash/run/user under a row-locked lease
transaction, restores original optional flags (including omission), pins model/
effort/window and freezes names without altering transport identity. Types passed;
full battery and negative recovery gates follow.

### Intake-review idempotency contract correction (2026-10-01)

The full backend preflight caught a missing shared IdempotencyKey declaration on
POST /v1/sectors/{sectorId}/work/{workId}/review. The route already used the
existing fingerprint guard, but the workspace client's generic request helper
sent no key. The receipt fence prevented duplicate owner effects; a lost reply
could not replay its exact cached receipt through the UI. This gap escaped the
initial review tests because their HTTP harness supplied keys directly and the
client assertions inspected only the body.

Added the shared optional OpenAPI parameter and a narrow optional client request
key. useWorkReview retains one key for an exact failed submission; changing its
work/version/decision/reason creates a fresh request. Observed the contract gate
fail before the declaration fix. Observed2 client regressions fail without the
previously absent header, then3 client tests pass with header/key retention.
The real keyed HTTP/isolated-PG suite now passes5/5: repeated exact owner decision
returns the identical200receipt and one journal event; changed arguments with the
same key return409. Contract suites pass18 tests with3 explicit live skips.
Final frontend suite passes333 tests with6 explicit skips; typecheck, lint and
build pass (the existing5 lint warnings and build chunk advisory remain).
Backend lint/typecheck pass. These are isolated fixtures, not pilot evidence.

Full isolated DB run initially814 passed/4 failed/116 explicitly gated skips.
Root causes: new work-review OpenAPI omitted IdempotencyKey; context authority
fixtures reused an intentionally hidden-source-blocked thread and its failed v1
seed; activity supervision fixture lacked the new UUID/producer-identity setup.
Header/client replay fixed with same-key200/changed-args409 proof; authority
fixtures isolated without changing policy (16pass). Updated lifecycle fixture
then revealed real late source-inheritance after heartbeat abort. Added abort
checks at setup boundaries and moved producer identity into protected cleanup/
heartbeat supervision. Maintained5-case setup suite passes; source ownership
read failure also releases its claimed lease and logs a static code. FullDB
rerun remained required at this checkpoint; no test deadline/assertion was weakened.

### Integrated preflight closure and Postgres capacity (2026-10-01)

The next original two-file-worker DB run encountered an infrastructure failure,
not an accepted red baseline: the running Postgres container had Docker's64-MiB
shared-memory mount. At15:54:31 UTC a32-MiB dynamic-segment resize failed with
ENOSPC during schema creation; the process then received signal11 and Postgres
entered crash recovery. That run ended567 passed/13 failed/356 skipped,56 failed
files and one uncaught connection error. Setup-failure skips are not intentional
gate skips. No shared container was restarted or data purged; Postgres completed
its own recovery at15:56:23 UTC. Logs: backend/test-results/preflight-final-isolated-db.log
and preflight-final-postgres-crash.log.

The prior migration round-trip also exceeded its unchanged5-second deadline
under this run's resource pressure. After recovery the isolated migration suite
passed4/4 in2.59s without changing its deadline or assertions. A diagnostic
one-file-worker full DB rerun passed820/116 declared gate skips in157.59s; it
does not certify the original concurrency envelope. The capacity regression
observed missing shm_size red before the source-only Compose correction and
green afterwards. Compose now declares1GiB and retains max_connections100.
The actual shared running container still has64MiB; source changes do not
activate it. Matching reviewed deployment and preservation of existing storage
remain required before rollout.

A fresh owned Postgres container used the same pinned image,1GiB shared memory,
100 connections, an ephemeral loopback port and a retained UUID fixture volume.
The full original two-file-worker DB battery passed821/116 explicit gate skips
in91.14s, with128 passed files/17 gated files, unchanged deadlines and original
within-file contention. The isolated runtime logged no shared-memory exhaustion
or crash recovery. Inventory/runtime logs are preflight-final-owned-pg.log and
preflight-final-owned-pg-runtime.log; the test log is
backend/test-results/preflight-final-isolated-db-capacity.log. No database was
dropped. The owned container and volume remain available for further isolated
verification; no shared deployment changed.

Final Node22.23.3 pr:verify passed1112 tests/395 explicit gate skips: frontend333/6,
agents229, backend550/389. Workspace lint/typecheck, agents/frontend builds and
separate backend build passed. Five existing Hooks warnings and the frontend
chunk advisory remain. Logs: backend/test-results/preflight-final-pr-verify.log
and preflight-final-backend-build.log. The actual SDK/HTTP/Temporal/Postgres/archive
owner Resume suite passed2/2 after the final activity setup changes; focused
pending-response storage recovery passed3/3. These use scripted providers, not
paid Meta calls. Logs: preflight-final-terminal-owner-resume.log and
preflight-final-paid-response.log.

The archive container/config gates passed3/3 in2.40s. The owned writer was removed,
then separate server and replacement-worker containers verified exact normalized
execution JSON and TEST Unicode source text through production archive APIs.
The extended maintained case uses persistResearchSource/hydrateResearchSources,
not a duplicate storage helper. Its fixture volume remains retained; only its
owned ephemeral containers were removed. Log: preflight-final-archive-container.log;
before/after volume inventories are retained beside it. This proves isolated
filesystem persistence across container roles, not matching shared deployment,
GCS credentials/network, genuine fetched content or the Meta UI campaign.

Sequential catalogue/acceptance refreshes each passed3 structural tests with one
release assertion gated. The enabled combined release audit then failed2/8 as
required:508 of543 files still have pending reviews, and all1780 surfaces,
22 features and82 scenarios remain pending. Log:
backend/test-results/preflight-final-release-audit.log. No review/acceptance
status was fabricated. Full browser matrix verification, matching deployed UI/
source-archive round trip, outbound-alert activation and the actual Meta pilot
remain separate gates; no shared worker/backend/browser rollout, push or merge
occurred in this closure. Frozen source/log hashes are retained in
backend/test-results/preflight-final-source-manifest.json; the tested tree is
explicitly an uncommitted integration over de2e54c, not release evidence bound
to a committed source snapshot.
# Final maintained browser closure (2026-10-01)

Full Node22 browser gate passed113 cases with4 explicitly skipped Meta journeys
in59.8s, exit0. It includes real isolated HTTP/Postgres/filesystem upload recovery
and scripted-provider HTTP/MCP/Postgres/Temporal context/reconnect, plus eight
exact767/768/1279/1280px light/dark rail/drawer/focus/overflow cases. Product source
was unchanged. All430 captured source/test/configuration/migration hashes stayed
stable during the final run. Watched logs,145 PNGs,82 videos and113 traces remain
in ignored `frontend/test-results/browser-closure-final-20261001T1617/`.

One prior matrix failed the file fixture's teardown: the live page issued late
resource reads after its owned backend began closing, causing503/ECONNREFUSED.
The maintained fixture now stops its page, waits for routed reads, and preserves
backend/pool cleanup in nested finally blocks. Assertions/timeouts are unchanged;
the focused real-file case and the complete final matrix passed after correction.
New boundary test collection also required moving worker-scoped trace/video
settings from describe to file scope. Failed logs remain retained.

Exact proof/hashes, visual-review scope and skipped gates are in
[browser closure](deep-checks/browser-closure.md). Four Meta UI journeys,
the2000 genuine-company campaign,50-company validation, shared rollout and full
file/functionality acceptance remain separate pending release gates. No merge,
deployment or release certification follows from the browser result.

### CI Postgres shared-memory parity (2026-10-01)

Packaging review found the existing GitHub integration Postgres service still
used Docker's64-MiB default despite the observed local parallel-query crash and
verified1-GiB owned-runtime correction above. The maintained capacity regression
now parses the CI configuration as well as Compose. It failed1/2 before the
CI service option was added; capacity plus archive-configuration checks then
passed4/4 on Node22.23.3. Logs: /tmp/kardata-ci-capacity-before.log and
/tmp/kardata-ci-capacity-after.log. The existing CI service now declares
--shm-size=1g; image, connection budgets, services and dependencies are unchanged.

This closes source configuration parity, not deployment activation or a new
cloud-green claim. The shared running Postgres remains64MiB. The new latest-head
cloud run must be watched separately; full release/pilot/acceptance gates remain
pending. No shared service, database or research data was changed.
