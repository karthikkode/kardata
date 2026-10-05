# Phase 5 review: MCP and Karbot (build-only, D1/D2)

Branch `p2-5-mcp` from `p2-4-capacity` (9999c4a). 19 commits
95a92c4..9505036, one item each. Diff: 37 files, +2379/−128.
Gates per commit: backend typecheck EXIT 0, eslint 0 errors on touched
files. Registry 1009 entries (mcp 97). No suites run per D1.

## AC → proof (all static; runtime deferred to final verification)
- Parity 0 unmapped: `scripts/mcp-parity.mjs` writes
  `docs/mcp-parity.md` (P5.1l, 6c9e884): 69 ops → 45 mapped, 24
  owner-only (6 DEV w/ reasons). Script fails on unmapped/unknown/
  stale; standalone run OK. Suite step: `node scripts/mcp-parity.mjs`.
- Tools green: 19 new tools (97 total). [db] suites per tool family
  (allowed/denied/wrong-sector/palette/replay): P5.1b bebdb71,
  P5.1d a82e281, P5.1f 6817f21, P5.1h d251a5c, P5.1j 7145b1c,
  monitor f878919, palettes 2c59321. Suite: backend db tier.
- Monitor [temporal]: 3 ticks + overlap-skip + until + stop
  (P5.2c 3c7d4e7). Suite: `KARDATA_TEMPORAL_TEST=1` file.
- Live L-K1..K3: `tests/backend/live/karbot.live.test.ts`
  (P5.2d c7986ff). Suite: `npm run test:live -- -t "L-K"`.
- Registry MCP no todo: P5.2e 7cac2f9 (112 retiered from content
  evidence, matrix tags in mcp.tools.test.ts). Enforce simulation:
  0 missing / 0 unknown / 0 non-frontend todo or gaps.
- `documentation/mcp.md` updated: P5.2f 053449a (97 tools,
  sectorId scope, palettes, parity pointer, request_plan rule).

## Key implementation points
- sectorScope (tools-types.ts): binding wins, explicit sectorId must
  match, required outside sector; read_sector_thread constrains target.
- Runs inspection via optional messenger methods + requireInspection
  fail-closed; queue surgery approver+sensitive (steering precedent).
- Obs reuses listSupervisionAlerts/researchHealth/evaluation/views;
  recentActivity returns no bodies/refs; cross-scope traces fail closed.
- companyResearch pause via patched('company-child-pause-v1') +
  boundary parks; gateway pauseRun covers all 4 kinds; fake mirrors prod.
- Karbot propose pending-only (one-line layer relaxation); request_plan
  sends instruction, never writes plan.
- karbotMonitor = durable timer workflow (CAN-bounded, tick overlap
  guard, until/24h stop, one-per-target uniques, failed-start cleanup).

## Suite commands (final verification, D1)
`npm run verify:full`; backend db tier (mcp.*); temporal monitor file;
`npm run test:live -- -t "L-K"`; `node scripts/mcp-parity.mjs`.

## Deviations
- Monitor is a timer workflow, not a Temporal Schedule: testable in the
  existing harness, no schedule infra. Same contract (ticks/until/stop).
- 6 owner-only ops carry DEV reasons (infra/catalog/model/skill gaps);
  precise, not blanket.
- Matrix tags enumerate all 97 tools but content-tier per TOOL_META;
  live tiers pinned to env-gated tests only (no fake tier coverage).

## Blocked
None.

## 3 weakest points
1. 19 tools + 7 test files are written-but-unrun; first db-tier run may
   surface contract drift (esp. recentActivity shape, queue reorder).
2. karbotMonitor bundle/activity wiring never executed; tick→Karbot
   post path is the least-reviewed code in the phase.
3. L-K3's 5-min cycle + seeded-duplicate detection depends on model
   phrasing; ≤3 tries may burn on wording, not product bugs.
