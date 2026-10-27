Status: done · Date: 2026-10-26

# Stage 1 — Backend core: sectors, companies, MCP server

**Goal:** a long-running `kardata-server` that the owner drives entirely through MCP:
- create, update and delete sectors;
- import Apollo CSVs into a sector;
- add, edit, remove and restore companies by hand;
- search, filter and page the companies of a sector.

There is no frontend. The MCP server is the only point of contact. See `docs/plans/roadmap.md` for later stages.

**Out of scope:**
- research, agents, LLM calls, web fetching, collectors;
- any UI or HTML pages;
- deployment.

## Step 0 — Repo bootstrap (git)

The GitHub repo is `karthikkode/kardata`. Its `main` holds v1 (head `956ef5d`).

1. `~/projects/kardata` already holds `AGENTS.md` and `docs/`. Clone into a temp folder, move its `.git` in,
   then check out a new branch `v2`. Keep the existing files.
2. Owner go required: create tag `v1-final` at `956ef5d` and push the tag.
3. One commit, "v2: start fresh": `git rm -r` every v1 file, then add `AGENTS.md` and `docs/`.
4. Steps 1–8 are committed on `v2`. Merging `v2` → `main` is by PR, after the owner accepts the review.

**AC:**
- `git ls-files` on `v2` lists only the new files.
- `git tag` shows `v1-final`.

## Step 1 — Project skeleton

- **Node 22, TypeScript strict, ES modules.** Layout:
  - `src/server.ts`: entry point;
  - `src/db/`: schema, client, migrations;
  - `src/domain/`: plain functions, no MCP types;
  - `src/mcp/`: tool definitions only, each a thin wrapper over `src/domain`;
  - `src/lib/apollo/`: the CSV parser.
- Dependencies (no others):
  - `@modelcontextprotocol/sdk`, `zod`;
  - `drizzle-orm`, `drizzle-kit`, `postgres` (postgres.js);
  - `csv-parse`;
  - dev: `tsx`, `vitest`, `eslint`, `typescript-eslint`.
- npm scripts: `dev` (`tsx watch`), `build`, `start`, `lint`, `typecheck`, `test`, `db:generate`,
  `db:migrate`, `smoke:real`.
- `docker-compose.yml` with **Postgres 16 only**:
  - host port **5433**;
  - volume `kardata_pgdata`;
  - databases `kardata` (dev) and `kardata_test`.
- `.env.example`:
  - `DATABASE_URL`, `TEST_DATABASE_URL`;
  - `PORT=8787`, `HOST=127.0.0.1`;
  - `KARDATA_OPERATOR_TOKEN`;
  - `KARDATA_IMPORT_DIRS`: comma-separated folders that CSV paths may come from, e.g. `/home/karthik/Downloads`.
- `.gitignore` covers `node_modules`, `dist`, `.env*` (except `.env.example`), `*.csv` (except
  `tests/fixtures/**`), `var/` and `test-results/`.
- `README.md` ≤ 40 lines: start Postgres, migrate, run, and how to register the MCP server in Claude Code
  (`claude mcp add --transport http kardata http://127.0.0.1:8787/mcp --header "Authorization: Bearer <token>"`)
  and in Muse.

**AC:**
- A fresh clone with `npm ci && docker compose up -d && npm run db:migrate && npm run dev` starts the server.
- `GET /healthz` returns `{ok:true, db:true}`.
- `lint` and `typecheck` report 0 errors.

## Step 2 — Database schema (Drizzle)

A company is **global**: one row per real company. Sectors hold companies through a membership table, so a
brand in two sectors is researched once.

**`sectors`**
- `id` uuid pk;
- `name` text, unique case-insensitively (unique index on `lower(name)`);
- `description` text, not null, may be empty;
- `created_at`, `updated_at`.

**`companies`**
- Identity and origin:
  - `id` uuid pk;
  - `apollo_account_id` text, nullable, **unique where not null**;
  - `source` enum `apollo | manual`.
- Domain:
  - `domain` text, nullable, normalized, indexed;
  - `shared_domain` boolean: true when more than one company has this domain. **Never merge by domain.**
