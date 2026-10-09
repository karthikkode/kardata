# Phase 1 review: Foundation

Branch `p2-1-foundation` from `main` (f912e5e). 1 commit (0eb0da6).
Stat: 29 files, +11076/-1416 (lockfile churn + 6158-line registry).

## Owner process decisions (change the run)

- D1 verify-once: no suite runs during the build; all suites and
  baselines run once after all development. Only lint/typecheck run
  while building. Evidence below marks what ran pre-rule vs deferred.
- D2 stack branches with no merges until final verification (reverses
  merge-per-phase; protection would otherwise force per-phase CI).

## AC

- `registry:sync` writes the YAML: met. 1025 entries (agents 118,
  backend 225, db 537, frontend 67, mcp 78) in
  `tests/registry/features.yaml` via `scripts/registry-sync.mjs`.
- Gate passes in report mode, fails unknown tags: met.
  `tests/registry/registry.test.ts` (9 tests: gate + enforce
  fixtures + merge + tier map). Ran green pre-D1.
- `quality` prints baselines: met (all ran pre-D1, static tools).
  knip: 9 files, 5+5 deps, 7 unlisted, 252 exports, 106 types.
  jscpd: agents 2.04% (8), backend 3.12% (93), frontend 1.03% (23).
  cruiser: agents 0, backend 92 circular, frontend 6 circular,
  0 layering breaks. eslint: 0 errors; 10 files in
  `quality-allowlist.json` (max-lines 800) + 2 fetch allowlist.
- `test:mutation` baseline per module: DEFERRED per D1. Harness
  complete (3 configs, 5-run script, vitest `related:false` +
  explicit roots so the sandbox resolves tests). Gauge validated
  discovery, then killed; ~1 min/mutant (~5h total) was the
  reason for D1. Baselines measured at final verification.
- `docs/bug-escapes.md` seeded: met, 17 rows from the v1 handoff.

## Suite (step 4 — deferred per D1 to final verification)

`npm run verify`; `TEST_DATABASE_URL=… npm test -w @kardata/backend`.
CI change (verify job runs `verify` + `git diff --exit-code`) ships
in this branch but first executes on the end-of-run PR.

## Deviations

1. D1 + D2 (above).
2. tests.md: kept the soak prose, ADDED the tiers table below it
   (the prose carries non-redundant meaning).
3. Stryker: `vitest.related:false` (mirror layout defeats related
   discovery) + explicit vitest roots in agents/frontend configs
   (sandbox starts from repo root; normal runs verified same).
4. test:mutation runs 5 sequential per-module runs for honest
   per-module scores (no helper script, §2.1.6).
5. Knip: Temporal workflows/activities added as entries (dynamic
   load), tests/** ignored (mirror sits outside workspaces).
6. quality:deps runs depcruise once per workspace dir (tsconfig
   paths resolve from CWD).
7. Enforce logic also fails `[none]` entries without `why`.
8. No [F:] tags on real tests yet; later phases tag their layers.
9. `yaml` declared at root (registry-sync's own dep; was hoisted).
10. Recorded items done: var/ excluded everywhere + guard test
    (4/4 pre-D1), stack refuses pilot-archive delete (+d.mts),
    `git clean -x` banned, reworded re-run bullet.

## Delta (review changes; one commit per item)

1. tierOfFile decides one tier from content (live > temporal >
   db gates; stress/fault/e2e by path; backend unit stays unit).
2. scanTags adds stress/fault/registry roots; backend vitest
   include widens the same way.
3. assertDeletablePath resolves first; refuses archive, contents,
   and ancestors (var/pilot, var, root); `..` covered by tests.
4. pre-push uses caller PATH, requires node 22 with clear errors.
5. Integration job ends with the tracked-file diff check.
6a. Typecheck covers all tests (backend +registry; frontend app
   +tests/frontend; node +tests/frontend-e2e with DOM lib,
   bundler resolution, no erasableSyntaxOnly; node types added).
   100 pre-existing test type errors fixed, zero product changes:
   unused vars, stale fixtures (ResearchState/WorkItem/WorkReview
   now match product types), bad casts, invalid `exact` options,
   untyped mocks, lib gaps. Lint 0 errors, typecheck EXIT=0.
6b. One item per commit from here on (this delta ships as 6).
6c. Mutation baseline runs at final verification on 0eb0da6 in
   a var/ worktree, not on later code.
7. Phase 2 drops `|| true` from `npm run quality` at 0 errors.

## Blocked

None.

## 3 weakest points

1. Mutation baselines are the only unmeasured AC; the harness is
   validated but the 5 scores don't exist yet.
2. Knip export/type counts (252/106) are inflated by test-only
   usage and dist consumption; Phase 2 triages, may allowlist big.
3. Backend duplication (3.12%) already exceeds the Phase 2 ≤3%
   bar; Phase 2 must net-delete clones.
