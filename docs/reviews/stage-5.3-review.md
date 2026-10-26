Status: done · Date: 2026-10-26

# Stage 5.3 review — Revenue truth (D-55)

Branch `stage-5.3`, one commit per step, no push. Commits: 145ab5c, f9a1731,
a7f3bcf, 663dda8, 7c13587, 687b551, 2cb9626, plus this finish commit.
Worktree also holds the owner's unrelated edits (docs/business, website/);
none were touched.

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

## Deviations and what is left

- Verdict loading and the live dry run wait for deploy. The tools are the only
  write path, and the live server (8787) predates them; starting a second
  server on the prod DB would double-run every runner (`src/server.ts:238-249`
  starts all runners on boot). After this branch is deployed: load the
  2026-10-26 verdicts through `company_verdict_record`, run
  `sector_tier_summary`, then `company_sheet_export`. No AI reruns were run.
- The refresh the owner asked for is therefore a recompute from stored data
  once deployed, plus Companies House re-collection where accounts are
  missing. AI research stays after review, as planned.
- Drizzle snapshots for data-only migrations 0025/0026 were dropped (copied
  snapshots broke drizzle-kit generation); the SQL migrations and journal are
  the source of truth and the suite migrates cleanly.

## Dry run and evidence

Full suite once after the final edit: 63 files passed, 1 skipped; 635 tests
passed, 1 skipped. Focused tiering, providers, prompt and MCP tests pass.

Dry run of the new domain function over the 2026-10-26 sheet inputs (814 rows;
the function's first run against today's data, before the prod load):
99 companies change tier (B to A 21, C to B 19, C to A 4, below floor to B 49,
below floor to A 4, below floor to no tier 2). New contactable counts
(408, was 378): A/L3 10, A/L4 40, A/L5 57, B/L2 2, B/L3 15, B/L4 75,
B/L5 182, C/L3 1, C/L4 7, C/L5 19. Revenue sources after D-55: public 51,
Apollo 280, estimated from staff 483. These counts repeat from the tools
themselves after deploy.
