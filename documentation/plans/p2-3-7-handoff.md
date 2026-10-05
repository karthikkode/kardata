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
- `59f9cdf`: this handoff doc started.
- `7e35334`: P3.3 log coverage (activity wrapper, outbox, workflow triples,
  static coverage + secrets tests).
- `90bb0d7`: P3.4 supervision that acts (control-before-record findings,
  `alerts` table + `GET /v1/alerts` + Agents panel, fault drills per row,
  1000-thread coverage test).
- `5adf469`: P3.5.1 execution records every round incl. in-turn compaction
  (`roundKind`, recovery replays turn requests only).
- `ac6cbb3`: P3.5.2 `execution_rounds`/`tool_calls` + all emitters + temporal
  invariant test; `turn.ts` split (`turn-rounds.ts`, `worker-mcp-auth.ts`).
- `6af52c1`: P3.5.3 `sector_documents.author_thread` (create/reference paths,
  keep-first, Files surface; uploads null).
- `156f7d0`: P3.5.4 retention keeps 7 knowledge event types hot;
  `cold_event_pointers` for moved operational events.
- `f30bddb`: P3.5.5 evaluation views + `GET /v1/sectors/:id/evaluation` +
  db.md stored-where table.
- `d62a4c9`: P3.6a stress seed (1M/200k/100k/20k/5k) + hot-20 p95 tier;
  tsconfig now covers tests/stress + tests/fault.
- `546c958`: P3.6b 100-writer × 5 min contention tier.
- `a6ef558`: tiers+tags for the 34 touched entries, [none]+why on 10
  re-exports; fixed the registry gate self-tag false positive.

Key design notes:

- `provider.chat` keeps its legacy op name; round fields are flattened onto it and
  also emitted as `provider.round`.
- `backend/src/observability/ambient.ts` is a leaf ALS module so `db/events.ts`
  can read trace/caller context without a `db → tracing → db` cycle.
- `ProjectableEvent` keeps MCP/projector replay compatible with pre-0025 events.
- Event `client` is route-derived for now (`/v1` → `ui`, `/mcp` → `agent-mcp`,
  else `other`; background → `system`). `api_keys.client` arrives in Phase 8.
- P3.4 ordering: Temporal signal/cancel runs BEFORE the finding record lands
  (a lost effect retries next page; `controlRecorded` dedupes per lease).
  Fail uses revivable ERROR, not PAUSED; a successor begin flips it RUNNING.
- P3.4 contract change: alerts are table-backed; the Agents panel renders
  kind/severity/subject (no sessionTitle/response/threadStatus). The `alerts`
  e2e fixture and panel copy were updated in the same commit.

Remaining Phase 3: `p2-3-review.md` only (build complete).

Phase 3 deviations (see review package): legacy db registry todos stay
(only the 34 touched entries tiered); `readThreadExecutionReference`
untested; P3.1 research table lives in the review package; retention
test rewritten (old artifact cold-move assertions contradicted 3.5.4);
`listSessions`-sector is the at-risk p95 query (unmeasured under D1).

## Phase 4 (branch `p2-4-capacity`, stacked on Phase 3)

- P4.2.1 turn slots + global Meta limiter; P4.2.2 worker replicas;
  P4.2.3 durable child queue + 409 refusal; P4.2.4 continue-as-new
  (`can.ts`, `patched('can-v1')`); P4.2.5 pool validation + `/mcp` rate
  limit; P4.2.6 coordinator concurrency 1..64; P4.2.7 positional
  idempotent turn keys. One commit each, all gated.
- P4.3 functional matrix DONE (commits 4.3a-f): agents 109 unit + 12
  none; routes 69 http.* tagged 1:1 + 2 gap tests; backend 146 +
  db 416 tagged via import/start/caller-chain attribution (worker and
  gateway registration excluded as non-execution); 3 dead activities
  deleted; 3 export-star barrels [none]; 10 gap tests (context-file
  factory/workflows, kb ingest, route gaps). 0 todos, 0 unknown tags
  across agents/backend/db/http.
- Findings for review: live routes without operationIds
  (queue/subagents/settings/context-files) are registry-invisible
  (Phase 5 spec-drift note); transitive tags prove execution, aspects
  at entry-point depth.

Remaining Phase 4: P4.4 (F1-F16 drills + 1000-child test) + review package.

## Verification status

- Per-commit gates only: `npm run typecheck`, `npm run lint`, `npm run quality`.
- No phase suites have been run yet under D1 (`verify`, `verify:full`, fault,
  stress, live, mutation, ui:review all deferred).
- Tests are written with each item but remain unexecuted until final verification.

## For Claude

Review each `p2-<N>-review.md` against the plan AC, then the stacked diff. Expect
unexecuted tests and unmeasured thresholds; do not ask for a suite until the owner
approves final verification after Phase 7.
