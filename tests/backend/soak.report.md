# B5.6 soak report (synthetic 1000-agent fleet)

Harness-measured, not production telemetry: heartbeats and usage are
seeded, Temporal has no fleet role (pure sweeper core over DB rows,
real event recording, ledger projection, Prometheus gauges). Rerun via
`TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1 npx vitest run
tests/backend/soak.harness.test.ts`; this file is rewritten by that run.

Fleet: 1000 agents (healthy=880, idle-stalled=60,
tool-stalled=20, looped=25, near-budget=15).
Thresholds: defaults held (idle 60s, in-tool 120s, near-ratio 0.8) —
no retune needed at synthetic scale.

## Detection latency

- sweep batch p50/p99 over 11 runs: 1ms / 1ms (budget 10000ms) — PASS
- finding record path (120 findings): 158ms
- end-to-end pipeline (list + sweep + record): 175ms (budget 30000ms) — PASS
- stale beats at sweep time: 80 (expected 80)

## Alert precision

- induced stalls: 105, flagged: 120
- missed: 0 (budget 0) — PASS
- false positives on healthy agents: 0 (budget 0) — PASS
- finding kinds: missing-heartbeat=80, context-near=15, no-progress=25

## Cost and ledger accuracy

- fleet usage: 5496500 in / 2298500 out tokens, exact match — PASS
- fleet cost: $12.39 exact to the cent — PASS
- provider token spend at 1000-agent scale (synthetic $1/MTok in, $3/MTok out): $12.39

## Dashboard truthfulness

- kardata_runs_by_state matches seeded ground truth (RUNNING=895, PAUSED=80, SUSPENDED=25) — PASS
- kardata_stale_heartbeats matches seeded stale count — PASS

## Out of scope (not measured here)

- Live Temporal fleet behavior (crash redelivery, lane saturation) stays
  covered by tests/backend/temporal.lanes.test.ts against a real server.
- Prometheus series cardinality stays covered by the traces budget test.
- Production token tariffs replace the synthetic ruler above.

