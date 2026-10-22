# Job control review (branch `job-control`)

Owner decisions (asked, both recommended options taken): pause stops the
agent immediately; quota trips auto-pause and auto-resume.

## 1. Full job control — done
- `companyJobPause` (`src/runs/company.ts:241`) now cancels the live run
  (engines stop it next tick), so pausing halts quota burn the same tick.
  Saved work stays in the DB; resume restarts the stage with it visible.
  Budget pauses inherit this. `company_job_pause` takes a reason.
- New `companyJobsPauseAll` (`:271`) + `company_jobs_pause_all` tool.
- Contract change (owner-authorized): pause used to drain. The pause test
  now asserts stop + restart. Evidence: `tests/runs/company.test.ts`
  pause/pause-all tests, `tests/mcp/tools.test.ts` reason + pause-all.

## 2. Live view — done
- New `companyJobLive` (`src/domain/company-jobs/live.ts:65`) + thin
  `company_job_live` tool: active stage/run, phase, areas done, last 10
  tool calls with times, job + run tokens, child-agent count, stall
  countdown; `active: null` when idle. Read-only, existing tables only.
- Evidence: domain test (seeded run) + tool idle assertion.

## 3. Quota breaker — done
- No provider quota-% API exists (verified: CLI has no usage command), so
  the 95% is self-calibrated from our own `provider_calls` meter.
- Exact trip on "Subscription quota exhausted" (`breaker.ts:30`): parses
  the reset time, parks the job paused (never failed/retried,
  `company.ts:663`), pauses all other running jobs (`:301`), blocks new
  claims. Auto-resume (`:361`) restarts exactly the tripped jobs at reset.
- Early trip (`:379`): at 95% of the learned allowance, once per window,
  with an estimated reset; a wrong estimate self-corrects on the first
  real 429. First window runs uncalibrated and teaches the allowance.
- Missing reset time holds for the owner (`quota_breaker_clear`; jobs
  stay paused for per-job resume). Plain rate-limit 429s still auto-retry
  without tripping. Personal Muse use is invisible to the meter, so the
  hard trip on the real error is the backstop.
- Tools: `quota_breaker_status` (burn vs allowance %) + clear. Evidence:
  6 breaker tests in `tests/runs/company.test.ts`, thin tool assertions.

## 4. Compose — done
- `restart: unless-stopped` on the db service (`docker-compose.yml:4`).

## Suite / deploy
- Full suite: 556 passed + 1 skipped; 1 failed = `shutdown.test.ts`, only
  because :8788 is held by another session's `tsx` process (pid 3296456,
  not mine — left running). Same shutdown sequence passes manually on a
  free port (SIGTERM → exit in 102ms).
- No migration (breaker lives in `harness_settings` keys). Deploy after
  merge: pull, `npm run build`, `npm run db:migrate`, restart the service
  (nothing mid-flight: pipeline is paused). No push yet — STOP for go.
