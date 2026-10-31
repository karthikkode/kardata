# RIA results

Stage 5.7 Part O, run 2026-10-31. Sector `ria-us` (01253fc6-3de6-464c-aca8-e86af97219f9).

- Imported: 17,210 firms from the SEC monthly file `ia100226.zip` (file date 2026-10-02), 0 skipped.
- Eligible: 8,072 — group P 5,105, group R 2,967.
- Kept aside: 9,138 — not_wealth 4,691, not_us 2,252, large 1,545, no_staff 383, exempt_or_inactive 267.
- Collector: SEC firm collector queued for all 8,072 eligible firms (still running; SEC host
  politeness bounds throughput). Pilot: 10 company jobs (5 P, 5 R) started; R wave: 150 jobs
  started, R group first. Research runs continuously at the concurrency ceiling (agents 64).
- Researched: 100 firms (97 R, 3 P) with ICP verdicts, all `icp_accepted` — by layer
  R/L5 14, R/L6 32, R/L7 41, R/L8 10, P/L7 2, P/L8 1. `sector_icp_start` finds no
  un-checked researched firms (company jobs run ICP themselves); re-run it as waves land.
- Failed: 60 of the first 160 jobs (collect homepage/LinkedIn robots refusals, research
  stalls) — retry in a later wave. A further 120-job R wave is running.
- Sheet: 100 rows at `~/kardata-live/var/sectors/ria-us/analysis/companies-2026-10-31.csv`.
- Research throughput: ~10 firms/hour at the concurrency ceiling (100 firms in ~10 hours,
  ~20M input tokens per firm; Muse weekly quota 76% used at the check). At that rate the
  full 8,072 eligible firms take weeks of quota, not one night — waves keep running.

No Google Sheet writes, no Apollo purchases, no outreach.

## Stage 5.8 light pipeline (2026-10-31)

Part C/O on the live sector after PRs #117–#130 (deployed).

- O1/O2: 174 old-path RIA company jobs cancelled (paused + failed); pools restored
  (collect 12, extraction 64, checkpoint cleared). No data deleted.
- Preflight re-run (17,958 firms, 0 failed): eligible 8,082, ineligible 9,876
  (9,128 in the current SEC file + 748 not_current from the older file).
- SEC address fix (PR #124): 1,406 firms have a suppressed main office
  (private residence); the parser now falls back to Mail Office, then Books and
  Records. Recount: eligible 8,403 (P 5,396, R 3,007); ineligible 8,807 in file
  (not_wealth 4,902, not_us 1,611, large 1,547, no_staff 480,
  exempt_or_inactive 267) + 748 not_current.
- firm_data: 8,403/8,403 done, 0 failed (SEC per-firm data + own-website pick;
  websites re-picked for all 8,403 after the re-import).
- brochure: 8,217 done, 186 gaps (no Item headings 110, exempt 41, fetch error
  22, older than 2 years 13), 0 failed. Brochures come
  from the IAPD firm record + files.adviserinfo.sec.gov version endpoint;
  the SEC offers no Part 2A bulk after Dec 2024.
- O5 gate on the 103 deep-researched firms: fees 61 done / 42 gap, contacts
  58 done / 45 gap, signals 103 done, 0 failed anywhere. Fee agreement vs deep
  research (57 firms with light facts): schedule present 68%, minimums 56%,
  negotiable 100% of 18 scored, proration 88%, refunds 82%, billing 54%.
  Contacts: same first contact as deep research for 62 of 91 firms (68%).
  Signals: Complex fees both 24 / deep-only 58; Multiple custodians deep-only
  30, light 0 (light reads the custodian fact's text column; the stored fact
  is JSON); Growing fast light-only 48 (light uses AUM change, deep required
  stated growth); Tool sprawl light-only 57. Score equal for 31/103.
  Tokens: fees ~21–23K input tokens per firm, contacts ~10–31K; total under
  the 100K target. Time: fees ~20s per firm, signals instant.
  Gate verdict: coverage and cost pass; fee-term and signal parity do not
  (90% bar missed). Details: docs/reviews/stage-5.8-review.md.
- Skincare unchanged: 626 eligible / 7,150 ineligible, as at the C2 baseline.

Follow-up (2026-10-31): fees replaced by ops_read (Items 4/5/8/12/14/15,
normalised grounding); owner signal set (icp.md section 4) with lead
signal column; Schedule A contact fallback. Gate re-run on the 103:
ops_read 99/4, contacts 91/12, signals 103, 0 failed; fee schedule on
96% and billing timing on 95% of firms with a brochure; hand-check
about 97% of stated fields correct (15 firms). Signal spread is wide
(Complex fees 86%); see docs/reviews/stage-5.8-review.md.
O6 (all eligible) replaced by owner direction with a next-200 R-group
run; the rest awaits the owner's go.
