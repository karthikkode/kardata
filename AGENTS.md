# AGENTS.md — rules for coding agents in this repo

Kardata v2: a backend service (`kardata-server`) driven only through MCP. It imports Apollo company lists
into sectors, then runs deep research per company with agents. No frontend until the roadmap says so.
The owner reviews every stage. Plans live in `docs/plans/`, and the current stage's plan is the spec.

## Docs map
| Folder | What it holds | Who edits it |
|---|---|---|
| `docs/plans/` | Stage plans (the spec) and `roadmap.md` | Owner / Claude |
| `docs/reviews/` | Your stage reviews | You, at the end of a stage |
| `docs/sources/` | How-tos for the code (for example, onboarding a source adapter) | You, when the plan says so |
| `docs/business/` | **Business context:** strategy, offer, ICP, problem bar, evidence rules, outreach, funnel, decisions. Start at `docs/business/README.md` | **Owner / Claude only.** You read it, never edit it |

**Analysis, briefs, screens or outreach work on company data must follow `docs/business/`.**
- Use the ICP in `icp.md` and its terms:
  - a **tier** groups companies by annual revenue and sets the offer (A high, B mid, C low);
  - a **layer** is priority inside a tier by signal score (Layer 1 = highest score);
  - a **research wave** is research order. Older plans call it "Layer 1/2"; that use is retired.
- Use the problem bar and 8 dimensions in `problem-bar.md`, and the citation rules in `evidence-rules.md`.
- If a business answer you need isn't there, ask the owner. Don't invent one. Open business questions are listed in
  `docs/business/decisions.md`.

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
- Operate the pipeline ad hoc. Every job (imports, passes, launches, retries, pauses, resumes,
  checkpoints, status checks) goes through a standard MCP tool; one-off scripts against prod data
  are banned. If no tool fits the op, add the tool (with tests) first. Tests, migrations, backups
  and harness setup stay as committed scripts.
- Commit real company data. Apollo CSVs are private. `*.csv` is gitignored. The only exception is
  `tests/fixtures/`, which holds synthetic data only.
- Commit secrets. `.env*` is gitignored except `.env.example`.
- Run destructive database commands (drop, truncate, reset) against anything except the dev or test database.
- Push, merge or change GitHub settings without the owner's explicit go.
- Add frameworks, services or dependencies the plan doesn't name. If one seems needed, propose it in the
  review instead.
- Write long docs, catalogues, hash manifests or "evidence metadata". Code and tests are the deliverable.
  (`docs/business/` is the owner's and is exempt; you never write there.)
- Put real prospect names, people, emails or phone numbers in any doc. They stay in the database.
- Re-run a test suite on code that hasn't changed.

## Stack (fixed)
- Node 22 and TypeScript (strict, ES modules).
- An MCP server through `@modelcontextprotocol/sdk` (Streamable HTTP), with zod schemas.
- Postgres 16 in Docker, accessed through Drizzle ORM and drizzle-kit migrations (the `postgres` driver).
- Vitest for unit, DB and MCP integration tests. npm is the package manager.
- Keep the layers apart: `src/domain` holds all logic; `src/mcp` holds only thin tool wrappers.
