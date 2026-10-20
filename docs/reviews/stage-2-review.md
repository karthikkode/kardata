# Stage 2 review — research store and collectors

Branch `stage-2`. Full suite: 188/188 green. No push.

## Acceptance criteria

- Store: 15 tables, enums, checks, GINs (`src/db/schema.ts`), migrations
  0001–0005. Seeds: 29 keys, 11 types. Proof: `tests/db/migrate.test.ts`,
  `tests/db/research-schema.test.ts`, `tests/db/research-model.test.ts` (22).
- Validators: 9 value types, auto-create + warnings, near-dup warnings, 5 hard
  rejects, provisional widening (`src/domain/research/facts.ts:58`,
  `records.ts:53`). Proof: research-model tests.
- Upsert: created/updated/unchanged, source union (`records.ts:53`).
  `reviews_ingest`: dedupe, identity strip, 5k cap, recomputed facts
  (`reviews.ts:99`). `facts_current` latest (`schema.ts:495`). Proof: same file.
- Constraints: one-active-run, finding source_ids, status reasons.
  Proof: research-schema tests.
- Fetcher: robots, 2s delay, 80 budget, 15s/5MB/5 redirects, SSRF guard,
  cancel-before-fetch (`src/collect/fetch.ts:27-40,54-63`). Proof: 15
  fetch tests against the fake server.
- Collectors: 11, ordered, outcomes merged done>blocked>error>not_found>skipped,
  fatal only on homepage failure (`src/collect/run.ts:30`). Docs carry paths;
  facts/records write strict through the domain. Per-provider endpoint comments
  in jobs/news/sec/wayback/companies-house. Proof: 32 fake-site tests +
  `tests/collect/run.test.ts` (merge, summary, requested-areas).
- Queue: batches ≤100, already_running, cancel, boot recovery, 10-min stall
  reaper, FIFO, COLLECT_CONCURRENCY=3 (`src/runs/queue.ts:18`,
  `src/runs/runner.ts:39`). Proof: `tests/runs/runner.test.ts` (9, fake clock).
- MCP: 28 tools (`src/mcp/research-tools.ts:47`), thin wrappers over the same
  domain/reads functions. Proof: `tests/mcp/research-tools.test.ts` (6),
  `tests/mcp/agent-style.test.ts` (tools-only shift), dossier/context <10KB.
- Smoke: ran 2026-10-20 on C1..C5 (see below): 4 succeeded, 1 partial.

## Deviations

- CH has no website field in its API: issuer match is name/postcode only.
- `reviews.avg_rating` also takes `platform` (the spec's own example needs it).
- Areas: `fact_keys.area` nullable for general keys; doc area falls back to
  `other` for non-area folders.
- Money facts store `{amount}` + currency column; fact unit is copied key→fact.
- 0004 split from 0003 (PG forbids new enum values mid-transaction); the four
  json-valued review keys are auto-created provisionally by `reviews_ingest`
  instead, so fresh-DB migrate stays green (verified on empty kardata_test).
- Apollo facts impossible without provenance: apollo_profile writes its
  document only; stack skips facts when the homepage source is missing.
- `source_fetch`/`source_capture` reuse one queued agent run per company
  (`queue.ts:80`); the spec is silent on their run provenance.
- `requestedAreas` scopes outcomes (side-effect docs stay); job roles without
  a URL skip records (no natural key).

## Unfinished

- Finding of note: findings cite sources/facts/records only — Apollo import
  data (document-only, no source) cannot be cited by a finding. Fixed in 2.1:
  every import now snapshots an `apollo_import` source per row.

## Stage 2.1 + live smoke (2026-10-20)

Fixes, one commit: operator writes share one `manual` run per company per UTC
day (born succeeded, `created_by=owner`); `getOrCreateAgentRun` deleted.
Proof: `tests/mcp/research-tools.test.ts` (note_add + source_fetch, then
collect_start is queued). Apollo provenance: `createApolloImportSource`,
`findApolloImportSource`, `backfillApolloImportSources`
(`src/domain/research/sources.ts`), import snapshots per row, backfill runs
from `scripts/migrate.ts`; apollo_profile writes the 4 financial facts and
stack cites the import source per detection. Proof:
`tests/db/imports.test.ts`, `tests/db/apollo-provenance.test.ts`,
`tests/collect/apollo-profile.test.ts`, stack tests. Full suite: 195/195.

Dev repair (not a product change): the 2,559 dev companies had no sectors or
imports (smoke-real artifact), so the backfill honestly skipped them. They
were re-imported through the normal path into sector `skincare`: 2,559
updated in place, 2,559 `apollo_import` sources. That also live-verified the
new import-source code.

Smoke: `SMOKE_COMPANY_IDS=C1..C5`, batch `cc415968`, ~2 min. 4 succeeded,
1 partial. Every area of every company has a status. Legend: NF = not_found
with the footnoted reason.

- C1 (succeeded): reviews NF(a), marketing NF(b), financials done,
  business_model done, hiring done, product NF(e), decisions done.
- C2 (succeeded): reviews done, marketing done, financials done,
  business_model NF(c), hiring done, product NF(e), decisions done.
- C3 (succeeded): reviews done, marketing NF(b), financials done,
  business_model done, hiring NF(d), product done, decisions done.
- C4 (succeeded): reviews NF(a), marketing done, financials done,
  business_model NF(c), hiring NF(d), product done, decisions done.
- C5 (partial): reviews done, marketing done, financials done,
  business_model done, hiring NF(d), product ERROR(f), decisions done.

Reasons: (a) no ratings or review app detected; (b) no marketing tools
detected; (c) no About/Wholesale/Subscribe/FAQ pages and no business-model
tools; (d) no Careers pages and no supported job board linked; (e) Apollo
lists Shopify but /products.json does not answer JSON; (f) BUG — shopify
upserted a 500+ product catalog in one call (`at most 500 records per
call`), needs batching.

Collectors that never reached done: news (C1–C3 GDELT HTTP 429 — 3
concurrent runs vs the ~1 req/5s throttle; C4 GDELT 200 invalid JSON; C5
fetch failed); sec_form_d (C4/C5 skipped non-US by design; C1–C3 SEC 403 —
the UA contact is a URL and SEC requires an email-style contact);
companies_house (4 skipped non-UK by design; C4 is UK but skipped —
`COMPANIES_HOUSE_API_KEY` is empty in `.env`); feeds (no RSS/Atom link on
these homepages, by design). Apollo live proof: 28 facts cite
`apollo_import` sources (14 apollo_profile: 5 founded, 5 employees, 2
revenue, 2 funding; 14 stack).

DB growth for 5 companies: 77 → 83 MB (+6 MB); +90 sources, +72 blobs, +32
documents, +194 facts, +382 records, +5 runs, +236 events, +35 statuses.
Projection for 2,559 (×512): ~3.1 GB; ~100k facts, ~200k records, ~46k
sources; ~17 h at COLLECT_CONCURRENCY=3. Skew warning: one 500+ catalog
dominates records; GDELT/SEC currently contribute ~nothing (blocked).
