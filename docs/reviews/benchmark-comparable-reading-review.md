# Comparable review: each published reading

- A fresh live gate approved an unsupported range endpoint because a different calculation method in a later band was treated as ambiguity in the earlier bands. No complete review or new benchmark revision followed the failed gate. Detailed filing evidence remains private.
- `comparable-review.ts` requires a separate grounded verdict for every publishable numeric balance/reading. A missing, duplicate, extra, unclear or ungrounded check cannot approve a firm. A grounded conflicting reading overrides an inconsistent supported overview and excludes the firm.
- The model checks the actual supplied dollars and effective percentages against the rules applicable at each tested balance. It may recompute internally for verification, but returns only decisions and quotes, never replacement schedules or fee facts. Later-band changes do not make explicit lower-band arithmetic ambiguous. Coincident readings stay separate; unpublished one-sided scenarios are omitted.
- Overall pricing still checks the stored method, tiers and annual floor used for revenue estimates. Scope, minimum/waiver, unread-page and provider-recovery rules remain intact. No filing-specific parser, regex or new dependency.
- `comparable-gate.ts` independently requires the complete supported reading set for the bound raw fee fact before allowing exact/range peer inputs or revenue estimates. Contradictions remain excluded even if a stored overview says supported.
- Review version advances to `adv-comparable-v5`; v1–v4 decisions and historical revisions remain preserved but cannot qualify a new revision. `FEE_VERSION` remains `adv-2a-v8`. No extraction code, fee fact, extraction-job control, import, website collection or social source changes.
- Synthetic coverage includes a hybrid schedule with different amounts/breakpoints, an inconsistent overview, missing/duplicate/ungrounded checks, genuinely unresolved and coincident readings, partial balances, waiver handling, stale versions and exact/range compute/report exclusion without raw changes.
- Expected selection remains 687 core firms; all need current v5 review evidence. The failed live gate and provider-failure run remain in history. After green CI the owner authorizes merge/deploy through `scripts/deploy-live.sh`, a fresh gate, complete review and independent audit. Another gate failure or terminal complete-review failure stops the task under the owner's rule.

| Acceptance | Implementation | Evidence |
|---|---|---|
| Validate each relevant numeric reading | review schema, required input list and grounding | selection/coverage unit cases; MCP hybrid cases |
| Cannot hide a bad endpoint in a supported overview | assessment and peer gate | inconsistent-summary unit/MCP cases |
| Preserve safe ranges, gaps and conditional values | complete checks plus existing minimum gate | range/partial/coincident/waiver unit and MCP cases |
| Keep unsafe inputs out of peers and revenue | independent peer guard | exact/range compute/report tests |
| Avoid stale approvals and raw mutations | v5 version boundary | v1–v4 exclusion; before/after fee-fact equality |

Validation: 63 focused tests (25 unit, 38 MCP), lint, typecheck and build passed on Node 22. An offline selection check on saved standard-MCP evidence kept all 687 selections unchanged across 1,930 core firms. Final full-suite and CI evidence are recorded in the PR; production acceptance is not inferred from synthetic tests.
