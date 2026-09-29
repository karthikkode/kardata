# Implementation status

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
  (failed on missing module before the fix; 4/4 after):
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
  live sector-context 4/4 on 5433, drawer unit tests 7/7, polish e2e 4/4
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
  (pause/resume 403/404/409/200), `tests/backend/db.sectors.test.ts`
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
