# Stage 4.1 — Extraction step, on-site reviews collector, browser fence

**Why:** the Stage 4 pilot showed that agents research well but write **documents only**:
- 1 `fact_add` versus 32 `document_save` calls across the 4 v1.1 runs;
- the documents are rich, e.g. Lume's `reviews/summary.md` has a ratings-per-platform table and complaint
  themes;
- prompt rules didn't change this.

So we stop asking the agent to structure data and split the jobs:
- the agent finds and reads sources and writes cited notes;
- an **extraction step with enforced JSON output** turns notes into facts, records and findings;
- a **collector** bulk-loads on-site reviews.

## Step 1 — Extraction phase

- **A new run phase after researching:** `researching → extracting → done`. It is also runnable alone:
  `extract_run(runId)` (operator), which re-extracts from a past run's documents.
- **Per area:** collect the run's agent documents for that area, plus the text of every source they cite.
  Budget ≈ 60 K characters; prefer cited sources and truncate long ones.
- **Muse call:** run one tool-less Muse call in the app container:
  - `--disable-web-tools --disable-shell --disable-write`;
  - no MCP servers;
  - **`--output-schema`** with an area JSON schema:
    `{facts:[{key, value, unit?, currency?, qualifiers?, as_of?, source_ids[], confidence, note?}],
      records:[{type, data, source_ids[], natural_key?}],
      findings:[{claim, detail, source_ids[], record_refs?, confidence, status}]}`.
  - The prompt (`prompts/extract-v1/<area>.md`) gives the registry vocabulary for that area (keys and types
    with descriptions) and the rules:
    - extract only what the text states;
    - never infer numbers;
    - every item cites ids **from the provided list only**;
    - no personal data (reviewer names or initials, private individuals);
    - prefer existing keys, and invent dotted area-first names only when nothing fits.
  - Verify first that `--output-schema` works headless in the container with this schema. If it doesn't,
    STOP and report.
- **Validation:** the server validates the JSON, drops items citing ids outside the provided list (and
  counts them), then writes through `src/domain/research/` with `created_by = extractor:<area>`.
  `findings.record_refs` resolve to the records just written.
- **Synthesis findings:** one more call over `summary.md` + all area documents → 5–15 cross-area findings.
- Store tokens per extraction call and add them to the run's usage.

**AC:**
- unit tests with a fake harness: schema validation, out-of-list citations dropped, writes attributed;
- **live: run `extract_run` on the 8 Stage 4 pilot runs (v1 + v1.1) without re-researching**, and report the
  scorecard split by `created_by` (collector / agent / extractor).

## Step 2 — On-site reviews collector (`reviews_onsite`, deterministic)

- It runs as a job in the `kardata-agent` image (it has Chromium). The server starts it like an agent
  container and reads JSON from stdout. No LLM.
- **Scope:**
  - the company's own domain only, robots.txt respected (the server pre-checks the URLs);
  - at most 10 product pages: bestsellers/hero first, from collector records;
  - page load + scroll + the widget's own "load more" up to 300 reviews per company.
- Supported widgets: Judge.me, Yotpo, Stamped, Okendo, Loox, Junip, Reviews.io. Fallback:
  `schema.org/Review` JSON-LD. Unsupported or no widget → `not_found` with the detected vendor.
- **Output** → `reviews_ingest`: text, rating, date, product, verified flag. **Identity is never emitted**,
  and the server strips it anyway.
- It runs in the collect phase for Shopify companies with a detected review app.

**AC:**
- tests against fake product pages for 3 widget vendors plus JSON-LD;
- live on the 2 pilot companies that have Judge.me/Stamped/Yotpo: reviews ingested, counts reported.

## Step 3 — Browser fence and agent prompt v1.2

- Playwright MCP per run gets `--allowed-origins` = the company's domain(s): apex, `www`, `shop.` and the
  Shopify `myshopify` domain if known. Verify the flag in the pinned version. Prove that a navigation to
  `amazon.com` fails.
