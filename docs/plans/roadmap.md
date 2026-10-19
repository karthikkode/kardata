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
| Meta Ad Library | the official API; needs the owner's token |
| UK Companies House | the official API, UK companies only |
| Tech-stack inference | from Apollo technologies (subscriptions, loyalty, email/SMS) |

**MCP:** read tools (`company_dossier`, `document_get`, `document_search`), plus `collect_run(company_id)`.

## Stage 3 — Muse spike, then the orchestrator

**Spike first.** With Muse Spark 1.3 in contributor mode, prove that Muse can:
- run headless from a prompt plus an MCP config;
- report a session id;
- stream progress;
- be killed cleanly.

Also measure how well Muse's built-in search works on 10 companies. If the spike fails, STOP and report.

**Orchestrator:**
- `research_start(company_ids[])` creates a batch;
- **one active main agent per company**, enforced by a partial unique index; the agent may spawn subagents;
- parallel up to `MAX_CONCURRENT_AGENTS`;
- heartbeat and idle reap → `stalled`;
- cancel, and a sweep of the run's working folder into `documents`;
- the harness sits behind an adapter interface, so another harness can replace Muse later.

**Agent toolset**, each scoped by a per-run token to one company: `source_record`, `document_save`,
`finding_add`, `area_status`, `heartbeat`, `run_finish`.

## Stage 4 — Research playbook
- The main agent's instructions and one subagent per area.
- A checking step: no finding without a source; conflicts are marked.
- A per-company summary document.
- Pilot on 5 companies, then a 25-company batch.

## Stage 5 — Frontend
Next.js on top of the same service, porting v1's design system from `v1-final`.
