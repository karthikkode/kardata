Status: reference · Last updated: 2026-10-27

# The sector pipeline (runbook)

How a sector goes from an Apollo export to a call list. Every step is a standard MCP tool
(`npx tsx scripts/mcp-call.ts <tool> '<json>'`). If a step has no tool, add the tool first
(AGENTS.md). Business rules are in `docs/business/icp.md`; this file is only the order.

| # | Step | Tools | What it decides | Muse cost |
|---|---|---|---|---|
| 1 | Create the sector and import | `sector_create` (with `profile`, `csvPaths`) | Who is in the sector | none |
| 2 | Sector preflight | `sector_preflight_start`, `_status`, `_summary`, `_companies` | Is it a D2C brand in this sector, with its own store? | ~45K per company, ~140K when Muse reads the site itself |
| 3 | Settle the unsure | `sector_preflight_start` with `onlyLowConfidence`, then `eligibility: ["review"], forceWeb: true` | Same question, with Muse reading the live site | as above |
| 4 | Owner calls | `company_eligibility_override` (always with a note) | Borderline cases | none |
| 5 | Deep research | `pipeline_start`, `pipeline_status`, `pipeline_checkpoint_set`, `company_jobs_list` | Collect, research, extraction, grounding per company | the expensive step |
| 6 | Revenue and tier | `company_revenue_truth`, `company_revenue_confirm`, `sector_tier_summary` | Tier A/B/C from D-55 revenue | none |
| 7 | ICP verdict | `company_verdict_record` | Signal score (layer), exclusions | **no standard job yet** (see below) |
| 8 | Call list | `company_sheet_export` | Contactable companies, by tier, then layer | none |

## Step notes

- **Steps 2–4 only answer "is it in the sector".** They are not the ICP check: revenue, HQ, data team,
  parent company, stack and signals all come from step 5 onwards.
- **Website reads (step 2):** our fetcher first; if it gets nothing or a thin page, Muse reads the site
  with its own web tools (`prompt_version = v2-web`). Never spoof a browser.
- **Profile changes:** `sector_profile_set`. Changing category text does not mark rows stale
  (`staleProfile` covers category keys only), so re-run the affected companies by `eligibility` or
  `companyIds`.
- **Concurrency:** `sector_preflight_concurrency_set` and the company pool settings are live MCP
  settings. Don't deploy while a sector preflight job runs (the deploy drain only waits for company jobs).
- **Deep research (step 5)** runs only on eligible companies. Start with a checkpoint
  (`pipeline_checkpoint_set`) and check a small batch with `batch_scorecard` before the whole sector.

## Gap: step 7 has no standard job

Tier (step 6) is computed from stored facts. The **signal score and the exclusions** are only
stored: `company_verdict_record` is a write path, and the 2026-10-26 skincare scores came from a
one-off ICP check. Before a sector's call list, this needs a standard job that scores the 6 signals
and the exclusions in `icp.md` from stored facts and records, with evidence per point
(`evidence-rules.md`). Plan it as its own stage.
