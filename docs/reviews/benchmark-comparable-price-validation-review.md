# Comparable review: existing-price consistency

- The v3 gate completed 67 firms: 50 pass, 5 conditional, 6 fail, 6 unclear, zero operational errors. A hand check found a passed price below a published annual fee floor outside Item 5. Raw extraction omitted that floor. No full review or new production revision followed this gate.
- `src/domain/benchmark/comparable-review.ts` adds a separate grounded `pricing` answer: supported, contradicted or unclear. The model sees existing exact values, both readings and annual-floor input; it checks explicit applicable brochure rules without re-extracting rates or calculating replacements.
- A grounded contradiction can fail despite another unread page. Missing/ungrounded/unclear pricing support cannot pass. `comparable-gate.ts` withholds contradicted and unclear inputs from exact/range peer numbers and revenue estimates. Raw fee values and schedules stay intact.
- Scope instructions distinguish a current effective date from a closed historical cohort, and separately priced optional services from asset-class components within the ordinary service. They assess a selected balanced/multi-asset row's applicability rather than assuming a nearby parent heading restricts it. Legacy, asset-class, strategy, product and restricted-channel limits remain exclusions. No filing-specific pattern or new regex.
- Review version advances to `adv-comparable-v4` to avoid reusing prior cached approvals. V1–v3 facts and historical revisions are preserved but cannot qualify new revisions.
- Synthetic tests cover annual floors outside Item 5 (including waivability), exact and two-reading exclusions, unread/ungrounded pricing, current versus legacy schedules, optional services, MCP persistence, compute/report effects and prior versions. Existing scope/minimum sentinels remain covered.
- Focused validation: 35 unit/MCP tests passed; Node 22 lint, typecheck and build passed. Isolated full-suite and final-commit CI evidence is recorded in the PR.
- Expected population is unchanged: 687 selectable core firms at the standard-MCP census. At least one confirmed unsafe core approval is withheld; three confirmed over-broad scope exclusions, including the waived-minimum sentinel, are addressed. Wider impact requires the fresh gate and full review.
- Authorized follow-through: after CI, merge and deploy only this review fix using `scripts/deploy-live.sh`, draw a fresh random sample, and continue the owner's four tests. Stop if the same test fails again. Production receipts and per-firm evidence remain private.
- `FEE_VERSION` stays `adv-2a-v8`; extraction code, facts, worker and job controls are unchanged. No new dependency, MCP tool, migration, import, website collection or social source.

| Acceptance | Implementation | Evidence |
|---|---|---|
| Catch grounded price contradictions | `comparable-review.ts` pricing schema/assessment | unit annual-floor and MCP exact/range cases |
| Withhold unsafe peers/revenue | `comparable-gate.ts` pricing guard | unit derivation and MCP compute tests |
| Keep normal current/general schedules | review prompt | current-date/optional-services fixtures; prompt assertions |
| Preserve restrictions/unknown gaps | review assessment | existing strategy/asset-class/channel, unread and grounding tests |
| Avoid stale review approvals | review version | unit/MCP rejection of v1–v3 |
| Preserve raw extraction | independent review boundary | MCP before/after fact equality and unchanged FEE_VERSION test |

No code item remains unfinished. Live acceptance and revision evidence will be reported privately after deployment; no success is claimed from synthetic tests alone.
