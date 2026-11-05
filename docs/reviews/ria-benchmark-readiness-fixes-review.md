# Benchmark readiness fixes

Base: main `8b6a9c8`. This is a code/review PR; deployment timing stays with the owner.

| Acceptance | Implementation | Evidence |
|---|---|---|
| AUM peer mix; same solo/bands/merges | `src/domain/benchmark/peers.ts:22`; computation version changes in `compute.ts:87` | `tests/unit/benchmark-measures.test.ts:56`, `:66`; offline full-sector replay |
| Official blank-count instruction and November test before changing policy | `docs/sectors/ria-us/client-counts.md:3`; blanks remain unknown in `fields.ts:101` | `tests/unit/sec-adv-fields.test.ts:44`; reconciliation and zero-AUM counterexamples |
| Explicit low/high totals, ratio/growth intervals, exact-only peer samples | `fields.ts:101`, `measures.ts:71`, `peers.ts:102`, `report.ts:133` | Unit bounds/denominator/rank tests; MCP enrichment and separate coverage at `benchmark-tools.test.ts:112` |
| Atomic, idempotent enrichment without replacing exact history | `src/domain/sec-adv/snapshot.ts:238` | Concurrent standard-tool retry test retains original exact fact IDs |
| Stored domain fallback; shared ownership checked globally; no shared evidence | `website-input.ts:13`, `:36`; `website.ts:79`; report filters current input keys | `tests/unit/website-software.test.ts:55`; MCP cross-sector ownership/cache test at `:323` |
| No block/403/robots retry or workaround; still at most two pages | `website.ts:98`; collector terminal robots result | Unit bounded-fetch tests; MCP legacy failure test at `:354` |
| Actual growth-window labels; stable measure keys | `windows.ts:8`; `report.ts:127` | `benchmark-windows.test.ts`; MCP existing-revision metadata/11-month label assertion |

Offline findings (private evidence under `~/kardata-live/var/sources/sec/benchmark-readiness-2026-11-05/`):

- AUM mix classifies 7,788/8,403 eligible and 1,815/1,930 core, versus 1,257/315 previously. There are 22 groups, none below 20.
- Retain one-third/two-thirds: a two-to-one AUM majority is still meaningful; every occupied band/mix has sufficient size. Full distributions/group sizes: `fix-peer-replay.json` and `fix-benchmark-review.md`.
- AUM reconciliation passes for all 5,848 eligible/1,328 core firms with unsuppressed blank counts and zero/blank category AUM. But 106/12 firms report positive client counts with zero category AUM. Official guidance also requires counting those clients. No blank-to-zero inference was enabled.
- Potential clients/staff coverage: exact 1,258/315 plus intervals 1,259/282. Non-advisory ratios: 938/287 plus 917/258. AUM/client: 1,257/315 plus 1,259/282.
- Client growth: 11-month exact 985/274 plus intervals 1,228/286; three-year exact 663/208 plus intervals 1,030/289. Offline replay changed zero exact SEC values.
- Shared inputs leave 3,064 eligible/926 core unchecked. Safe domain fallback adds 20/5 potential inputs. Of the original 45 missing-site firms, 44 are shared; the remaining stored URL/domain contains prose and is unusable.
- The 21 earlier fetch failures were 17 unavailable robots files (one HTTP 406) and four DNS failures. IDs/causes stay private in `fix-website-input-replay.json`.

Validation: changed-file unit/MCP tests pass; lint, typecheck and build pass on Node 22. Full-suite and GitHub CI results are reported in the PR. All DB tests use a new isolated Postgres 16 database and synthetic fixtures.

Operations/deviations: only read-only company/fact metadata tools were called for offline inputs. No production import, benchmark computation, website fetch, fee-job status/control, deployment or merge was performed. No fee extraction code changed. Real source data stayed outside git. Existing snapshots require the standard import enrichment and recomputation after deployment; the coverage above is an offline projection, not a production write.

Blocked: none.
