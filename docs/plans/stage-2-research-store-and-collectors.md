# Stage 2 — Research store and collectors (no LLM)

**Read `docs/plans/research-data-model.md` first. It is part of this spec** (the registry, facts, records,
the single write path and the ingest tools).

**Goal:** for any company, a **collect run** fetches what's legitimately public about it, stores every
fetched page as a source, and writes indexed documents and per-area statuses. The owner drives it and
reads the results entirely through MCP. Stage 3's agents will build on this store.

**Out of scope:**
- LLM calls, agents, Muse, web search;
- findings written by agents (the table is created now, filled in Stage 3);
- Meta Ad Library (skipped: its API returns no US commercial ads), Reddit, Trustpilot, Amazon, Google
  reviews, LinkedIn;
- any UI.

**Research areas (enum `area`):** `reviews`, `marketing`, `financials`, `business_model`, `hiring`, `product`,
`decisions`.

## Hard rules for every network call
- Each request runs through **one fetcher module**, `src/collect/fetch.ts`. No other code calls `fetch`.
- **robots.txt is respected.** Use `robots-parser`, cached per host for 1 hour. A disallowed URL is never
  fetched; it is recorded as a source with status `robots_disallowed`.
- **Honest User-Agent:** `KardataBot/0.1 (+$KARDATA_CONTACT_URL)`. No browser spoofing, no rotating
  identities, no proxies, no headless browser.
- **Rate limits:**
  - at least 2 s between requests to the same host, enforced globally across concurrent runs;
  - at most 80 requests per collect run;
  - a 15 s timeout, at most 5 MB per response and at most 5 redirects;
  - http(s) only.
- **SSRF guard.** Domains come from CSVs, so resolve each hostname and refuse private, loopback,
  link-local and metadata addresses, including after a redirect. Tests cover this.
- **Bot walls are recorded, never worked around.** A 403/429/503 response, or a challenge page (Cloudflare
  `cf-chl`, captcha markers), becomes a source with status `blocked`. Do not retry it during the run.
  Whatever area depended on it ends `blocked` with the URL and the status code.
- **Nothing is invented.** If an area has no data, its status is `not_found` with the reason (for example
  "no careers page or job board found"). A tool or network failure is `blocked` or `error` with the exact
  message. It is never `not_found` and never a guess.

## Step 1 — Schema

- **`research_runs`**
  - `id`, `company_id` (fk cascade);
  - `kind` enum `collect | agent` (`agent` is used in Stage 3);
  - `status` enum `queued | running | succeeded | partial | failed | cancelled | stalled`;
  - `requested_areas` area[];
  - `batch_id` uuid, nullable;
  - `error` text;
  - `request_count` int;
  - `created_at`, `started_at`, `finished_at`, `last_activity_at`.
  - **Partial unique index on `company_id` where status in (`queued`, `running`)**: at most one active run
    per company, whatever its kind.
- **`run_events`**
  - `id` bigserial, `run_id`, `at`;
  - `type`: `fetch`, `collector_start`, `collector_end`, `area_status`, `error`, `log`;
  - `payload` jsonb, small: no page bodies.
- **`blobs`**
  - `sha256` pk, `content_type`, `size`;
  - `gzip` bytea. Bodies are stored gzipped and deduplicated by hash.
- **`sources`**
  - `id`, `company_id`, `run_id`;
  - `url`, `final_url`, `collector`;
  - `status` enum `ok | not_found | blocked | robots_disallowed | error`;
  - `http_status`, `error`, `fetched_at`;
  - `blob_sha256`, nullable.
- **`documents`** — everything the system or an agent writes:
  - `id`, `company_id`, `run_id`;
  - `area` (nullable: "general");
  - `kind` enum `extract | summary | agent_note | report | artifact`;
  - `title`, `content_md` text;
  - `source_ids` uuid[];
  - `created_by`, e.g. `collector:shopify`, later `agent:<run>/<subagent>`;
  - `content_sha256`, `created_at`;
  - generated column `tsv` (english, title weighted A) with a GIN index.
