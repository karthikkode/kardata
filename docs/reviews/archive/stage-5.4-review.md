Status: done — 2026-10-27

# Stage 5.4 review — sector profiles

Commits on `stage-5.4` (local, unpushed): steps `51ff85c`, `2aedcec`, `7f7e1b0`,
`4bece7c`, `41405e2`, finish `5250ce7`; review fixes `5dc01dd`, `8ec46c1`,
`50c93c3`, `fd3edd4`, `fcbeeb5`, plus this update. No live migration, LLM run
or deploy. Storage: `sectors.profile` jsonb (migration `0030`), read/written
whole like the rubric; `0031` adds `prompt_version`/`profile_hash` to rows.

## Acceptance criteria

1. Skincare unchanged — `SKINCARE_PROFILE` seeded from the old constants
   (`profile.ts:131`, migration `0030`); existing suites pass unchanged
   (`sector-preflight-scope`, `sector-preflight-rules`, `sector-eligibility`,
   `sector-preflight` tests); fix 5 pins the seed exactly; no DB rows touched.
2. Garden end to end — owner's profile is `docs/sectors/garden/profile.json`
   ("garden-outdoor", 8 categories, all core; not the test profile).
   `tests/runs/sector-garden-e2e.test.ts` drives a separate synthetic profile
   kept in the test file over 12 companies, per-company outcomes (fix 4).
3. Validation — unknown scope/rubric keys, duplicates, >20 categories,
   non-snake-case rejected; `other` auto-added (`profile.ts:69,106`).
   Proof: `tests/unit/sector-profile.test.ts`, `tests/db/sector-profile.test.ts`.
4. No hardcoded lane lists on the live path — classifier schema, prompt, scope
   and pipeline categories read the profile (`classify.ts:66,90,155`;
   `applySectorScope`; `src/runs/sector.ts`). Remaining skincare literals are
   only seed/defaults: `SKINCARE_PROFILE` (`profile.ts:131`), v1-compat
   `PRIMARY_CATEGORIES` (`classify.ts:27`), `DEFAULT_SKINCARE_RUBRIC` and
   legacy scope constants (`eligibility.ts:48,112,115`).
5. Category-key change refused — `setProfile` (`profile.ts:213`) refuses
   without `reclassify: true`; with it, memberships go `pending`.
   Proof: `tests/db/sector-profile.test.ts` (refusal + pending).
6. No profile → plain refusal — `resolveProfileForSector` (`profile.ts:191`),
   wired into preflight/pipeline start and `classifyCompany`. Fix 2 adds the
   same for rubrics.
7. Tests synthetic only — `apollo-garden.csv` invented, `.example` domains;
   full suite: 69 files, 665 passed, 1 skipped (`npm test`, 2026-10-27).

## Review fixes (2026-10-27)

1. Garden JSON corrected — now the plan's "garden-outdoor" profile (8
   categories all core; eligible = D2C + own products + store in any of the 8;
   review = `brand_retail_only`/`unknown`/low confidence; plan hints). Proof:
   `tests/unit/sector-garden-profile-file.test.ts` (parse + rubric validation).
2. Rubric fallback removed — `getRubric` (`eligibility.ts:261`) defaults only
   for the sector named "skincare"; others throw "has no eligibility rubric;
   set one with sector_rules_set". `startSectorPreflight` checks it
   (`src/runs/sector.ts:68`); derivation uses `getRubric` throughout. Proof:
   `tests/db/sector-eligibility.test.ts` (refusals + preflight start).
3. Included rubric applied (option a) — one validated path
   `parseEligibilityRubric` (`eligibility.ts:427`), used by `setRubric`
   (`eligibility.ts:439`); `setProfile` applies an included rubric
   (`profile.ts:226,262`, `rubricApplied` returned); `createSector` the same
   (`src/domain/sectors.ts:85`). Bad rubric stores nothing; documented in the
   MCP tool descriptions. Proof: `tests/db/sector-profile.test.ts`.
4. Fixture grown — 12 invented companies: D2C in 6 categories, garden centre,
   multi-brand online retailer, landscaping service, `brand_retail_only`,
   dead site, low-confidence D2C. E2E asserts rubric outcomes per company
   (6 eligible / 2 review / 4 ineligible), scope outcomes (7 / 5), and that
   the pipeline takes the 2 `growing` brands.
5. Seed pinned field-for-field — `tests/unit/sector-profile.test.ts` asserts
   the whole `SKINCARE_PROFILE` (categories incl. labels/descriptions, core,
   adjacent, all 46 `scopeKeywords`, hints) against literals and the surviving
   constants (`PRIMARY_CATEGORIES`, `SCOPE_CORE_*`, `SKIN_KEYWORDS`,
   exported at `eligibility.ts:112,115`).

## Other skincare-specific code found

- `prompts/sector-preflight-v1/` untouched; v2 renders profile categories and
  hints; stored `business_type` values unchanged. The press-source list in
  `src/domain/tiering.ts` stays sector-flavoured (plan follow-up, out of scope).

## Deviations

- Fallbacks remain only for the legacy sector named "skincare" (profile and
  rubric); migration `0030` seeds the real row. A sector with no stored
  rubric may set a profile first; its rubric is validated when set, or in
  the same call via fix 3.
