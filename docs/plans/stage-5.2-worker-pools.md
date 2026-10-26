Status: current · Date: 2026-10-26

# Stage 5.2 — Worker pools (AI pool + deterministic pool)

**Owner requirement (2026-10-23):** Muse quota is the scarce resource. While quota is available, it must
never sit idle because the pipeline is busy with deterministic work. Work runs **per stage, from queues**,
not as one company at a time. The company job stays the tracker: a company is done when all of its stages
are done.

This replaces items 1–2 of `ai-saturation.md` (handoffs, collect-ahead). Parallel extraction becomes part
of it. If the small parallel-extraction PR is nearly finished, ship it first; this stage replaces it later.

## Step 0 — Real quota numbers (report before building anything else)

- Find out whether the app's Muse exposes **actual usage % for the 5-hour and the weekly limit, with reset
  times**. Places to look:
  - a usage command or endpoint;
  - provider response headers or events in the run logs;
  - the "resets at …" error text.
- Report what exists. If no live % is available, say how we would estimate it (the learned window size,
  tokens per window) and how wrong that estimate could be.
- Also report whether **cached tokens count** against the quota.
- The app account is **separate** from the owner's personal Muse, so the app may use up to 95%.

## Step 1 — Stage queue

- **New table `stage_tasks`:**
  - columns: `company_job_id`, `stage`, `pool` (`ai | det`), `status`
    (`queued | running | done | failed | parked`), `priority`, `attempts`, `not_before`, `lease_owner`,
    `lease_until`, `last_error`, `created_at`, `finished_at`;
  - one active task per (company_job, stage).
- **Pools by stage:**
  - `ai`: company preflight, research, extraction;
  - `det`: collect, quote grounding, and any later non-AI step.
- **When a task finishes, the next stage's task is created in the same transaction.** No waiting for a tick.
- **Company job status is derived from its tasks.** Remove the global tick that walks every job.
- **Migration:**
  - in-flight runs finish as they are;
  - `created`/`scheduled` jobs become one queued task at their current stage;
  - terminated, cancelled and completed jobs get no tasks.

## Step 2 — Workers

- **Each pool has a supervisor** that keeps N workers running, where N is the pool's current target.
- **Claiming work:**
  - a worker claims a task with `FOR UPDATE SKIP LOCKED`, sets a lease, and heartbeats while it runs;
  - an expired lease puts the task back in the queue (attempt +1);
  - a task is never run twice at once.
- **Every worker runs independently.** One slow task never blocks another.

## Step 3 — AI pool size and order

- **Target size:**
  - `ai_max_workers` (64) while the 5-hour usage and the weekly usage are both below `ai_halt_pct` (95);
  - **0** once either one reaches it.
  - At the halt, no new AI tasks start, and running ones finish.
- **A quota error never counts as a failure.** The task goes back to the queue with
  `not_before = reset time` and no strike.
- **Order while quota is available:** extraction → research → preflight, oldest first within each stage.
  Finished companies pile up early.
- **From `ai_preflight_shift_pct` (85) up to the halt, only preflights start.** Each one unblocks a collect,
  so the deterministic pool has plenty to do during the pause.
- **At the reset time** (5-hour or weekly), the pool scales back up to the max automatically.

## Step 4 — Deterministic pool size

- It **always runs.** It uses no quota.
- **Size:**
  - `det_min_workers` (8) while the AI pool is on, which keeps a buffer of collected companies ready for
    research;
  - `det_max_workers` (32) while AI is halted.
- **Collect runs ahead.** It is skipped if a fresh collect already exists (the freshness window is a
  setting).
- **The memory guard applies to both pools.** AI work gets memory first.

## Step 5 — Visibility and control (MCP)

- **`pools_status`**, which shows:
  - mode (`ai_on | ai_preflight_only | ai_halted_5h | ai_halted_weekly`);
  - 5-hour and weekly usage %, with the reset times;
  - target vs actual workers for each pool;
  - queue depth for each stage, and the oldest waiting task.
- **`pools_set`** for every setting above; changes apply live.
- **`pool_pause` / `pool_resume`** for each pool.
- **Every report includes:**
  - AI slot fill % (average busy / target);
  - tokens per finished company;
  - % of tokens spent on failed or stalled runs;
  - completions per hour over the last 3 hours.

## AC

- **Tests:**
  - no task is ever claimed twice;
  - an expired lease puts the task back in the queue;
  - the next stage is created when a task finishes;
  - the pool targets change correctly at 85% and 95% (5-hour and weekly), and at the reset;
  - the priority order holds;
  - a quota error puts the task back in the queue with no strike;
  - company status is derived from its tasks;
  - restarting the server mid-run loses nothing.
- **Dev first:** run against `kardata_dev` with a fake Muse that reports usage %, through all four modes.
- **Live:** deploy using the drain, then report every 30 minutes for 2 hours. **Target: AI slots ≥ 90% busy
  while quota is below 85%, and no deterministic backlog holding up research.**

## Stop

Write the Step 0 findings and a short plan before you code. **STOP for the owner's go.** No push without the
go.
