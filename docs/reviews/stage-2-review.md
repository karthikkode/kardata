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
- Smoke: **not run — Blocked, see below.**

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

- Blocked: live smoke needs `SMOKE_COMPANY_IDS` (owner to set). Ready:
  `npm run smoke:collect` runs the batch and asserts all 7 areas per company.
- Finding of note: findings cite sources/facts/records only — Apollo import
  data (document-only, no source) cannot be cited by a finding.
