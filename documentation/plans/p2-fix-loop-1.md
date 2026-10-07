# P2 fix-loop 1: stalled-remainder close-out (HEAD 78cdbbf, 2026-10-07)

Closes the lanes the 2026-10-05 session left stalled on FD exhaustion
(ulimit 1024; parallel lane setup wedged the box). Worked solo and
serially. Most items were already fixed on the branch; this loop
re-verified each at HEAD and fixed the one open axe rule.

## Results by item

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | 5 slow queries + companies seq-scan | GREEN, no change | `tests/stress/db.volume.test.ts` 2/2: session.list 4.0, context.global 50.9, library.list 42.8, evaluation.sector 49.8, agent_reliability 44.3 ms p95; plan gate passes |
| 2 | alerts 403s, ops-runs `this` | GREEN, no change | `alerts.test.ts`, `mcp.ops-runs.test.ts` pass at HEAD |
| 3 | F8 503 on Temporal cut | GREEN, no change | `temporal-unavailable.test.ts` passes (C4/10 proved full F8 500→503) |
| 4 | trace continuity | GREEN, no change | `observability.trace-continuity.test.ts` passes (temporal tier) |
| 5 | L-K live setup + reach Meta | GREEN after env fix | 3/3 live (tries 1/2/1, real spend). Was red: stale `session-run-*` in shared `kardata-live` namespace poisoned the fresh DB (FK 23503); terminated 4 stranded test runs, kept 2 singletons |
| 6 | denied-state retry, "8 across 0 sectors" | GREEN, no change | ChatPanel + Dashboard `denied` pass (Try-again pinned); Dashboard copy assertions pass |
| 7 | axe button-name (Sidebar aria-label) | FIXED+VERIFIED | Uncommitted Sidebar edit kept; `button-name` zero in Dashboard, ChatPanel, 14-spec sweep |
| 8 | axe scrollable-region-focusable | FIXED+VERIFIED | `Markdown.tsx`: code `pre` + table wrapper gain `tabIndex={0}` + aria-label + focus ring (mirrors `ExecutionInspector`). ChatPanel 6 axe fails → 0; sweep zero |

## Changes in tree (uncommitted)

- `frontend/src/components/Sidebar.tsx`: always name icon-rail buttons (old session's edit, verified here).
- `frontend/src/components/Markdown.tsx`: focusable scroll regions (this loop).
- Frontend `lint` clean (2 pre-existing complexity warnings); app `typecheck` clean.

## Remaining (out of scope, diagnosed)

| Finding | Detail |
|---|---|
| axe color-contrast (7) | `text-foreground-subtle` captions fail on card surfaces (Sidebar, TopBar). Token-value call: needs owner/design decision |
| axe aria-required-children (4) | Base-UI `role=menu` popup without menuitem children (ui.menu, ui.switch). Data-vs-product undetermined |
| focus indicator (9+) | Every matrix `focus` state: "no visible indicator" on click-focused subject. Systemic, needs own batch |
| screenshot diffs (26+) | Pre-existing drift vs old baselines (e.g. Dashboard offline ratio 0.02). Needs `ui:review` grading, not blind `-u` |
| factory.ts typecheck | Pre-existing `data.sectors` possibly-undefined (D4) fails test/node configs; app config clean |
| ModelsPanel-partial | Excluded throughout (was coordinator-owned); untouched |

## Hygiene notes

- Stale `.muse/worktrees/*` + `.stryker-tmp/*` match vitest path filters and run dead code; scope live runs with `--exclude`.
- `kardata-live` namespace has no inter-run cleanup; stranded runs poison the next live suite. Consider pre-run guard.
- This loop ran every suite once per unchanged tree; logs in ignored `test-results/`.
