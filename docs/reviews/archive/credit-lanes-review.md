Status: done · Date: 2026-10-26
Banner (2026-10-26): in this old review, "Layer 1/2" means research wave and "core/adjacent" is retired (see docs/business/icp.md, Terms). Company names below predate the no-names rule in AGENTS.md.

# Credit-lanes review (branch `credit-lanes`, on `main@6c18cb2`)

Six commits: perishable credits spend first, free work fills the rest,
exhaustion flips to collect-only. Full suite: 579 passed, 1 skipped.

## 1. Feed lanes (`b9bed54`)
- Tick feeds agent-next jobs before collect-next (`feedLane` on
  `describe.nextStage`, complete-ready first). FIFO within a lane is
  the starvation guard; claims stay FIFO (all enter at preflight).
- Evidence: `tests/runs/company.test.ts` "feed lanes" (2).

## 2. Deterministic trip (`02269ca`)
- Trips pause only credit jobs; live/next-collect and complete-ready
  flow. Fed jobs hold agent/extraction begins while tripped.
- Evidence: quota breaker "trip pauses credit jobs", "tick holds agent
  begins while tripped but feeds collect".

## 3. Pacer (`3c83ecc`)
- `paceAgents` fits launches to budget-vs-time-left (floor 4, never
  above operator max); uncalibrated runs flat-out. Feeder and engine
  share it via `effectiveMaxAgents`; override bypasses.
- Evidence: `tests/runs/jobs.test.ts` "quota pacer" (6).

## 4. In-flight meter (`e50eec7`)
- Live preflight/research burn estimated from a learned rate (50k/min
  fallback); extraction excluded (inline-logged). Pacer, early trip
  and status (`burn` + `inflight`, pct on total) all use it.
- Evidence: "in-flight estimate" (3), pacer in-flight test, early-trip
  integration test.

## 5. Collect knob (`b34e3ac`)
- `collect_concurrency_get/set` (1..64); feeder and engine read the
  effective width per tick; trips open it to 64.
- Evidence: "collect settings" (2), tools round-trip + list.

## 6. Memory guard (`b8da2a9`)
- Engine holds launches below 12 GB available (same floor/log as
  sector); `systemMemAvailableMB` moved to settings for sharing.
- Evidence: agent-runner mem-hold test.

## Deviations
- Resume staggering dropped: staggering row flips cannot spread
  begin-load; the pacer throttling begins + launches subsumes it.
- Starvation guard is FIFO-in-lane, not an N-hour jump: caps are
  per-resource so ordering cannot starve either lane.
- Added `agentsAllowed/agentsMax` + `inflight` visibility beyond the
  plan text, so a throttle never reads as idle slots.
- Lanes key on the describe (reused, no added queries): the row's
  `currentStage` lags a stage behind and mis-lanes every job once.

## Left for after merge
- Set collect to 24 via the new tool; watch the first real 429 teach
  the upgraded allowance + window, then confirm smooth throttling.
- Extraction parallelism stays a separate follow-up (stacks with this).
