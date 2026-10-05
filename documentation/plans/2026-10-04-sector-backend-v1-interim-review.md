# Sector backend v1: interim review handoff (2026-10-04, ~00:15 IST, round 4)

> For Claude review. Full evidence handoff (B5 format):
> `documentation/plans/2026-10-04-sector-backend-v1-handoff.md` (draft, gates +
> spend totals fill in after the final runs). Branch `sector-backend-v1`, never
> pushed, never merged. Base `main @ 042bd18` (owner override; spec's
> `ui-revamp-v2` no longer exists). Round-4 fixes 1-4 are implemented and
> unit-tested but UNCOMMITTED; no commits or full suites until Claude approves.

## Done

- Stages 0-3 committed, one commit per stage: `456a7b5`, `3cba53b`,
  `ebb74c0`, `429e6bf`. Stage 4 (walkthrough + handoff + gate) uncommitted.
- A1-A20 implemented with unit tests. `KARDATA_META_KEY= npm run pr:verify`
  GREEN: lint/typecheck clean, frontend 772 passed / 6 skipped, agents 282
  passed / 2 skipped, backend 676 passed (DB-gated tests skip without env),
  frontend build clean.
- All 19 live backend tests green with real Meta (tries=1 each unless noted):
  L-A19, L-A3, L-A1, L-A4/A5, L-A6, L-A7, L-A8, L-A9 (2 tries, prompt
  hardened), L-A10, L-A2/A12, L-A13, L-A14, L-A15, L-A16, L-A17, L-A18,
  L-PLAN, L-LOCAL. Spend per test recorded in the full handoff section 5.
- B4 browser walkthrough GREEN (run 12, 15/15 steps, 2.4 min). All 16
  screenshots opened and hand-verified against their claims (full handoff
  section 4 table). Shots uncommitted under
  `tests/evidence/sector-backend-v1/b4-*.png`.
- 6 bugs found while testing, each fixed with a test. The two found by B4:
  CORS preflight missing `Idempotency-Key` (killed keyed staging-UI
  mutations), and context-change ids namespaced `<keyId>:<key>` colliding
  across sectors (now `<sectorId>:<keyId>:<key>`, cross-sector unit test).
- Docs updated: `sector-workspace.md`, `agents-context.md`,
  `agents-subagents.md`, `mcp.md`, `db.md`, `tests.md`,
  `implementation-status.md`, `coverage-registry.md`, hardening
  catalog + acceptance surfaces regenerated green.

## Round-4 fixes (done, uncommitted, unit-green)

1. Proposal wipe: PATCH semantics (merge at creation, '' clears, no-op
   rejected, approval applies merged doc). 3 DB tests green.
2. Subagent names: V2 launch name kept by projector, MCP defaults
   `Subagent N`, shared `subagentDisplayName`, raw keys in tooltips
   only. Backend + UI tests green.
3. @title composer: pick inserts `@title`, mapping in composer state,
   send expands via `send(steer, text)`, delete drops mapping. 3 UI
   tests + neighbors green.
4. Background spend: `sector.context.ai_usage` events (never deleted)
   + `usage.aiUsage` sums. Record/read/dedup/survival test green.
   Docs updated (`sector-workspace.md`, `agents-subagents.md`,
   `agents-context.md` via mcp note); full handoff bugs 7-10.

## Pending (gated on Claude approval, then in order)

1. Commit fixes 1-4 + CORS + id-namespace (explicit paths only, never
   `git add -A`: sandbox placeholder files in repo root).
2. Full backend DB suite re-run (was 1160 passed / 56 skipped / 0
   failed on pre-fix code).
3. Full Playwright suite on 15174 (non-live specs).
4. Every live test re-run: final L-A1/A3/A19 numbers, fix-1 proofs
   (L-A2/A12 + B4 step 9 v4 keeps Scope), b4-13 re-shoot.
5. Fill handoff sections 2 (gates) + 5 (spend grand total incl.
   aiUsage), Stage 4 commit with hash, stop the live stack (leave
   `kardata-live` namespace + `kardata_live` DB in place).

## Blocked

None. No red gates outstanding; every failure so far was root-caused and
fixed (product or test side, recorded in `docs/implementation-status.md`).

## Reviewer notes

- Screenshots are asserted by hand (opened, not pixel-pinned); 16/16 opened.
- Round-4 fixes answer the review 1:1; file list: `backend/src/db/
  workspace.ts` (PATCH merge, ai_usage), `backend/src/db/threads.ts`
  (V2 name), `backend/src/threads/project.ts` (V2 schema),
  `backend/src/mcp/schemas.ts` + `tools.ts` (partial schema, MCP
  default name), `backend/src/routes/workspace.ts` (partial
  route), `backend/src/temporal/activities/context-files.ts`
  (spend emits), `frontend/src/components/SectorWorkspace.tsx`
  (names, @title), `SubagentsPanel.tsx` (shared helper),
  `frontend/src/data/useWorkspace.ts` (send override), plus
  tests + area docs.
- Review the full handoff for per-item AC evidence; this note is only the
  status wrapper.
