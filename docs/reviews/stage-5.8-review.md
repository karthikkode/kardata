# Stage 5.8 review — clean RIA pipeline

Spec: `docs/plans/stage-5.8-ria-pipeline.md`. Branch `stage-5.8/ria-light` (PR #117) plus
follow-ups #118–#130, all merged and deployed. Live runs were MCP-only; nothing deleted.

## Acceptance criteria

| Criterion | How met | Evidence |
|---|---|---|
| C1-C4 baselines recorded, nothing deleted | Recorded pre-stage; skincare re-checked equal at the end | `ria_status` skincare 626/7,150 = C2 baseline |
| B1 `ria_status`, bulk cancel, extraction cancel, `not_current` | `src/domain/ria-steps/status.ts`, `company_jobs_cancel`, migration 0040 | `tests/db/ria-steps.test.ts`, `tests/unit/ria-preflight.test.ts` |
| B2 step runner + pause, 90% quota stop | `src/domain/ria-steps/runner.ts` | `tests/db/ria-runner.test.ts` |
| B3 firm data (code only) | `createFirmDataStep` over the SEC/IAPD collector; own-website pick | `tests/db/ria-light.test.ts`; live 8,403/8,403 done |
| B4 brochure (bulk checked first) | FOIA Part 2A bulk stops Dec 2024; per-firm IAPD record + version endpoint; pdfjs Item split | `tests/db/ria-light.test.ts`; live 8,217 done / 186 gap |
| B5 fee terms, one call, quoted | Single extractor call, only quote-grounded facts stored, `ria.fee_*` keys | fees tests; gate firm facts verified on live |
| B6 contacts, one call | Team page found in code, one call, leaders stored | contacts tests; live gate 58 done |
| B7 signals/ICP/sheet in code | `computeSignals`, verdict, sheet columns (AUM, staff, growth, fees, custodians, brochure date) | signals tests; `src/domain/icp/sheet.ts` |
| B8 deep research opt-in | `ria_deep_research` named list only (max 50), not run | `tests/db/ria-deep.test.ts` |
| B9 e2e + pipeline.md | Synthetic sector through B3-B7; RIA section added | `tests/db/ria-light-e2e.test.ts` |
| O1-O4 ops | 174 jobs cancelled; pools restored; preflight re-run; B3+B4 for all eligible | `docs/sectors/ria/results.md` (Stage 5.8 section) |
| O5 gate on the 103 | Fees/contacts/signals run; agreement measured | Below; stopped before O6 |

## O5 gate (103 deep-researched firms)

- Coverage: fees 61 done / 42 gap (no grounded terms 38, no Item 5 4); contacts 58 done /
  45 gap (no website 9, no team page 22, fetch error 8, blocked 6); signals 103 done; 0 failed.
- Fee agreement (57 firms with light facts): schedule present 68%, minimums present 56%,
  negotiable 100% (18 scored), proration 88%, refunds 82%, billing-in-advance 54%,
  family grouping 67% (3 scored). Under the 90% bar.
- Contacts: sheet first contact matches deep research for 62 of 91 firms (68%); 29 differ.
- Signals: Complex fees both 24, deep-only 58, light-only 4. Multiple custodians deep-only
  30, light 0 (stored custodian fact is JSON; the light reader checks the text column).
  Growing fast light-only 48 (AUM change of 20%+, a looser rule than deep stated growth).
  Tool sprawl light-only 57 (code counts named-system facts; deep judge was stricter).
  Hiring operations staff deep-only 9, by design. Score equal for 31 of 103 firms.
- Cost and time: fees 21–23K input tokens per firm, contacts 10–31K; under the 100K total
  target. Fees ~20s per firm at concurrency 8; signals instant. Weekly Muse quota 86%
  after the gate (90% stop armed, never tripped).
- Verdict: the light path is cheap, honest and complete, but fee-term and signal parity
  with deep research is not yet at the bar. Do not promote it to the default sheet
  ranking until the custodian read, the growth definition and fee-schedule recall
  (68%) are fixed. O6 not started.

## Deviations from the plan

- B3/B4 bulk for 2025-2026: the SEC publishes no Part 2A bulk after Dec 2024 and no
  2025-2026 Part 1 bulk; the per-firm IAPD path is used throughout (verified on the
  SEC FOIA page, 2026-10-31).
- Brochure download: guessed `reports.*` URLs return 403; the step now uses the IAPD
  firm record (`iacontent.brochures`) and the `files.adviserinfo.sec.gov` version
  endpoint (owner-supplied, verified by hand).
- Light fee facts use `ria.fee_*` keys: deep extraction owns `firm.fee_*` as prose text,
  so typed writes there failed validation (plan C4 already separates the two fact sets).
- Step runs use research-run kind `manual`: kind `collect` collided with stale queued
  runs from cancelled jobs (`research_runs_one_active_idx`, 31 prod failures).
- Heading styles widened twice from live samples (Form ADV prefix, Title - Item N,
  bare titles, TOC-vs-body choice); true scans stay gaps (100 firms).
- Prod fixes folded in: extractor/classifier `--trust-workspace` (same failure hit
  D2C calls), strict fee schema (quotes as field/quote array), NUL bytes stripped
  from PDF text, SEC host delay on live set to 300ms for adviserinfo hosts
  (still under the SEC 10 req/s limit) so O4 finished in hours.
- `docs/sectors/ria/icp.md` section 4 gained the light-path signal rules (B7).

## Blocked / unfinished

- O6 not started (per plan): light steps for all eligible firms, R group first, sheet
  re-export. Gate parity fixes above should land first, as their own stage or follow-up.
- 110 brochures have text but no recognizable Item headings; 41 firms are exempt,
  22 fetch errors, 13 brochures older than 2 years (stored, then gap).
- Deep-era `company_jobs` for RIA remain cancelled/terminated by design; the 748
  not_current firms stay members until the next SEC file.
- One CI failure on PR #127 was an agent-runner flake (passed locally and on rerun).

## Follow-up: ops_read redesign and gate re-run (2026-10-31)

Owner change of direction: RIA research is judged on visible manual-work
problems, not fees alone. `fees` was replaced by `ops_read` (one model call
over brochure Items 4, 5, 8, 12, 14, 15; Items 8/14 now split and stored),
with PDF-normalised quote grounding (ligatures, curly quotes, hyphenation,
whitespace). New code-only Part 1 measures: offices, private fund count,
pension/trust clients. Signal set per owner (icp.md section 4): heavy_book,
multi_custodian, growth (AUM +30%+ or staff +20%+ and +2), many_services,
outside_managers, alternatives, custody_work, fee_complexity, fee_problem,
tool_sprawl; score = signal count; sheet shows top 3 signals with quotes
plus a Lead signal column. Contacts fall back to Schedule A officers
(COO/head of operations, then CCO, then CEO/president, source marked).
Shipped as PR #133 (redesign) and PR #134 (batch fix), merged on green CI
and deployed with drain.

Gate re-run on the same 103 firms (MCP only):
- brochure 100 done / 3 gap; ops_read 99 done / 4 gap (all "no brochure
  Item 5 stored"), 0 failed. "No grounded terms" (38 firms at O5) is gone.
- Fee recall was the production bug the local diagnostic could not see:
  brochureItemText read an arbitrary versioned document row, so ops_read
  often read the superseded O5-era table-of-contents Item 5 slice. Fixed
  to the current version (PR #134). Local reproduction on current text
  grounds every field (35,282 input tokens for a large brochure, ~78 s).
- Coverage on current facts (100 gate firms with a brochure): fee schedule
  96%, billing timing (advance/arrears) 95%. Contacts 91 done / 12 gap
  (was 58/45 at O5); every remaining gap ends "no Schedule A officer".
  Signals 103 done, 0 failed.
- Hand-check, 15 sampled firms, every stated ops value read against the
  brochure text (firm id only): 138 fields stated, 3 confirmed errors
  (one negotiable, one custody_exam where the text says the exam is
  avoided under SLOA conditions, one billing=arrears with no timing
  wording) — about 97% correct where stated, above the 90% bar.

| Firm id | Fields stated | Errors |
|---|---|---|
| 123173cb-ba0d-42f3-a687-2876c23a440b | 12 | 0 |
| f6a1a12b-148e-457e-8605-d8e713db9d55 | 16 | 0 |
| f5926bdd-8fba-4b35-bd08-cc63bce15433 | 0 (no brochure) | – |
| 73d5a4e8-8472-48a7-ba74-1e29ec2e8d6c | 11 | 1 (negotiable) |
| 88aff119-c201-4bc6-a32a-96a2ce44c137 | 14 | 0 |
| 759210aa-db59-480b-bc2f-5dae42b21bee | 16 | 0 |
| a0df78ab-e9f0-4f3b-a697-a57e68bdd185 | 15 | 0 |
| 081d2883-59a8-4672-8fcf-e9eb1c2bba35 | 18 | 0 |
| 5068a01b-6094-4f1c-930b-41f973389ff0 | 18 | 0 |
| ba51c08a-dfea-4a20-997a-d31c1d096987 | 16 | 0 |
| 31ef7848-ca70-4b3f-b5c5-691e0354ed4c | 17 | 0 |
| 9e7284fa-76b4-48cb-add0-333f93ba869f | 12 | 0 |
| 0d3d629a-ffe2-4fef-be2b-96fdd10fda6c | 20 | 1 (custody_exam) |
| e114eb27-b40f-4efe-9f8e-7282b65b7ee7 | 16 | 0 |
| 10ccecca-5b17-4a95-8d3c-e39cb092c467 | 12 | 1 (billing) |

Signal spread on the 103 (guideline: no signal over ~60% — missed):
Complex fees 86%, Multiple custodians 73%, Outside managers 68%, Many
services 62%, Alternatives 62%, Tool sprawl 57%, Custody work 54%, Heavy
book 36%, Growing fast 30%, Fee problem 11%. Scores spread 0-9. The top
signals fire on brochure boilerplate (negotiable fees plus advance billing
with proration; custodians named in Item 12), so they rank weakly on
their own; lead-signal spread: Outside managers 43, Heavy book 32, Fee
problem 11, Alternatives 6, Custody work 4, Multiple custodians 4, Many
services 1, Growing fast 1, none 1. Owner decision needed: raise
fee_complexity to 3 of 4 traits, or accept and rank by score only.

Remaining defect for the next batch: brochures in all-caps heading style
("ITEM 5 – …") can still slice the table of contents as a stub Item 5
(3 of 103 under 1K chars). Next batch: splitter TOC/all-caps fix plus a
stub-length guard in ops_read, then re-run those firms.

Sheet re-exported after the gate (103 rows, ria-us analysis CSV, no
Google Sheet writes). O6 as originally scoped (all 8,403) not run; the
owner replaced it with a next-200 R-group run (highest signal score
first), reported separately below.

## Next-200 run (owner-directed step 7 change, 2026-10-31)

After the gate report and sheet re-export, the light steps ran on the
next 200 firms only: R group, highest signal score first, excluding the
103 gate firms. Ranking used pre-ops signal scores (Part 1 facts only;
pool maximum was 3: 27 firms at 3, 173 at 2). Brochure was re-run first
so Items 8/14 are split for these firms.

- ops_read: 197 done / 3 gap ("no brochure Item 5 stored") / 0 failed.
- contacts: 25 done / 175 gap. All 25 came from team pages (fresh leader
  records in the run window); the Schedule A officer fallback fired 0
  times because these firms have no stored leader records at all.
  Gaps by reason: no firm website and no Schedule A officer 81, team
  page named no people 42, no team/about page 25, website fetch blocked
  13, fetch error 12, robots disallowed 2. Root cause is upstream:
  firm_data's Schedule A parse (sec-firm collector, "Name - Title" line
  regex) rarely matches the filing PDF table layout, so officers are
  almost never stored. This is the first item for the next fix batch
  (collector parse + firm_data/contacts re-run); contacts coverage on
  unresearched firms depends on it.
- signals: 200 done. Post-ops scores 2-9. Spread: Heavy book 86% and
  Growing fast 84% (both enriched by the score-first selection), Complex
  fees 84%, Outside managers 73%, Many services 66%, Multiple
  custodians 57%, Custody work 50%, Alternatives 48%, Fee problem 39%,
  Tool sprawl 18%. Lead signal: Heavy book 119, Fee problem 78, Outside
  managers 2, Alternatives 1.
- Tokens: ops_read median about 26K input tokens per firm, max about
  40K (estimated from stored prompt sizes, calibrated on one exact
  usage reading of 35,282 for a large brochure). Weekly quota after
  the run: 88% (resets Mon 2026-11-02 00:00 UTC).

Stopped here per owner instruction. The remaining ~8,100 eligible
firms have not been run.