- Typed Apollo fields:
  - `name`, `website`, `linkedin_url`, `facebook_url`, `twitter_url`;
  - `employees` int, `industry`, `keywords` text[], `technologies` text[];
  - `country`, `state`, `city`, `postal_code`, `address`, `phone`;
  - `annual_revenue` numeric, `total_funding` numeric, `latest_funding` text, `latest_funding_amount` numeric,
    `last_raised_at` date;
  - `founded_year` int, `short_description`, `logo_url`;
  - `sic_codes` text[], `naics_codes` text[].
- `raw` jsonb: every original CSV column, verbatim, from the latest import.
- `overrides` jsonb, default `{}`: owner edits to typed fields. **Imports never touch `overrides`.**
  Reads return each field as `override ?? imported value`.
- `notes` text: owner notes.
- `created_at`, `updated_at`.
- Indexes: GIN on `technologies` and `keywords`; btree on `country`, `employees` and `industry`.

**`sector_companies`** — membership:
- pk (`sector_id`, `company_id`), with `sector_id` fk cascade and `company_id` fk cascade;
- `added_via` enum `csv | manual`;
- `first_import_id`, `last_import_id`, both nullable;
- `removed_at` timestamptz, nullable. This is the **tombstone**: a removed company stays removed when a CSV is
  re-imported, until it is explicitly restored;
- `created_at`.

**`imports`** — one row per file:
- `id`, `sector_id` (fk cascade);
- `filename`, `file_sha256`;
- `rows_read`, `created_count` (new global companies), `linked_count` (an existing company newly added to
  this sector), `updated_count`, `skipped_count`;
- `skipped` jsonb: up to 200 `{row, reason}` entries;
- `created_at`.

**AC:**
- Migrations on an empty database create exactly these tables.
- A migration test applies them to `kardata_test`.

## Step 3 — Apollo CSV parser (pure, unit-tested)

`src/lib/apollo/parse.ts`: file text → `{ rows: ParsedCompany[], errors }`.

- Use `csv-parse`. It must handle quoted fields with **embedded newlines** (the 3 real files have about 8.6k
  lines for 2,559 rows), a UTF-8 BOM, and CRLF.
- **Required headers:** `Company Name`, `Apollo Account Id`. If either is missing → file-level error.
- Map the 47 known headers to typed fields. Unknown headers go into `raw` only.
- Normalization:
  - `domain` from `Website`: lowercase, strip the protocol, `www.`, path and query. Empty → null.
  - Numbers: strip `,` and `$`. Invalid or empty → null.
  - Lists (keywords, technologies, SIC, NAICS): split on `,`, trim, drop empties, dedupe case-insensitively,
    keep the first spelling.
  - `Last Raised At` → date or null.
- A row without an `Apollo Account Id` is skipped with reason `missing apollo id`.

**AC:** unit tests on a **synthetic** `tests/fixtures/apollo-sample.csv`, about 30 fake rows with the real
47 headers. They cover:
- embedded newlines, BOM and CRLF;
- missing website, a shared domain across different ids, the same id twice;
- a list with duplicates and blanks, a malformed number;
- an unknown column, a missing required header.

## Step 4 — Domain functions (`src/domain/`)

Plain async functions that take a db handle. Each returns data or throws a typed
`DomainError{code: not_found | conflict | invalid_input | file_error, message}`.

- **Sectors:**
  - `createSector({name, description, csvPaths?})`: creates the sector, then imports the files. If every
    file fails, nothing is created (one transaction).
  - `updateSector`: name and/or description.
  - `deleteSector`: removes the sector and its memberships. Global companies stay, because they may hold
    research later.
  - `listSectors`: with live and removed counts.
  - `getSector`: with its last 20 imports.
- **Imports — `importCsv(sectorId, paths[])`:**
  - At most 10 files, each ≤ 25 MB.
  - Each path must resolve (after `realpath`) inside `KARDATA_IMPORT_DIRS`; otherwise `invalid_input`.
  - **One transaction per file**:
    - upsert the global company on `apollo_account_id`, overwriting its typed fields and `raw`
      (latest import wins; `overrides` untouched);
    - upsert the membership;
    - a tombstoned membership is **not** revived; the row is skipped with reason `removed by owner`;
    - the same id twice in one file → the last row wins, counted once.
  - After each file, recompute `shared_domain` for the affected domains.
  - A file-level error writes nothing.
