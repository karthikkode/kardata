# Phase 3 review: logging, observability, DB design

Branch `p2-3-observability` ← `p2-2-quality`. 20 commits (`cad5962`…`a6ef558`).
Diff: 95 files, +4601/−616. Gates per commit: typecheck 0, lint 0 errors
(71 warnings, baseline), quality 0.

## P3.1 research (one table)

| Reference | Take | Where | Result |
|---|---|---|---|
| Temporal OTel interceptors | client/workflow/activity context | `temporal/otel.ts`, gateways, workers | trace continuity e2e |
| OTel Node SDK spans | span attrs already in `tracing.ts` | unchanged | reused as-is |
| Langfuse data model | rounds/tool calls/scores tables | `execution_rounds`, `tool_calls`, eval views | new schema |
| OTel GenAI conventions | model/latency/token field names | `provider.round` payload, rounds columns | adopted |
| `pg_stat_statements` | server-side timings | stress tier (best-effort install) | adopted |

## AC

- Tests green: written, unrun under D1 (see Suites). Detection times live in
  `tests/fault/supervision.actions.test.ts` thresholds (`temporal/timeouts.ts`).
- Invariant counts equal: `temporal.execution-rounds.test.ts` (6 rounds/4 tools).
- 0 secrets in logs: P3.3 secrets test over a scripted turn with a fake key.
- Top-20 p95 < 100 ms: `tests/stress/db.volume.test.ts` asserts it (unmeasured).
- 100-writer run: `tests/stress/db.writers.test.ts` asserts 0/0/p95<50 ms.
- db/observability entries todo-free: 34 touched tiered + 10 `[none]`+why;
  legacy db todos stay (deviation 1). No observability entries exist (sync
  does not scan `observability/`).
- db.md stored-where table: added (`documentation/db.md` "What is stored where").

## Suites (step 4, deferred per D1)

`npm run verify:full`; `npm run test:fault`; `npm run test:stress`
(`KARDATA_STRESS=1`, `TEST_DATABASE_URL` set).

## Deviations

1. Legacy db todos stay: only the 34 Phase 3 entries tiered; repo-wide
   tagging needs suites + coverage the D1 deferral forbids.
2. P3.1 table lives here, not a separate doc (plan allows one table).
3. Retention test rewritten: old artifact cold-move assertions contradicted
   3.5.4 (knowledge stays hot); the plan text is the arbiter.
4. `readThreadExecutionReference` untested (route-only); stays todo.
5. Client derivation is route-based (`api_keys.client` arrives Phase 8).

## Blocked

None.

## Weakest points

1. `listSessions`-sector over 1M events may miss p95<100 (1M-tuple join
   for `updated_at`); fix at verification: sessions projection or cache.
2. 46+ stacked commits with only static signal; first suite run may surface
   projector/type drift in the stress seed.
3. Evaluation-view loop/stall attribution (first-kind/run-kind) is a
   convention, unvalidated against real supervision traffic.
