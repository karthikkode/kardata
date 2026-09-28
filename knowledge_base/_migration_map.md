# KB migration map (source repo `/home/karthik/projects/kardata` → `knowledge_base/`)

Method: KEEP (verbatim) / REWRITE (same topic, true of current product) /
DROP (subject no longer exists or is old-stack internals). Superseded text
is recorded here, never silently deleted.

## Curated corpus (REWRITE into `knowledge_base/`)

| Source | Disposition | Notes |
|---|---|---|
| `kardata_final/knowledge/company/business-thesis.md` | REWRITE → `offer.md` | Wedge + expansion kept; free-wedge bound added (user spec) |
| `kardata_final/knowledge/company/offer-direction.md` | REWRITE → `offer.md` + `pricing.md` | $3k/$6k reframed as targeting band per user ruling |
| `kardata_final/knowledge/company/current-funnel.md` | REWRITE → `funnel.md` | Three phases kept; "Kardata never sends" kept |
| `kardata_final/knowledge/company/icp-hypothesis.md` | REWRITE → `icp.md` | D2C hypothesis + kill signals kept; "no settled price" superseded by pricing.md |
| `kardata_final/knowledge/company/non-goals.md` | PARTIAL → `pricing.md`, `funnel.md` | Pricing-freeze clause kept; harness-machinery clauses DROP (describe the old stack, not this one) |
| `kardata_final/knowledge/research/problem-direction.md` | REWRITE → `problems.md` | "Choose one strongest problem" SUPERSEDED by breadth rule (user spec); OOS-ads anti-fixation added; mechanism-or-cost bar kept |
| `kardata_final/knowledge/research/evidence-governance.md` | REWRITE → `problems.md` | Admissibility bar kept verbatim in substance |
| `kardata_final/knowledge/research/qualification-policy.md` | REWRITE → `qualification.md` | Rejection rules kept; "find ALL problems" depth per user spec |
| `kardata_final/knowledge/research/sector-direction.md` | REWRITE → `icp.md` | Sector discipline kept |
| `kardata_final/knowledge/outreach/email-writing-direction.md` | REWRITE → `voice.md` | Voice rules kept |
| `kardata_final/knowledge/outreach/draft-review-policy.md` + `mailability-and-contacts.md` | REWRITE → `voice.md` | Mailability gate kept |
| `kardata_final/knowledge/current-truths.yaml` | REWRITE → spread | truths.yaml v1 truths kept; `agent_page: none planned` kept; architecture truth DROP (old stack) |
| `kardata_final/knowledge/terminology.md` | REWRITE → ledger schema | Run/session/journal/ledger terms inform table design; GCS-specific terms DROP (no GCS here) |
| `documentation/business/offer-and-pricing.md` | REWRITE → `pricing.md` | Locked tiers kept as band context; "single source of truth" claim scoped: this file wins on quotable entry price only |
| `documentation/business/outbound-economics.md` | REWRITE → `funnel.md` | Cohort discipline + required ledgers kept; `data/`/`logs/` paths DROP (old repo layout) |
| `documentation/archive/business/offer-pricing-history.md` | DROP | Retired working draft; supersession note in `pricing.md` is the only trace |
| `kardata_v3/docs/_kb_migration_map.md` + `_kb_migration_report.md` | METHOD ONLY | KEEP/REWRITE/DROP ledger method reused; content is v2→v3 machinery, not product knowledge |

## Dropped old-stack internals (no product knowledge)

`kardata_final/knowledge/operations/**` (run protocols, SQL extraction,
MCP reference to retired stack), `research/source-playbooks/**`,
`research/pattern-taxonomy.md`, `documentation/frameworks/**` (agent
method for the old harness — revisit as a later method batch, not v1
product corpus).

## Excluded raw evidence (not ingested v1)

`data/` (2.4 GB), `meta_ads_*.txt/html`, `feefo_*.json`, `*_capture.txt`,
`m16–m19-home.html`, v1 `kardata/web/` prospect JSON (pricing blocks
confirm the $2,900 entry framing; a later voice-of-customer batch may
distill reviews/ads, never bulk-import them).
