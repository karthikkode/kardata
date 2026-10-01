# Hardening evidence catalogue

Design authority: [approved plan](../../documentation/plans/2026-09-30-repo-hardening.md).
`catalogue.json` inventories maintained runtime, migration, configuration and
test files. Reading a file or finding an export does not prove its behavior.
A public feature's stable identity is `<source path>#<export>`; HTTP operations
also use their OpenAPI operationId; MCP operations use their tool name.

Each file has a content hash, public exports, review status, and explicit test
and contract links when reviewed. Changed content invalidates a completed
review. `pending` is an acceptance gap. Exclusions state why; test data still
needs validation through its consumers. Generated lockfiles require review
of dependency manifests and integrity changes rather than hand editing.

Refresh deliberately after changes:

```sh
UPDATE_HARDENING_CATALOG=1 npm test -w @kardata/backend -- hardening.catalog.test.ts
```

Ordinary tests only read the catalogue. The final audit gate is:

```sh
KARDATA_HARDENING_ACCEPTANCE=1 npm test -w @kardata/backend -- hardening.catalog.test.ts hardening.acceptance.test.ts
```

That release gate currently **fails** because the complete file audit is not
finished. Module/unit gates, live integrations, browser fixtures, and the
real-provider pilot are separate evidence tiers. Never substitute one for
another or count skipped suites as proof.

Generated soak evidence belongs in ignored `backend/test-results/soak.report.md`.
Browser stills/videos belong in ignored `frontend/test-results/`. Curated
verdicts and repeatable measurements go in this operations tree; linked PR
attachments preserve visual evidence. Routine tests never rewrite tracked
performance reports.

## Verified initial regressions

| Feature | Failure caught | Maintained verification |
|---|---|---|
| TEST.database-isolation | Shared migration target and unsafe database names | db-helper.test, live db.migrations.test and db.concurrency.test |
| DB.discovery-identity | Domain ids collapsed discoveries across sectors | live db.discovery-integrity.test, replay and 20 twins |
| DB.discovery-ledger | Rediscovery overwrote researched verdicts | live db.discovery-integrity.test |
| DB.heartbeat-recovery | Failed writes suppressed retry; databases/colon pairs shared throttle state | heartbeat-recovery.test, three failures observed before fixes |
| AGENT.compaction-recovery | Summary/count failures escaped recoverable error handling | compaction.test, failure observed before fix |
| WORKFLOW.context-resume | Session compaction failure terminated its workflow | live workflows.run.test, same turn resumes and user message occurs once |
| PLAN.edit | Displayed-text edits discarded executable work | live api.sectors.test, failure observed before fix |
| UI.plan-edit | Failed saves closed the editor and lost its draft | research-plan-editor.test and browser conflict journey |
| UI.workspace-stream | Prior answer settled queued send; EOF ended following; failure overwrote new draft | workspace-conversation.test, three failures observed before fixes |
| DB.outbox-lifecycle | Leaked LISTEN leases, duplicate handlers/releases, unhandled disconnect and missed failure wake during backlog read | db.outbox-subscription.test, isolated db.outbox-disconnect.test; setup/cleanup/socket/race failures reproduced |
| UI.karbot-stream-recovery | Graceful EOF silently ended Karbot's persistent tail | follow-resume.test and real HTTP/Temporal/MCP/DB agent-context-db.spec browser disconnect/reconnect with retained draft and terminal reply |
| FILE.sector-preview | Missing preview/download surface | live api.workspace.test, sector-file-preview.test, browser download journey |

These entries prove slices, not whole modules. Remaining source review,
failure scenarios, measured scale limits, and the UI-driven Meta campaign
are still acceptance requirements.

## Measured scripted fleet (2026-10-01 local time)

The maintained fleet suite ran with isolated DB/task queues and existing lane
limits (four active turn activities per worker); these are logical children,
not simultaneous model requests. The runner host reported 16 logical CPUs and
98,794,881,024 bytes of physical memory. All tiers completed with zero rejected
launches/missed steering and one indexed artifact per child.

| Children | Indexed outputs ready | Full lifecycle completion | Runner RSS at end | Pool waiters at end |
|---|---|---|---|---|
| 10 | 2.641s | 3.378s | 426,897,408 bytes | 0 |
| 50 | 14.150s | 17.133s | 497,311,744 bytes | 0 |
| 100 | 28.734s | 35.423s | 442,646,528 bytes | 0 |
| 1,000 | 418.481s | 486.356s | 556,015,616 bytes | 0 |

Generated evidence: `backend/test-results/fleet.hardening.report.json`. These
end-of-tier observations establish successful scripted execution on this host,
not peak resource demand, latency distributions, external-service contention,
provider capacity or a production SLO. Mixed-failure/overload envelope and paid
Meta validation remain release gaps. No test DB was dropped.

