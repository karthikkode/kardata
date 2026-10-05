# Phase 0 review: Stop the waste

Branch: work merged to `main` as `cb15608` (pre-protection); this file on
`p2-0-review`. Stat vs `92a0573`: 26 files, +811/-680. Phase 0 items are a
subset: 2 JSONs archived, 2 tests deleted, 3 docs scrubbed, README + status
noted. The same commit also holds owner-approved deploy hardening (with-env,
port guards, stack:clean, restart) and the two-tier checklist; those carry
their own tests and are out of Phase 0 scope.

## AC

- Narrow grep (`UPDATE_HARDENING_*|hardening.catalog|hardening.acceptance`,
  excluding `archive/` + `plans/`): 2 hits, both dated history in
  `implementation-status.md:70,3698`. No live instruction remains.
  Literal 0 NOT met; history left intact per item 6. Proved by the grep
  itself (rule-8 subagent re-ran it; delta re-checks below).
- `git ls-files 'docs/deep-checks/*.json'`: only `archive/` paths. Met:
  delta moved `preflight-authority-review.{md,json}` into `archive/`.
- `AGENTS.md` has "Forbidden work": met (`AGENTS.md`, 5 bullets).

Retire behavior is proved negatively: `pr:verify` contains no hardening
test (files deleted at HEAD) and the suite is green without any regen
step. No dedicated test was added for a deletion.

## Suite (step 4, after review)

`KARDATA_META_KEY= npm run pr:verify`. Already green on this exact tree:
frontend 778/6, agents 282/2, backend 694/545, lint 0 errors, typecheck
clean, build green, compose config valid. Re-runs only if review requests
changes (§2.1.4).

## Deviations

1. Old `deep-checks/README.md` also moved to `archive/` (reversible).
2. Forbidden-work bullets are terser than a §2.1 copy; same five bans.
3. Status entry covers the whole merged change (~13 lines), not ≤ 5.
4. Amendments adopted for later phases: env via `node scripts/with-env.mjs`
   (§2.2 `set -a` fails on `|`); pilot worktrees/archive under ignored
   `var/pilot/` (sandbox denies the pinned outside-root paths); merge each
   accepted phase via PR (owner chose merge-per-phase); per-phase push nod
   needed for CI (protection is on).

## Blocked

None.

## 3 weakest points

1. One AC line is literally unmet (2 history hits in the status log).
2. The retire has no positive test, only suite-absence + grep.
3. Reviewed after merge: protection landed after `cb15608`, so Phase 0
   never went through a PR; Phase 1+ will.

## Suite result (authorized run, EXIT=0)

`KARDATA_META_KEY= npm run pr:verify`, full log `var/p2-0-verify.log`.
- frontend: 778 passed / 6 skipped (89 files, 1 skipped file).
- agents: 282 passed / 2 skipped (32 files).
- backend: 694 passed / 545 skipped (89 files, 82 skipped files).
- lint: 0 errors, 7 warnings (pre-existing react-hooks + bundle).
- typecheck: clean all workspaces. build: frontend ✓ in 513ms.
- 0 failures; the 6 "FAIL" strings in the log are expected
  `TEST_LISTEN_FAILURE` codes inside passing error-path tests.
- Spend: 0 provider tokens (no live tests in this suite).
