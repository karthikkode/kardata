# Phase 8: Pilot run (100 companies), UI only, with fix loop

Source: the owner-approved Phase 2 plan (§8, §2), plus reviewer additions from
the Phase 7 fix loop (marked **[new]**). This file is the agent's reference for
Phase 8. Phase 9 (the 2000-company final run) gets its own file after a clean
pilot.

## 0. Preconditions (all must hold before any Phase 8 commit)

1. Phase 7 is merged to `main` by PR (merge commit), and backend mutation has a
   number or an explicit owner waiver recorded in `p2-fix-loop-1.md`.
2. Branch `p2-8-pilot` from the new `main`.
3. **[new]** The coding agent's process runs with `ulimit -n 65536` (Muse 1.4.2
   leaks one handle per tool call; pilot runs are long). Check with
   `cat /proc/$PPID/limits | grep 'open files'` and report it in the package.
4. Owner decisions that stand (do not re-ask): real Meta only for scale tiers;
   no spend cap (report tokens per step and per tier); never fix mid-run; UI
   only, enforced in code and audited; the agent only reads during a run.

## 1. How Phase 8 runs

1. **Build** the run tooling (§2). Run only related tests while building.
2. **Review package** `documentation/plans/p2-8-review.md` (≤ 120 lines), then
   STOP: "Phase 8 tooling ready for Claude review".
3. After acceptance: **Meta ceiling** (§2, B7), twice at different hours.
4. **Run r1** (§3). Log, never fix. Write the run report (§4), STOP.
5. **Fix loop** after review, then run r2 from scratch. Repeat until a clean
   pass (§5).

## 2. Build items (each with its own tests and AC)

### B1. UI-only enforcement (`KARDATA_UI_ONLY=1`)
Today events get `client` from the URL alone (`eventClientForRoute`: any
`/v1/*` request is `ui`), so a curl with any key would audit as UI. Fix that
first; the audit means nothing without it.
- `api_keys` gains `client text NOT NULL DEFAULT 'other'` (`ui`, `agent-mcp`,
  `viewer`, `other`). Migration with up/down markers.
- With `KARDATA_UI_ONLY=1`, every mutating `/v1/*` request (POST, PUT, PATCH,
  DELETE) needs all three: a key whose `client='ui'`; `Origin` equal to the
  pilot UI origin (`KARDATA_UI_ORIGIN`); header `X-Kardata-Client: ui`.
  Otherwise 403 `ui_only_violation` and one `alerts` row with route, key_id
  (never the key), origin and trace_id.
- The worker MCP key works only on `/mcp`; on `/v1/*` it is a violation.
- `requestEnvelope` (frontend) always sends `X-Kardata-Client: ui`.
- The event's `client` comes from the authenticated key's `client`, not the
  URL. A `viewer` key is GET-only everywhere.
- Flag off (default) changes nothing: dev, live and test stacks behave as now.
- **AC**: DB tests for each rejection path (wrong key client, missing header,
  wrong origin, MCP key on /v1, viewer key mutating) → 403 + alert row; UI key
  + header + origin → 2xx and event `client='ui'`; flag off → today's behavior.

### B2. Read-only access for the agent
- Postgres role `kardata_pilot_ro` (`CONNECT` + `SELECT` only, default
  privileges for future tables). Created idempotently by `stack.mjs pilot up`.
  Its password is generated once and stored with the other local secrets; never
  printed or committed.
- A `viewer` API key for the pilot backend, issued by `stack.mjs pilot up`.
- **AC**: DB test proves the RO role cannot INSERT, UPDATE, DELETE, or run DDL.

### B3. Pilot stack (extend `deployment/scripts/stack.mjs`; no new scripts)
- `stack.mjs pilot up --worktree <path>`: Temporal namespace `kardata-pilot`, DB
  `kardata_pilot`, backend 3201, UI 25174, `KARDATA_UI_ONLY=1`,
  `KARDATA_UI_ORIGIN=http://localhost:25174`. The UI is the **production build**
  (`vite build` + `vite preview`), not the dev server, with the UI key baked in
  at stack start. Runs migrations; creates the RO role and the keys.
- `stack.mjs pilot down` stops processes only. `stack.mjs pilot status`.
- Never drops the DB, the namespace or `var/pilot/archive`.
- **[new]** The live-stack "drain stale workflows" step (eddfd8f) must NOT run
  for the pilot. Pilot runs are kept, and Phase 9 resumes the same research.
  Add a test that pilot startup never terminates workflows.
- **AC**: up → status shows all four ports healthy; down → up again keeps the
  previous run's sector, files and workflows; `var/pilot/archive` refuses delete.

