Status: done · Date: 2026-10-26

# Research data model and the standard ingest toolset

This is the **one way** research data enters the database, whether it comes from a collector (code) or an
agent (Muse, from Stage 3). Agents never write scripts, SQL or files to store data. They call the kardata MCP
tools below, and the server stores, deduplicates, indexes and links everything.

**Design stance: guide, don't gate.** Every company is different, and the agent must be free to follow
whatever is important. The registry is a shared vocabulary that helps keep data consistent; it is **not a
gate**. The server rejects a write only when something is genuinely broken. Everything else is accepted,
sometimes with a warning that suggests a better fit.

## Principles

1. **One write path.** The MCP tools and the collectors both call the same functions in
   `src/domain/research/`. There is no other insert path into the research tables.
2. **Anything goes in; nothing goes in without provenance.**
   - **Hard rejects, the only ones:**
     - no `source_ids` on a fact, record or finding;
     - a source or company outside the run's scope;
     - an over-size payload;
     - a malformed document path;
     - a value that can't be read as the type of an **approved** key.
   - **Accepted with a warning:**
     - an unknown key or record type (auto-created as `provisional`);
     - a near-duplicate name (the warning names the existing match);
     - new fields on an existing record type (added to the type automatically);
     - a value that doesn't fit a **provisional** key's type (the key widens to `text`/`json`).
   - Every write records `company_id`, `run_id`, `created_by` (`collector:<name>`, `agent:<runId>/<label>`
     or `owner`) and `created_at`.
3. **Append, don't overwrite.**
   - Facts are append-only: every value keeps its history as a time series.
   - Records upsert on a natural key and remember first/last seen.
   - Documents are versioned.
4. **Everything is indexed.**
   - A `tsv` (full-text) column with a GIN index on every research table, plus GIN on jsonb.
   - One `search` tool spans all of them.
   - Embeddings (pgvector) are a later proposal, not now.
5. **Responses teach.** Every write response lists per item `created | updated | unchanged | rejected`,
   plus any `warnings`, with suggestions in plain words. The agent reads them and adjusts. It never needs
   to improvise a workaround.

## Five kinds of data

| Kind | Table | Use it for | Example |
|---|---|---|---|
| **Source** | `sources` (+ `blobs`) | Every page, API response, search hit or browser view looked at | a fetched `/products.json`; a search hit's URL and snippet; a browser page's text |
| **Fact** | `facts` | One value about the company | `reviews.avg_rating = 4.6` (qualifier `platform: trustpilot`), as of 2026-10-20 |
| **Record** | `records` | One item in a list | a product, a review, a job posting, a news item, a funding event, a stockist |
| **Document** | `documents` | Long text: extracts, notes, analyses, summaries. **As many as needed** | `reviews/complaints-packaging.md` |
| **Finding** | `findings` | A conclusion built on the above | "Shifted to subscription-first in 2025", citing records and sources |

**Areas:**
- the seven defaults: `reviews`, `marketing`, `financials`, `business_model`, `hiring`, `product`, `decisions`;
- plus `other`.
- Items also carry free `tags` text[], so the agent can group things any way a company needs.

Each area gets an `area_statuses` row per run (Stage 2 schema).

## Tables, in addition to the Stage 2 schema

**`fact_keys`** — the registry:
- `key` pk: dotted lowercase, e.g. `reviews.avg_rating`;
- `area`;
- `value_type` `number | money | percent | date | bool | text | url | text_list | json`;
- `unit`;
- `description`;
- `qualifier_names` text[]: open; a new qualifier name is added on first use, with a warning;
- `status` `approved | provisional`;
- `created_by`, `first_used_at`, `use_count`.

**`facts`**:
- `id`, `company_id`, `run_id`, `key` (fk), `area`;
- `value_num`, `value_text`, `value_date`, `value_bool`, `value_json`, `currency`, `unit`;
- `qualifiers` jsonb;
- `as_of` date;
- `source_ids` uuid[], not empty;
- `confidence` `low | medium | high`;
- `note` text;
- `tags`;
- `created_by`, `created_at`.
- The view `facts_current` = the latest per (`company`, `key`, `qualifiers`).
- Indexes: (`company_id`, `key`), GIN (`qualifiers`), `tsv`.

**`record_types`** — the registry:
- `name` pk, snake_case;
- `area`, `description`;
- `fields` jsonb: `[{name, type, description}]`. It **grows automatically** when new fields appear; a type
  is inferred from the first values.
- `natural_key` text[]. If none is declared, the default is `url` when present, else a hash of all fields.
- `status`, `created_by`, `use_count`.

**`records`**:
- `id`, `company_id`, `type` (fk), `area`;
- `natural_key_hash`, unique (`company_id`, `type`, `natural_key_hash`);
- `data` jsonb (any shape; known fields are type-checked, unknown ones kept as given);
- `source_ids` uuid[], not empty;
- `tags`;
- `first_seen_run_id`, `last_seen_run_id`, `created_by`, `created_at`, `updated_at`.
- Indexes: GIN (`data`), `tsv` over all text fields.
- An upsert merges `data`, unions `source_ids` and bumps `last_seen_run_id`.

**`findings`** gains `fact_ids` uuid[], `record_ids` uuid[] and `tags`.

