# Stage 4.1 review — Extraction, reviews, fence, bulk jobs (Steps 1–5)

## Step 1 — Extraction (`64c2813`)
- `--output-schema` proven headless in `kardata-agent` first (strict schema: `additionalProperties:false`, all keys required, optionals nullable); `extract_run` runs 8 tool-less calls (7 areas + synthesis) and attributes writes to `extractor` (`src/runs/extract.ts`, `src/harness/extract.ts`). Tests: `tests/runs/extract.test.ts`, `tests/harness/extract.test.ts` (fake harness: validation, out-of-list citations dropped/counted, attribution).
- Live re-extraction of the 8 Stage 4 runs, no re-research: v1 batch `f9d49b38` (3 stalled originals still yielded 35–55 facts each) + v1.1 batch `779485a6` → extractor totals 364 facts / 239 records / 220 findings. Split holds everywhere: agents 0 facts/records/findings, docs only.

## Step 2 — On-site reviews (`28e6895`)
- `reviews_onsite` collector (`src/collect/collectors/reviews-onsite.ts`, Chromium job in `harness/reviews.mjs`): Judge.me/Yotpo/Stamped/Okendo/Loox/Junip/Reviews.io + JSON-LD + accessible-cards fallback; robots pre-check, ≤10 pages, 300 cap; identity never emitted. Tests: `tests/collect/reviews-*.test.ts` (fake pages per vendor + JSON-LD).
- Live on the 2 widget pilots: Forte 74, Nature's Care 3. Current review totals: Forte 74, ROWSE 56, Wander 38, Lust 34, Cheekbone 15, Wolf 5, Nature's Care 3, Cloré 1 (all distinct, no dupes).

## Step 3 — Fence, v1.2 prompt, PII (`ce79ca9`)
- Per-company `--allowed-origins` (apex/www/shop/website/myshopify); mechanical proof: amazon.com `ERR_BLOCKED_BY_CLIENT`, example.com ok. All 10 v1.2 runs: forbidden 0 (`src/runs/agent-runner.ts`, `tests/harness/docker.test.ts`).
- `prompts/research-v1.2/`: depth + `[src:uuid]` per claim, no structuring tools, no reviewer names; PII scan redacts `First L.` near review words at finalize (`src/domain/research/pii.ts`). 6 real hits redacted on Lume 3b; 0 hits on all Stage-4/4.1 pilots since.

## Step 4 — v1.2 pilot + gates (`ec1b42e`; agent+extractor only, 10 runs: 4 pilot + 6 job)
- ≥25 facts 9/10 (Astral 24); ≥30 records 5/10 (20–29: Astral, INSKIN, WAXON, Lust, ROWSE); ≥5 findings with 2+ cites 10/10 on count (18–38 each, not 100%); reviews ≥100 N/A (best Forte 74; 4/6 job companies skipped, no supported widget); 0 PII 10/10; 0 off-domain 10/10; ≤30 min 10/10 (8–28 min); all areas done.
- Extraction cost/company: 226–260k fresh + 46–116k cached in, 61–85k out, 8 calls. Agent cost dominates (~3.6–10.3M in, 97% cached).
- Exports: `var/exports/inskin-cosmedics-610d8c71`, `var/exports/wolf-badger-3974a0bf` (+ Step 4 `wander-beauty-30eb2cda`, `rowse-5639ee75`). `var/` gitignored.

## Step 5 — Bulk jobs (`77ed61f` + `3313497` interface alignment)
- Tools per plan: `research_sector` (criteria/sort/maxCompanies/budget), `research_shortlist`, `collect_sector` (now a job), `job_status` (counts/active runs/tokens/avg min/ETA), `job_pause/resume/cancel` (stopRunning choice)/`retry_failed`/`list`, `harness_settings_get/set` (global 1–8, DB-backed, also caps the agent runner). `research_runs.job_id` set per run. Tests: `tests/runs/jobs.test.ts` (17: feeding, runtime concurrency change, pause/resume/cancel, skip-if-recent, token+hour budgets, 3-same-errors auto-pause, restart recovery incl. mid-extraction, ETA math, settings) + `tests/runs/sector.test.ts` (6, job-based).
- Live `research_shortlist` job `167b3db0` (INSKIN, Beard Struggle, Wolf & Badger, Astral, WAXON, Cloré) at concurrency 3: fed exactly 3, paused once via MCP (nothing new started), resumed, completed 6/6 in 52 min wall (avg 18.8 min/co), 64.9M tokens spent, 393 facts / 223 findings. Concurrency restored to 4 after.

## Deviations & unfinished
- Step 5 first landed as `bulk_*` with per-job concurrency; `3313497` realigned to the plan's tool names, global `harness_settings` concurrency, `job_id` on runs, {maxTokens,maxHours} budgets (`0012`). `startCollectSector` removed; `collect_sector` is a job.
- `collector_end` events log `area:status` without the skip/not_found reason (cosmetic; reasons live in code paths).
- Record gate is the systematic miss (5/10 <30 extractor records) — extractor writes what the notes support; notes are fact-dense but record-sparse on some companies.
- Suite: `npm test` 42 files / 388 tests passed + 1 skipped (live) in ~145 s; lint/typecheck clean. Close-out fixes: `migrate.test.ts` table list (+3 job tables), `agent.test.ts` latest-version expectation (was hardcoded v1.1). No push.
