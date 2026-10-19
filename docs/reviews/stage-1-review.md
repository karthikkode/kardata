# Stage 1 review — sectors, companies, MCP server

Branch `v2`: bootstrap + 8 step commits. Full suite 7 files / 98 tests green; lint + typecheck 0 errors; `npm run build` ok.

## Acceptance criteria

- S0 ls-files only new files: commit `a04c5d8`; verified.
- S0 tag v1-final at 956ef5d: pushed; confirmed via `git ls-remote --tags`.
- S1 fresh-clone flow: `README.md:1-38`; ran locally (ci, compose up, migrate, dev).
- S1 `GET /healthz` → `{ok:true, db:true}`: `src/server.ts:20`; curled 200.
- S1 lint/typecheck clean: `eslint.config.js`, `tsconfig.json`; both 0 errors.
- S2 exactly 4 tables: `src/db/migrations/0000_init.sql`; `tests/db/migrate.test.ts:21`.
- S2 migration test on kardata_test: `tests/db.ts` + `tests/db/migrate.test.ts`.
- S3 parser `src/lib/apollo/parse.ts:167`; newlines/BOM/CRLF, missing site, shared domain, dupe id, list dedupe, bad numbers, unknown col: `tests/unit/parse.test.ts` (15 tests, synthetic `tests/fixtures/apollo-sample.csv`); missing header → `ApolloFileError` (`parse.ts:56`, `apollo-bad-headers.csv`).
- S4 exact counts 30/28/0/0/1: `src/domain/imports.ts:115`; `tests/db/imports.test.ts:65`.
- S4 re-import 0 created / 28 updated, count stable: `tests/db/imports.test.ts:91`.
- S4 second sector links 28: `tests/db/imports.test.ts:105`.
- S4 tombstone not revived + restore: `tests/db/imports.test.ts:119`.
- S4 override survives re-import: `tests/db/imports.test.ts:136`.
- S4 shared_domain exact: `src/domain/companies.ts:206`; `tests/db/imports.test.ts:150`.
- S4 bad file writes nothing: `tests/db/imports.test.ts:165`.
- S4 jail incl `../` + symlink: `src/domain/imports.ts:48`; `tests/db/imports.test.ts:177,191`.
- S4 every filter/sort = SQL truth: `tests/db/companies.test.ts` (30 list cases + facets case).
- S5 all tools via SDK HTTP client + error codes + 401: `tests/mcp/tools.test.ts:104-244`.
- S5 tools/list exact 15, destructiveHint×2: `src/mcp/tools.ts:56-340` (`:108`,`:257`); `tests/mcp/tools.test.ts:93`.
- S6 2559 rows / 2559 companies: `scripts/smoke-real.ts`; observed 1000+1000+559, created 2559.
- S6 28 no-domain, 3 shared / 1 domain: observed 28, 3/1.
- S6 re-import 0/2559, still 2559: observed.
- S6 p95 < 300ms (20 combos @50, server-side): observed p95=168.1ms (p50=143.6, max=178.4) via `durationMs` (`src/mcp/tools.ts:319`).
- S7 SIGTERM → exit 0 < 5s: `src/server.ts:152`; `tests/service/shutdown.test.ts:36`.
- S8 CI valid: `.github/workflows/ci.yml` (Node 22, PG16 service, ci→lint→typecheck→migrate→test→build); YAML parsed; runs on the PR.

## Register (Claude Code)

`claude mcp add --transport http kardata http://127.0.0.1:8787/mcp --header "Authorization: Bearer <token>"`

## Deviations (with reasons)

- listCompanies/facets filter in JS on effective values (one JOIN): exact override semantics for search/sort/facets; p95 168ms at 2.5k rows. Revisit past ~100k rows/sector. (`companies.ts:523,653`)
- domain is derived: effective domain follows a website override; patching `domain` → invalid_input. Manual add still accepts explicit domain. (`companies.ts:156`)
- tombstoned rows skip the global company upsert too (row fully skipped).
- second-sector import counts linked=28 AND updated=28 (fields rewritten).
- createSector validates jail/size up front (fail fast); content errors stay per-file.
- company_update takes `{companyId, patch}` (record; domain validates, null clears).
- company_list returns server-side `durationMs` (the p95 instrument).
- `db:migrate` creates missing DBs (CI has no db-init); CI runs it before test.
- `/healthz` unauthenticated (infra); every `/mcp` request needs Bearer (`server.ts:120`).
- devDeps add `typescript` + `@types/node` (implied by TS-strict; plan names the rest).
- shutdown test spawns the built server (tsx wrapper swallows SIGTERM); `close()` destroys idle sockets (keep-alive stalls `close()`).
- vitest `singleFork`: DB files share kardata_test sequentially; each test truncates first.

## Unfinished / notes

- Nothing unfinished. No pushes except tag v1-final; no merge (PR after this review).
- Real CSVs never copied into the repo (`SMOKE_CSV_PATHS` only); fixtures synthetic.
- Adhoc empty dirs (`backend/`, `mcp/`) + stray AGENTS.md lines removed per plan layout.
- p95 headroom ~44%; payload dominated by raw JSONB per row.