## Reviews: bulk ingest

Reviews are the highest-volume unstructured data, so they get a dedicated tool. They still land in
`records` (type `review`), indexed like everything else.

`reviews_ingest(companyId, platform, sourceId, reviews[] ≤ 500)`:
- Each review: `{text, rating?, rating_scale?, title?, date?, product?, verified_buyer?, url?, language?,
  helpful_count?, reply_text?}`. **Unknown extra fields are kept.**
- **No reviewer identity.** Names, handles, avatars, emails and locations finer than country are dropped by
  the server, even if sent.
- Dedupe key: `platform` + normalized `text` + `date`. Re-ingesting the same reviews is a no-op.
  Dateless reviews are stored with `date_missing: true`; they dedupe on the same key with the date
  empty, so a rerun is still a no-op, and each ingest recomputes a `reviews.dateless_count` fact
  (`src/domain/research/reviews.ts:200-208`, count at `src/domain/research/reviews.ts:251-252`).
- Up to 5,000 reviews per company per platform; beyond that, the server keeps the most recent.
- After each call, the server **recomputes these facts automatically** for that platform:
  `reviews.ingested_count`, `reviews.avg_rating` (normalized to 5) and `reviews.rating_distribution` (json),
  and the oldest/newest review dates.
- `review_theme` records (theme, sentiment, prevalence, example review ids) and `reviews/*.md` documents are
  where the agent writes its analysis.

## Documents = the company's markdown files, stored in the database

Agents and collectors "create files" by calling `document_save`. There are **no `.md` files on disk.**
Each company has its own **virtual folder tree**.

- `path`:
  - lowercase `[a-z0-9-_/.]`, ending in `.md`, at most 200 characters;
  - **any folders the agent likes**. If the first folder is an area name, it sets `area`; otherwise `area`
    is `other`;
  - the current version is unique per (`company_id`, `path`).
- `version` and `is_current`: saving an existing path creates version N+1. **Nothing is overwritten.**
  Saving identical content is a no-op.
- `content_md` at most 500 KB. A larger save is rejected with "split into several files".
- `title`, `kind` (`extract | summary | agent_note | report | artifact`), `source_ids`, `fact_ids`,
  `record_ids`, `tags`, `created_by`, `run_id`, `content_sha256`, `tsv`.

**Rule for agents (repeated in the Stage 4 playbook):** create **as many documents as needed, one per topic
that matters**. Follow what is interesting about *this* company, even if it fits no default area. Examples:
- `reviews/complaints-packaging.md`
- `product/hero-products.md`
- `decisions/2025-rebrand.md`
- `founder/story.md`
- `sustainability/claims.md`

## Seed registry (a migration; suggestions, not limits)

**Fact keys:**

| Area | Keys |
|---|---|
| product | `product.count`, `product.price_min`, `product.price_median`, `product.price_max` (money), `product.launches_per_month` (qualifier `month`), `product.type_count` (qualifier `type`), `product.catalog_change_12m` (percent) |
| reviews | `reviews.avg_rating`, `reviews.count` (qualifier `platform`), `reviews.app` (text) |
| marketing | `marketing.channel_active` (bool, qualifier `channel`), `marketing.tool` (text, qualifier `category`), `marketing.positioning` (text) |
| business_model | `business_model.subscription`, `business_model.wholesale`, `business_model.marketplace` (bool, qualifier `marketplace`), `business_model.bnpl`, `business_model.retail_presence` (bool), `business_model.price_tier` (text) |
| hiring | `hiring.open_roles`, `hiring.open_roles_by_department` (qualifier `department`), `hiring.board` (text) |
| financials | `financials.revenue_estimate` (money, qualifier `source`), `financials.total_funding` (money), `financials.employees` (qualifier `source`), `financials.accounts_type` (text), `financials.last_raise_date` (date) |
| general | `company.founded_year`, `company.hq_country` |

**Record types** (`natural_key` in brackets):
- `product` [`url`]
- `review` [`platform`, `text`, `date`]: written by `reviews_ingest`
- `review_theme` [`theme`, `sentiment`]
- `job_posting` [`url`]
- `news_item` [`url`]
- `funding_event` [`date`, `round`]
- `company_event` [`date`, `event_type`, `summary`]
- `retailer` [`name`]
- `competitor` [`domain`]
- `leader` [`name`, `title`]: **public business roles only**
- `blog_post` [`url`]

## MCP tools

The tool list is not kept in this file. The live list is registered in code: `src/mcp/server.ts:9-10`
registers the operator tools from `src/mcp/tools.ts:35` and the research tools from
`src/mcp/research-tools.ts:159`. Read those functions for names, schemas and limits.

Auth shape (unchanged): an operator token for the owner, and a per-run token for agents in Stage 3
(scoped to one company, with `created_by` set by the server, never by the caller).

**Current prompts:** research `v1.4` (`prompts/research-v1.4/`) and extraction `v2`
(`prompts/extract-v2/`). The research version is chosen by `latestPromptVersion()`
(`src/runs/prompt.ts:60-65`), which returns the highest `research-v*` prompt present; the extract
prompt path is fixed at `src/runs/extract.ts:41`.
