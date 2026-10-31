# RIA results

Stage 5.7 Part O, run 2026-10-31. Sector `ria-us` (01253fc6-3de6-464c-aca8-e86af97219f9).

- Imported: 17,210 firms from the SEC monthly file `ia100226.zip` (file date 2026-10-02), 0 skipped.
- Eligible: 8,072 — group P 5,105, group R 2,967.
- Kept aside: 9,138 — not_wealth 4,691, not_us 2,252, large 1,545, no_staff 383, exempt_or_inactive 267.
- Collector: SEC firm collector queued for all 8,072 eligible firms (still running; SEC host
  politeness bounds throughput). Pilot: 10 company jobs (5 P, 5 R) started; R wave: 150 jobs
  started, R group first. Research runs continuously at the concurrency ceiling (agents 64).
- Company jobs live at the check: 100 scheduled (running), 60 created (queued). ICP job
  2f8659dc-2833-4e47-a567-afeff8f80f32 found 0 researched firms; re-run `sector_icp_start`
  as research lands (it skips already-checked firms). ICP verdicts: none yet. Sheet exported with 0 rows to
  `~/kardata-live/var/sectors/ria-us/analysis/companies-2026-10-31.csv`; re-export after ICP.
- Research throughput (firms/hour): not yet measurable; preflight ran 17,210 firms in ~10 min.

No Google Sheet writes, no Apollo purchases, no outreach.
