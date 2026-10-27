Status: done · Date: 2026-10-28

# Stage 5.6 review: sector-agnostic server

Baseline (data DB, before): eligibility 911 eligible/rule, 6,860 ineligible/rule, 5 ineligible/override
(7,776 members, 813 verdicts); tier summary contactable 574; sheet export 574 rows. `kardata_dev` was
empty, so the baseline and the acceptance re-check ran on the `kardata` DB the live server uses.

## Steps -> evidence -> proof

- B1 Profile v2 (src/domain/sector-preflight/profile.ts:22): scope.businessTypes + require flags,
  tiering, promptHints; rubric removed; hash over category keys only. Tests: tests/unit/sector-profile.test.ts.
- B2 One scope path (src/domain/sector-preflight/eligibility.ts:58, :197): profile-required
  evaluateSectorScope, override-then-scope deriveCompany; migration 0034 drops sectors.eligibility_rules;
  sector_rules_get/set removed. Tests: tests/db/sector-eligibility.test.ts, tests/unit/sector-preflight-scope.test.ts.
- B3 Repo profiles (scripts/mcp-call.ts): --json-file passes the file as `profile`; sector_profile_set
  returns before/after + changedFields. Test: tests/unit/mcp-call.test.ts. Used live below.
- B4 Verdicts per sector (src/db/migrations/0035_verdicts_per_sector.sql; src/domain/sectors.ts:213;
  src/domain/tiering.ts:195): PK (company_id, sector_id), sector-required companyRevenueTruth on the
  sector profile's tiering/press, resolveCompanySector, REVENUE_FLOOR. Tests: tests/db/tiering.test.ts.
- B5 Prompt v1.6 (prompts/research-v1.6/, src/runs/prompt.ts, src/runs/agent-runner.ts): company_jobs.sector_id
  (0036), PromptContext.sectorProfile, four sector.* substitutions only (diff vs v1.5 verified); dead prompts
  and templatePath() deleted; null version throws. Tests: tests/runs/prompt.test.ts.
- B6 Fact key (src/domain/icp/rules.ts:169): decisions.online_store_active; neutral question examples.
  Test: tests/unit/icp-rules-key.test.ts.
- B7 Removals: src/runs/job-shared.ts holds the five shared helpers; bulk feeder, backfill, reclassify,
  spike-muse deleted; smoke-real takes --expect/--search. Tests: tests/mcp/tools.test.ts, tests/mcp/screening.test.ts.
- B8 Guard (tests/unit/sector-agnostic.test.ts): scans src (minus migrations) + live prompts for sector
  nouns with word boundaries; neutral fixture tests/fixtures/sector-profile.json. Renames done via git mv.
- B9 var layout (src/domain/research/export.ts, src/mcp/research-tools.ts): var/sectors/<slug>/exports|analysis.
  Proven live: sheet wrote var/sectors/skincare/analysis/companies-2026-10-27.csv.
- A1-A5 docs: docs/sectors/ (skincare active, garden rejected), business docs stripped, decisions Scope
  column + D-55 + D-19/D-32 restored from git (d1a1f53), plans/reviews archived, AGENTS/README updated.

## Acceptance (data DB, new code over MCP-only server, no runners started)

- Migrations 0034-0036 applied with scripts/migrate.ts. Profile loaded:
  `sector_profile_set --sectorId 557cb85b-... --json-file docs/sectors/skincare/profile.json`, then
  sector_scope_apply: 911 eligible, 6,860 ineligible (5 overrides, 0 pending) - exact baseline match.
- sector_tier_summary identical to baseline (813 verdicts, same tier/layer, source and status counts);
  company_sheet_export 574 rows - exact baseline match.
- Full suite: 674 passed, 1 skipped (live), 1 failure fixed after (screening collect_sector test);
  lint clean except two pre-existing fetch errors in the owner's untracked var/analysis/d2c/*.mts;
  typecheck clean. Second-sector e2e (tests/runs/sector-profile-e2e.test.ts) passes.

## Follow-up operator calls (supervisor, after deploy - not run here)

- registry_curate {name: "decisions.online_store_active_oct_2026", rename_to: "decisions.online_store_active"}
- Load the prod profile: sector_profile_set --sectorId <skincare> --json-file docs/sectors/skincare/profile.json
  (already applied to the local data DB during acceptance; prod deploy still needs its own go).

## Deviations and leftovers

- A1 landed as two commits (a git add pathspec slip split the folder create from its contents).
- docs/business/decisions.md and sector-selection.md still contain the sector words: A3 itself requires
  the Scope value sector:skincare and the D-08/D-63/D-66 history, and sector-selection.md is the locked
  D-66 record. The Done grep is clean everywhere else outside docs/sectors/ and the archives.
- startCompanyJob tolerates a company in 0 sectors (sector stays null) so older sector-less flows keep
  working; 2+ sectors without an explicit sectorId still refuse in plain words.
- research_start's sectorId validates membership only; a run's prompt sector still comes from its
  company job, as specified.
