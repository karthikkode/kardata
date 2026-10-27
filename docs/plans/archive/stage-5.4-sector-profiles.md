Status: done · Date: 2026-10-27

# Stage 5.4: Sector profiles (preflight works for any sector)

**Why:** the sector preflight (Stage 5.1) is hard-coded to skincare.
- The product categories are a fixed skincare enum. They live in `src/domain/sector-preflight/classify.ts`
  (`PRIMARY_CATEGORIES`) and `prompts/sector-preflight-v1/schema.json`.
- A sector without a rubric falls back to `DEFAULT_SKINCARE_RUBRIC`.
- `evaluateSectorScope` (behind `sector_scope_apply`) uses skincare categories and `SKIN_KEYWORDS`.

So a second sector (garden and outdoor, about 3.4K Apollo rows, decided 2026-10-27) would classify every company as
`other`, and come out ineligible. This stage moves everything sector-specific into a **sector profile** stored per
sector. Skincare's profile reproduces today's behaviour exactly.

**Out of scope:** research and extract prompts (they are sector-agnostic); the press-source list in
`src/domain/tiering.ts` (note it in the review as a follow-up); importing or classifying the garden CSVs (the owner does
that through MCP after this stage).

## Step 1: The profile (schema, storage, skincare seed)

- **A sector profile** (zod-validated jsonb on the sector, or its own table; your choice, justified in the review):
  - `categories`: 2–20 items of `{ key (snake_case), label, description }`. `other` is always present and added
    automatically.
  - `scope`: `coreCategories` (in scope outright), `adjacentCategories` (in scope only with keyword evidence),
    `scopeKeywords` (site-text and Apollo-keyword hits for adjacent categories). Each must list only declared keys.
  - `classifierHints`: short sector-specific examples the prompt needs, such as what counts as a service business or
    a retailer in this sector (`serviceExamples`, `retailerExamples`, `supplierExamples`).
  - The eligibility rubric (`sector_eligibility_rules`) stays where it is, but is validated against the profile's
    category keys.
- **Migration:** seed the existing skincare sector with a profile equal to today's constants (the categories, the
  core and adjacent lists, `SKIN_KEYWORDS`, the current rubric). Remove the skincare fallback: a sector with no
  profile **can't be preflighted**, and the tools say so plainly.
- **AC:** unit tests for profile validation (unknown keys in scope or rubric are rejected, `other` is auto-added,
  limits); a DB test showing that the seeded skincare profile matches the old constants field for field.

## Step 2: The classifier reads the profile

- New prompt version `prompts/sector-preflight-v2/`. The category list, with descriptions, and the hints are rendered
  from the profile. The JSON schema's `primary_category` enum is built at runtime from the profile's keys.
- Business types stay as they are (stored data depends on them), but their descriptions become sector-neutral. For
  example, `spa_salon` reads "a service business without its own product line (spa, salon, or in this sector:
  {serviceExamples})". Don't rename stored enum values.
- Each classification stores the prompt version and a hash of the profile categories used.
- **AC:**
  - Prompt-rendering tests for skincare and for a synthetic garden profile.
  - A schema test: the garden categories are accepted and skincare-only values are rejected.
  - A **regression test**: for the skincare profile, the rendered v2 prompt carries the same categories and rules as
    v1.
  - Quote grounding is unchanged.

## Step 3: Scope and launch rules read the profile

- `evaluateSectorScope` takes the profile (core, adjacent and keywords) instead of the module constants. Skincare
  results must be identical: run the existing tests unchanged, plus a test over the stored skincare classifications
  in the test DB.
- `pipeline_start(categories)` validates the categories against the sector's profile.
- Changing category keys after classifications exist is **refused** unless `reclassify: true` is passed. That marks
  the affected rows `pending` (logged), so `sector_preflight_start` re-runs them. Rubric and scope edits still
  re-derive instantly, with no LLM calls.
- **AC:** scope tests with a garden profile (core category → eligible; adjacent category without keyword evidence →
  ineligible); the refusal and reclassify path; skincare results identical before and after.

## Step 4: MCP tools

- `sector_profile_get(sectorId)` and `sector_profile_set(sectorId, profile, reclassify?)`. The set returns the
  validation result and the before → after eligibility counts.
- `sector_create` accepts an optional `profile`.
- `sector_rules_get` stops saying "default skincare rubric".
- Thin wrappers only; the logic stays in `src/domain`.
- **AC:** MCP integration tests for get, set (valid and invalid), create with a profile, preflight refused without a
  profile, and the reclassify flow.

## Step 5: Synthetic end-to-end check

- Add a **synthetic** garden fixture to `tests/fixtures/` (about 12 invented companies: D2C brands across several
  categories, a garden centre, a landscaping service, a multi-brand outdoor retailer, a dead site). Never use rows
  from the real Apollo CSVs.
- Run the preflight on it through MCP, with the provider faked in tests. The expected eligibility per company is
  asserted.
- **Don't run a live LLM preflight on real garden companies.** The owner does that after review.

## The first non-skincare profile (for the owner to apply after the stage)

Write it as `docs/plans/stage-5.4-garden-profile.json`, valid against the Step 1 schema:
- **Categories:**
  - `growing`: seeds, bulbs, plants, compost, plant food, growing media;
  - `tools_watering`: hand and power tools, hoses, irrigation, sprinklers;
  - `planters_structures`: pots, planters, raised beds, greenhouses, sheds, storage;
  - `outdoor_furniture`: furniture, parasols, cushions, pergolas;
  - `outdoor_cooking_heating`: BBQs, grills, pizza ovens, fire pits, patio heaters;
  - `lighting_decor`: garden lighting, ornaments, garden giftware;
  - `wildlife`: bird feeders, bird food, insect houses;
  - `lawn_care`: lawn feed and seed, mowers, smart lawn devices.
- **Scope:** all eight are core; there are no adjacent categories.
- **Rubric:**
  - eligible: `dtc_brand` + sells its own products + has an online store, in any of the eight categories;
  - review: `brand_retail_only`, `unknown`, or low confidence.
- **Hints:**
  - services: landscaping, lawn and garden maintenance, garden design, tree surgery;
  - retailers: garden centres, DIY chains, multi-brand online outdoor retailers;
  - suppliers: growers selling only to trade, horticultural wholesalers.

## Review and stop

Write `docs/reviews/stage-5.4-review.md` (≤ 80 lines), following AGENTS.md. It must include:
- the storage choice;
- proof that skincare behaviour is unchanged;
- the list of any other skincare-specific code you found;
- the press-source follow-up.

**STOP:** no deploy, no migration on the live database, no push or merge without the owner's go.
