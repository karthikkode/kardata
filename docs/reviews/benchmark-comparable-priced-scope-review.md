# Comparable review: priced asset coverage

- Trigger: the 47-firm v2 production gate found a false pass: an asset-class component table was treated as general because the firm's broader services cover diversified portfolios. Private evidence remains outside git.
- Final gate: 37 pass, 3 conditional, 2 fail, 5 unclear (10.6%), zero operational errors. Both named sentinel decisions passed, but the false pass fails the gate. No full review or production computation followed.
- Scope: `src/domain/benchmark/comparable-review.ts:20` adds the semantic `asset_class` category to both response validators. The prompt locates the exact selected table and its priced universe before applying the firm's broader context; a stored primary label is not evidence of general scope.
- Grounding: the restriction cites the table heading or applicability text. Existing quote/page grounding remains mandatory. Unsupported restrictions stay unclear; no filing-specific pattern or new regex was added.
- Exclusion: `comparable-review.ts:107` and `src/domain/benchmark/comparable-gate.ts:9` treat grounded asset-class restrictions as fail, including when another page or the minimum is unread. Exact values, two-reading ranges and estimated revenue stay outside peer inputs.
- Negative case: one schedule covering diversified/balanced/customized portfolios and firm-wide investing styles remains general. Separate pricing for one component cannot borrow that classification from Item 4.
- Version: `adv-comparable-v3` invalidates cached v2 decisions for new computations; v1/v2 facts and historical revisions remain stored. This version change is necessary because a changed prompt alone would reuse the old cached answer.
- Tests use synthetic stock/bond component tables with a diversified firm description, including exact and two-reading inputs, unread/unquoted restrictions, unchanged raw facts, MCP persistence, compute/report exclusions and both prior review versions.
- Focused validation: 30 unit/MCP tests passed. Node 22 lint, typecheck and build passed. Final full-suite and CI results are recorded in the PR.
- Expected effect: at least one confirmed incorrect core pass is excluded after re-review; the fresh MCP core census found 687 selectable firms. Broader impact is unknown because the full review was not started.
- Production boundary: only the previously queued 47-firm v2 gate ran. No full review, new computation, import, website collection, deploy or extraction-job control. `FEE_VERSION` stays `adv-2a-v8`; no extraction, worker, MCP tool or dependency change.

| Acceptance | Implementation | Evidence |
|---|---|---|
| Review priced scope, not broad firm | `comparable-review.ts:170` | MCP prompt contract and synthetic component tables |
| Grounded component fails | `comparable-review.ts:107`, `comparable-gate.ts:9` | unit exact/two-reading/unread cases; MCP status quotes |
| Preserve general diversified schedule | `comparable-review.ts:171` | existing diversified/style negative tests |
| Withhold peer fees and revenue | `comparable-gate.ts:9` | unit derivation and MCP compute/report tests |
| Invalidate v2 cached passes | `comparable-review.ts:15` | unit v1/v2 gate and MCP revision tests |

No requested fix remains unfinished. No production validation of v3 is claimed. Stop at the PR for owner review.
