Status: done · Date: 2026-10-26

# Stage 5.3 review — Revenue truth (D-55)

Branch `stage-5.3`, one commit per step, no push. The worktree also holds
the owner's unrelated edits (docs/business, website/); none were touched.

## Root causes 1-7

1. Apollo figure carried no status. Fixed: `src/collect/collectors/apollo-profile.ts:51-60`
   stores estimate_kind=vendor, estimate_status=unverified (migration 0025).
   Test: tests/collect/apollo-profile.test.ts.
2. Nothing compared facts. Fixed: prompt v1.5 writes a Revenue plausibility
   verdict (`prompts/research-v1.5/main.md:46`); extract v3 stores it as a fact
   (`prompts/extract-v3/synthesis.md:26`); D-55 flags disputed figures
   (`src/domain/tiering.ts:80`). Tests: prompt.test.ts, tiering tests.
3. Companies House checked 3 candidates. Fixed: all 20, scored domain, name,
   postcode; ties refused (`src/collect/collectors/companies-house.ts:12`).
4. Match stored only accounts type and year. Fixed: latest accounts parsed
   from the filed iXBRL document (companies-house.ts:75) and written as dated
   facts: total assets, cash, net assets, employees (migration 0026).
   Tests for 3-4: tests/collect/providers.test.ts.
5. Decisions prompt filtered out trade press. Fixed in v1.5: one exact-name
   quoted search for acquisitions/funding (`prompts/research-v1.5/areas/decisions.md:12`).
6. Tier/layer computed by hand. Fixed: `src/domain/tiering.ts:80` implements
   D-55; tools `company_revenue_truth`, `sector_tier_summary`,
   `company_verdict_record`, `company_sheet_export`
   (`src/mcp/research-tools.ts:1436`); verdict storage migration 0027.
   Tests: tests/domain/tiering.test.ts, tests/db/tiering.test.ts.
7. URL citations weakened grounding. v1.5 states URLs are never citations
   (`prompts/research-v1.5/main.md:54`). No code change was needed.

## Refresh run (2026-10-26, after the build)

- The 2026-10-26 ICP verdicts were loaded through `company_verdict_record`
  (the only write path): 813 of 814 recorded. One sheet row has no domain
  and could not be matched to a company; it is a US watchlist row.
- Tools ran through an MCP-only instance of this branch (no runners, no AI reruns).
- Companies House re-collection is the one piece left for deploy: 124 UK
  companies in the checked set still take staff from Apollo, not from filed
  accounts. Queuing them now would execute the live server's old collector
  (3 candidates, no accounts facts), so the pull runs after this branch is
  deployed: `collect_start` with the companies_house adapter.
- Drizzle snapshots for data-only migrations 0025/0026 were dropped (copied
  snapshots broke drizzle-kit generation); the SQL migrations and journal are
  the source of truth and the suite migrates cleanly.

## Dry run and evidence

Full suite after the final edit: 635 tests passed, 1 skipped.

Live recompute from today's stored data (`sector_tier_summary`, 813
companies with verdicts): 130 companies changed tier against the sheet on
the first run. The case company reads Tier B Layer 5, Apollo rejected.

## Bugfix (after review): vendor estimates are not public

"Named public source" was matching vendor guesses (ZoomInfo, RocketReach,
Prospeo, Owler and similar). Fix: revenue facts carry a `source_kind`
qualifier (filing, press, interview, company_statement, vendor_estimate,
award_entry; migration 0028), picked with judgement in the extract prompt
(`prompts/extract-v3/areas/financials.md`), with a seed vendor list as the
read-time backstop (`classifyRevenueSourceKind`, src/domain/tiering.ts).
Public now means filing, press/interview or company statement only; an
award entry counts as a company statement and keeps the check flag. Vendor
figures go through the $75k-per-staff check like Apollo, reason kept.
Stored figures were reclassified through `sector_revenue_reclassify`:
439 stamped (379 vendor, 59 press, 1 interview). No scripts, no AI reruns.
After the fix: 125 companies change tier against the sheet; contactable
407 (Tier A 109: L3 10, L4 41, L5 58; Tier B 263: L2 1, L3 13,
L4 72, L5 177; Tier C 35: L2 1, L3 3, L4 9, L5 22). Revenue used in the
export, by source: public 70, vendor 9, Apollo 110, estimated from staff
218. Sector-wide revenue by source: public 123, vendor 10, Apollo 221,
estimated from staff 459. 85 vendor figures were rejected below $75k per
staff; for 82 of them the tier differs from treating the figure as public.
The 27 "over $1M per staff" check flags (owner expected 22 from the old
export; live data has 27) are listed by name with source in
`var/analysis/revenue-check-flags-2026-10-27.csv`, not in git. Tests:
tests/domain/tiering.test.ts, tests/db/tiering.test.ts (reclassify case).
New sheet: `var/analysis/companies-2026-10-26.csv` (407 contactable rows).
