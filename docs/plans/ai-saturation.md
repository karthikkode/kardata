# AI saturation: no idle slot, no wasted quota

Goal: while quota is available, all 64 agent slots stay busy on research;
when quota is tight, only deterministic work runs. One work item, six steps.

Constraints: keep the 64 agent cap. No prompt changes during layer 1.
Operate the wave via MCP only. Deploy between work with the drain script.

## Step 0 — land the hotfix (code done, needs push/PR/deploy)

Branch `hotfix/stuck-retry-collect-knob`, two commits, tests green
(tests/runs/company.test.ts 46, tests/runs/runner.test.ts 14).

- Retry requeues failed jobs whose stages all passed (the 4 quota-stuck
  companies: research succeeded but the row says failed, and no MCP tool
  could move them). Auto-retry that throws after beginning a run now
  leaves the job scheduled instead of stranding it failed. Job status
  also shows the last 20 events, oldest first.
- The collect engine follows the DB knob every tick. Until this ships,
  `collect_concurrency_set 24` only widens the feeder, not the engine:
  the standalone runner is boot-fixed at 3 (each). This makes 24 real.

After deploy: retry the 4 stuck jobs via MCP, verify the engine runs
above 3 wide, then start Step 1.

## Step 1 — fast handoffs

Measured today: the worker tick walks 2,581 jobs, 96% terminated
tombstones (~12-17k queries/tick), and runs each extraction inline
(8 sequential model calls, minutes). ~62 of 90 feeding jobs sit idle
between stages. Worst handoff delay is minutes.

- Tick query drops `terminated` (2,581 rows -> ~94). Terminated rows
  can never change state; driving their leftover rows is waste.
- Extraction moves out of the tick into an in-process pool (cap 2):
  the tick offers running extraction rows to the pool without awaiting;
  the pool drives them concurrently and completes the job inline, as
  today. Restart recovery keeps working (compare-and-set on the row).
- Kick on finish: engines call `kick(jobId)` (one `tickJob`) when a
  subjob turns terminal, so the next step begins in seconds. The 15s
  tick stays as the backstop (quota resume, claims, checkpoint).

Tests: terminated jobs are never described; a slow fake extraction no
longer stalls other lanes in the same tick; kick advances a job without
waiting for the poll. Acceptance: sustained completions/hour rises with
no other change; p95 stage-handoff gap under 60s.

## Step 2 — collect ahead (operation + one code change)

Raw collect-ahead alone is NOT worth it: the company worker always
re-runs its own collect (no fresh-skip), so backfill without a skip is
pure double-fetch on a shared FIFO engine. Do both:

1. Fresh-collect skip in the company worker: when a company's existing
   collect output (<=14d) covers the preflight plan's adapters, skip
   the collect subjob and fold the adopted docs into the research
   brief with their source ids. Tests: skip taken when covered, taken
   never when stale or short; brief cites adopted docs.
2. Backfill via `collect_start` batches (<=100): ~150 layer-2 eligible
   without jobs first, then layer-1 companies whose jobs are still
   `created`. Pace 100 at a time at width 24; watch fetch errors.
   Do NOT use bulk `collect_sector` (whole-sector scope, wrong lane).

Preflight-ahead: NO. Reports are keyed to jobs, there is no hold
state, and preflight is agent work (same model/harness as research) —
running 151 early would starve live research of slots and quota.
Preflight stays in-flow; it is short (15 min / 30 steps).

## Step 3 — stalls: measure first, then fix

Honest status: the "64 stalls / 18% / ~150M tokens in 24h" figures
could NOT be verified — no MCP surface enumerates runs, and stall
tokens are zeroed everywhere (`agentUsage=null`, reconcile drops
them). Visible now via MCP: 8 stall-flagged jobs (3 terminal stalls
examined, 5 auto-recovered). The 3 examined stalls are all real
agent-side hangs in fetch loops (300s silence, 0-6 areas done), not
slow tools. ~1 in 6 companies shows a prior stall-and-recover.

1. New read-only MCP tool `research_stall_stats { sinceHours, stage? }`:
   runs total/stalled/% in window, metered stall tokens (provider_calls
   by run) plus estimated (weekly per-ms rate x wall time), top jobs.
   No migration. Also ingest provider rows for stalled outcomes and
   clear stale errorClass/streak on stage success (16% of sampled
   completed jobs carry stale stall flags today).
2. Measure 24-48h. Report real incidence and waste before fixing.
3. Fixes, in order: (a) fetch-loop wedge — cap in-flight fetches,
   shrink maxChars for XML/JSON endpoints, per-tool result timeout in
   the harness (harness/fetcher changes, NOT prompts); (b) faster
   tripwire — >=2 tool_calls with no result in ~120s stops the run
   instead of 300s; (c) retries resume from areas without `done`
   instead of from scratch. Each fix ships with a before/after
   stall-share reading from the new tool.

## Step 4 — quota-tight mode test

The behavior is already built and half-tested: a trip pauses only
credit-burning jobs (`pauseCreditJobs`) while live/next collect and
complete-ready jobs flow, and ticks hold agent/extraction begins
while tripped. Two tests cover the trip and the hold. Missing: the
extraction half. Add one test: tripped with (a) a job holding a live
extraction row -> paused, row cancelled; (b) a research-done job ->
extraction NOT begun while tripped, begun after clear; (c) a live
collect -> flows to done mid-trip. If the test finds the active-branch
drive path ignores the hold, fix it in the same step.

## Step 5 — report metrics

Extend `pipeline_status` with a `metrics` block (read-only, no
migration; all from `research_runs` + `provider_calls` over 24h):

- `slotFillPct`: average busy agent slots / 64, reconstructed from
  run started/finished spans in 1-minute buckets (running,
  non-extraction agent rows).
- `tokensPerCompleted`: provider input+cached tokens attributed to
  jobs completed in window / completions.
- `wastePct`: provider tokens on terminal-failed/stalled runs /
  total provider tokens in window. Needs Step 3.1 attribution to
  read above zero.

Tests: a seeded window (busy spans, one failed run with provider
rows) yields the exact three numbers. Every wave report then quotes
all three.

## Order and gates

Step 0 deploys first (drain). Steps 1+2 (skip part) land together —
the handoff rewrite touches the same tick code. Step 2 backfill runs
after that deploy. Steps 3.1, 4, 5 are independent and can share one
release; Steps 3.3a-c follow measurement, one release each at most.
Full suite once per release; wave tending continues between releases.