### B4. Pilot specs (`tests/frontend-e2e/pilot/`)
- One spec file per step P1–P12 (§3.2), plus one per scale tier, so a run can
  resume from a step after a crash instead of restarting a multi-hour test.
  Shared state (sector id, chat ids, run tag) in
  `var/pilot/run-<tag>/state.json`.
- ESLint override for this folder bans `page.request`, `request.`,
  `APIRequestContext`, `fetch(` and `page.evaluate` bodies that call fetch.
  Specs only click, type, upload, wait and screenshot. Lint-test the ban with
  one fixture file per banned form.
- Each step records wall time, console errors, failed requests and screenshots
  into `var/pilot/run-<tag>/evidence/<step>/` (reuse the recording pattern of
  `tests/frontend-e2e/pilot-live.spec.ts`).
- Long waits poll visible UI state with an explicit ceiling, and fail with the
  step and the last visible status when the ceiling is reached.
- Checks that need the DB use the RO role through one read-only helper, never
  the owner connection.

### B5. Audit: `npm run pilot:audit -- --since <ISO>`
- Uses the RO role. Prints mutating events by `client`, the `ui_only_violation`
  count, and each owner-type action (create, approve, upload, spawn, steer,
  pause, resume, stop, plan edit, context decision) with its client.
- Exit non-zero unless `other = 0`, violations = 0 and every owner-type action
  is `client='ui'`.
- **AC**: DB tests seed a clean set (exit 0) and each failure kind (exit 1).

### B6. Issue log and report templates
- `docs/pilot/README.md` (≤ 30 lines): severity rules (§3.1), the log columns
  and the report outline. No generators: the agent writes the log by hand.

### B7. Meta ceiling (`tests/stress/meta-ceiling.ts`, gated `KARDATA_LIVE_META=1`)
- Calls Meta directly (a provider benchmark, not an owner action). About 1k
  input and 200 output tokens; concurrency 2, 4, 8, 16, 24, 32; 40 requests
  per step; 60 s between steps.
- Safe = the highest step with ≥ 98% success and p95 ≤ 2× the concurrency-2 p95.
- Run twice at different hours, take the lower value, and set
  `KARDATA_META_MAX_CONCURRENT` for the pilot stack (config only).
  `meta-limiter.ts` already enforces it.

### B8. Quality checks
- A RO SQL file computing: domain duplicates, companies without a stored
  source, and precision inputs per source type (`v_research_quality`).
- A sampler with a recorded seed (30 for Phase 8) that writes
  `docs/pilot/run-<tag>-sample.md` with the stored source URL for each pick.

### Review package must include
Per B1–B8: `file:line` and the test names that prove each AC, plus:
- the honest limit: someone holding the UI key could fake the header and
  origin, and the audit, the RO role and review cover that gap;
- the open-files limit of the agent process;
- the exact command sequence for run r1.

## 3. The pilot run

### 3.1 Run rules
- **Freeze.** Tag `pilot-r<N>` on the reviewed commit;
  `git worktree add var/pilot/run-pilot-r<N> pilot-r<N>`; start the stack from
  that worktree. No code, prompt, migration or config change during a run.
- **Log, never fix.** `docs/pilot/run-pilot-r<N>-issues.md`:

  | id | step | time | symptom | trace_id / thread_key | severity | screenshot |

  Severity: **blocker**, the run cannot continue; **major**, wrong data or
  state, a lost action or a broken control; **minor**, cosmetic or slow.
- **Diagnose read-only** (viewer key, RO role, logs). On a blocker: pause the
  research in the UI and end the run.
- **[new]** The machine stays quiet during a run: no suites, no Stryker, no
  builds in other trees.

### 3.2 Steps (UI only, via the pilot specs)

| Step | Action | Must prove |
|---|---|---|
| P1 | Create sector "AU electrical, plumbing and HVAC services r<N>" | Landing shows it as a draft |
| P2 | 3 brainstorming chats: (a) Kardata ICP for trades, (b) geography and filters, (c) sources to mine. Each agent researches and writes a findings file. Upload 1 md + 1 pdf | All files in Files, indexed (RO SQL), author thread shown |
| P3 | Global context: approve proposals for Scope, Instructions and Decisions; reject one; add 3 files; remove 1; compact once; rewrite once with a direction | History shows each; blocks ready; token bar correct; the rejection changed nothing |
| P4 | Each brainstorming chat is asked to spawn ≥ 10 subagents; spawn 2 more with the UI button | Named subagents; transcripts readable; results return to parents |
| P5 | Research chat: `@` the 3 chats, ask for a detailed plan with acceptance criteria (target **100**, filters §3.4); then "Yes, update the plan accordingly" | Turn 1 advises without changing the plan; turn 2 writes it; executable JSON + criteria |
| P6 | Edit the plan once, approve, start research | Landing and plan views show identical progress |
| P7 | During research: steer the parent ("prioritise regional NSW"); steer 3 running subagents; pause and resume 2; stop 1; reorder and remove a queued message; global context off and on in one chat | UI receipt + DB receipt for each; behavior change observed. A steer to a paused subagent shows the 409 "not accepting" message (expected, same as sessions) |
| P8 | Karbot chat: "Monitor this research every 10 minutes, check quality and progress, steer if quality drops." | Ticks visible; ≥ 1 tick reports or steers with facts matching the DB |
| P9 | Add HVAC via a plan edit, re-approve | Completed work kept; new scope runs |
| P10 | Reach ≥ 100 accepted companies | Landing count = DB count |
| P11 | Ask the research agent for a final report file | Indexed and readable in the UI |
| P12 | Reload mid-stream; switch sessions while running; close the tab and reopen after 5 min | No stuck spinners; state matches the server; drafts kept |