- **Companies:**
  - `addCompany(sectorId, {name, domain?, website?, …typed fields})`: `source: manual`. If the domain
    matches existing companies, still create it, but return those as `possible_duplicates`.
  - `addCompanyToSector(sectorId, companyId)`: links an existing company.
  - `updateCompany(id, patch)`: writes `overrides` and `notes`. Passing `null` for a field clears that
    override.
  - `removeCompany(sectorId, companyId)` sets the tombstone; `restoreCompany` clears it.
  - `getCompany(id)`: effective fields, overrides, raw, notes, and the sectors it belongs to.
  - `listCompanies(sectorId, {search, country[], employeeBand[], industry[], technologiesAny[], hasFunding,
    sharedDomain, includeRemoved, sort, order, page, pageSize ≤ 200})`. Search covers name, domain and
    keywords. Employee bands are 1–10, 11–50, 51–200, 201–500, 501+. Sort by name, employees, founded or
    revenue.
  - `facets(sectorId)`: counts per country, industry and employee band, plus the top 50 technologies.

**AC (DB tests on `kardata_test`):**
- Fixture import counts are exact.
- Re-importing gives `created 0`, `updated N`, and an unchanged count.
- The same file imported into a second sector gives `created 0`, `linked N`.
- A tombstoned company is not revived by a re-import, and `restore` brings it back.
- An override survives a re-import.
- `shared_domain` is set on exactly the fixture's shared-domain rows.
- A bad-header file writes nothing.
- A path outside `KARDATA_IMPORT_DIRS` is rejected, including through `../` and symlinks.
- Every filter and sort matches an SQL ground truth on the fixture.

## Step 5 — MCP server (`src/mcp/`)

- Use **Streamable HTTP** at `/mcp`, on `HOST:PORT` (default `127.0.0.1:8787`).
- Every request needs `Authorization: Bearer $KARDATA_OPERATOR_TOKEN`; otherwise 401.
- Tools have zod input schemas and return `structuredContent` plus a one-line text summary. A
  `DomainError` → `isError: true` with `{code, message}`.

| Tool | Domain function |
|---|---|
| `sector_create`, `sector_update`, `sector_delete`, `sector_list`, `sector_get` | sectors |
| `companies_import_csv` | `importCsv` |
| `company_add`, `company_link`, `company_update`, `company_remove`, `company_restore` | companies |
| `company_get`, `company_list`, `company_facets` | reads |
| `import_list` | the imports of a sector |

- Tool descriptions are short and say what each tool returns. Destructive tools (`sector_delete`,
  `company_remove`) are annotated `destructiveHint: true`.
- `sector_delete` requires `confirm_name` equal to the sector's name.

**AC:**
- An integration test starts the server in-process and drives every tool through the SDK's HTTP client.
  It covers happy paths, each error code, and 401 without a token.
- `tools/list` returns exactly the tools above.

## Step 6 — Real-file acceptance (`npm run smoke:real`)

`scripts/smoke-real.ts` goes through the MCP client against the running dev server. It reads paths from
`SMOKE_CSV_PATHS` and prints only counts, never company data. Check it against the owner's 3 files in
`~/Downloads`. Never copy them into the repo.

**AC:**
- **2,559** rows read and **2,559** companies.
- **28** companies with no domain.
- **3** flagged `shared_domain` (1 domain).
- Re-importing gives 0 created, 2,559 updated, still 2,559 companies.
- `company_list` p95 < 300 ms for 20 mixed filter combinations at page size 50, measured server-side.

## Step 7 — Run it as a service

- `scripts/kardata-server.service`: a systemd **user** unit template (`npm start`, `Restart=on-failure`,
  `EnvironmentFile`).
- The README shows how to install it. Do **not** install it yourself.
- Graceful shutdown on SIGTERM: close the HTTP server and the DB pool.

**AC:** a test sends SIGTERM to a spawned server, which exits with code 0 within 5 s.

## Step 8 — CI

`.github/workflows/ci.yml` runs on PRs: `npm ci`, `lint`, `typecheck`, then `test` (with a Postgres 16
service), then `build`.

**AC:** the workflow file is valid; the owner sees it run on the PR.

## Review and stop

Write `docs/reviews/stage-1-review.md` per `AGENTS.md` and STOP. Include the Step 6 numbers, the p95, and
the exact command to register the server in Claude Code.