- **`findings`**
  - `id`, `company_id`, `run_id`, `area`;
  - `claim` text, `detail` text;
  - `source_ids` uuid[] **not empty** (check constraint);
  - `confidence` enum `low | medium | high`;
  - `status` enum `supported | conflicting | unverified`;
  - `created_by`, `created_at`.
- **`area_statuses`**
  - pk (`run_id`, `area`), `company_id`;
  - `status` enum `done | not_found | blocked | error | skipped`;
  - `reason` text, required unless the status is `done`;
  - `updated_at`.
- **Also add every table in `research-data-model.md`:**
  - `fact_keys`, `facts`, the `facts_current` view, `record_types`, `records`;
  - `findings.fact_ids` and `findings.record_ids`;
  - a `tsv` column with a GIN index on documents, facts, records and sources;
  - the seed registry as a migration.
- The write functions live in `src/domain/research/` and follow "guide, don't gate" from the data model:
  - hard rejects only for the listed cases;
  - otherwise accept, auto-create provisional keys/types/fields, and return warnings.

**AC:**
- The migration applies.
- Unit/DB tests for the validators:
  - each value type;
  - an unknown key / type / field → accepted as provisional, with a warning;
  - a near-duplicate name (same normalized name, or edit distance ≤ 2) → accepted, with a warning naming the
    match;
  - a missing `source_ids` → rejected;
  - a bad value for an approved key → rejected; for a provisional key → the key widens;
  - a record upsert on its natural key → `updated`, with source ids unioned;
  - `reviews_ingest`: dedupe, identity fields dropped, the cap, the recomputed rating facts;
  - `facts_current` returns the latest value per (company, key, qualifiers).
- Constraint tests: a second active run for the same company is rejected; a finding with no source ids is
  rejected; a non-done area status without a reason is rejected.

## Step 2 — Fetcher (`src/collect/fetch.ts`)

It implements every hard rule above and returns `{source, body?: Buffer, text?: string}`. Each call writes
its source row plus one `fetch` event.

Dependencies to add: `robots-parser`, `cheerio`.

**AC:** tests run against a local fake HTTP server (no live network in tests). They cover:
- robots disallow;
- the per-host delay, timed;
- the size cap, timeout and redirect limit;
- an SSRF refusal, including a redirect to 127.0.0.1;
- challenge-page detection → `blocked`;
- blob dedupe on identical bodies.

## Step 3 — Collectors (`src/collect/collectors/*.ts`)

Each collector is `(ctx) => Promise<CollectorResult>`. **It writes through the same
`src/domain/research/` functions the MCP tools use**:
- **facts** for measurable values (e.g. `product.count`, `hiring.open_roles`);
- **records** for list items (`product`, `job_posting`, `funding_event`, `news_item`, `blog_post`, `retailer`);
- **`extract` documents** for page text.

It returns area statuses. Collectors run in the order below, and a later one may read
an earlier one's sources.

1. **`site`**
   - Fetch the homepage, `robots.txt`, then `sitemap.xml` (and nested sitemaps, at most 3).
   - Classify URLs by path/title into `about`, `press/news/blog`, `careers/jobs`, `wholesale/stockists`,
     `subscribe/subscription`, `faq/shipping/returns`, `reviews`.
   - Fetch at most 12 classified pages.
   - Documents:
     - about, wholesale, subscribe and faq → `business_model`;
     - press and blog → `decisions`;
     - careers → `hiring`.
   - Also extract JSON-LD (`Organization`, `Product`, `AggregateRating`) and social links.
2. **`shopify`**
   - Run when Apollo technologies include Shopify, or `/products.json` answers JSON.
   - Fetch `/products.json?limit=250&page=N` (at most 4 pages) and `/collections.json`.
   - Write a `product` document with:
     - the product count and a product-type breakdown;
     - price min/median/max per currency, from variants;
     - variants per product;
     - launches per month, from `published_at`/`created_at`, for the last 24 months;
     - the top tags;
     - collection names.