Additional maintained regressions cover paused plan revisions, superseded
lifecycle writes, conflicting artifact bytes, cross-tenant source imports, unsafe
archive keys, and scoped global-MCP plumbing. The UI pilot needs an existing
approver credential; the configured operator key was not upgraded.

## Earlier verification checkpoint (2026-10-01)

Mechanical entrypoint: `npm run pr:verify`. It passed frontend 301 cases (6
live-gated skips), agents 202, backend 373 (243 live-gated skips), lint/typecheck,
and frontend build. Backend build also passed separately. Five existing lint
warnings and the approximately 694-kB JS bundle warning remain visible.

| Gate | Command | Current outcome |
|---|---|---|
| Isolated Postgres battery | `TEST_DATABASE_URL=<local-test-base> npm test -w @kardata/backend` | 555 passed, 59 gated skips |
| Temporal recovery/planning | `KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=<local-test-base> npm test -w @kardata/backend -- workflows.coordinator.test.ts workflows.run.test.ts workflows.subagents.test.ts workflows.plan.test.ts` | 28 passed |
| Browser state/transition matrix | `npm run test:e2e -w frontend` | 52 passed, 4 live-journey skips |
| Independent live recovery slice | `TEST_DATABASE_URL=<local-test-base> npm test -w @kardata/backend -- api.workspace.test.ts research.report-recovery.test.ts outbox.snapshot.test.ts` | independent reviewer: 13 passed |
| Scripted fleet measurements | `KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=<local-test-base> npm test -w @kardata/backend -- workflows.fleet-load.test.ts` | measured 10/50/100/1,000 children; see table above |
| Release catalogue | `KARDATA_HARDENING_ACCEPTANCE=1 npm test -w @kardata/backend -- hardening.catalog.test.ts hardening.acceptance.test.ts` | intentionally blocked by pending reviews |

Configure local test connection variables without publishing credentials. The
DB helper allocates fresh UUID-suffixed databases and never drops shared data.
The four skipped browser cases are plan-live, plan-full, pilot-live and
plan-console, each explicitly requiring `KARDATA_LIVE_JOURNEY=1`. The required
2,000-company Meta UI campaign is not established by these fixture journeys.
At that checkpoint the configured UI was operator-only. A later owner-authorized dedicated local test approver is now configured; the original operator record was not upgraded.

Next release gaps: full file/functionality review; durable per-round evaluation
and inspection; live reconciliation/scrape activation; historical workflow replay;
file import/retention failure windows; mixed-fault and overload measurements;
UI-driven Meta campaign and 50-company source validation. The draft change must
not merge merely because deterministic gates pass.

Independent mechanical verdict: `pr:verify` exit 0, 876 passed/249 skipped;
13 isolated live DB/HTTP cases passed; diff whitespace check passed. The reviewer
cleared both stream recovery findings after fresh tests. The five Hooks warnings
and bundle-size warning remain. Curated local UI proof (ignored binary convention; remote attachments outstanding) lives in
`tests/evidence/hardening-2026-10-01/` (nine files, 750,267 bytes); generated full
matrix artifacts remain ignored. Historical examples in status docs are dated;
only this section states the current slice's gate results.


### Atomic file-publication follow-up

The file-ingestion follow-up passed `pr:verify` (876/253 gated skips), the full
isolated Postgres battery (559/59 skips), and the browser matrix (53/4 live skips).
The real-HTTP file journey uploads through browser controls, observes indexing
failure, retries, previews, downloads exact bytes, and reuploads without a second
row. It uses a fresh DB and filesystem archive; FakeRunsGateway/chat SSE do not
prove Temporal/provider behavior. CI integration adds that same maintained gate.

The unchanged synthetic soak setup timed out under concurrent DB/browser/build
runs; the sequential DB rerun passed. Do not hide that failure or relax timeouts:
run live DB verification sequentially on this host. Independent mechanical gates
and eight ingestion/context DB cases passed. Local curated proof now also includes
`files-db-upload-failure.png`, `files-db-upload-recovered.png`, and
`files-db-upload-recovery.webm` under the existing ignored evidence directory.


