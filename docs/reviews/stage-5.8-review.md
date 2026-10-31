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
| B4 brochure (bulk checked first) | FOIA Part 2A bulk stops Dec 2024; per-firm IAPD record + version endpoint; pdfjs Item split | `tests/db/ria-light.test.ts`; live 8,221 done / 182 gap |
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
- 88-100 brochures have text but no recognizable Item headings; 41 firms are exempt,
  22 fetch errors, 13 brochures older than 2 years (stored, then gap).
- Deep-era `company_jobs` for RIA remain cancelled/terminated by design; the 748
  not_current firms stay members until the next SEC file.
- One CI failure on PR #127 was an agent-runner flake (passed locally and on rerun).
