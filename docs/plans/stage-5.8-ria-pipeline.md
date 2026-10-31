Status: current · Date: 2026-10-31

# Stage 5.8: A clean RIA pipeline

Stage 5.7 put RIA firms through the D2C company job: an AI planning step per firm, D2C collectors, and a
multi-agent deep research run. Result: 6–25M input tokens per firm, about 10 firms an hour, roughly 2 of 3 jobs
in the later waves failed, and the weekly Muse quota rose to 82% for 103 firms. That design fits D2C, where facts
are scattered across the web. It doesn't fit RIAs: almost everything a call needs is filed with the SEC, in
structured data or in one brochure per firm.

This stage replaces the RIA path with its own pipeline: **code does everything structured; AI is used only for
two short single-call reads per firm; deep research is a separate, opt-in step for a named list.** The D2C pipeline
is unchanged. Business rules: `docs/sectors/ria/icp.md`.

## State at the start (checked 2026-10-31, 17:30 IST, through MCP)

- **Live server: everything stopped on purpose.** All company jobs paused (22 RIA jobs paused), promotion frozen
  at checkpoint 1603, extraction pool 1 and collect pool 1 (they were 64 and 12), agents 64. Muse weekly quota 82%,
  resets 2026-11-02 00:00 UTC. The quota stop is at 90% (`quotaEarlyTripRatio` 0.9, live weekly reading; no
  calibration).
- **Sector `ria-us`** (01253fc6-3de6-464c-aca8-e86af97219f9): 17,958 companies. 17,210 come from `ia100226.zip`
  (file date 2026-10-02); 748 were created by the older `ia122025.zip` and are not in the current file (likely no
  longer registered) and were never preflighted.
- **Preflight (stale):** 8,072 eligible (P 5,105, R 2,967), 9,138 aside (not_wealth 4,691, not_us 2,252, large
  1,545, no_staff 383, exempt_or_inactive 267). The not_us fix (a US state with a blank country is US) is deployed
  but the preflight has not been re-run; companies now show 15,520 with country United States.
- **Researched:** 103 firms have deep research, ICP verdicts (all accepted; R/L5–L8, P/L7–L8) and sheet rows: 100%
  main phone, 87 named contacts. About 213 RIA company jobs failed and 22 are paused, all on the old path.
- **Not visible through MCP:** how many eligible firms the `sec_firm` collector has covered. There is no tool for
  per-step coverage.
- **Data quality seen:** the SEC "Website Address" is sometimes a LinkedIn or other social URL, or upper case.
  `sec_firm` reads PDFs with a hand-written stream parser and finds leaders with a regex; both are weak.
- **SEC bulk data (sec.gov FOIA "Form ADV Data" page):** Part 1 data as CSV tables up to 2024-12-31; Part 2
  brochures as monthly ZIPs of PDFs with mapping CSVs up to 2024 (March is the big month: annual updates).
  Data from 2025 on is said to be on adviserinfo.sec.gov/adv; what it offers in bulk is not yet verified.

## Design rules

- Steps, not agent runs. Each step works on a batch of firms, stores a status per firm and step (`done`, `gap`
  with a reason, `failed` with an error), skips firms already `done` for the same input, and can be re-run.
- Code first. A model is called only where text must be read (fee terms, team page), once per firm, no tools, no
  subagents, no browser. Every value it returns carries a verbatim quote that the grounding check finds in the
  stored text.
- A missing brochure, website or page is a `gap`, never a failed firm.
- Bulk downloads over per-firm requests wherever the SEC offers them. SEC requests carry
  `User-Agent: Kardata karthik@kardata.co`, under 10 per second.
- Every operation is an MCP tool. Prod is never touched by scripts or SQL.

## Part C: clean start (first, before any code; MCP only, nothing deleted)

What stays, what goes, and in what order. Live state was checked again at 17:45 IST: created 0, scheduled 0,
running 0, paused 22 (all RIA), failed: all of the latest 100 are RIA. Pools: company 100, collect 1, extraction 1,
sector preflight 64, agents 64; checkpoint 1603.

- **C1. Confirm nothing runs.** `pipeline_status` shows 0 running and 0 scheduled; no `kardata-agent` containers.
  One extraction run (913a7256…) kept working through its areas after `run_cancel` returned `partial`: let it
  finish (it only structures research already done) and note the bug (run_cancel doesn't stop extraction runs);
  the fix is B1.
- **C2. Record baselines** in your notes: skincare (eligible / ineligible, `sector_tier_summary`, sheet row count)
  and RIA (`sector_preflight_summary`, `sector_tier_summary`, `import_list`).
- **C3. Leave as is (kept, not touched):** sector `ria-us`, both imports (`ia100226.zip`, `ia122025.zip`), all
  company rows, the stored SEC zips, the 103 researched firms' documents, facts and verdicts (the gate in O5
  compares against them), skincare data and jobs, `var/` files, the quota breaker and the 90% setting.
- **C4. To be replaced, not deleted:** RIA preflight rows (re-derived in O3); RIA ICP verdicts and sheet rows
  (recomputed by B7); facts and leader records from the old `sec_firm` parser (the new steps write their own facts
  and the RIA ICP and sheet read only those). Old D2C-named area statuses on RIA firms are ignored by the RIA path.
- **C5. To be cancelled (after B1 adds the tool, as O1):** every RIA company job that is not completed: the 22
  paused and all failed ones. Completed jobs stay.