3. **`jobs`**
   - Detect a job board from links on the careers page and homepage: Greenhouse, Lever, Ashby, Workable.
   - Call that board's public JSON API. Look up the current endpoints in each provider's own docs; write
     each one in one line in the code.
   - **Only use a slug found linked from the company's own site. Never guess one.**
   - Write a `hiring` document: open roles by department and location, posting dates, and any compensation
     ranges shown.
4. **`reviews`**
   - Aggregate rating and count, from `AggregateRating` JSON-LD on the homepage and at most 3 product pages.
   - Which review app the site uses, from Apollo technologies and page scripts: Judge.me, Yotpo, Okendo,
     Stamped, Loox, Reviews.io.
   - Do **not** call review-vendor APIs in this stage.
   - Write a `reviews` document.
5. **`stack`** — no network; reads Apollo technologies plus the homepage scripts already fetched.
   - Map tools to signals:
     - subscriptions (ReCharge, Skio, Stay.ai, Ordergroove);
     - loyalty (Smile.io, LoyaltyLion, Yotpo Loyalty);
     - email/SMS (Klaviyo, Attentive, Postscript, Omnisend);
     - ad pixels (Meta, TikTok, Google Ads, Pinterest, Snap);
     - affiliate/creator (Impact, Refersion, Grin, Aspire);
     - support (Gorgias, Zendesk);
     - BNPL (Afterpay, Klarna, Affirm);
     - wholesale (Faire).
   - Keep the map in one file, `src/collect/stack-map.ts`.
   - Writes `marketing` and `business_model` documents.
6. **`feeds`** — the company's own news, through its own feeds.
   - Find RSS/Atom feeds: `<link rel="alternate">` on the homepage, plus Shopify's `/blogs/<handle>.atom`
     for blog handles found in the sitemap.
   - Read at most 3 feeds.
   - Write a `decisions` document: the dated post titles and links from the last 24 months.
