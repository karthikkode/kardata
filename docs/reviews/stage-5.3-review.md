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
- Companies House re-collection waits for deploy: 124 UK companies still
  take staff from Apollo. After deploy: `collect_start` (companies_house).
- Drizzle snapshots for data-only migrations 0025/0026 were dropped (copied
  snapshots broke drizzle-kit generation); the SQL migrations and journal are
  the source of truth and the suite migrates cleanly.

## Dry run and evidence

Full suite after the final edit: 635 tests passed, 1 skipped.

Live recompute (`sector_tier_summary`, 813 verdicts): 130 companies
changed tier against the sheet. The case company reads Tier B, Apollo rejected.

## Bugfix (after review): vendor estimates are not public

"Named public source" was matching vendor guesses. Fix: revenue facts carry
a `source_kind` qualifier (migration 0028), picked with judgement in the
extract prompt (`prompts/extract-v3/areas/financials.md`), with vendor and
press seed lists as backstop (`classifyRevenueSourceKind`,
src/domain/tiering.ts). Public means filing, press/interview or company
statement only; an award entry counts as a company statement and keeps the
check flag. Vendor figures go through the $75k-per-staff check like Apollo.
Reclassified through `sector_revenue_reclassify`: 439 stamped (379 vendor,
59 press, 1 interview). Export by source: public 70, vendor 9, Apollo 110,
estimated from staff 218.

## Fix 2 (fail closed, flagged figures)

Unknown sources now default to vendor_estimate, never press (Datanyze,
Grips, SignalHire, Endole and 8 more added to the backstop; a source is
press only if a journalist or the company states the figure). Re-stamp
recomputes our own earlier stamps. A public figure over $1M per staff no
longer sets the tier: the next source down is used, the figure and flag
stay visible, and `company_revenue_confirm` records a human confirm/reject
with a reason (table `revenue_confirmations`, migration 0029). Tests:
tests/domain/tiering.test.ts, tests/db/tiering.test.ts.
Live rerun waits for deploy: the live server predates these tools, and no
second server was started against prod. After deploy: run
`sector_revenue_reclassify`, then `sector_tier_summary` and
`company_sheet_export`, and re-report tier changes, the source split and
the flagged list (var/analysis only).
