Status: done · Date: 2026-10-26

# Stage 5.3 review — Revenue truth (D-55)

Branch `stage-5.3`, one commit per step, no push. The worktree also holds
the owner's unrelated edits (docs/business, website/); none were touched.

## Root causes 1-7

1. Apollo figure carried no status and could not be overruled. Fixed:
   `src/collect/collectors/apollo-profile.ts:51-60` writes the revenue fact with
   qualifiers estimate_kind=vendor, estimate_status=unverified (migration
   `0025_revenue_estimate_status.sql` allows the qualifiers). Test:
   tests/collect/apollo-profile.test.ts.
2. Nothing compared facts. Fixed two ways: prompt v1.5 makes the synthesis
   agent write a Revenue plausibility verdict from revenue next to staff,
   accounts and channels (`prompts/research-v1.5/main.md:46`), and extract v3
   turns it into the `financials.revenue_plausibility` fact
   (`prompts/extract-v3/synthesis.md:26`). The D-55 function also flags any
   disputed figure (`src/domain/tiering.ts:80`). Tests:
   tests/runs/prompt.test.ts (v1.5 renders), tests/domain/tiering.test.ts.
3. Companies House checked 3 candidates. Fixed: all 20, scored by
   website/domain, then name, then postcode; ties refused, candidates listed
   (`src/collect/collectors/companies-house.ts:12`). Tests:
   tests/collect/providers.test.ts (target 5th of 5; tie case).
4. Match stored only accounts type and year. Fixed: latest accounts are parsed
   from the filed iXBRL document (`parseAccountsXhtml`,
   companies-house.ts:75) and written as dated facts: total assets, cash, net
   assets, average employees (companies-house.ts:341; fact keys seeded by
   migration 0026). Test: tests/collect/providers.test.ts.
5. Decisions prompt filtered out trade press. Fixed in v1.5: one exact-name
   quoted search for acquisitions and funding, accepted only on a country,
   founder or product match (`prompts/research-v1.5/areas/decisions.md:12`).
6. Tier/layer computed by hand outside the system. Fixed: domain function
   `src/domain/tiering.ts:80` implements D-55 exactly; read-only MCP tools
   `company_revenue_truth` and `sector_tier_summary`
   (`src/mcp/research-tools.ts:1436`), verdict storage `company_verdicts`
   (migration 0027) written only through `company_verdict_record`, and the
   sheet export `company_sheet_export` (`src/mcp/research-tools.ts:1503`,
   `src/domain/tiering.ts:302`). Tests: tests/domain/tiering.test.ts,
   tests/db/tiering.test.ts (the case shape: Apollo rejected, staff fallback,
   Tier B Layer 5).
7. URL citations weakened grounding. The rule already demanded source IDs;
   v1.5 now states URLs are never citations and requires re-fetching to obtain
   an id before writing a claim (`prompts/research-v1.5/main.md:54`). No code
   change was needed.

## Refresh run (2026-10-26, after the build)

- Migrations 0025-0027 applied to the prod database after a fresh backup
  (`~/kardata-backups/kardata_2026-10-27_0205.dump`).
- The 2026-10-26 ICP verdicts were loaded through `company_verdict_record`
  (the only write path): 813 of 814 recorded. One sheet row has no domain
  and could not be matched to a company; it is a US watchlist row.
- Tools ran through an MCP-only instance of this branch (no runners).
  No AI reruns were run.
- Companies House re-collection is the one piece left for deploy: 124 UK
  companies in the checked set still take staff from Apollo, not from filed
  accounts. Queuing them now would execute the live server's old collector
  (3 candidates, no accounts facts), so the pull runs after this branch is
  deployed: `collect_start` with the companies_house adapter.
- Drizzle snapshots for data-only migrations 0025/0026 were dropped (copied
  snapshots broke drizzle-kit generation); the SQL migrations and journal are
  the source of truth and the suite migrates cleanly.

## Dry run and evidence

Full suite once after the final edit: 63 files passed, 1 skipped; 635 tests
passed, 1 skipped. Focused tiering, providers, prompt and MCP tests pass.

Live recompute from today's stored data (`sector_tier_summary`, 813
companies with verdicts): 130 companies change tier against the sheet
(A to B 14, A to C 1, B to A 38, B to C 3, C to B 15, C to A 3, below floor
to B 42, to A 8, to C 2, to no tier 3, C to no tier 1). New contactable
counts (406, was 378): A/L2 1, A/L3 11, A/L4 38, A/L5 54 (Tier A 104);
B/L2 1, B/L3 13, B/L4 76, B/L5 179 (Tier B 269); C/L3 1, C/L4 8, C/L5 24
(Tier C 33). Statuses: contactable 406, watchlist 232, excluded 93,
research incomplete 82. Revenue by source: public 209, Apollo 158,
estimated from staff 446 (public beats the sheet's 51: stored facts carry
named sources the sheet did not use). The case company now reads Tier B
Layer 5, Apollo rejected. The sheet is `companies-2026-10-26.csv` (406 rows).