- **`prompts/research-v1.2/`:** the agent's job is now **depth and citations**, not structuring:
  - read widely, with ≥ 3 sources per area or an honest `not_found` listing what was tried;
  - write rich area documents with tables, and **put the source id next to every claim** as `[src:<uuid>]`;
  - **no reviewer names or initials**; quote review text only without attribution;
  - keep the v1.1 completion fixes (no Workflow tool, progressive `summary.md`, finish-over-stall).
- **Doc PII check:** after research, scan agent documents for reviewer-style attributions (a first name +
  initial near review words). Any hit → redact it in a new document version and count it in the scorecard.

## Step 4 — Pilot

- **Gates per succeeded run, counting only `agent` + `extractor` items, not collectors:**
  - ≥ 25 facts;
  - ≥ 30 records;
  - ≥ 5 findings, each citing ≥ 2 items or sources;
  - reviews ≥ 100 where a supported widget exists;
  - 0 PII hits after redaction;
  - 0 off-domain browser navigations;
  - ≤ 30 min.
- Run v1.2 + extraction on 4 **new** companies, plus Step 1's re-extraction of the 8 old runs.
- `company_export` 2 companies for the owner/Claude spot-check.

## Step 5 — Bulk jobs: automated sector/shortlist research

The owner must be able to say "research every company in this sector (or shortlist)" once, then let it run
unattended in batches, at the configured agent concurrency.

- **Table `bulk_jobs`:**
  - `id`, `kind` (`research | collect`);
  - `scope` (`sector` + optional screen criteria, or `shortlist`);
  - `options`, `status` (`running | paused | cancelled | completed`), `pause_reason`;
  - counters, tokens used, `created_at`, `finished_at`.
  - Runs get a `job_id`. Everything is DB-backed, so a job survives a server restart.
- **Tools:**
  - `research_sector(sectorId, {shortlistId? | criteria?}, options)`:
    - `skipIfResearchedWithinDays` (default 30);
    - `promptVersion`;
    - `maxCompanies?`;
    - `budget?: {maxTokens?, maxHours?}`;
    - `order` (default: shortlist order, else employees desc).
  - `research_shortlist(shortlistId, options)`: the same, scoped to a shortlist.
  - `collect_sector` becomes a job of kind `collect` (same controls).
- **Feeding:** the job **feeds companies into the queue as slots free up**; it never enqueues thousands at
  once. Concurrency comes from `MAX_CONCURRENT_AGENTS`, plus an operator tool
  `harness_settings_get/set({maxConcurrentAgents})`, stored in the DB, that changes it **at runtime** (1–8).
- **Job controls:**
  - `job_status(jobId)`: counts by status, current runs, tokens used, average minutes per company, and an
    **ETA** (remaining × average ÷ concurrency);
  - `job_pause`, `job_resume`, `job_cancel` (running agents finish or are stopped, as chosen);
  - `job_retry_failed`;
  - `job_list`.
- **Auto-pause, rather than burning through the queue:**
  - when a budget is reached;
  - when **3 consecutive runs fail with the same error class**, including a Muse usage/subscription-limit
    error. Store the error text in `pause_reason`; the owner resumes later.
- Each run still has its limits (stall, time, steps).

**AC:**
- tests with the fake harness for feeding at concurrency, a runtime concurrency change, pause/resume/cancel,
  skip-if-recent, budget pause, the 3-same-errors auto-pause, restart recovery mid-job, and ETA math;
- live: a `research_shortlist` job on a 6-company shortlist at concurrency 3, paused once and resumed, then
  complete.

## Review and stop

Write `docs/reviews/stage-4.1-review.md` (≤ 80 lines), including the Step 5 job evidence: the scorecards split by `created_by`, gate results,
extraction cost per company, reviews counts, PII and fence evidence, and the export paths. STOP. No push.
