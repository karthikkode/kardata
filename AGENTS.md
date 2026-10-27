# AGENTS.md — rules for coding agents in this repo

Kardata v2: a backend service (`kardata-server`) driven only through MCP. It imports Apollo company lists
into sectors, then runs deep research per company with agents. The server has no frontend. The public website
(kardata.co) is a separate project in `website/` (see "Website" below).
The owner reviews every stage. Plans live in `docs/plans/`, and the current stage's plan is the spec.

## Docs map
| Folder | What it holds | Who edits it |
|---|---|---|
| `docs/plans/` | Stage plans (the spec) and `roadmap.md` | Owner / Claude |
| `docs/sectors/` | Per-sector profile, decisions, results, log | Owner / Claude |
| `docs/plans/website/` | Website plans (their own spec, separate from the server stages) | Owner / Claude |
| `docs/reviews/` | Your stage reviews | You, at the end of a stage |
| `docs/sources/` | How-tos for the code (for example, onboarding a source adapter) | You, when the plan says so |
| `docs/business/` | **Business context:** strategy, offer, ICP, problem bar, evidence rules, outreach, funnel, decisions. Start at `docs/business/README.md` | **Owner / Claude only.** You read it, never edit it |

**Finding the current stage:** exactly one file in `docs/plans/` (ignoring `docs/plans/archive/`) has `Status: current` as its first line.
That file is the spec. All other plans and all of `docs/reviews/` are history. New reviews go in `docs/reviews/` (not the archive). Website work has its own
current plan: the one file in `docs/plans/website/` with `Status: current`. Its reviews go in `docs/reviews/website/`.

**Analysis, briefs, screens or outreach work on company data must follow `docs/business/`.**
- Use the ICP in `icp.md` and its terms ([docs/business/icp.md](docs/business/icp.md), Terms):
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

## Who decides (D-65)
Claude (the reviewer and operator) makes the operational calls: pipeline runs, retries, research quality,
which companies are reachable or go on the sheet, data fixes, harness changes, and merging and deploying
`kardata-server` once CI passes. Don't hand the owner small decisions; the owner isn't following closely, so a
decision made by the owner would be uninformed. Report what was decided and why, in a line, after the fact.
Ask the owner only for:
- secrets, passwords or accounts;
- spending money;
- business rules in `docs/business/` that the data can't settle (offer, pricing, ICP definition);
- anything sent to people outside (emails, posts), and website pushes and deploys (rules below).
- adding or changing rows in the owner's outreach Google Sheets: show the rows first, write only after the
  owner approves, and never touch rows or columns the owner has worked on.

## Website (`website/`)
- **Live since 2026-10-27** at https://kardata.co: an Astro static site in `website/frontend/` (Node 22).
  Start at `website/README.md` for hosting, VM and deploy facts. Its stack is the website plan's, not the server
  stack below. `docs/plans/website/site-1-launch.md` is done; no website plan is current until the owner writes one.
- Work on the site in this checkout. Don't create extra worktrees or folders for it.
- **Pushing and deploying are two separate actions, each needing the owner's explicit go for that action:**
  - *Push* (`git push`) sends commits to GitHub. It never changes the live site (there is no CI deploy).
  - *Deploy* (`npm run deploy` in `website/frontend`) builds the commit checked out here and puts it on the VM, pushed
    or not. It refuses uncommitted changes in `website/frontend` or `website/deploy`, and fails unless kardata.co
    serves the new release. `npm run rollback` goes back one. Never build on the VM or deploy by hand.
  - A go to deploy is not a go to push, and the other way round. After a deploy, report the release it printed.
- It is its own project: own `package.json`, never imports from `src/`, never reads the Kardata database, never
  shares secrets with the server. Root lint, typecheck and tests ignore it.
- Copy, offers and the blog shape follow `docs/business/content.md` and `offer.md`. The owner writes every post (D-44);
  you build the site, you don't write its articles.
- The VM is shared with kathawin.com. The only Kardata thing on it is the `kardata-site` container; v1 and
  Mattermost were removed on 2026-10-27. Never touch kathawin containers, images, volumes or Caddyfile blocks, and
  change nothing on the VM without the owner's explicit go.

## Never
- Operate the pipeline ad hoc. Every job (imports, passes, launches, retries, pauses, resumes,
  checkpoints, status checks) goes through a standard MCP tool; one-off scripts against prod data
  are banned. If no tool fits the op, add the tool (with tests) first. Tests, migrations, backups
  and harness setup stay as committed scripts.
- Commit real company data. Apollo CSVs are private. `*.csv` is gitignored. The only exception is
  `tests/fixtures/`, which holds synthetic data only.
- Commit secrets. `.env*` is gitignored except `.env.example`.
- Run destructive database commands (drop, truncate, reset) against anything except the dev or test database.
- Push, merge, deploy or change GitHub settings without a go for that action. The owner has given a standing go
  for `kardata-server` work once CI passes (D-65). Website pushes and deploys still need their own go.
- Put sector-specific nouns (product categories, retailers, trade press) in src/, prompts/ or docs/business/ — they belong in docs/sectors/<slug>/. A test enforces this for code.
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