7. **`news`** — GDELT DOC 2.0 API (free, no key).
   - Query the quoted company name plus the domain. Article list mode.
   - Keep only articles whose title or URL contains the exact company name or the domain.
   - Write a `decisions` document: date, outlet, title, URL, headed **"Unverified mentions — the name may be
     ambiguous"**.
   - Do not fetch the articles themselves (Stage 3's agent verifies).
   - Verify the API's current parameters and history window against GDELT's own docs; note them in one
     code comment.
8. **`sec_form_d`** — US companies only. Uses SEC EDGAR's public full-text search.
   - The User-Agent must contain `KARDATA_CONTACT_URL` (SEC requires one). Stay under 5 requests/second.
   - Search Form D filings by the exact company name.
   - Accept a filing only if the issuer name normalizes equal **and** the issuer state matches the company's
     state. Otherwise `not_found` "no confident match", listing the candidates.
   - From the filing XML take: date, total offering amount, amount sold, industry group, and number of
     investors.
   - Write `financials` and `decisions` documents ("raised $X on <date> per Form D").
   - Verify the endpoint against SEC's developer docs.
9. **`wayback`** — Internet Archive CDX API.
   - Count homepage captures per year, and the first and last capture.
   - If the company is a Shopify store: find the `/products.json` capture closest to 12 months ago and fetch
     it (one request). Compare it with today's: products added/removed, and the median price change.
   - Write `product` and `decisions` documents.
   - Respect archive.org's rate limits (≥ 2 s between requests applies there too).
10. **`companies_house`**
   - Only for `country = United Kingdom` and if `COMPANIES_HOUSE_API_KEY` is set; otherwise `skipped` with
     the reason.
   - Search by name, then accept a match only if the name normalizes equal, or the registered website or
     postcode matches. Otherwise `not_found`: "no confident match", with the top 3 candidates in the
     document.
   - Fetch the profile, officers count and filing history, plus the latest accounts' type and date. Do not
     parse PDF or iXBRL in this stage.
   - Writes a `financials` document.
11. **`apollo_profile`** — no network.
   - Writes a `financials` document of the Apollo proxies (revenue estimate, total and latest funding,
     employees, founded year), each labeled "Apollo estimate".

**After the collectors**, write one `summary` document per run: one line per area with its status, reason
and document ids.

The run's status is:
- `succeeded` if no area is `blocked` or `error`;
- `partial` if some are;
- `failed` only if the homepage itself failed.

**AC:** each collector is tested against a synthetic fake site served locally. That includes a Shopify-like
`products.json`, a careers page linking to a fake Greenhouse board, JSON-LD ratings, and a challenge page, plus fake GDELT, EDGAR and CDX responses.
Each test asserts facts, records, documents, `source_ids` and area statuses exactly.

## Step 4 — Run queue (`src/runs/`)

- An in-process runner with DB-backed state, **no new services**.
  - `COLLECT_CONCURRENCY`, default 3 companies at a time.
  - FIFO by `created_at`.
- `startCollect(companyIds[] ≤ 100, areas?)` creates a batch.
  - A company that already has an active run is reported as `already_running` with that run id, not
    queued again.
- Cancel sets `cancelled`. The run stops before its next fetch.
- On boot: `running` → `failed` with error "server restarted"; `queued` runs stay queued.
- `last_activity_at` updates on every event. A run with no activity for 10 minutes → `stalled`.

**AC:**
- DB tests for the batch, the one-active-run rule, cancel, the restart rule and the stall reaper, using a
  fake clock.
- The concurrency cap is respected (assert the maximum number of simultaneously running runs).

## Step 5 — MCP tools

Add these tools, with the same conventions as Stage 1. Keep outputs small: lists never include bodies.

| Tool | Returns |
|---|---|
| `collect_start(companyIds[], areas?)` | the batch id, plus per company a run id or `already_running` |
| `batch_status(batchId)` | counts per status, plus one line per run |
| `run_get(runId)` | the run, its area statuses and document ids |
| `run_events(runId, afterId?, limit ≤ 200)` | event rows |
| `run_cancel(runId)` | the run |
| `company_dossier(companyId)` | the latest status per area across runs, document titles/ids/sizes per area, finding counts, last run |
| `document_get(documentId, offset?, maxChars ≤ 20000)` | the content slice, plus metadata and source urls |
| `document_search(query, companyId?, area?, limit ≤ 50)` | ids, titles, a 200-char headline, rank |
| `source_get(sourceId, maxChars ≤ 5000)` | metadata plus an extracted-text excerpt |
| **every tool in `research-data-model.md` → "MCP tools"** | as specified there. In this stage they use the operator token; per-run agent tokens come in Stage 3 |
| `note_add(companyId, area, title, content, sourceUrls[]?)` | the new document. A manual owner entry: `kind agent_note`, `created_by owner`. Used for things the owner looked up by hand, such as Ad Library pages |

**AC:**
- MCP integration tests for each tool.
- Size tests: `company_dossier` and `company_context` on the fixture company are each < 10 KB.
- **An "agent-style" integration test,** driving only MCP tools, with no direct DB access:
  1. `registry_list` → `company_context` → `source_fetch` (fake site);
  2. `fact_add` + `record_upsert` + `document_save` + `finding_add` citing them;
  3. an ad-hoc record type and fact key used without registering first (warnings returned);
     `reviews_ingest` of 20 fake reviews; `source_capture` with `via: browser`;
  4. `area_status_set`;
  5. `search` finds the data that was written.

## Step 6 — Live smoke (`npm run smoke:collect`)

- Run a collect batch on **5 real companies** from the dev DB, chosen by the owner through
  `SMOKE_COMPANY_IDS`.
- Print **counts only**: per area, the status and the number of facts, records and documents; per run, the request count and
  duration; and the blocked hosts.
- Put that table in the review **with the company names replaced by `C1`–`C5`**.

**AC:**
- Every area of every company ends with a status and, unless `done`, a reason.
- 0 SSRF or robots violations in `run_events`.
- No run exceeds 80 requests.

## Review and stop

Write `docs/reviews/stage-2-review.md` per `AGENTS.md` and STOP. Include:
- the smoke table;
- which collectors never produced `done` on the 5 companies, and why;
- the DB size growth for the 5 companies, to project 2,559.
