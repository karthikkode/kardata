# Item 5.D client-count policy

Checked before changing count handling, 2026-11-05. The [official Form ADV Part 1A](https://www.sec.gov/files/formadv-part1a_1.pdf), Item 5.D, allows a fewer-than-five response for specified categories and requires category AUM to reconcile to total regulatory AUM. It gives no general blank-means-zero rule.
The [SEC Item 5.C/5.D FAQ](https://www.sec.gov/about/divisions-offices/division-investment-management/electronic-filing-investment-advisers-iard/frequently-asked-questions-form-adv-iard) requires counting advisory clients without regulatory AUM and encourages an explicit zero when there are no clients.

November 2026 registered-adviser release, offline checks:

| Check | Eligible | Core |
|---|---:|---:|
| Blank unsuppressed count; explicitly zero category AUM | 227 | 55 |
| Blank unsuppressed count; blank category AUM | 5,700 | 1,293 |
| Either condition (distinct firms) | 5,848 | 1,328 |
| Category AUM sum reconciles for those firms | 5,848 | 1,328 |
| Positive reported client count with explicitly zero category AUM | 106 | 12 |
| Blank unsuppressed count with positive category AUM | 0 | 0 |

Across the entire 17,263-row release, 12,786 of 12,788 firms with the blank-count conditions reconcile; two do not. Missing AUM was treated as zero **only for this diagnostic sum**, never as a client-count inference.

Decision: retain unknown blank counts, including when category AUM is zero or absent. Reconciliation proves asset completeness, not client completeness. The instruction and counterexamples do not support zero inference. Positive-AUM blank counts also remain unknown.
Hidden-category bounds assume 1–4 clients as requested; exact totals and explicit reported zeros remain unchanged. Unsuppressed missing counts prevent a finite total range. These bounds are assumptions, not exact observations.

After deployment, the standard snapshot importer can enrich an existing identical file once with the two bound keys; it preserves earlier exact fact IDs and canonical evidence. No production enrichment was run for this PR.
`benchmark_compute` stores uncertain ratios and growth separately in `clientRanges`, with exact values left null. Inverse and growth denominators must have positive lower bounds. Peer quartiles and point ranks use exact observations only; `clientRangePercentiles` ranks each bound against that sample. Reports distinguish exact, range and missing coverage.
