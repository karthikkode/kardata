Status: done · Date: 2026-10-31

# Stage 5.7: RIA sector (the first non-D2C sector)

The owner adds US registered investment advisers (RIAs) as a sector (D-69). The server is D2C-shaped in five places:
the Apollo-only import, the D2C preflight classifier, the D2C research and extraction areas, the 6 D2C ICP signals,
and revenue tiers. This stage adds a **sector playbook** (`d2c` or `ria`) and builds the `ria` side of each. Skincare
must behave exactly as before. Sector content: `docs/sectors/ria/` (README, icp.md). Read `docs/sectors/ria/icp.md`
before any code; it is the business spec for every RIA rule below.

Work in the worktree `~/projects/kardata-ria` on branch `stage-5.7/ria-sector` (from origin/main). Never touch the
owner's checkout `~/projects/kardata` (it holds caller work and private files) or the live checkout except through
`scripts/deploy-live.sh`.

## Part B: code (one commit per step, tests with each step)

- **B1. Playbook on the profile.** `profile.playbook: "d2c" | "ria"`, default `d2c` (existing profiles unchanged,
  same hash). For `ria`, the D2C-only fields (scope.businessTypes and require flags, classifierHints, promptHints,
  tiering per-staff numbers) are not required; a `ria` block holds the thresholds from icp.md sections 1–3
  (max AUM, max employees, min employees, min wealth share, group split at $500M). Profile load and set work for
  both. `docs/sectors/ria/profile.json` is written in this step.
- **B2. SEC adviser file import.** A second import kind beside Apollo CSV: the SEC monthly investment adviser file
  (the public "Information About Registered Investment Advisers" download; verify the current URL and format on
  sec.gov first, with the User-Agent from the sector README). Parse every SEC-registered adviser; key companies by
  SEC/CRD number (no Apollo id needed); map name, website, main phone, address, state, country, employees, regulatory
  AUM, account count, client-type shares, compensation types, registration status, file date into the company row
  and into facts with an import source (cite the file and its date). Re-import of a newer month updates facts and
  keeps history (needed for the `growth` signal). The file stays under the import dir, never committed. Tests use a
  small synthetic fixture in `tests/fixtures/` only. Tool: `sector_create`/import accept the new kind (or a
  `sector_import_sec` tool) through MCP.
- **B3. Rule-based preflight for `ria`.** No LLM: eligibility from imported facts per icp.md sections 1–2, with
  the reason key stored (`large`, `not_wealth`, `no_staff`, `exempt_or_inactive`, `not_us`), and the size group
  (P or R). Runs through the existing preflight tools and summary; `company_eligibility_override` still works.
  D2C sectors keep the LLM classifier.
- **B4. SEC firm collector** (adapter, per `docs/sources/onboarding.md`). For one firm: the latest Part 2A brochure
  (text: Item 4 services, Item 5 fees and billing, Items 12/15 custodians, Item 9 disciplinary) and Form ADV Part 1
  data from adviserinfo.sec.gov (Schedule A executive officers with titles, custodians, disclosures). Store
  documents, facts and leader records through `src/domain/research/`. Only through `fetchUrl`, SEC User-Agent,
  polite rate (the existing sec.ts host delay). Deterministic and cheap: it must be able to run for every eligible
  firm. Fake-site tests for ok / not_found / error.
- **B5. RIA research and extraction prompts** (`prompts/research-ria-v1/`, `prompts/extract-ria-v1/`), chosen by the
  company job's sector playbook. Same flow, citation and source rules as research-v1.8 (copy them, don't
  reinvent). Areas: `firm_and_fees` (fee schedule, billing in advance or arrears, family grouping, negotiable
  fees, flat or hourly options, minimums, proration and refunds, in the brochure's words); `people_and_ops`
  (leaders by name and role, ops, billing, compliance and client service roles, team size); `systems` (custodians,
  portfolio, billing, CRM and planning software named anywhere); `deals_and_growth` (acquisitions, mergers, new
  offices, AUM and staff change); `hiring` (ops, billing, client service, onboarding posts, last 6 months);
  `compliance` (disclosures, fee-related findings or refunds). No revenue plausibility section; AUM comes from the
  SEC file.
- **B6. RIA ICP check.** Signal and exclusion rules per playbook: the 7 signals of icp.md section 4 with their
  routes and windows (`prompts/icp-ria-v1/`), exclusions from the preflight reasons. Size group replaces the D-55
  tier for `ria`; layer from the signal score; score 0 still listed, last. `sector_tier_summary`,
  `sector_icp_companies` and `company_sheet_export` work for `ria`: the sheet shows firm, state, time zone, group,
  layer, signals with quotes, contact name and title (section 5), main phone, website.
- **B7. Guard and tests.** sector-agnostic.test.ts still passes; the playbook exception in AGENTS.md covers only
  `prompts/*-ria-*` and the SEC import and collector. An e2e test runs a synthetic RIA sector through import,
  preflight, collect, research (fake agent), extraction and ICP. Skincare acceptance unchanged: on the data DB,
  skincare's eligible / ineligible counts, tier summary and sheet row count match their values before this stage
  (record them first).

## Part O: operations (after B is merged and deployed)

Standing go (D-65): open the PR, merge when CI passes, deploy with `scripts/deploy-live.sh` (drain). No preflight
or research may run during a deploy. Every operation below is an MCP tool; if one is missing, add it in Part B first.

1. Create sector `ria-us` with `docs/sectors/ria/profile.json`; import the latest SEC file (all US SEC-registered
   advisers).
2. Run the RIA preflight. Record in `docs/sectors/ria/results.md`: imported, eligible by group (P, R), kept aside
   by reason.
3. Run the SEC collector for **every** eligible firm (cheap, deterministic). This alone gives fees, custodians and
   named executives for all of them.
4. Pilot deep research on 10 firms (5 P, 5 R, strongest collector signals). Check with `batch_scorecard`: citations,
   area statuses, leaders found, fee terms quoted. Fix prompts until the pilot is clean.
5. Deep research in waves, by priority: R group first, ordered by collector signals (fee complexity, multi
   custodian, deal, named ops leader), then P group. Run continuously at the concurrency the machine and Muse quota
   allow; set checkpoints so a bad wave can be stopped. It will not finish in one night; that's expected.
6. ICP check on every researched firm; export the sheet CSV (`company_sheet_export`). Do **not** write to the
   owner's Google Sheets.

## Done means

Lint, typecheck and the full test suite pass; skincare acceptance unchanged; `ria-us` exists with the SEC file
imported, preflight run, collector run for all eligible, the pilot clean, research waves running; ICP verdicts and
a sheet CSV for every researched firm. `docs/reviews/stage-5.7-review.md` (≤ 80 lines) lists each B step with
file:line and test, the Part O counts, research throughput (firms per hour), deviations and anything blocked.
`docs/sectors/ria/results.md` has the counts. Then STOP: no outreach, no Apollo purchases, no sheet writes.
