# Comparable review v2

- Scope: `src/domain/benchmark/comparable-review.ts:171` explicitly treats diversified/balanced/customized multi-asset schedules and firm-wide styles as general; single named strategy/product and restricted client channels stay scoped.
- Minimums: `comparable-review.ts:21` adds `net_worth_target` and `relationship_preference`; prompt rules at `:172` preserve actual account/managed-assets minimums and the assets limb of either/or requirements. Targets keep their cited amount for audit without becoming account dollars.
- Peer gate: `src/domain/benchmark/comparable-gate.ts:17` can discard a positively identified non-account target from eligibility while preserving raw fee facts; true minimums and two-reading conditional endpoints keep their existing treatment.
- Unread pages: `comparable-review.ts:139` retains physical page numbers for archived PDFs; `:161` lists textless pages in the model input without suppressing a call on readable evidence. Unknown/absent physical evidence and the existing size cap remain named gaps.
- Grounded restrictions: `comparable-review.ts:107` can fail with incomplete pages/sections. Every other result remains unclear while coverage is incomplete (`:111`). Nullable citations represent unread sections without fabricated quotes; they never approve a price.
- Version boundary: `comparable-review.ts:15` is `adv-comparable-v2`; v1 facts remain stored but cannot qualify new benchmark revisions. Existing historical revisions are immutable and require a later authorized recompute to replace their fee comparisons.
- Expected selection is unchanged: standard MCP read-only census observed 1,522 eligible / 687 core price-bearing firms on 2026-11-06 04:19 UTC. Extraction advanced during the census, so this is a rolling count, not a future queue guarantee. All 27 stored v1 gate reviews need v2 evidence before qualifying a new revision.
- Expected corrections in the earlier gate: two diversified/style scope exclusions, one net-worth/asset minimum confusion, and one named restriction blocked by an unrelated unread page. No live v2 result is claimed.
- Synthetic fixtures only: `tests/fixtures/comparable-review.ts`. Unit tests cover diversified/style pass, product/channel fail, targets/preferences, either/or thresholds, real waived minimums, readable restriction with missing sections, unclear unread general/waived firms, and v1 exclusion.
- MCP tests cover calls with named unread pages, archived-PDF fallback, fail versus unclear persistence, v1 exclusion from compute/report, numeric two-reading ranges, restart/quota behavior and unchanged extraction facts/jobs.
- Focused validation: 26 unit/MCP tests passed. Node 22 lint, typecheck and build passed. The isolated local full suite passed 1,076 tests (one live harness skipped); final-commit CI evidence is recorded in the PR.
- Plan detail: used explicit semantic categories for non-account targets and nullable citations for unavailable sections; no filing-specific wording rules, new dependency, migration or MCP tool.
- No production v2 review or benchmark computation was run. `FEE_VERSION` remains `adv-2a-v8`; extraction code, extraction worker/jobs and their tables are unchanged. No deployment or fee-job control.

| Acceptance | Implementation | Evidence |
|---|---|---|
| Diversified/style scope | `comparable-review.ts:171` | unit diversified/style fixtures; MCP prompt contract |
| Targets versus true minimums | `comparable-review.ts:172`, `comparable-gate.ts:17` | target/preference, either/or and waiver tests |
| Named unread pages; fail only | `comparable-review.ts:107`, `:161` | unit missing-section fail and unclear tests; MCP live/archived fixture reads |
| Retire v1 inputs | `comparable-review.ts:15`, `comparable-gate.ts:8` | unit explicit v1 rejection; MCP new-revision coverage test |
| Preserve existing extraction | `comparable-gate.ts:27` | unit raw-object equality; MCP fact/job equality and FEE_VERSION assertion |

No required code item is unfinished. Await owner review and deployment choice before any v2 production run.
