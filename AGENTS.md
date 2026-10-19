# AGENTS.md — rules for coding agents in this repo

Kardata v2: a backend service (`kardata-server`) driven only through MCP. It imports Apollo company lists
into sectors, then runs deep research per company with agents. No frontend until the roadmap says so.
The owner reviews every stage. Plans live in `docs/plans/`, and the current stage's plan is the spec.

## How you work
1. Read the current stage plan in `docs/plans/` before writing code. Do the steps in order.
2. Use one commit per plan step, with explicit paths (`git add <paths>`, never `git add -A`).
3. Each step's tests are written with the step. While building, run only the tests for files you changed.
   Run the full suite once at the end of the stage.
4. When the stage's steps are done, write `docs/reviews/stage-<N>-review.md` (≤ 80 lines) and STOP.
   The review lists:
   - each acceptance criterion → how it is met (`file:line`) → the test or evidence that proves it;
   - any deviations from the plan, with the reason;
   - anything left unfinished.
5. Stuck more than 45 minutes on one item: write it under "Blocked" with the exact error, then move on.

## Never
- Commit real company data. Apollo CSVs are private. `*.csv` is gitignored. The only exception is
  `tests/fixtures/`, which holds synthetic data only.
- Commit secrets. `.env*` is gitignored except `.env.example`.
- Run destructive database commands (drop, truncate, reset) against anything except the dev or test database.
- Push, merge or change GitHub settings without the owner's explicit go.
- Add frameworks, services or dependencies the plan doesn't name. If one seems needed, propose it in the
  review instead.
- Write long docs, catalogues, hash manifests or "evidence metadata". Code and tests are the deliverable.
- Re-run a test suite on code that hasn't changed.

## Stack (fixed)
- Node 22 and TypeScript (strict, ES modules).
- An MCP server through `@modelcontextprotocol/sdk` (Streamable HTTP), with zod schemas.
- Postgres 16 in Docker, accessed through Drizzle ORM and drizzle-kit migrations (the `postgres` driver).
- Vitest for unit, DB and MCP integration tests. npm is the package manager.
- Keep the layers apart: `src/domain` holds all logic; `src/mcp` holds only thin tool wrappers.
