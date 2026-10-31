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
