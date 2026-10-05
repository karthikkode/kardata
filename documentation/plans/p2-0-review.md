# Phase 0 review: Stop the waste

Branch: work merged to `main` as `cb15608` (pre-protection); this file on
`p2-0-review`. Stat vs `92a0573`: 26 files, +811/-680. Phase 0 items are a
subset: 2 JSONs archived, 2 tests deleted, 3 docs scrubbed, README + status
noted. The same commit also holds owner-approved deploy hardening (with-env,
port guards, stack:clean, restart) and the two-tier checklist; those carry
their own tests and are out of Phase 0 scope.

## AC

- Narrow grep (`UPDATE_HARDENING_*|hardening.catalog|hardening.acceptance`,
  excluding `archive/` + `plans/`): 4 hits, all dated history
  (`implementation-status.md:70,3698`,
  `preflight-authority-review.md:669,670`). No live instruction remains.
  Literal 0 NOT met; history left intact per item 6. Proved by the grep
  itself (rule-8 subagent re-ran it).
- `git ls-files 'docs/deep-checks/*.json'`: the 2 archived JSONs plus the
  old `preflight-authority-review.json` artifact (dated review data, not an
  inventory). Literal "only archive/" NOT met; artifact left in place.
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

1. Two AC lines are literally unmet (history hits, preflight JSON).
2. The retire has no positive test, only suite-absence + grep.
3. Reviewed after merge: protection landed after `cb15608`, so Phase 0
   never went through a PR; Phase 1+ will.
