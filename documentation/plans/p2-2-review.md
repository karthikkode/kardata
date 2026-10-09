# Phase 2 review: code quality audit and consolidation

Branch `p2-2-quality` (stacked on `p2-1-foundation`, D2), 46 commits, one item
each. Diff: 290 files, +8840/−14157. Registry 907 entries (agents 121,
backend 216, db 415, frontend 77, mcp 78). Gates right before this file:
`typecheck` 0, `lint` 0, `quality` (knip+dup+deps, `|| true` dropped) 0.

## AC

- `quality` 0 errors, allowlist 2 scopes ≤ 25 (`quality-allowlist.json`: maxLines
  0, globalFetch 0, knip 2 ignore-dep scopes with reasons). Proof: `QUALITY_EXIT=0`.
- Duplication ≤ 3% per workspace, lines/tokens, base→head re-measured:
  agents 1.96/2.04→1.94/2.03, backend 3.41/3.12→2.95/2.76,
  frontend 1.29/1.03→1.27/0.97. Proof: `DUP_EXIT=0` + tables in §dup.
- 0 files over 800 (max: `db/file-jobs.ts` 796), 0 dep violations, all 5
  depcruise rules flipped to error (`20c491b`). Proof: `DEPS_EXIT=0`.
- knip: 0 unused files, 0 unused deps, 0 unused exports (log holds config
  hints only). Proof: `KNIP_EXIT=0`, zero "unused" lines.
- Test count / mutation vs Phase 1: verdict deferred to final verification
  per D1 (no suites ran). Static delta: test files 337→330; all 7 deletions
  are dead-subject cascades (2 supervision/loopguard suites, 5 dead-view
  suites); no surviving test lost its subject.

## Known items (§2.1.3)

Chat one surface (`components/chat/`, shell 755) ✓; `useModelCatalog` ✓;
`agents/src/http.ts` ✓; `data/api/` 16 modules + `client.ts` ✓; dead sector
views + 5 test suites deleted, survivors one purpose each ✓; gateways renamed ✓;
turn/workspace/tools/workspace-parts +3 splits, all < 800 ✓; supervision checks
to `supervision-rules.ts`, guarded runs deleted ✓. Rules (§2.2): `CLAUDE.md` ✓,
40-row reuse map ✓, ad-hoc line ✓, checklist line ✓, live-stack caller-PATH ✓.

## Directory audit (§2.1.2): tick + fixes this phase

- `agents/src` ✓ 2 (http client, registry prune) · `agents/src/fixtures` ✓ 0
- `backend/src` ✓ 3 (contract harness moved out, plan modules homed, yaml dep cut)
- `backend/src/auth|http|threads|streams|ledger|artifacts|archive` ✓ 1 (auth/types leaf)
- `backend/src/browserPool` ✓ 1 (barrel deleted) · `backend/src/providers` ✓ 2 (rename, finishers)
- `backend/src/mcp` ✓ 1 (tools split) · `backend/src/observability` ✓ 1 (supervision-rules)
- `backend/src/retrieval` ✓ 0 · `backend/src/db` ✓ 4 (splits, errors leaf, sessions kind)
- `backend/src/routes` ✓ 0 · `backend/src/temporal` ✓ 2 (runs-gateway rename+split)
- `backend/src/temporal/workflows` ✓ 1 (inbox-queue helper) · `.../activities` ✓ 2 (turn split, turn-legacy deleted)
- `frontend/src` ✓ 1 (tsconfig split) · `frontend/src/lib` ✓ 0 · `frontend/src/data` ✓ 1 (catalog hook)
- `frontend/src/data/api` ✓ 1 (new) · `frontend/src/components` ✓ 3 (chat split, views, catalog)
- `frontend/src/components/ui|chat|plan` ✓ 0/1/1 (chat parts, PlanTab actions)
- `frontend/src/test` ✓ 0 · `scripts` ✓ 2 (sync tiers, live-stack PATH) · `deployment/scripts` ✓ 0
- New audit finds beyond the plan: contract table re-homed 33+25 rows
  (`8db767f`), harness to `tests/backend/contract-harness.ts` (`31b2c7c`),
  `turn-legacy.ts` deleted — knip-blind, zero refs (`76849f1`).

## Deviations

- D1 (owner-confirmed): no suites; test-count/mutation verdicts at final verification.
- Depcruise frontend rule narrowed to ban `data/*-api` only; `data/api/*` sanctioned
  (`0beab29`) — the plan's literal rule predates the sanctioned split.
- Contract coverage names `LoadState` excluded (UI-state union, not wire).
- `SectorActivityEntry` dropped from parity (unexported, unrendered anywhere).
- `PATCH plan`/`POST approve` 409-overload dup variant left unsplit, needs review.
- `db/file-jobs.ts` at 796 lines noted, not pre-split (no mandate).

## Blocked

None.

## 3 weakest points

1. Backend dup 2.95% lines: 0.05pp under the cap, and jscpd exits 0 regardless —
   the ratchet is human-read until Phase 7.
2. 46 stacked commits with typecheck+lint signal only; first suite signal at final
   verification (accepted D1 risk, bisectable by construction).
3. `db/file-jobs.ts` (796) tips over 800 on the next edit; pre-split candidate.

## Step-4 suites (deferred per D1)

`npm run verify:full`; `npm run test:mutation`. Plus the standing gates above.
