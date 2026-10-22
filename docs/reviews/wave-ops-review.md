# Wave-ops review (branch `release/wave-ops`, on `main@b4a2ca9`)

Four commits, one release: the live wave keeps running through the
deploy (drain), then sees truthful job states and full agent slots.

## 1. Quota hotfix (`a2af2a9`) — done
- `windowBurn` summed into `::int` and crashed past 2.1B tokens, which
  broke `quota_breaker_status` and the monitor on live. Now `::bigint`
  (`src/domain/quota/breaker.ts`), the tick never lets the monitor break
  the feeder, and the first window self-calibrates on the first real 429.
- Evidence: `tests/runs/company.test.ts` "meters burn past int4 max".

## 2. Job lifecycle (`eba9012`) — done
- Company jobs: CREATED → SCHEDULED → RUNNING, plus PAUSED, COMPLETED,
  FAILED, TERMINATED (`src/db/schema.ts:COMPANY_JOB_STATUSES`). RUNNING
  now means an agent is actively working: the feeder admits CREATED to
  SCHEDULED within the cap, and flips to RUNNING only while a live
  non-terminal subjob exists (`src/runs/company.ts`).
- TEXT + CHECK, not an enum: drizzle migrates in one txn where new enum
  values are unusable. Migration `0023` backfills queued→created,
  cancelled→terminated, runless running→scheduled, so in-flight
  containers survive. Bulk/sector launches stay deferred; resume, retry
  and auto-retry land on SCHEDULED (never jump the cap).
- Evidence: 34 company tests, pipeline/migrate/preflight/tools updates.

## 3. Feeder (`ad02a18`) — done
- Extraction rows (kind=agent, running, worker-driven, no container)
  were counted against the agent cap; live showed 5 of 8 slots busy.
  `countActiveRuns` now excludes `stage=extraction`, matching the agent
  engine (`src/runs/company.ts:609`). `MAX_AGENTS_MAX` 8→16.
- Evidence: two feeder tests (extractions never block, real runs do);
  `tests/runs/jobs.test.ts` validates 1..16.

## 4. Drain deploys (`1251a0d`) — done
- Default path freezes promotion (checkpoint at current completed),
  waits for live jobs (2h cap), then pulls/builds/migrates/restarts and
  restores the checkpoint. Timeout restores and aborts. Already-paused
  stays paused. `--force` keeps pause-all. Straggler re-check before
  restart; migrations must stay additive (old code runs till restart).
- Evidence: `bash -n` + stubbed rehearsals of drain, timeout and
  --force paths (scratch, `/tmp/drain-test*.sh`, not committed).

## Deploy notes
- Live still runs pre-release code (usage readout crashes there now).
- Deploy with `scripts/deploy-live.sh` from this branch's live checkout
  after merge; a drain window needs <16 live jobs to finish in 2h.
- Flake: one company-test failure passed twice on re-run (timing?);
  full suite green since: 562 passed, 1 skipped (live-only).
- No push yet; branch ready for owner go.
