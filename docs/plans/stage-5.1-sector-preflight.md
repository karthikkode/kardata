# Stage 5.1 — Sector preflight (eligibility pass)

**Owner decision (2026-10-21):** before any company job runs, a **sector-level preflight pass** classifies
every company in the sector. Only **eligible** companies get company jobs (company preflight → collect →
research → extraction) and enter the analysis. This filters noise such as clinics, spas, salons,
distributors and dead sites.

**Two levels, two names:**
- **Sector preflight** (this stage): "is this company in scope?" It runs once per company per sector and is
  cheap.
- **Company preflight** (Stage 5): "where does this company's data live?" It is the first stage of a company
  job, and is unchanged.

## Step 0 — Pause the current batch

Pause the migrated company-job batch now. In-flight jobs finish normally.

Then **cancel the remaining queued company jobs** with reason `superseded by sector preflight`. They are
re-created later only for eligible companies. Completed jobs and all data stay.

Report the counts.

## Step 1 — Classification (LLM, once per company)

- **Inputs, collected deterministically through the existing fetcher** (robots, rate limits, logging):
  - homepage + up to 2 of the about / shop / products pages, as text, ≤ 30 K chars;
  - plus the Apollo fields (industry, keywords, short description, employees, country);
  - plus the Shopify/products.json signal if cheap (1 request).
- **Classifier:** a tool-less app-Muse call (no MCP, no web tools) with `--output-schema`. It returns:
  - `business_type`: one of `dtc_brand`, `brand_retail_only` (own brand, sold only via retailers),
    `clinic_medical`, `spa_salon`, `retailer_marketplace` (sells others' brands), `distributor_wholesaler`,
    `manufacturer_private_label`, `agency_service`, `ingredient_supplier`, `other`, `site_dead_or_parked`,
    `unknown`;
  - `primary_category`: `skincare`, `haircare`, `cosmetics_makeup`, `body_bath`, `fragrance`,
    `supplements_wellness`, `mens_grooming`, `other`;
  - `sells_own_products` (bool), `has_online_store` (bool), `ships_to` (country list if stated);
  - `confidence`, a `reason` (one sentence) and **`quote` + `quote_source_id`**, checked like the Stage 4.3
    quote grounding.
- **Blocked or unreachable sites:** classify from the Apollo fields only, with `confidence: low`. Never retry
  around a block.
- Store the classification on a new table `sector_preflight` (`sector_id`, `company_id`, `run_id`, the
  fields above, `verification`, `created_at`), and log the provider calls like every other stage.

## Step 2 — Eligibility = rules over the classification (no LLM, re-computable)

- **The sector stores an editable rubric** (`sector_eligibility_rules`, jsonb). Default for skincare:
  - **eligible:** `business_type in (dtc_brand)` AND `sells_own_products` AND `has_online_store` AND
    `primary_category in (skincare, body_bath, mens_grooming)`;
  - **review:** `business_type in (brand_retail_only, unknown)` OR `confidence = low` OR
    `primary_category in (haircare, cosmetics_makeup, fragrance, supplements_wellness)`;
  - **ineligible:** everything else.
- **Eligibility is derived** from the rubric plus the classification, and can be **re-derived instantly**
  when the owner edits the rubric, with no new LLM calls.
- **Owner overrides** per company (`include` / `exclude`, with a note) always win over the rubric.
- `sector_companies` gets `eligibility` (`pending | eligible | review | ineligible`), `eligibility_source`
  (`rule | override`) and `eligibility_reason`.

## Step 3 — Tools and launch rules

| Tool | Purpose |
|---|---|
| `sector_preflight_start(sectorId, onlyPending?=true)` | a job over every company in the sector, with the same job controls (status/ETA, pause/resume/cancel, retry, budget, 3-same-errors auto-pause, quota visibility) |
| `sector_preflight_summary(sectorId)` | counts by business_type × primary_category × eligibility; 5 example companies per bucket, with reason + quote |
| `sector_rules_get` / `sector_rules_set(sectorId, rules)` | view / edit the rubric; set returns the before→after eligibility counts |
| `company_eligibility_override(sectorId, companyId, include\|exclude\|clear, note)` | per-company override |
| `pipeline_start(sector)` | **only creates company jobs for `eligible` companies**; `review`/`pending` are never auto-included |

- **Concurrency:** a separate `sector_preflight` pool (default 8, runtime-settable). The calls are tool-less
  and light on memory; the Muse quota is the real limit.

**AC:**
- Tests:
  - classifier schema validation and quote grounding;
  - rule evaluation, and re-derivation on a rubric change;
  - overrides win;
  - `pipeline_start` only takes eligible companies;
  - the cancel/supersede of queued jobs;
  - job controls.
- **Live on 20 companies first:** include the 4 completed ones, plus the known noise (Cosmetic Surgery
  Associates, Pinski Dermatology, Hammam Spa by Céla, The Mane Attraction). Report the classifications.
  Then run the full sector.

## Review and stop

After the full sector pass, write `docs/reviews/stage-5.1-review.md` (≤ 60 lines):
- the summary table (business_type × category × eligibility);
- tokens and minutes in total and per company;
- failures;
- 10 random spot-check rows (name, type, category, eligibility, reason, quote).

**STOP before launching any company jobs.** The owner reviews the rubric first.
