Status: done · Date: 2026-10-26
Banner (2026-10-26): in this old review, "Layer 1/2" means research wave and "core/adjacent" is retired (see docs/business/icp.md, Terms). Company names below predate the no-names rule in AGENTS.md.

# Stage 5 review — Company pipeline (Phases 0–8)

## Acceptance
- Company job runs preflight→collect→research→extraction as subjobs (`src/runs/company.ts:206,373`; `beginStageReal`, company worker). Tests: `tests/runs/company.test.ts` (21).
- Atomic completion: `complete` ⟺ all four stages complete, derived never stored (`src/domain/company-jobs/status.ts:33-63`). Tests: `tests/db/company-jobs.test.ts`.
- One active job per company: partial unique index (`src/db/schema.ts:729`); subjob rows carry `company_job_id`+`stage`.
- Company concurrency default 4, DB-settable 1..100 (`src/runs/settings.ts:82`); engine pools gate feeding. Tests: `tests/runs/company.test.ts`, `tests/mcp/tools.test.ts`.
- Preflight: 15-min recon agent files report v1; collect gated on a valid report (`src/domain/company-jobs/preflight.ts:141`, `prompts/preflight-v1.md`). Live: 3/3 pilots filed.
- Plan-driven collect: subjobs run exactly the planned adapters; unknown adapters pause `adapter_missing`, never improvised (`src/collect/adapters.ts:64,71`, `src/collect/run.ts:48`). Onboarding standard: `docs/sources/onboarding.md`. Tests: `tests/collect/adapters.test.ts`.
- Research briefed from preflight+collect: areas, counts, captured sources appended to the prompt (`src/domain/company-jobs/brief.ts:47`); subjobs skip legacy collect. Tests: `tests/runs/brief.test.ts` (5). Live: brief verified in all 3 pilot dispatch prompts.
- Extraction worker-driven on the research run (`company.ts` `driveExtraction` → `extractRun`); grounding/verification unchanged.
- Full logging: dispatch prompt + per-call session ingest (`provider_calls`), MCP audit, `http_fetches`, `job_events` (`src/domain/logging/`). Tests: `tests/runs/logging.test.ts` (8). Not loggable, stated upfront: subagent stdout between MCP calls (only usage rollups survive); pre-existing rows have no logs (accepted).
- Migration `91c1931f` (`src/runs/migrate.ts:36,77`, `scripts/migrate-bulk.ts`): dry-run reconciled 2559 (2497/48/12/2), executed 2556 queued jobs, 3 skipped (pilots), 48 run links intact, bulk retired. Tests: `tests/runs/migrate.test.ts` (3).

## Deviations
- `028d543`: unparenthesized `AND(status, …OR…)` in recover/claim massacred terminal rows on reload; fixed with `or()` + regression tests. Bulk rows verified intact; pilots cancelled and restarted fresh.
- `7652bcb`/`8ab7953`: collect-runner `recover`/`reapStalled` had no kind filter and cross-killed agent rows at startup (failed → agent tick finalized `cancelled`, killing live containers); now kind-scoped with a regression test. Preflight rows no longer legacy-collect.
- Migrated companies run the full pipeline honestly; legacy collect data stays as history. No stage is pre-marked complete.
- `costUsd` still null (no price map); replay tooling deferred, capture-only now.

## Unfinished
- 2552 migrated jobs queued; pipeline draining at company concurrency 4 (live, not yet complete).
- Preflight prompt quality at scale unproven (3 pilots + early migrated jobs).

Suite: 481 passed + 1 skipped (live) in ~195 s; lint/typecheck clean. No push.
