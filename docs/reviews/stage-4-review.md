# Stage 4 review — Research playbook (Steps 0–3)

## Step 0 — Sector collection and screening
- `collect_sector` queues live members in batches of 100, skips fresh: `src/runs/queue.ts` (`startCollectSector`), tool in `research-tools.ts`. Tests: `tests/runs/sector.test.ts` (6: batching, already-running, stale skip, window, removed, errors).
- `company_screen` on Apollo effective fields + current facts in SQL: `src/domain/screening.ts`. All 9 ops tested vs handwritten SQL ground truth on the fixture; 50 rows serialize < 30 KB: `tests/db/screening.test.ts` (22).
- Shortlists (`shortlists` table, migration `0009`, upsert by sector+name): same files. MCP round-trips: `tests/mcp/screening.test.ts` (3).
- `collect_sector` was never run on the full sector (fixtures only), per instructions.

## Step 1 — Playbook v1 + prompt versions
- `prompts/research-v1/main.md` + 7 area briefs (orient → delegate → synthesize, budgets ~8 searches/15 pages, browser only on company domains).
- `research_runs.prompt_version` (migration `0010`); `research_start(promptVersion?)` defaults to latest at creation and stores it; builder renders the stored version (`src/runs/prompt.ts`); `batch_status` shows it. Tests: `prompt.test.ts`, `agent.test.ts`.

## Step 2 — Scorecard
- `src/domain/research/scorecard.ts` + `npm run eval:research -- <batch|runs>` + `batch_scorecard(batchId)`: per run/area facts, records by type, reviews, docs, findings (+well-cited), primary share, new provisional names, statuses, tokens, minutes, MCP calls, forbidden. Tests: `tests/db/scorecard.test.ts`, `tests/mcp/scorecard.test.ts`.

## Step 3 — Pilot (4 new companies: 47 Skin UK/24, Forte Series US/14, Tai Beauty CA/19, Nature's Care AU/97)
- v1 batch `f9d49b38`: 4/4 STALLED, 0 findings. Forensics: every parent delegated via the Workflow tool (maxParallelAgents 2), whose background completion never produces run activity → 300s silence. 60 forbidden (company_dossier 17, document_search 14, …). 106 min, 36.4M in (95% cached) / 313K out.
- v1.1 (`prompts/research-v1.1`, one iteration per plan): bans Workflow, incremental per-area findings + progressive summary.md, exact do-not-call list, MUST-ingest reviews when `reviews.app` names a widget, finish-over-stall discipline.
- v1.1 batch `779485a6`: 4/4 SUCCEEDED, 0 forbidden, 0 Workflow calls, 10–13 min each. Totals: 156 facts, 255 records, 37 docs, 0 reviews, 0 findings; 22.6M in (97% cached) / 97K out.
- Scorecard split added in Step 3 (`agent.*` by `createdBy`): the collect phase runs under the agent run id, so run totals credit collectors. Agent output is 0 facts / 0 records / 0 reviews / 0 findings in BOTH batches — agents wrote docs only (v1.1: exactly 7 area docs + `summary.md` each; 47 Skin's solo parent even faked per-area labels, usage proves no subagents ran).
- Gates per succeeded run: agent facts ≥25 ❌ (0), agent records ≥30 ❌ (0), reviews where widget ❌ (Forte/Nature's have Judge.me/Stamped/Yotpo, 0 ingested), findings ≥5 citing ≥2 ❌ (0), all 7 statuses ✓ (hollow — done without deliverables), `summary.md` ✓ 4/4, 0 forbidden ✓, ≤30 min ✓.
- Cost/company (v1.1): ~153K fresh + 5.5M cached in, ~24K out, ~12 min. ×150: ~23M fresh / ~825M cached / ~3.6M out, ~29 agent-hours (~7.5 wall-hours at 4-way).
- Exports: `var/exports/lume-deodorant-7a903174` (C2: 15 docs, 24 facts, 16 job_posting), `var/exports/47-skin-1575d95e` (25 docs, 40 facts, 30 product). `var/` is gitignored.

## Deviations & proposals
- Pilot ran 4 NEW companies only (owner override; C1–C4 not re-run). Scorecard `agent.*` split + tool-inventory fix folded into the Step 3 commit (measurement the gates require).
- Headline finding: prompt rules alone do not produce structured writes — two playbooks, 8 runs, 0 agent facts/records/findings. Proposals (not implemented): refuse `run_finish` until minimum banked structured writes; require per-area fact/record minimums in `area_status_set`; verify `agent_label` against real subagents; revisit the 300s stall for synthesis-heavy runs.
- Suite: 327 passed + 1 skipped (live) in 137 s; lint/typecheck clean. No push.
