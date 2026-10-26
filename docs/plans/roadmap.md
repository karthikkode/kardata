# Roadmap (context only: build just the current stage's plan)

Kardata v2 is a backend service, `kardata-server`, driven entirely through MCP. Each stage ends with a
review, then STOP. The frontend comes last.

## Stage 1 — Core: sectors, companies, MCP server
See `stage-1-sectors-and-companies.md`.

## Stage 2 — Research store and collectors (no LLM)

**Tables:**
- `research_runs`, `run_events`;
- `sources`: url, fetched_at, http status, content snapshot, sha256;
- `documents`: every agent- or collector-created file, with full-text index, area, run and creator;
- `findings`: area, claim, source ids, confidence, `supported | conflicting | unverified`;
- `area_status`: `done | not_found | blocked` with the exact reason.

**Seven research areas:** reviews, marketing, financials, business model, hiring, product, decisions/ad-hoc.

**Deterministic collectors.** Every one respects robots.txt, is rate-limited, never bypasses a bot wall,
and stores a snapshot:

| Collector | What it reads |
|---|---|
| Site | homepage, about, press, careers, sitemap |
| Shopify | `/products.json`, `/collections.json` |
| Job boards | Greenhouse, Lever, Ashby and Workable public JSON |
| On-site reviews | Judge.me, Yotpo and Okendo widgets on the company's own site |
| Own feeds, GDELT news, SEC Form D, Wayback | the company's RSS, free news, US fundraises, site history |
| UK Companies House | the official API, UK companies only |
| Tech-stack inference | from Apollo technologies (subscriptions, loyalty, email/SMS) |

**MCP:** read tools (`company_dossier`, `document_get`, `document_search`), plus `collect_run(company_id)`.

## Stage 3 — Muse spike (3a: `stage-3a-muse-spike.md`), then the orchestrator (3b: `stage-3b-orchestrator.md`)

**Spike first.** With Muse Spark 1.3 in contributor mode, prove that Muse can:
- run headless from a prompt plus an MCP config;
- report a session id;
- stream progress;
- be killed cleanly.

Also measure how well Muse's built-in search works on 10 companies. If the spike fails, STOP and report.

**Browser use.** Muse Code 1.4.10 has `web_search` and `web_fetch` but **no built-in browser**. It does load
MCP servers (stdio and streamable-http), so the browser is Microsoft's official **Playwright MCP**
(`@playwright/mcp`, headless Chromium) attached per research agent. The spike proves:
- Muse `exec` can load kardata MCP and Playwright MCP together, per run, from config;
- the memory per browser instance, to set `MAX_CONCURRENT_AGENTS`.

Browser rules:
- a fresh isolated profile per run: **no logins, no saved cookies**;
- no CAPTCHA solving and no bot-wall workarounds: a challenge → `area_status blocked`;
- at most `BROWSER_PAGES_PER_RUN` (default 40) pages per run;
- everything read in the browser is stored with `source_capture(via: browser)`.

Use it for JS-rendered pages: review widgets, careers pages, store locators.

**Orchestrator:**
- `research_start(company_ids[])` creates a batch;
- **one active main agent per company**, enforced by a partial unique index; the agent may spawn subagents;
- parallel up to `MAX_CONCURRENT_AGENTS`;
- heartbeat and idle reap → `stalled`;
- cancel, and a sweep of the run's working folder into `documents`;
- the harness sits behind an adapter interface, so another harness can replace Muse later.

**Agent toolset:** the ingest tools from `research-data-model.md`, scoped by a per-run token to one company, plus
`heartbeat` and `run_finish`. Research agents get **no shell or file-write tools** where Muse can restrict
that (check it in the spike). They store data only through kardata MCP.

## Stage 4 — Research playbook (`stage-4-research-playbook.md`)
- The main agent's instructions and one subagent per area.
- A checking step: no finding without a source; conflicts are marked.
- A per-company summary document.
- Pilot on 5 companies, then a 25-company batch.

## Stage 6 — Analysis, RAG and the sector product (planned later, with the owner learning RAG hands-on)
- **Structured analysis in SQL** over facts and records: sector benchmarks, percentiles, segments.
- **RAG over the unstructured data** (documents, reviews, sources):
  - pgvector in the same Postgres (switch the image to `pgvector/pgvector:pg16`);
  - chunking;
  - embeddings (a local model on the Spark, or an API);
  - hybrid retrieval: full-text + vector, fused, then reranked;
  - answers that cite our stored sources;
  - a retrieval/answer eval set.
- **Sector product:** the private benchmark report, plus a per-company one-pager for outreach.
- **Business inputs:** the ICP scoring, the 8 problem dimensions, the evidence rules and the offer in
  `docs/business/` define what the analysis looks for. Plan Stage 6 against them.

## Stage 5 — Frontend
Next.js on top of the same service, porting v1's design system from `v1-final`.

## Later (not planned yet; do not build)
- Social content: YouTube and Instagram through official APIs. TikTok has no legitimate API.
