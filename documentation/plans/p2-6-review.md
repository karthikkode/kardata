# Phase 6 review: frontend matrix (build-only, D1/D2)

Branch `p2-6-frontend` from `p2-5-mcp`. 35 commits
a6ea453..12de940, one item each. Diff: 155 files, +7539/−307.
Gates per commit: typecheck EXIT 0 (touched workspace), eslint 0
errors (per-workspace). No suites run per D1.

## 6.1 open source (≤2h taxonomy cross-check)

| Reference | Take | Where | Result |
|---|---|---|---|
| assistant-ui | chat state taxonomy | features.yaml states, support/matrix.ts | 373 tests written (unrun) |
| Vercel ai-chatbot | not adopted: same taxonomy, no delta | — | — |
| LibreChat | not adopted: same taxonomy, no delta | — | — |
| Open WebUI | not adopted: same taxonomy, no delta | — | — |
| TanStack Virtual | dep installed (exact); use deferred to measured miss | knip ignore + scale doc | stated fix |
| toHaveScreenshot | pixel baselines ≤0.1% | matrix.ts matrixShot | in runner (unrun) |
| @axe-core/playwright | serious-violation gate | matrix.ts runAxe | in runner (unrun) |

## AC → proof (all static; runtime deferred to final verification)

- States + matrix: 77/77 frontend entries have states; 69 visual →
  69 specs / 373 tests (P6.3f 34ac754); ThinkingRow + 7 non-visual
  tagged unit/e2e. Files: features.yaml, matrix/*.spec.ts,
  components.json, support/matrix.ts, support/factory.ts.
- Failure matrix (357 tests): GET 23×9 + 6 offline (P6.4b e7de3aa,
  P6.4d 55ec325; 17 verified full-flow, 6 unverified chrome-only
  recorded), mutations 16×9 (P6.4c b3d62ae), 30s timeout (P6.4a
  5d30f1c + request-timeout.test.ts).
- Live-state truth: 4 e2e (P6.3.2i 48ad15e: orphan ×2, reconnect
  ×2), unit (d6986e8), db (869e375). Product: migration 0028
  state_reason, terminal release both chats, orphan banner.
- Scale: 7 specs (P6.3.3 117211a): 100/1000/2000 lists + queue,
  5k thread, memory cycles; budgets asserted, unmeasured.
- ui:review: `npm run ui:review` wired (P6.4a e7879ac: shots +
  manifest.json + --changed); grading runs at final verification.
- axe: 0-serious gate per matrix state (P6.3c 8153d4c), unrun.
- Registry frontend no todo: 0 todos repo-wide (P6.5 9b45319:
  10 seam hooks tiered, 77 filled from tag evidence, gap tests
  for messages/useChatScroll/useApi). Static: 0 missing/0 unknown.
- Quality green: P6.6 12de940 (knip/dup/deps exit 0).

## Suite commands (final verification)

`npm run verify:full`; `npm run ui:review` (first run with
`-u`: no toHaveScreenshot baselines exist yet); grading output
`docs/ui-review/<date>.md` per the 6.4 rubric.

## Deviations

- 6.3.2 needed backend reason plumbing (migration 0028, schema,
  projection, views, OpenAPI): the reason never reached the UI
  (ThreadState stripped it, no column). ~60 lines, db-pinned.
- Virtualization deferred to a measured miss (D1 cannot measure
  blind); dep installed, knip-ignored with reason, fix stated.
- matrix-sync parser hardened for block-format states
  (registry-sync normalizes); regen byte-identical (69/373).
- P6.6 greened quality (red from P6.0a deps, P5 dead types, 1 new
  export): unexport, 2 knip ignores, dropped 3 dead re-exports.

## Blocked

None. Grading, budget measurement, and the 6 unverified failure
cases await the final-verification run.

## 3 weakest points

1. 35 stacked commits, ~740 tests, zero runtime signal: matrix
   anchors, failure flows, budgets, banner all static-only.
2. Scale budgets unmeasured: 5k-message/2000-row renders may miss
   without virtualization (fix stated, not applied).
3. ui:review grading 100% pending; first run captures baselines,
   so its failures are capture noise, not product signal.
