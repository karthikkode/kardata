# Phases 3–7 handoff for Claude review

Owner instruction (2026-10-05): build Phases 3–7 without per-phase Claude/owner
approvals, then stop after Phase 7 for approval before Claude review. D1/D2 stay
in force: lint/typecheck only while building, one item per commit, stacked phase
branches, no merges/pushes, no full suites until final verification.

## Where to look

- Plan: `/home/karthik/.claude/plans/now-i-need-you-scalable-brooks.md`.
- Phase review packages: `documentation/plans/p2-<N>-review.md` (written per phase,
  no stop until Phase 7 is complete).
- Branches: `p2-2-quality` (accepted) → `p2-3-observability` (active) → later
  `p2-4-*`, `p2-5-*`, `p2-6-*`, `p2-7-*`, stacked, unmerged.

## Phase 3 status

Done on `p2-3-observability` (all `TC_EXIT=0 LINT_EXIT=0 QUALITY_EXIT=0`):

- `cad5962`: hooks-only dependency rule + 27 grandfathered component importers.
- `45baf35`: jscpd threshold 3.
- `b15e15a`: Temporal OTel client/workflow/activity interceptors end to end.
- `9848a60`: activity log join keys (`trace_id`, run/thread/session/sector, attempt, round).
- `dde96f6`: provider round fields on turn rounds, compaction, direct callers, gateway lines.
- `efb49ca`: worker→`/mcp` `traceparent`; server continues via global trace plugin.
- `2b16f2a`: migration 0025 `events.trace_id/client` + indexes; ambient trace/client
  defaults; route caller ALS; gated temporal continuity e2e.

Key design notes:

- `provider.chat` keeps its legacy op name; round fields are flattened onto it and
  also emitted as `provider.round`.
- `backend/src/observability/ambient.ts` is a leaf ALS module so `db/events.ts`
  can read trace/caller context without a `db → tracing → db` cycle.
- `ProjectableEvent` keeps MCP/projector replay compatible with pre-0025 events.
- Event `client` is route-derived for now (`/v1` → `ui`, `/mcp` → `agent-mcp`,
  else `other`; background → `system`). `api_keys.client` arrives in Phase 8.

Remaining Phase 3: 3.3 log coverage/static/secrets tests, 3.4 supervision + alerts,
3.5 execution rounds/tool calls/retention/views, 3.6 DB stress, then `p2-3-review.md`.

## Verification status

- Per-commit gates only: `npm run typecheck`, `npm run lint`, `npm run quality`.
- No phase suites have been run yet under D1 (`verify`, `verify:full`, fault,
  stress, live, mutation, ui:review all deferred).
- Tests are written with each item but remain unexecuted until final verification.

## For Claude

Review each `p2-<N>-review.md` against the plan AC, then the stacked diff. Expect
unexecuted tests and unmeasured thresholds; do not ask for a suite until the owner
approves final verification after Phase 7.
