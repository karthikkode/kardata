# Stage 5.7 review — RIA sector

## Acceptance criteria

- B1 playbook → [profile.ts](/home/karthik/projects/kardata-ria/src/domain/sector-preflight/profile.ts:54) (`playbook` default d2c, `ria` thresholds), [profile.json](/home/karthik/projects/kardata-ria/docs/sectors/ria/profile.json) → `tests/unit/sector-profile.test.ts` (d2c hash unchanged, ria minimal, skincare parses as d2c).
- B2 SEC import → [imports.ts](/home/karthik/projects/kardata-ria/src/domain/imports.ts:528) `importSec`, [parse.ts](/home/karthik/projects/kardata-ria/src/lib/sec/parse.ts), migration `0039_ria_sec_import` (CRD key) → `tests/db/sec-import.test.ts`, `tests/unit/sec-parse.test.ts`. SEC format verified live on sec.gov (monthly ZIP, one 448-column CSV); UA `Kardata karthik@kardata.co`.
- B3 rule preflight → [ria.ts](/home/karthik/projects/kardata-ria/src/domain/sector-preflight/ria.ts:34) `evaluateRia`, derive in `eligibility.ts` → `tests/unit/ria-preflight.test.ts`, `tests/db/ria-preflight.test.ts` (groups/reasons, override wins). No LLM: classifier returns before any model call.
- B4 collector → [sec-firm.ts](/home/karthik/projects/kardata-ria/src/collect/collectors/sec-firm.ts:81) `secFirmCollector` (IAPD record + Part 1 compilation via `fetchUrl`) → `tests/collect/sec-firm.test.ts` (ok / not_found / error, SEC UA asserted).
- B5 prompts → [prompt.ts](/home/karthik/projects/kardata-ria/src/runs/prompt.ts:28) `ria-v1` by playbook, `prompts/research-ria-v1/`, `prompts/extract-ria-v1/` → `tests/unit/ria-prompts.test.ts` (six briefs, no plausibility section).
- B6 ICP + sheet → [judge.ts](/home/karthik/projects/kardata-ria/src/domain/icp/judge.ts:338) `decideRia`, [ria-rules.ts](/home/karthik/projects/kardata-ria/src/domain/icp/ria-rules.ts), [sheet.ts](/home/karthik/projects/kardata-ria/src/domain/icp/sheet.ts:223) `riaSheetRows` → `tests/unit/ria-icp.test.ts` (score, preflight exclusion, group contact, time zones).
- B7 e2e + guard → `tests/db/ria-e2e.test.ts` (synthetic sector: import → preflight → collect → research → extraction → ICP → sheet), `tests/unit/sector-agnostic.test.ts` unchanged and green.

## Part O counts (2026-10-31, sector `ria-us`)

- Imported 17,210 (SEC file `ia100226.zip`, 2026-10-02), skipped 0. Eligible 8,072 (P 5,105 / R 2,967); aside 9,138 (not_wealth 4,691, not_us 2,252, large 1,545, no_staff 383, exempt_or_inactive 267).
- Collector queued for all 8,072 eligible (`sec_firm` only). Pilot: 10 company jobs (5 P / 5 R). R wave: 150 more jobs started. Concurrency at ceiling (agents 64, extraction 64, company 100, collect 12); quota breaker untripped (weekly 65%).
- Throughput so far: preflight 17,210 firms in ~10 min (rules, no tokens). Research throughput not yet measurable: no firm has completed research (see Unfinished). Sheet exported (0 rows for now): `~/kardata-live/var/sectors/ria-us/analysis/companies-2026-10-31.csv`; re-export after ICP.
- Skincare unchanged: baseline eligible 626 / ineligible 7,150 / sheet 454, re-checked equal before and after deploy.

## Deviations

- PR [#111](https://github.com/karthikkode/kardata/pull/111) merged on green CI; deployed with `scripts/deploy-live.sh` (health ok). Two exact-count tests updated for the new tool/collector the plan requires.
- Import facts are written with `addFacts` per firm; a batched rewrite is committed locally (`3f5f9cc`, unpushed) for monthly re-imports — not deployed, to avoid restarting mid-operations.
- Pilot firms are the first eligible per group, not yet ranked by collector signals (collect queue still draining); R wave likewise starts in file order. Ranking applies to later waves.
- RIA research areas map to stored areas (firm_and_fees→financials, people_and_ops→decisions, systems→product, deals_and_growth→business_model, compliance→other); brief names follow the plan.
- `not_us` includes firms whose SEC row leaves the main-office country blank (cannot prove US); revisit if the owner wants them reviewed instead.

## Unfinished (running, not blocked)

- Collector for 8,072 firms runs for hours (SEC host politeness, ~2 s/host). Pilot scorecard check, prompt fixes if needed, remaining R then P waves, `sector_icp_start`, and the final sheet follow as research completes. No outreach, no sheet writes, no Apollo purchases.