### 3.3 Real-Meta scale tiers (after P10, in a new chat of the pilot sector)
T = 10, then 100, then 1000. Each tier must pass before the next starts.
- Upload a suburb list file. Type: "Spawn T subagents. Each finds and verifies
  1 AU electrical business in its suburb from the attached list, then writes a
  one-paragraph note file."
- During the tier, in the UI: pause and resume 3, steer 3 ("skip franchises"),
  cancel 2, reorder a queue, steer the parent.
- UI check: the strip and directory show T subagents, scrolling works, one
  transcript opens. Grade the screenshots with the ui:review rubric.
- **Pass per tier**: ≥ 98% of children complete, failures honest and 0 silent;
  0 orphans; note files = completed children, all indexed; control actions
  100% effective; owner GET p95 < 500 ms (viewer-key poller every 5 s);
  0 deadlocks; spend recorded.
- Publish `docs/limits.md`: Meta ceiling, children per hour, max tested
  children per session, pool and CPU headroom, and what breaks first.

### 3.4 Basic ICP filters (written into the plan and Instructions)
Accept only if ALL hold:
1. A real operating business: its own website, or a verifiable listing with an
   address or phone.
2. Located in Australia.
3. Primary service is electrical, plumbing or HVAC.
4. Not a directory, aggregator, franchise head office page, job ad, article or
   marketplace.
5. Not a duplicate: normalized domain, then name + suburb.
6. At least one source URL fetched during research, stored with a timestamp.

Unknown size stays unknown. No deep research, scoring or outreach.

### 3.5 Quality validation
1. Freeze the population (RO role).
2. Seeded sample of 30; for each, fetch the stored source and check filters 1–6.
3. Whole population: domain duplicates = 0, companies with no source = 0.
4. Notes: precision by source type, cost per accepted company, the top 5
   failure reasons.

## 4. Run report: `documentation/plans/p2-8-run-r<N>.md` (≤ 80 lines), then STOP
- An AC table (§6) with pass/fail and evidence paths.
- The issue list by severity, with trace ids.
- `pilot:audit` output.
- Spend per step and per tier; wall time per step.
- Tier results and the `docs/limits.md` summary.

## 5. Fix loop (only after Claude has reviewed the run report)
1. Fix every blocker and major (minors unless the owner defers them). Each fix
   gets a failing-first test and a `docs/bug-escapes.md` row. Workflow changes
   use `patched()`, because pilot workflows stay alive across runs.
2. Group fixes by root cause, one commit each, with targeted reruns.
3. `npm run verify:full` and `npm run test:fault` once, at the fixed HEAD.
4. Delta package (≤ 60 lines) mapping issue id → commit → test, then STOP.
5. Next run from scratch: new sector suffixed ` r<N+1>`, new tag.
6. **Clean pass** = 0 new blockers, 0 new majors, all §6 AC met, audit clean.
   Expect r1 to be a shakedown.

## 6. Phase 8 AC (a run is clean only if ALL hold)
- P1–P12 done via the UI, with screenshots graded.
- ≥ 100 accepted companies.
- Sample ≥ 29/30.
- 0 duplicates; 0 missing sources.
- All agent files indexed.
- All 3 tiers pass, and `docs/limits.md` is published.
- `pilot:audit` clean.
- 0 new blockers or majors.

## 7. Forbidden (in addition to AGENTS.md "Forbidden work")
- Calling the pilot backend with anything but the UI during a run, including
  "just to unblock". Log it as a blocker instead.
- Connecting to `kardata_pilot` as owner or superuser during a run (B3 setup
  only).
- Dropping, draining or resetting the pilot DB, namespace or archive.
- Raising a test ceiling or budget to make a run pass. Log it as an issue.
- New scripts outside `stack.mjs` and `package.json`.
- Pushing or merging without the owner's word.
