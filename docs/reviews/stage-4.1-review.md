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

## Stage 4.2 — Grounding, capture, onsite fixes
- Grounding check after extraction (`src/domain/research/grounding.ts`, wired into `extractRun`; `verification` column via `0013`; never drops rows). Numbers/dates/short strings must appear normalized (commas, currency incl. USD→$, decimals, case) in cited source text, else in `[src:id]`/URL-carrying doc lines (agents cite inline URLs). Shares on scorecard + `batch_scorecard` + `eval:research`; `company_screen(verifiedOnly)` filters factKey criteria only. Tests: `tests/db/grounding.test.ts` (7), `scorecard`/`screening` updates.
- Re-ran extraction + grounding on the 10 v1.2 runs (no re-research), 8/8 areas each. Extractor shares, total 1621: verified 554 (34.2%), doc_only 126 (7.8%), unverified 941 (58.1%). Per run (v/d/u): Lust 71/6/111, ROWSE 34/6/81, Wander 60/28/108, Cheekbone 85/5/131, INSKIN 58/17/76, Beard 70/8/99, Wolf 55/6/74, Astral 12/10/50, WAXON 62/1/131, Cloré 47/39/80. Unverified is mostly non-checkable values + abstractive syntheses, per spec.
- `source_capture` now requires verbatim `passages` for via browser/muse_fetch (containment-checked); text <200 chars stored but flagged `thin` with a response warning. Prompt v1.2→v1.3: verbatim excerpts, never summaries/probes. Deleted 5 agent-made test sources (47skin Trustpilot snippet + homepage capture, Forte homepage capture, Lust homepage test, Wolf & Badger about capture) + the 18 facts / 13 records / 9 findings citing solely them; re-check finds 0 stragglers. Thin now 9/4466 sources.
- `reviews_onsite` logs displayed-vs-ingested per page (`details.displayedTotal` + run event). Pagination fixes in `harness/reviews.mjs`: Judge.me numbered pages accumulate deduped (swaps don't append; `jdgm-curt` excluded from "more"); Yotpo `aria-current="false"` no longer counts as current (was re-clicking page 2 forever). Final ingested/displayed: Forte 294/342, ROWSE 212/309, Wander 300/2880, Lust 300/14389, Cheekbone 203/2214, Nature's 4/4. Remaining Yotpo gaps are by-design sampling (300 cap, 14 rounds/page, ≤10 pages), not stuck pagers.
- Close-out: 8 MCP test call sites updated to the passages contract; `tests/service/shutdown.test.ts` flaked once under load (passes alone, untouched since Stage 1). Suite green: 43 files / 406 passed + 1 skipped (live); `tsc` + `eslint` clean.
