# P2 final verification (fix-loop HEAD 853ca7f, 2026-10-06)

Every suite ran ONCE, in order, logs in `var/fv/`. Nothing was fixed during the run.
Branch `p2-7-fixes`, tree clean except `docs/ui-review/2026-10-06.md` (new) and this file.

## Suite results

| # | Suite | EXIT | pass / fail / skip |
|---|---|---|---|
| 1 | `npm run verify` (COVERAGE_SKIP_BACKEND=1) | 1 | unit 1853 / 11 / —; quality green (01c EXIT=0) |
| 1b | coverage (agents+frontend) | 1 | aborts on the 2 agents fails; no summary |
| 2 | backend DB tier | 1 | 1274 / 24 / — (17 files) |
| 2b | backend coverage (unit+db+temporal) | 1 | 1368 / 26 / — (19 files); no summary |
| 3 | backend Temporal tier | 1 | 1374 / 35 / 89 (25 files) |
| 4 | `test:fault` (documented env + dist rebuilt) | 1 | 15 / 13 / 0 (28); noenv run EXIT=0 all-skip |
| 5 | `test:stress` | 1 | 2 / 2 / 0 (4) |
| 6 | Playwright full incl. matrix `-u` on 15174 | 1 | 542 / 690 / 23 (1255, 55.8m) |
| 7 | `ui:review` | 1 | 25 / 348; 26 screenshots graded 23 pass / 3 minor fail |
| 8 | mutation HEAD | 1 | dry run red (operationId test), aborts; no score |
| 8 | mutation baseline 0eb0da6 (var/mut-baseline) | 1 | 0 tests found (config rot); no score |
| 9 | `test:live -t L-K` as ordered | 1 | no root `test:live` script (only agents/probe has one) |
| 9 | L-K direct (kardata_live + with-env) | 1 | 0 / 3 / 22; setup fails, never reached Meta |

## Failures grouped by phase / fix ID

Fix-loop area (fix commits touched the test or product; all need fix-loop triage):
- P3-B1/B2: supervision.actions 2 fails (wall 0v1; flatline RUNNINGvERROR) — FV-2/3/4.
- P4-B2: 3 continue-as-new fails (sessionRun/subagentRun carry timeouts, 4v3) — FV-3.
- P4-B3: F9 gap-reporting reply timeout — FV-4. P4-M3: F4/F5 no resume after SIGKILL — FV-4.
- P5-M5: monitor stop-at-final-tick 28/100 in 30s with AND without coverage: test
  timescale bug (each tick costs ~1s; 100 ticks cannot fit). Fix the test, not the tick.
- P4-B1 HOLDS: subagents drain passes in FV-3; the 59/60 was coverage-only slowness.
- children-1000 stalls at 685–689 with and without coverage. Test untouched by fix
  loop, product changed by P4-B1/B2: BISECT (suspect CAN mid-drain vs promotion stall).

Pre-existing (no fix-loop touch; confirmed by git log or bisect):
- Alerts 403s ×5 (bisected: old http.ts also fails, not P4-M6); ops-runs `this` ×5
  (P5.1c detached method); template 30v24; operationId; postWithDeadline; traceparent;
  log-coverage can.ts; stop_monitor sample; trace-continuity (FV-3).
- L-K1..K3: `ensureResearchSession` throws Sector-not-found in setup (P5.2d, no
  projector catch-up or scope bug). Key presence unverified: Meta never called.
- FV-1 frontend: matrix-counts 52 rows, coverage-registry 12 components,
  supervision-alerts text. FV-2 rest (api.rest, artifact-author, operation-recovery,
  reconciliation, paid-recovery) and FV-4 rest (db/turn/provider/infra faults):
  attribution unchecked, bisect in fix loop. F8 returns 500 not 503 (real).
- Playwright failures/* 315: designed error UI never renders (alert/copy not found);
  only 24 mention console, so the console theory is minor. Matrix 348: sr-only
  overflow-checker bug (112+), timeouts, axe 10. Scale 7: fixture setup fails,
  budgets unmeasured. v2 motion/plan ~20.
- Stress: writers PASS (0 deadlocks). Volume: execution-seed binding error; p95
  budget blown by session.list 2.3s, context.global 9.4s, evaluation.sector 248ms,
  agent_reliability 246ms, library.list 8.6s; companies.page seq-scan plan gate.

## Coverage / mutation / scale numbers

- Coverage: UNMEASURED on all workspaces (every gate aborts on red tests first).
- Mutation: no HEAD score (dry-run red), no baseline score (0 tests found at 0eb0da6).
- Hot-query p95 (ms): page 1.0, header 0.3, directory 7.9, session.get 25.4,
  progress 8.5, companies.page 9.8, events.partition 17.7, outbox 0.3,
  thread_cost 0.2, research_quality 27.1, documents 22.1, artifacts 28,
  events.by_key 0.2; over budget: session.list 2301, context.global 9368,
  evaluation.sector 248, agent_reliability 246, library.list 8634.
- Temporal: children-1000 stalls ~689; CAN carry fails; monitor tick ~1s/ea.
- E2E: 1255 tests in 55.8m; ui-review graded 26/26 (3 minor fails, see
  docs/ui-review/2026-10-06.md). Full-shot grading needs a post-checker-fix rerun.

## Fix-list additions (from Claude's deferred + this run)

1. STOPPED/CANCELLING runs must release the "thinking" indicator (pilot-facing).
2. 30s request timeout must exempt uploads and long mutations (P2 uploads a PDF).
3. Queued children need pause/steer/cancel controls (P7 needs exactly these).
4. Pre-continue check: children from before a parent CAN must be cancelled when the
   parent is cancelled (else only the orphan rule catches them; unconfirmed).
5. Suite-config bugs: root `test:live` script missing; `test:fault` without
   TEST_DATABASE_URL passes vacuously (28 skips); baseline stryker config rotten.
6. Denied-state retry is inconsistent (Dashboard/SectorLanding have it, Models/Runs
  lack it); ModelsPanel-partial renders the full error; "8 across 0 sectors" copy.

## Verdict

CHANGES REQUIRED. 11 unit + 24 DB + 11 temporal-only + 13 fault + 2 stress + 690
e2e + 3 live failures; coverage and mutation unmeasured. The fix loop has three
strands: (a) fix-loop fallout (supervision ×2, CAN ×3, F9, F4/F5, P5-M5 test,
children-1000 bisect); (b) pre-existing product bugs (alerts, ops-runs, F8,
trace-continuity, L-K setup, 5 slow queries, companies index, error UI);
(c) test-harness bugs (sr-only checker, scale fixtures, execution seed, suite
scripts). Recommend strand (c) first: it unblocks measuring everything else.