Historical replay gate: `KARDATA_LEGACY_REPLAY=1 npm test -w @kardata/backend --
temporal.legacy-replay.test.ts`. The dated pre-main-baseline sample replayed six
session/child test histories. Four other declared types lacked pre-baseline
history and fail explicitly, remaining an acceptance gap. The ignored report
records per-type availability and history hashes without payload copies.
The cloud follow-up run at
[36807811844](https://github.com/karthikkode/kardata/actions/runs/36807811844)
passed verify, browser and integration jobs, with browser-review and
browser-files-integration artifacts. It is additional proof, not release approval.


### Context authority and guarded mutation replay follow-up

Latest watched gates: `pr:verify` 878 passed/269 gated skips; isolated Postgres
571 passed/65 skips; real-HTTP/Temporal/MCP/DB scripted browser matrix 54 passed/
4 Meta-gated skips; backend build and 18 contract checks passed. Independent
review rechecked the guarded-mutation slice (55 focused live cases) and found no
remaining concrete defect there. This is not full release acceptance.

Maintained regressions cover general-chat own-context access, explicitly selected
approved sector context, source/parent proposal privacy, general-child transcript,
run-control and rename isolation, invalid execution bindings on repeated keys,
RPC-ID-independent mutation replay, hidden-file read freshness, missing-runner
recovery, and uncertain handler/completion-store failures without duplicate effects.
Session run directories describe their recorded graph rather than unrelated
namespace histories; the same full browser interaction deadline now passes.

Only typed pre-dispatch dependency failures release replay guards. Uncertain
claims stay guarded and require reconciliation; neither their recovery UI nor
an automatic reconciler is claimed complete. Old cache records without authority
identity remain a rollout gap. Six sampled old session/child histories replayed,
but four declared types lacked retained pre-baseline histories. Do not merge or
deploy the worker on mechanical-green results alone.

### Outbox and UI disconnect follow-up

Watched verification: `npm run pr:verify` passed886 cases with270 declared gated
skips; isolated Postgres578 passed/65 gated skips; full browser54 passed/4 Meta
skips; backend build and standalone browser typecheck passed. Independent focused
DB/stream16 and frontend69 plus typechecks passed. Evidence and failures caught
are recorded in implementation-status and frontend-verification. These results
cover this recovery slice, not the remaining release audit/pilot requirements.

## Final acceptance matrix

Approved final campaign contract: [final acceptance](../../documentation/plans/2026-10-01-final-acceptance.md). `acceptance.json` inventories named/default/type/interface/barrel exports, OpenAPI operation IDs, MCP names and UI component surfaces. Component/export enumeration is a starting point: every reachable interaction/state still requires manual functionality mapping and scenarios. No enumeration counts as reviewed behavior.

Explicit refresh (after refreshing the file catalogue):

```sh
UPDATE_ACCEPTANCE_SURFACES=1 npm test -w @kardata/backend -- hardening.acceptance.test.ts
```

Ordinary gates validate structure/coverage enumeration only. The canonical final audit command above runs **both** release assertions: file reviews plus functionality/surface/scenario acceptance. Pending mappings block release. Verified scenarios require maintained test links and structured evidence with tested commit, environment, timestamp, tier, artifact hash and source/test hashes. The enabled release gate resolves local retained artifacts, checks their bytes, and checks that the tested commit contains the same sources/tests. Each scenario declares required tiers; release rejects unit-only proof where browser, stress or live-provider evidence is required. Evidence labels/integrity do not replace independent review of what the tests proved.

Initial cross-module criteria cover basic discovery filtering, plans/progress, global approvals and mid-run changes, local isolation, cache/compaction, steering/delegation, DB durability/pool/migrations, files, HTTP/MCP, recovery/telemetry, historical rollout, frontend states and infrastructure. Export/tool/route/UI mappings and all criteria remain pending until reviewed and observed; no full-coverage claim is made.

## Browser preflight slice verification

Mechanical entrypoint passed: frontend 303, agents 202, backend 454 tests; 275
live-gated skips remain explicit. Lint/types / frontend build and separate backend
build passed. Focused retrieval/browser/MCP checks: 100 passed,3 gated skips.
Isolated Postgres HTTP authority checks: 16 passed. Existing Hooks warnings, jsdom
scrollTo diagnostics and bundle-size warning remain visible. No real browser,
Meta campaign, full stress or historical replay claim follows from this slice.

Ownership, namespace, failed-open, hung-action and cleanup receipt regressions are
maintained in browser.isolation.test.ts; literal admission in
retrieval.destinations.test.ts. Source-network DNS pinning/subresources, fetched-
source basic intake, legacy replay/cache rollout and recoverable uncertain
operations remain pilot preflight gaps. PR #36 remains draft/unmerged. The app's
backend/worker images have not been rolled onto this branch.

Final browser preflight-slice checks on Node 22.23.3 passed: pr:verify
(frontend 303, agents 202, backend 455; 960 passed / 275 explicitly gated skips),
separate backend build and 16 isolated Postgres HTTP authority cases. Independent
review /root/independent_review passed 18 focused cases, backend types and diff
checks on Node 22; no further concrete defect found in covered DI paths. Real
Chromium/second-client survival, DNS/network admission, Meta, full stress and
historical replay remain unverified for this slice. PR remains draft and no
backend/worker rollout or pilot launch has occurred.
