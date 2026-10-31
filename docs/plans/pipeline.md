Status: reference · Last updated: 2026-10-31

# The sector pipeline (runbook)

How a sector goes from an Apollo export to an outreach sheet. It has four steps. Every operation is a standard MCP
tool (`npx tsx scripts/mcp-call.ts <tool> '<json>'`). If an operation has no tool, add the tool first (AGENTS.md).
Business rules live in `docs/business/icp.md`. This file only gives the order.

| # | Step | Tools | What it decides |
|---|---|---|---|
| 1 | **Sector creation** | `sector_create` (with `profile`, `csvPaths`), `sector_profile_get/set`, `sector_rules_set` | Who is in the sector, and its categories |
| 2 | **Sector preflight** | `sector_preflight_start`, `_status`, `_summary`, `_companies`, `company_eligibility_override` | Is it a D2C brand in this sector, with its own online store? → eligible list |
| 3 | **Deep research + ICP check** on each eligible company | `pipeline_start`, `company_job_start`, `pipeline_status`, `pipeline_checkpoint_set`, `batch_scorecard`; ICP: `sector_icp_start`, `company_icp_get` (stage 5.5) | Facts, records, revenue; signal score, exclusions, status. Stored for **every** company, whether it passes or not |
| 4 | **Tier and sheet** | `company_revenue_truth`, `company_revenue_confirm`, `sector_tier_summary`, `sector_icp_companies`, `company_sheet_export` | Tier A/B/C (D-55 revenue), layer (signal score), and the outreach sheet for manual tracking |

## Step 1: Sector creation

- The profile sets the categories, scope and classifier hints. The rubric sets what is eligible.
- Category text changes don't mark rows stale: `staleProfile` covers category keys only. Re-run the affected
  companies by `eligibility` or `companyIds`.

## Step 2: Sector preflight

- It only answers "is it in the sector". It is **not** the ICP check: revenue, HQ, data team, parent company, stack
  and signals all come in step 3.
- **Website reads:** our fetcher goes first. If it gets nothing or a thin page, Muse reads the site with its own web
  tools (`prompt_version = v2-web`). Never spoof a browser.
- **Settling the unsure:**
  1. `sector_preflight_start` with `onlyLowConfidence`;
  2. then with `eligibility: ["review"], forceWeb: true`;
  3. the owner's calls (or Claude's, when the owner delegates) go through `company_eligibility_override`, always
     with a note.
- **Muse cost:** about 45K tokens per company, and about 140–260K when Muse reads the site itself.
- Don't deploy while a preflight job runs: the deploy drain only waits for company jobs.

## Step 3: Deep research and the ICP check

- Runs only on eligible companies. Start with a pilot: about 10 companies through `company_job_start`, or
  `pipeline_start` with `pipeline_checkpoint_set`. Check it with `batch_scorecard` before the whole sector.
- The checkpoint pause stops promotion only. Jobs already scheduled finish.
- Old `created` jobs from another sector wait in the queue (oldest first). Check `company_jobs_list` before you raise
  the checkpoint.
- **The ICP check** scores the 6 signals and the exclusions from stored, quoted, dated evidence only
  (`evidence-rules.md`). Every company gets an ICP status with its observations: `icp_accepted`, `icp_watchlist`,
  `icp_rejected`, or `research_incomplete` (no usable evidence yet). The same step rebuilds the company's public
  contact statuses (names and roles from leader records). Apollo people the owner bought go in with
  `apollo_contacts_import`; `company_contacts_get` shows both. See `icp.md`, Terms (D-67).
- **Until stage 5.5 ships,** this check has no standard job. Don't score companies by hand; wait for 5.5.

## Step 4: Tier and the outreach sheet

- The tier comes from revenue (D-55: A $10M+, B $2–10M, C $500k–2M, under $500k not contacted). Source order: public
  figure, then Apollo, then staff estimate. Flagged public figures need `company_revenue_confirm`.
- Layer = 7 − signal score. Score 1 is Layer 6, a discovery call (D-64); score 0 is the ICP watchlist, kept for future campaigns (D-67).
- `company_sheet_export` writes `var/analysis/companies-<date>.csv` (gitignored): ICP accepted companies by tier, then
  layer, with observations and blank tracking columns. The owner imports it into the Google Sheet. All outreach is
  manual.

## RIA sectors: the light pipeline (Stage 5.8)

RIA sectors (`playbook: ria`) do not use steps 3–4 above. Code does everything structured; AI is used only for
two single-call reads per firm. Deep research is opt-in for a named list only.

| Order | Step | Tool | What it does |
|---|---|---|---|
| 1 | Firm data | `ria_step_run {step: "firm_data"}` | SEC/IAPD per firm: officers, custodians, disclosure flags, the firm's own website (social URLs dropped) |
| 2 | Brochure | `ria_step_run {step: "brochure"}` | Latest Part 2A brochure (pdfjs), stored split by Item 4/5/9/12/15; not downloadable → gap |
| 3 | Fee terms | `ria_step_run {step: "fees"}` | One AI call on Item 5 (+4): fee terms, each with a verbatim quote found in the stored text |
| 4 | Contacts | `ria_step_run {step: "contacts"}` | Team/about page found in code, one AI call: people with titles, merged with SEC officers |
| 5 | Signals | `ria_step_run {step: "signals"}` | Code-only signals, ICP verdict and layer (`docs/sectors/ria/icp.md` section 4) |
| — | Coverage | `ria_status` | Per step: done / gap / failed / pending over eligible firms |
| — | Deep research (opt-in) | `ria_deep_research {companyIds}` | Named firms only (max 50): reads stored step data first; deals, ops job posts, recent news only |

Rules: `ria_step_pause {paused}` pauses step runs; AI steps stop at the 90% weekly quota reading; a missing
brochure, website or page is a gap, never a failed firm; steps skip firms already done and can be re-run by
naming them. The sheet is `company_sheet_export` as in step 4 (RIA rows add AUM, staff, growth, fee summary,
custodians, brochure date). Business rules: `docs/sectors/ria/icp.md`.
