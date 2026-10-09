# Phase 7 review: gate lock (build-only, D1/D2)

Branch `p2-7-gates` from `p2-6-frontend`. 13 commits
1dea447..af885fd, one item each. Diff: 20 files, +594/−37
(341 insertions are package-lock). Gates per commit: typecheck
EXIT 0 (touched workspace), eslint 0 errors (gated dirs only),
node --check / JSON parse / YAML parse / --print-plan. No suites
run per D1. No open-source item in Phase 7 (no table).

## AC → proof (all static; runtime deferred to final verification)

- Enforce default: `tests/registry/registry.test.ts` (1dea447):
  new test fails on todo/gaps unless REGISTRY_ENFORCE=0.
- Coverage thresholds: agents 85 (53845aa), backend 80 (0d930ac),
  frontend 75 (047f48a); istanbul dep ×2 (0270ff2); gate script
  scripts/coverage.mjs + root `coverage` (79fb31e, --print-plan
  verified); backend = evergreen tiers + temporal env (48e56b8);
  `verify` = pr:verify + coverage + quality (58c231c). Tests:
  tests/registry/coverage-gate.test.ts, 5 fixture tests (unrun).
- Mutation ≥ 70%: break=70 in all 3 stryker configs (524b595);
  per-module via existing `-m` runs. "Add tests where low" is
  unmeasurable under D1 → deferred to the fix loop (stated).
- CI: integration += backend build, toxiproxy, fault, reduced
  stress, backend coverage; timeout 45min (3e3bf3b, YAML parsed).
  Reduced knob KARDATA_STRESS_SCALE (812cd32: 100k events, 10
  writers, 60s). Local gates documented (ci header + tests.md).
- AGENTS.md bug-fix rule (6036d9b); tests.md gate docs + status
  note (af885fd). `npm run quality` exit 0; registry:sync +0/-3.

## Suite commands (final verification)

`npm run verify:full` (coverage rides inside verify; backend gate
needs DB + Temporal); `npm run test:mutation` (local gate).

## Deviations

- Backend coverage skips bare with a printed note (DB+Temporal
  needed; bare db-tier skips make numbers meaningless). Forced by
  the gating architecture; full gate in verify:full/CI. Documented.
- Backend coverage = evergreen tiers only (tests/backend +
  tests/registry); fault/stress are separate gates, not re-run
  inside coverage.
- CI toxiproxy mirrors stack:toxi (docker --network host,
  shopify/toxiproxy:latest): dynamic proxy ports cannot be
  pre-mapped on a service container. Mutable tag accepted (v2 API
  stable for years).
- New dev dep @vitest/coverage-istanbul in agents+backend: vitest 5
  needs the provider package per workspace; istanbul matches
  frontend (v8 needs @vitest/browser, not installed).
- 3 removed-surface entries retained in the YAML: live test tags
  reference them (mcp.monitor, mcp.ops-obs); deleting the entries
  would trip unknown-id. Load-bearing, not dirt.
- p7-cov-gate is 141 lines: one item (script + its test + wiring),
  cannot bisect further.

## Blocked

None. All gates are wired-but-unproven until final verification.

## 3 weakest points

1. Zero runtime signal on the numbers: backend 80/85 split and
   frontend 75 may fail at final verification (fix loop expected).
2. CI integration unvalidated until first push: toxi host
   networking, the 45min budget, reduced-stress timing guesses.
3. Backend coverage adds a second Temporal dependency to
   verify:full (coverage step + temporal test step both need it).
