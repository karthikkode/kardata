Status: current · Date: 2026-10-28

# Stage 5.6: Sector-agnostic server (no sector content in code)

Garden was rejected: most of its companies sold to retailers, were too big, or weren't real businesses (D-66, docs/business/sector-selection.md). Before the next sector, no sector-specific content may remain in code, prompts or shared docs. Every sector stays a D2C sector: the Shopify collectors, the stack map, the 6 ICP signals, the buyer titles and the business-type enum stay in code. Only product-level sector content (categories, scope keywords, trade press, retailer names, price tiers, product claims) moves, into docs/sectors/<slug>/profile.json loaded through sector_profile_set.

## Part B: code (one commit per step)

- B1. Profile v2 is the single sector config: scope.businessTypes + require flags, tiering (with sector pressSources), promptHints; rubric field removed; profileHash stays over category keys only.
- B2. One eligibility path: evaluateSectorScope(input, profile); deriveCompany is override-then-scope; rubric machinery and skincare defaults deleted; migration drops sectors.eligibility_rules; sector_rules_get/set removed.
- B3. Profiles load from the repo: sector_profile_set returns before/after counts + changed fields; mcp-call --json-file.
- B4. Verdicts per sector: company_verdicts PK (company_id, sector_id); sector-required companyRevenueTruth on the sector profile's tiering; resolveCompanySector; REVENUE_FLOOR constant.
- B5. Sector-aware research prompt: company_jobs.sector_id, PromptContext.sectorProfile, prompts/research-v1.6 with sector.* hints; dead prompts and templatePath() deleted.
- B6. ICP fact key: not_d2c routes on decisions.online_store_active; dated key renamed by the supervisor after deploy.
- B7. Remove one-off code: onsite backfill, revenue reclassify, Apollo source backfill, the legacy bulk feeder (helpers to src/runs/job-shared.ts), spike-muse; smoke-real takes --expect/--search.
- B8. Tests and guard: neutral fixture tests/fixtures/sector-profile.json; sector-agnostic.test.ts bans sector nouns in src and live prompts.
- B9. var/ layout: exports under var/sectors/<sector-slug>/exports and analysis.

## Part A: docs (after Part B is green)

- A1. Sector folders: docs/sectors/ (README, skincare/, garden/).
- A2. Strip skincare sentences from shared business docs into docs/sectors/skincare/README.md.
- A3. decisions.md Scope column; D-55 added; D-19/D-32 restored from git history.
- A4. Plans and reviews archived; this plan becomes current; roadmap and pipeline.md fixed.
- A5. AGENTS.md docs map + Never rule; README scripts refreshed.

Done means: lint, typecheck and the full test suite pass (including sector-agnostic.test.ts); on the data DB, loading docs/sectors/skincare/profile.json and re-deriving gives 911 eligible / 6,860 rule-ineligible / 5 overrides with tier summary and sheet counts at baseline; docs/reviews/stage-5.6-review.md is written; then STOP (no push, no deploy).
