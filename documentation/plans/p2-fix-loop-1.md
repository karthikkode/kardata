# P2 fix-loop 1 close-out (fv4, branch p2-7-fixes, HEAD eddfd8f)

Full rerun into var/fv4/ at frozen product src (3bff925), then two
fix commits with targeted reruns. Solo serial, TEST_DATABASE_URL =
kardata_test on :5433, Stryker coverageAnalysis "all".

## Per-suite table (EXIT, pass/fail/skip)

| Suite | EXIT | Result | True path |
|---|---|---|---|
| verify (build+lint+typecheck+test+coverage+quality) | 0 | 211 files pass, 10 skip; backend lines 92.2% (≥80) | 19 red attempts → f0f0fc8 (15s/30s DB budgets; cause: coverage-load starvation) |
| temporal | 0* | 219 pass, 11 skip + 1 fail → rerun 13/13 | 1 fail (subagents race) → f207847 (poll to 60 finished) |
| fault | 0 | 8 files, 32/32 | green first run |
| stress | 0 | 2 files, 4/4 | green first run |
| Playwright -u (final) | 0 | 1250 pass, 21 skip (42m) | 1247 + 3 axe → 37e2c02 (freeze motion) → rerun |
| ui:review | 0 | 373 shots graded, snapshot dirs committed | green |
| mutation agents (turnRunner) | 0 | 99.89 ≥ 70 | durable runner 2ef4cda (patch-package + guard + npm-ci proof) |
| mutation frontend (useWorkspace) | 0 | 98.59 ≥ 70 | W0–W9 batteries; baselines agents 56.18, frontend 42.25 |
| mutation backend (3 files) | — | NO SCORE, gate UNVERIFIED | dropped by owner: 2165 mutants, dry run 36m41s, ~20h killed. Configs in 5e05573 (test-scope only) |
| live L-K + stages | 0* | battery 24/25 → L-PLAN targeted 1/1 (25/25 effective) | 17 FK fails → eddfd8f (drain stale workflows); L-PLAN 600s timeout → 259fb1d (sandbox env read) |
| scale preview | 0 | 7/7 on vite build+preview (58.9s) | committed switch cf21659 (KARDATA_E2E_SERVER=preview) |

*temporal/live EXIT=0 after the named targeted rerun, not in one shot.

## Product-src note

Suites measured 3bff925. One product change after: 259fb1d
(pure laneTaskQueue; identical queue string, replay-safe, no
patched() gate). Re-verified targeted: plan 3/3, lanes 7/7,
coordinator 35/35, L-PLAN live 1/1 (56s). No full re-run post-fix.

## Remaining failures: none, except

- Backend mutation ≥70 UNVERIFIED (dropped, ~20h). OWNER WAIVER
  2026-10-09: exhaustive testing deferred until after the pilot
  runs; backend HEAD+baseline mutation resumes on staging
  post-pilot with the 5e05573 configs (perTest, 4h caps).

## Split proposal (report only, no code)

turnRunner.ts (772) → turnRunner.ts (runKarbotTurn + turn loop) +
mcp-client.ts (StreamableMcpClient, closed client, tool-def parse,
grant header). Import sites: agents barrel + own test only.
runs-gateway.ts (785) → runs-gateway.ts (shell + run lifecycle) +
runs-interaction.ts (send/sendSkill/steer/missed-steer/queue) +
runs-launches.ts (sector sweep/plan, subagent delegate, file,
context, monitor starts). Barrel re-exports keep import sites stable.

## Done, stopped for review
