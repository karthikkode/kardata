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
KARDATA_HARDENING_ACCEPTANCE=1 npm test -w @kardata/backend -- hardening.catalog.test.ts
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

## Current verification commands and outcomes (2026-10-01)

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
| Release catalogue | `KARDATA_HARDENING_ACCEPTANCE=1 npm test -w @kardata/backend -- hardening.catalog.test.ts` | intentionally blocked by pending reviews |

Configure local test connection variables without publishing credentials. The
DB helper allocates fresh UUID-suffixed databases and never drops shared data.
The four skipped browser cases are plan-live, plan-full, pilot-live and
plan-console, each explicitly requiring `KARDATA_LIVE_JOURNEY=1`. The required
2,000-company Meta UI campaign is not established by these fixture journeys.
The configured local UI remains operator-only; owner approval is not bypassed.

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
