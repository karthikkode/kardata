Status: done · Date: 2026-10-26

# Docs cleanup review (branch docs/cleanup, docs only, no code changed)

Commits: 9d0ecaa (step 1), c495cd3 (step 2), dc7eb83 (step 3), ce42a5c (step 4). No push.

## Audit items 1-16

1. Business docs missing on main: fixed by PR #75 (precondition verified). Step 1 added the
   current-stage pointer and icp.md links to AGENTS.md. docs/business untouched.
2. Roadmap described a benchmark-report product: rewritten in step 2 to diagnostic, then a
   build or retainer (strategy.md/offer.md). Research is private prospecting input.
3. Stage 5 collision (frontend vs company pipeline): roadmap now has Stage 5 as the company
   pipeline as built (5.1, 5.2). Frontend is parked until the first paid client, unnumbered.
4. Retired Tier/Layer meanings in old docs: banners added to every old review (step 3);
   AGENTS.md already carried the new terms. Nothing rewritten.
5. Eligibility as Shopify-only or staff-cap: no plan states it; step 4 added a note in
   stage-5.1-sector-preflight.md separating sector scope from the two icp.md filters (D-23/D-24).
6. Open decisions invisible: AGENTS.md points to docs/business/decisions.md (D-17, D-18, D-20,
   D-31 open). Left to the owner; not edited.
7. Dateless reviews: fixed in research-data-model.md; dedupe, date_missing and
   reviews.dateless_count cited to src/domain/research/reviews.ts:200-208, 251-252.
8. Stale schema/tool inventory: roadmap now points to src/mcp and src/db/schema.ts;
   research-data-model.md MCP table replaced by a pointer to src/mcp/server.ts:9-10,
   src/mcp/tools.ts:35, src/mcp/research-tools.ts:159.
9. Concurrency/quota read from files: stage-5.2-worker-pools.md now states .env is boot
   defaults only and MCP settings are live (src/runs/settings.ts:58-67, 296-305;
   src/runs/quota-monitor.ts:18-19). Verified by MCP: agents 64, company 64, both source db.
10. Prompt versions: research-data-model.md names research v1.4 and extract v2, chosen by
    latestPromptVersion() (src/runs/prompt.ts:60-65; extract at src/runs/extract.ts:41).
11. ai-saturation vs 5.2 overlap, 5.2 untracked: 5.2 plan committed in step 3; ai-saturation
    states Step 0 done, Steps 1-2 replaced by 5.2, Steps 3-5 still open.
12. No status on plans/reviews: every file in docs/plans and docs/reviews now begins with
    Status and date. Exactly one current plan: stage-5.2-worker-pools.md.
13. Counts disagreeing: not edited (icp.md is the owner's; its snapshot was updated in PR #75).
    Live recount in the numbers section below settles research wave 2.
14. D-35 free audits name an empty Layer 1 cohort: business-owned; icp.md already notes that
    no company reached Layer 1. Left alone for the owner.
15. Company names in old reviews: banner added (step 3) saying names predate the no-names
    rule. Reviews not rewritten, per instructions.
16. Business thin spots (two problem dimensions without data; revenue estimates): left in
    docs/business for the owner. See the revenue-source numbers below.

## Step 5 numbers (MCP tools only; no DB scripts)

Live MCP, 2026-10-26: sector_preflight_summary over 7,776 classified companies gives 911
eligible; pipeline_status shows 757 completed with reruns still in progress, so the
research-incomplete count is falling and tier counts should be re-run after it drains.
Contactable by tier and layer (2026-10-26 sheet built from MCP exports, 814 rows checked;
no MCP tool computes tier or layer today): Tier A: Layer 3 = 10, Layer 4 = 34, Layer 5 = 46
(90). Tier B: Layer 2 = 2, Layer 3 = 11, Layer 4 = 70, Layer 5 = 169 (252). Tier C: Layer 3 = 3,
Layer 4 = 10, Layer 5 = 23 (36). Total contactable 378; no company reached Layer 1.
Research wave 2 = 156 companies, counted live from sector_preflight_summary as eligible
companies whose primary_category is haircare, cosmetics_makeup, fragrance or
supplements_wellness (29 + 72 + 2 + 53). Wave 1 eligible on the same count is 755
(skincare, body_bath, mens_grooming); total eligible 911, three below the 914 launched.
Tier revenue sources across the 814 checked rows: public figure 51, Apollo 382, staff
estimate 381. Among contactable companies only: public 37, Apollo 161, staff estimate 180.