- **C6. Restored (O2, after deploy):** collect pool 12, extraction pool 64, checkpoint cleared. Company 100,
  sector preflight 64 and agents 64 stay.
- **C7. Housekeeping:** a `kardata-reviews-…` container has been up for 2 days with no run owning it; remove it
  through the harness cleanup path (add one to the harness scripts if none exists). In `~/projects/kardata-ria`,
  delete local branches already merged (`stage-5.7/*`); never delete remote branches or touch
  `~/projects/kardata`. Never touch the `lakehouse-replica-*` containers (another project).

## Part B: code (one commit per step, tests with each step)

- **B1. Status and cleanup tools.** `ria_status {sectorId}`: per step, counts of done / gap / failed / pending
  over eligible firms, plus the latest import and preflight counts. `company_jobs_cancel {sectorId, statuses}`
  (bulk cancel with a reason; tests). `run_cancel` also stops a running extraction run between areas (test).
  Firms absent from the latest SEC file get the preflight reason `not_current`.
- **B2. Step runner.** `ria_step_run {sectorId, step, companyIds?, limit?}` and `ria_step_pause`. Runs one step
  over eligible firms (or a list) with its own concurrency, honours the 90% quota stop for AI steps, and resumes
  where it stopped. No D2C company job stages are used for RIA.
- **B3. Firm data, code only.** Verify what adviserinfo.sec.gov offers for 2025–2026 in bulk (Part 1 tables,
  Schedule A officers, Schedule D custodians and websites, brochure ZIPs with mapping files). Use bulk files where
  they exist; otherwise per-firm IAPD data, still code only. Store per firm: officers with titles and start dates,
  custodians, disclosure flags, website list. Pick the firm's own website (drop LinkedIn and other social URLs,
  lower-case). The year-earlier SEC file gives AUM and staff change (use the file nearest to 12 months back).
- **B4. Brochure text.** Latest Part 2A brochure per eligible firm (bulk ZIP plus mapping when available, else per
  firm). Replace the hand-written PDF parser with `pdfjs-dist` (new dependency, named here). Split by Item
  headings; store Items 4, 5, 9, 12, 15 as separate documents with the brochure date. Scanned or unreadable → gap.
- **B5. Fee terms (AI, one call).** Item 5 (plus Item 4 when Item 5 points to it) → fee schedule and tiers, family
  grouping, negotiable, other fee types (flat, hourly, planning), minimums, billing in advance or arrears,
  proration, refunds, how fees are collected. Quote per value. Cheapest model that passes the gate in O5.
- **B6. Contacts (code, then one AI call).** Code finds the team or about page from the firm's site (links whose
  text or path says team, people, about, leadership); a failed fetch is a gap. One call: page text → people with
  titles. Merge with B3 officers; pick the contact by icp.md section 5.
- **B7. Signals, ICP and sheet, code only.** Signals from stored facts: `fee_complexity` only when at least two of
  family grouping, negotiable fees, two or more fee types, advance billing with proration or refunds;
  `multi_custodian`; `growth` (AUM or staff up 20%+ year on year); `fee_problem` (fee-related disclosures, or Item
  9 text about fees or refunds); `tool_sprawl` (two or more named systems in the brochure). `recent_deal` and
  `ops_hiring` come only from deep research. ICP verdict and layer from these; the sheet adds AUM, staff, growth,
  a one-line fee summary, custodians and brochure date. Update icp.md section 4 in the same commit.
- **B8. Deep research, opt-in.** A lean RIA research run for a named list only: reads all stored step data first
  and looks only for what code can't get (deals, ops job posts, recent news). Not run in this stage.
- **B9. Tests.** Unit tests per step, fake-site and fixture tests for B3/B4/B6 (ok / gap / error), an e2e test of a
  synthetic sector through B3–B7, skincare unchanged (record its counts first; equal after). Add an RIA section to
  `docs/plans/pipeline.md` with the step order and tools.

## Part O: operations (after B is merged and deployed; standing go D-65)

1. `company_jobs_cancel` for sector `ria-us`, statuses paused and failed, reason "stage 5.8: old RIA path
   replaced". Check with `company_jobs_list` that none remain. Keep the 103 researched firms' data (C3).
2. Restore the D2C pools (C6) so skincare can run; RIA no longer uses those pools.
3. Re-run the RIA preflight (not_us fix, not_current). Record counts by group and reason in
   `docs/sectors/ria/results.md`.
4. Run B3 and B4 for every eligible firm (no AI). Report coverage with `ria_status`.
5. **Gate:** run B5–B7 on the 103 deep-researched firms. Compare fee terms, contact and signals with deep
   research; report agreement, input tokens per firm, time, gaps. Pass: fee terms agree on 90%+ of firms with a
   brochure, under 100K input tokens per firm. **Stop here and report; continue only on the owner's or Claude's go.**
6. After the go: B5–B7 for all eligible firms, R group first. Export the sheet (`company_sheet_export`, no Google
   Sheet writes).

## Done means

Lint, typecheck and the full test suite pass; skincare unchanged; `ria_status` shows every eligible firm done or a
recorded gap for B3–B7; the gate numbers are in the review; `docs/sectors/ria/results.md` has the counts, tokens
per firm and quota used; `docs/reviews/stage-5.8-review.md` (≤ 80 lines) lists each B step with file:line and
test, the gate result, deviations and anything blocked. Then STOP: no deep research, no outreach, no Apollo
purchases, no sheet writes.
