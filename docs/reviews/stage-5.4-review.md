Status: done — 2026-10-27

# Stage 5.4 review — sector profiles

Commits on `stage-5.4` (local, unpushed): step 1 `51ff85c`, step 2 `2aedcec`,
step 3 `7f7e1b0`, step 4 `4bece7c`, step 5 `41405e2`, plus this finish commit.
No live migration, no live LLM run, no deploy.

Storage choice: `sectors.profile` jsonb (migration `0030`), read/written whole
like the rubric; `0031` adds `prompt_version`/`profile_hash` to preflight rows.

## Acceptance criteria

1. Skincare unchanged — `SKINCARE_PROFILE` seeded from today's constants
   (`src/domain/sector-preflight/profile.ts:131`, migration `0030`); scope and
   rubric defaults still equal it (`eligibility.ts:203`, default profile).
   Proof: existing suites pass unchanged — `tests/unit/sector-preflight-scope.test.ts`,
   `tests/unit/sector-preflight-rules.test.ts`, `tests/db/sector-eligibility.test.ts`,
   `tests/runs/sector-preflight.test.ts`; `tests/runs/sector-classify.test.ts`
   only gained profile seeding in its helper. No DB classifications touched.
2. Garden works end to end — `docs/plans/stage-5.4-garden-profile.json`;
   `tests/runs/sector-garden-e2e.test.ts` (import → classify → scope →
   `startPipeline`): D2C `growing` brand eligible, 1 pipeline item; retailer,
   service and tools brands out.
3. Validation — unknown scope/rubric keys, duplicates, >20 categories,
   non-snake-case keys rejected; `other` auto-added
   (`profile.ts:69`, `profile.ts:106`). Proof: `tests/unit/sector-profile.test.ts`,
   `tests/db/sector-profile.test.ts`; rubric checked at rubric-set
   (`eligibility.ts` `setRubric`) and against a stored rubric in `setProfile`
   (`profile.ts:232`).
4. No hardcoded lane lists on the live path — classifier schema, prompt,
   scope and pipeline categories all read the profile (`classify.ts:66,90,155`;
   `eligibility.ts:341`; `src/runs/sector.ts:333`). Remaining skincare
   literals are only the seed/defaults: `SKINCARE_PROFILE` (`profile.ts:131`),
   v1-compat `PRIMARY_CATEGORIES` (`classify.ts:27`, used only when no profile
   is passed), `DEFAULT_SKINCARE_RUBRIC` and scope keyword defaults
   (`eligibility.ts:51,112,115`). `pipeline_start` wording genericised
   (`research-tools.ts:2026`).
5. Category-key change refused — `setProfile` (`profile.ts:213`) refuses
   without `reclassify: true` once classifications exist; with it, memberships
   go `pending` and `reclassifyPending` is returned. Proof:
   `tests/db/sector-profile.test.ts` (refusal + pending). Scope-only edits
   re-derive instantly via `applySectorScope`, like rubric edits.
6. No profile → plain refusal — `resolveProfileForSector` (`profile.ts:191`)
   throws "has no profile; set one with sector_profile_set"; wired into
   preflight start and pipeline start (`src/runs/sector.ts:66,333`), and
   `classifyCompany` loads the profile before any call
   (`src/runs/sector-classify.ts:269`).
7. Tests synthetic only — `tests/fixtures/apollo-garden.csv` (invented
   companies, `.example` domains); full suite: 68 files, 658 passed,
   1 skipped (`npm test`, 2026-10-27).

## Other skincare-specific code found

- `prompts/sector-preflight-v1/` kept untouched for old rows; v2 template at
  `prompts/sector-preflight-v2/prompt.md` renders categories/hints from the
  profile; stored `business_type` values unchanged.
- Each classification now stamps `promptVersion: "v2"` + `profileHash`
  (`src/runs/sector-classify.ts:350,367`); `profileHash` = first 16 hex of
  sha256 over category keys (`profile.ts:111`).
- MCP: `sector_profile_get`/`sector_profile_set` (`research-tools.ts:1919,1935`),
  `sector_create` accepts a validated profile (`src/domain/sectors.ts:80`),
  `sector_rules_get` no longer says "default skincare rubric".

## Deviations

- Profile schema also accepts the plan JSON's `name`/`description`/`rubric`
  keys (step 5), so `stage-5.4-garden-profile.json` round-trips as written.
- Read paths fall back to `SKINCARE_PROFILE` only for a sector literally named
  "skincare" with no stored profile (pre-5.4 rows/tests); migration `0030`
  seeds the real row. Any other sector without a profile is refused.
- Stored-rubric-only validation in `setProfile`: a sector with no stored
  rubric can set its profile first, then its rubric (validated at that point).
