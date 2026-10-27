Status: done · Date: 2026-10-26

# Roadmap (context only: build just the current stage's plan)

Kardata is a solo data-engineering practice. The software in this repo exists to serve the business
in `docs/business/`: read `docs/business/strategy.md` and `docs/business/offer.md` first.

## The product

- The paid entry is a **diagnostic** (priced by tier, `docs/business/offer.md`), which leads to a
  **build or a monthly retainer**.
- The call sells the meeting. The meeting sells the diagnostic. The diagnostic earns the retainer.
- `kardata-server` does outside-in research on every company in a sector so each conversation can
  open on one specific, evidenced problem. Sector research is **private prospecting input**.
  Nothing about a named company is ever published.
- Business rules (ICP, tiers, layers, evidence, outreach, open decisions) live in `docs/business/`
  and are the owner's. This roadmap never overrides them.

## How to read the stages

Exactly one plan in `docs/plans/` has `Status: current` as its first line; that is the spec.
Every other plan and every file in `docs/reviews/` is history. Build just the current stage.

## Stage 1 — Core: sectors, companies, MCP server (done)

See `stage-1-sectors-and-companies.md`. MCP is the only operating surface.

## Stage 2 — Research store and collectors, no LLM (done)

See `stage-2-research-store-and-collectors.md` and `research-data-model.md`.

## Stage 3 — Muse spike, then the orchestrator (done)

See `stage-3a-muse-spike.md` and `stage-3b-orchestrator.md`. App-owned Muse in Docker;
research agents store data only through kardata MCP.

## Stage 4 — Research playbook, extraction and grounding (done)

See `stage-4-research-playbook.md`, `stage-4.1-extraction.md` and `stage-4.3-quote-grounding.md`.
Research agents write cited notes; a separate extraction step structures them and grounding
checks each value against its quoted source.

## Stage 5 — Company pipeline (current stage family)

A job is one company. It runs preflight, collect, research and extraction as stages, and is
complete only when all of them are complete.

- **5.1 — Sector preflight (done).** One sector-level eligibility pass before company jobs.
  See `stage-5.1-sector-preflight.md`. Who qualifies is decided by the filters in
  `docs/business/icp.md` (a D2C brand with enough revenue to pay; any store platform).
- **5.2 — Worker pools (done).** Work runs per stage from queues: an AI pool (preflight,
  research, extraction) and a deterministic pool (collect, grounding), so Muse quota never
  sits idle behind deterministic work. See `stage-5.2-worker-pools.md`.
- **5.3 — Revenue truth (done)** and **5.4 — Sector profiles (done):** D-55 tiers; preflight
  for any sector. See their stage plans.

**The order of operations for a sector is in `pipeline.md`** (every step is an MCP tool).

## Stage 6 — Analysis and RAG (planned later)

Analysis serves `docs/business/`; it does not define its own product. Plan it against the ICP
scoring, the 8 problem dimensions in `docs/business/problem-bar.md`, the citation rules in
`docs/business/evidence-rules.md`, and the offer in `docs/business/offer.md`.

- Structured analysis in SQL over facts and records (sector patterns, per-company signals).
- RAG over the unstructured data (documents, reviews, sources) with answers that cite stored
  sources, when SQL cannot answer the question.
- Output is prospecting input for outreach and material for the diagnostic. There is no
  benchmark-report product and no per-company one-pager product.

## Frontend (parked, unnumbered)

A frontend for `kardata-server` stays parked until the first paid client. The service stays backend-only and
MCP-driven.

## Website (separate track, D-56)

The public site kardata.co (blog, call booking, later the brainstorming agent from D-51) is built now, as its own
project in `website/`. Its plans are in `docs/plans/website/` and run separately from the server stages. Hosting and
deploy facts: `website/README.md`.

## Later (not planned yet; do not build)

- Social content: YouTube and Instagram through official APIs. TikTok has no legitimate API.
- Meta/Google/TikTok ad-library data. (Business decision D-10 in `docs/business/decisions.md`.)

## Where the technical truth lives

- **Tools:** `src/mcp/` (`src/mcp/server.ts` registers every tool; thin wrappers only).
- **Schema:** `src/db/schema.ts` (Drizzle; migrations in `src/db/migrations/`).
- **Domain logic:** `src/domain/`. Collectors: `src/collect/`. Runs and pools: `src/runs/`.
- Live concurrency and quota values are MCP settings, not file values. See
  `stage-5.2-worker-pools.md`.
