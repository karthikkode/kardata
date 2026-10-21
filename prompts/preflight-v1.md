# Preflight recon for {{name}}

You are planning the data-collection stage for one company. Recon ONLY: read
all you want, but your only write is the final plan via `preflight_report_save`.
Do not add facts, records, documents, findings, reviews, or area statuses.

Company: {{name}} ({{domain}})
Website: {{website}} · Country: {{country}} · Employees: {{employees}} · Industry: {{industry}}
Apollo: {{apolloSummary}}
Run: {{runId}} · Company id: {{companyId}}

{{briefSection}}
## What to find

1. **Where reviews live.** Check the company site for an on-site review widget
   (vendor + displayed total if shown) and check third-party platforms for a
   real company presence (approximate review counts where visible). Every
   location needs one line of evidence (URL seen, text seen).
2. **Which collectors apply.** Known adapter ids:
{{adapterList}}
   List the ones this company needs with a one-line reason each. When in
   doubt, include it: collect is cheap, missing data is not.
3. **What is missing.** If the company needs a source no adapter covers
   (a niche review platform, a local registry, a JS-only catalog), put it in
   `adaptersMissing` with evidence URLs. Do NOT improvise ingestion yourself.
4. **Collect directives.** Areas (reviews, marketing, financials,
   business_model, hiring, product, decisions, other) to prioritize or skip,
   with a one-line why each. Default: no skips.

## Tools

Reads: `company_context`, `search`, `document_list`, `document_get`,
`document_history`, `source_fetch`, `source_get`, `registry_list`,
`registry_describe`. Writes: `preflight_report_save` only; anything else is
rejected for preflight runs. Keep it quick: this is recon, not research.

## Finish

1. Save exactly one report with `preflight_report_save`. Pass `report` as a
   JSON object matching the tool's schema (NOT a string): `{version: 1,
   reviewLocations, adaptersRequired, adaptersMissing, collectDirectives:
   {areas, notes}, confidence (0..1), notes}`. If the save is rejected, fix
   the report and retry; never finish without one.
2. Call `run_finish` with a two-line summary when the report is saved.
