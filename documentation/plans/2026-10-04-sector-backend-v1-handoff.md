# Sector backend v1: handoff (FINAL - all green, merged to main)

> Status: all stages committed, all gates green on final code.
> Backend live 18/18, B4 walkthrough green with all 16 shots opened,
> pr:verify exit 0, backend DB suite 1165/56/0, full Playwright
> 485/23/0. Round-4 fixes 1-4 + 2 corrections committed
> (`6b66af8`); e2e compat + live-test robustness + this handoff in
> the Stage 4 commit. Merged to main locally, never pushed.

## 1. Summary and commits

Branch `sector-backend-v1` (from `main @ 042bd18`; the spec's
`ui-revamp-v2` base no longer exists, owner override). Never pushed,
never merged. One commit per stage:

| Stage | Hash | Subject |
|---|---|---|
| 0 | `456a7b5` | Sector backend stage 0: branch, live stack, live test harness |
| 1 | `3cba53b` | Sector backend stage 1: plan lock, owner approval, sector-id pin |
| 2 | `ebb74c0` | Sector backend stage 2: global context model, files, budget, compaction, rewrite |
| 3 | `429e6bf` | Sector backend stage 3: sector reads, @chat, subagent control |
| R4 | `6b66af8` | Round-4 fixes: PATCH proposals, subagent names, @title composer, ai_usage spend, CORS, per-sector ids |
| 4 | `a12fc01` | Sector backend stage 4: e2e compat, live re-runs, walkthrough, handoff, final gate |

What shipped: the plan write lock (research parent only), owner approval
for every agent context write, the six-part global context model with
AI file blocks / budget / compaction / restore / rewrite chats, the
per-chat context switch, sector read tools, `@chat` references, owner
and parent subagent spawn with inherited context, per-child
pause/resume, inbox queue view/edit, and confirmed stop controls.

## 2. Gates (FINAL - all green on final code)

- `KARDATA_META_KEY= npm run pr:verify`: exit 0. Lint 0 errors
  (7 pre-existing warnings), typecheck clean, frontend 778 passed /
  6 skipped, agents 282 passed / 2 skipped, backend 676 passed
  (DB-gated rest skipped), frontend build clean.
- Full backend DB suite
  (`TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1 npm test -w
  @kardata/backend`): 162 files passed / 8 skipped, 1165 tests
  passed / 56 skipped / 0 failed.
- Full Playwright on 15174: 485 passed / 23 skipped / 0 failed
  (8.7m). First re-run after the fixture migration went 276/209;
  the 209 were stale e2e fixtures missing the A6/A8 response
  shape (migrated, bug 11/12 run), then 468/17 (5 product/test
  wedges fixed), 484/1 (strip overlap), then green.
- Backend live battery with real Meta (B2 stack DOWN - bug 13):
  14/18 first clean run; the 4 reds root-caused (bugs 14-16) and
  green on targeted re-runs. Final: 18/18.
- B4 live walkthrough: `1 passed (2.8m)`, all 16 shots opened.
- History: stage 2 gate (1132/48/0, 7/7 live), stage 3 gate
  (1159 + 284 + 772, 8/8 live), B4 run 12 green on pre-round-4
  code. Round-4 code re-proved everything above.

## 3. Per-item results

### A1 Plan write lock
Changed: `invokeTool` denies `db.update_sector_plan` unless the actor
is the research session's main thread; `RESEARCH_TOOLS` split from
`SECTOR_TOOLS`/`PRODUCT_TOOLS`; `planSectorResearch` requires the
bound research session. Owner HTTP routes unchanged.
Unit: `mcp.authority.test.ts` (normal chat denied, research subagent
denied, research parent allowed, Karbot denied, palette
include/exclude).
Live: L-A1 PASS tries=1 in17736/out3214, planCalls=0 -
plan version unchanged after an explicit update request, no
successful `db.update_sector_plan` call.

### A2 Owner approval for every agent context write
Changed: deleted the research-parent auto-approve branch; agent
proposals are always `pending` (research-session children keep
`parent-review` first); `commitChildContext` produces a new `pending`
proposal, never approval. Authors: owner, research, session,
system:compaction.
Unit: updated `mcp.authority.test.ts` + `api.workspace.test.ts`
proposal states; research-parent findings end `pending`.
Live: L-A2/A12 PASS tries=1 in23530/out2283 (fix-1
proof: approving the Instructions-only proposal kept Scope,
Decisions, Findings and Questions byte-identical).

### A3 Sector id line lost after round 1
Changed: `beforeRound` keeps `pinned = [...preload, sectorIdLine]` in
every rebuilt prompt.
Unit: `karbot.turn.test.ts` two-round fake-provider prompt pin.
Live: L-A3 PASS tries=1 in11205/out952 - every round's
request carries the exact sector id line.

### A4 Six sections
Changed: `ContextSections` gains `instructions` (24k max, default '');
`formatGlobalContext(sections, blocks)` renders Scope, Instructions,
Decisions, Findings, Open questions, Files (ready blocks by
added_version then filename). MCP schema accepts `instructions`; old
rows read with `instructions: ''`.
Unit: backend format order + legacy-row default; panel renders
Instructions.
Live: covered by L-A4/A5 (below).

### A5 "Use global context" switch per chat
Changed: `session_settings` table (0024) with `use_global_context`
(default true) and `purpose`; `PATCH /v1/sessions/:id/settings`;
turn wiring drops references but keeps the sector id line when off;
header More-menu switch + composer chip.
Unit: route role/persistence; turn-off prompt shape; UI toggle + chip.
Live: L-A4/A5 PASS tries=1 in16238/out1124 - B's
request holds all six headings, A's later request holds no
global context text but keeps the sector id line.

### A6 File blocks
Changed: `context_file_blocks` table (0024) + legacy backfill;
`summarizeContextFileActivity` (12k-token chunks, template prompt,
deterministic numeric coverage with one retry then Additional figures);
`contextFileSummary` workflow on the research lane; owner add/retry
routes with 409 budget guard; agent fileRef approval starts
summarization; injection uses ready blocks, keeps legacy raw.
Unit: numeric helper, template validator, route roles + 409, approval
starts workflow (fake gateway), injection skips hidden/keeps legacy,
UI states.
Live: L-A6 PASS tries=1 in1095/out5156 (blocks) - md +
pdf ready, template headings in order, every fixture number
present, +1 version per file, usage byFile populated.

### A7 Remove a file
Changed: `DELETE .../files/:fileId` deletes block + clears
`workspace_files` + strips `section_file_refs` + bumps version +
history row, no AI call; summarizing removal cancels best-effort and
late completion cannot re-insert. Provenance contract recorded in
`documentation/sector-workspace.md`.
Unit: route deletes all listed state; fake turn runs after removal;
late completion leaves no block.
Live: L-A7 PASS tries=1 in3587/out160 - route under
500 ms, next turn's request lacks the block text, no
ContextFileBlocked error.

### A8 Token usage
Changed: `GLOBAL_CONTEXT_BUDGET_TOKENS = 30000`; usage object on GET
(total/budget/method/bySection/byFile, estimated, no provider call);
header caption + progress bar (warning 70%, danger 100%) + breakdown
popover.
Unit: sums match parts; tone thresholds.
Live: L-A8 PASS tries=1 in566/out2704 - total equals
the sum of parts, byFile matches stored block tokens.

### A9 Compaction and restore
Changed: `compactGlobalContextActivity` (Decisions/Findings/Questions
only, numeric coverage, must shrink, one version-conflict retry);
`globalContextCompaction` workflow (USE_EXISTING single-flight);
auto trigger at 70% via gateway; manual compact route; restore route
(text sections only, 404 unknown); legacy notes route untouched.
Unit: scope/instructions guard, 70%/69% trigger, single-flight id,
restore equality, UI menu + restore.
Live: L-A9 PASS tries=1 in24845/out19559 on the final
run (bug 15: fixture restructured after 2 non-shrinking
compactions - 340 identical "decisions" fought the keep-every-
decision instruction; now 3 distinct decisions + explicit
filler at identical volume). Auto-compacted below 70%,
scope/instructions/blocks identical, no numbers lost, restore
exact, manual route works.

### A10 Rewrite with a direction
Changed: `POST .../rewrite` creates `Context rewrite: <instruction>`
chat with purpose + first owner message; `systemPrepend` brief for
rewrite chats; proposal stays pending.
Unit: route creates session/settings/sends; prepend for rewrite
purpose only; dialog flow.
Live: L-A10 PASS tries=1 in12172/out1166 - new titled
session, exactly one pending proposal, commercial weight
visibly shifted, context unchanged until approval.

### A11 Full viewer
Changed: frontend only - Open full view button, large overlay with
version/token caption, chat-variant Markdown of the API markdown,
Copy as Markdown + Close footer.
Unit: opens with all six headings; copy works.
Live: B4 step 6 PASS (light + dark shots opened,
formatted document with all sections + file block, v2 503
tokens).

### A12 Agents ask to update context
Changed: sector preload sentence nudging `db.propose_global_context`
for durable directions, never claiming application.
Unit: prompt contains the sentence for sector sessions only.
Live: L-A2/A12 PASS tries=1 in23530/out2283 (shared
with A2).

### A13 Sector read tools
Changed: `db.get_sector_plan`, `db.get_research_progress`,
`db.list_sector_sessions`, `db.read_sector_thread` (viewer, both
palettes + PRODUCT_TOOLS for the stacking contract; server-side
identity still denies Karbot). Isolation exemption for
`db.read_sector_thread` except subagent actors; hidden-file rules
via `assertThreadFileContext`. Tool labels added.
Deviation: the four also ride PRODUCT_TOOLS (stacking contract:
`sectorMcpClient` sits over `productMcpClient`, so SECTOR_TOOLS must
survive the Karbot palette like `db.get_local_context`).
Unit: per-tool cross-sector denial, sibling + subagent reads,
subagent-actor denial, palette pins (89 tests across authority, tools,
karbot.turn).
Live: L-A13 PASS tries=1 in33597/out4737 -
plan/progress/sibling/subagent reads recorded, reply
contains Coastline Electrical.

### A14 @chat
Changed: `[[session:id|title]]` markers (never `@name`, which routes
to subagents); research-turn validation + preload + same-turn palette
narrowing via grant freeze; composer Chats group; chips in sent
bubbles (textarea cannot render chips).
Unit: marker parsing, unknown-id note, palette exclude/include
across turns, listbox + chip rendering (4/4 backend + frontend).
Live: L-A14 PASS tries=1 in49063/out7605 - turn 1
reads the sibling with the plan tool absent from the request
palette and version unchanged; turn 2 bumps the plan.

### A15 Spawn with inheritance
Changed: `thread_context.inherited` (0024); `buildInheritedContext`
(summary + last 20, 12k cap, oldest dropped first); `onAccepted`
seam writes inheritance between acceptance and goal;
`POST /v1/sessions/:id/subagents` (operator, 50 cap as 409);
preload every round; spawn dialog UI.
Unit: builder caps/order, write-before-goal call order, preload pin,
route roles; UI 3/3.
Live: L-A15 PASS tries=3 in89647/out19015 (bug 14:
first two parent-written goals sent the child to global
context instead of its brief; test now pins every child's
stored `inherited` column and loops the reply check). Final
child replies HARBOUR-42; owner child first-try.

### A16 Pause/resume subagent
Changed: `thread_control` (0024); `childPause`/`childResume` + loop
gate (`subagent-pause-v1`); mid-turn park at the round boundary via
`resumableTurn` `parkPause` with checkpoint resume (children never
parked ResearchPaused before - would have failed); gateway accepts
`subagentRun`; PAUSED header via projector events; UI on
strip/directory/dock + badge.
Unit: workflow pause/resume 2/2, DB 3/3, UI 2/2.
Live: L-A16 PASS tries=1 in18914/out5580 on re-run
(bug 16: first attempt's post-resume generation hit the 60 s
round timeout 3x in a provider slow window; pause, 60 s
freeze, sibling progress and resume signal all held). Final
run 115 s, resume completed the goal.

### A17 Queue view/edit
Changed: `{id, text, queuedAt}` inbox items in both workflows
(`inbox-ids-v1`, legacy wrap); `queueItems` query,
`queueRemove`/`queueReorder` updates (exact-set else QueueMismatch);
gateway list/remove/reorder; routes GET/DELETE/POST (viewer,
operator, operator; 404 idle); Collapsible disclosure polling every
3 s while busy, optimistic + error-toast revert.
Unit: workflow list/remove/reorder/order-follows 2/2, routes 4/4,
UI 3/3.
Live: L-A17 PASS tries=1 in12597/out1849 - listed 3,
removed TWO, swapped to THREE/ONE, replies arrived in the
new order.

### A18 Stop controls
Changed: backend reuses `cancelRun`. UI: header Stop while a turn
runs, Stop on every running workspace subagent row (strip +
directory), Runs already had it - all with "Stop this agent?"
confirm + "Stopped" toast. Karbot dock keeps its existing
confirm-less stop (Karbot out of scope).
Unit: component surfaces 5/5, run-id mapping hook tests 3/3.
Live: L-A18 PASS tries=1 in0/out0 - no further provider requests
after stop (cancelled turns record no responses); session shows
'run cancelled', child completion status 'cancelled'.

### A19 Landing basics
No new feature. Live: L-A19 PASS tries=1 in0/out0
(no AI) - consistent draft sector, empty companies, progress
and runs read back.

### A20 Documentation
Updated: `documentation/sector-workspace.md` (contract + decisions),
`agents-context.md` (sections/blocks/budget/compaction/switch/
inheritance), `agents-subagents.md` (spawn/pause/queue),
`documentation/mcp.md` (tools + plan lock), `documentation/db.md`
(binding), `documentation/tests.md` (live command),
`docs/implementation-status.md`, `tests/frontend/coverage-registry.md`
(GC-08..GC-14, WS-13/14, CH-23, AG-10/11/12). Inventories
regenerated after migration additions. This handoff.

## 4. Live browser walkthrough

GREEN final run (`1 passed (2.8m)`), spec
`tests/frontend-e2e/live/sector.live.spec.ts` (KARDATA_LIVE_UI=1, B2
stack, 1440 light + dark viewer). All 16 shots opened and confirmed
by hand against the claim in the third column (uncommitted under
`tests/evidence/sector-backend-v1/`). (Run 12 went green on
pre-round-4 code; this run re-proves round-4 code, including the
fix-1 v4-keeps-Scope proof and the b4-13 human-name re-shoot.)

| Step | Shot | Confirmed in the opened shot |
|---|---|---|
| 1 Create sector | b4-01 | Landing "Live walkthrough", Draft badge, topic, stat tiles, "Sector created" toast |
| 2 Open workspace | b4-02 | Research tab, "No subagents yet", Files 0, context v0 "6 of 30,000", six sections |
| 3 Upload md+pdf | b4-03 | Both files listed, report.pdf Indexed, model muse-spark-1.3-contributor High |
| 4 md to context | b4-04 | "In global" badge, context v1 "465 of 30,000", FILES row 465 tokens |
| 5 Token bar | b4-05 | "465 of 30,000 tokens" caption + progress bar |
| 6 Full viewer | b4-06-light/dark | Dialog "Global context v2 503 tokens", formatted document, block Overview/Key facts with exact figures (42 shops, $3,200, 12.5%, 96/1,000, 1,240, 3-6k USD, 2,000 hrs, 15%), Copy + Close |
| 7 Remove block | b4-07 | Badge gone, context v3 "38 of 30,000", "Removed market-notes.md" toast |
| 8 Chat reply | b4-08 | User bubble + real agent reply ("Used 1 tool", Reasoning, service-contract answer) |
| 9 Proposal+approve | b4-09 | Agent proposed + "pending owner approval", approved to v4: SCOPE INTACT ("Electrical contractors on the coast."), Instructions holds the 50-staff direction (fix-1 proof) |
| 10 Switch off | b4-10 | More menu "Use global context" switch off, "Global context off" chip, toast |
| 11 Rewrite chat | b4-11 | Landed in "Context rewrite: Give more weight to commercial customers", Chats (1) |
| 12 @chat | b4-12 | @-mention chip in bubble, agent read the chat ("Used 5 tools"), advises + asks to confirm, plan unchanged, "1 update waiting for review" |
| 13 Subagent | b4-13 | Strip "Subagent 1" (human name, re-shoot) with pause/stop, "View all 1", rewrite agent's proposal summary |
| 14 Queue | b4-14 | Fresh chat busy (Steer/Queue/Stop, "Thinking 3s"), PEAR queued behind the guide request |
| 15 Stop | b4-15 | "Stopped" toast, composer idle, no guide reply |

Runs 1-11 failed for wedges, each fixed: theme click behind the
viewer modal (close/reopen), switch PATCH blocked by CORS preflight
(bug 4), menu overlay intercepting the chip (Escape), drain races in
14/15 (restart loops), `banner` landmark missing (scope to `main`),
rewrite chat never staying busy (fresh normal chat for 14/15),
model skipping the step-9 proposal some runs (3-tries loop per B3
rules), and the cross-sector id collision (bug 6, real product bug).
The final round's first attempt died at step 1 on the poisoned
projector (bug 17: 4 orphan events from the bug-13 battery wedged
every route at 500); after the checkpoint skip + zombie clear,
the re-run went green first try.

## 5. Spend (FINAL - every number from green runs, aiUsage included)

Provider tokens from execution records, plus background calls
(`sector.context.ai_usage` events, which survive file removal):

| Test | Tries | Input | Output |
|---|---|---|---|
| L-A19 | 1 | 0 | 0 |
| L-A3 | 1 | 11205 | 952 |
| L-A1 | 1 | 17736 | 3214 |
| L-A4/A5 | 1 | 16238 | 1124 |
| L-A6 | 1 | 1095 | 5156 |
| L-A7 | 1 | 3587 | 160 |
| L-A8 | 1 | 566 | 2704 |
| L-A9 | 1 | 24845 | 19559 |
| L-A10 | 1 | 12172 | 1166 |
| L-A2/A12 | 1 | 23530 | 2283 |
| L-A13 | 1 | 33597 | 4737 |
| L-A14 | 1 | 49063 | 7605 |
| L-A15 | 3 | 89647 | 19015 |
| L-A16 | 1 | 18914 | 5580 |
| L-A17 | 1 | 12597 | 1849 |
| L-A18 | 1 | 0 | 0 |
| L-PLAN | 1 | 30529 | 7982 |
| L-LOCAL | 1 | 105394 | 3883 |
| B4 final | n/a | 59224 | 13797 |

Backend live subtotal: in450715/out86969. B4: execution
in58658/out10178 (14 responses, 2 sessions) + aiUsage in566/
out3619 (the md summary, recorded permanently despite step 7
removing the file - bug 4 fix working). The stopped "New
conversation" turn recorded no responses, like L-A18.

GRAND TOTAL: in509939/out100766, 610705 tokens.

Failed attempts (all root-caused in section 6; spend from
dropped per-suite DBs is unrecorded, stated not silent):
poisoned battery L-A3/L-A1 (2 + 4 rounds, bug 13); L-A9
non-shrink x2 + attempt-3 hang (bug 15); L-A16 3x round
timeout (bug 16); L-PLAN 2x3 round timeouts (bug 16). The
B4 first attempt made no AI calls (died at sector create
on the 500s). Superseded pre-round-4 campaign numbers are
dropped; every row above is final-code green.

## 6. Bugs found while testing

1. Subagent children never parked ResearchPaused (mid-turn pause
   would have failed the turn). Fixed with `parkPause` +
   checkpoint resume. Tests: `workflows.subagent-pause.test.ts`,
   `subagent-pause.test.ts`.
2. Compaction prompt returned section arrays instead of strings.
   Fixed with explicit shape + strip + normalize. Tests:
   existing compaction suites + L-A9 live.
3. Planning brief produced a valid spec fenced as ```json, failing
   artifact parsing. Fixed by naming the exact ```research-plan
   fence. Tests: `workflows.plan-brief.test.ts` + L-PLAN live.
4. CORS preflight omitted Idempotency-Key, killing every keyed
   staging-UI mutation cross-origin (same-origin production masked
   it). Fixed in `backend/src/http/cors.ts`. Tests:
   `api.cors.test.ts` + B4 step 10 live.
5. Live-test setup gaps (test-side, not product): DB `createSector`
   defaults to `queued` (plan paths need planned/draft); giant
   single blobs trip the deliberate short-history compaction
   refusal (now unit-pinned in `agents/src/compaction.test.ts`).
6. Context-change ids were namespaced `<keyId>:<key>`, so the same
   model-generated idempotency key in two sectors collided on the
   global id (`conflict: context change id collision`). It killed
   B4 step 9 in two runs: the model proposed correctly, the server
   rejected it. Fixed to `<sectorId>:<keyId>:<key>` in
   `backend/src/mcp/tools.ts`. Tests: new cross-sector same-key
   case in `mcp.authority.test.ts` (both pending, distinct ids,
   same-sector retry replays) + B4 run 12 green.
7. Proposal wipe (Claude round 4, blocker): approving an agent
   proposal that filled only Instructions wiped the other four
   sections (B4 v4 kept Instructions only). Proposals now use
   PATCH semantics: partial sections merge onto current at
   creation, explicit '' clears, no-op proposals are rejected,
   approval still applies the complete merged document, and the
   GC-06 diff (already changed-only) shows just real changes.
   Tests: 3 new cases in `global-context.test.ts` (merge,
   clear, no-op rejection). Live proofs pending suite approval:
   L-A2/A12 re-run + B4 step 9 (v4 keeps Scope).
8. Subagent strip/directory showed raw `child-<uuid>` (Claude
   round 4): the V2 launch payload carried the name but the
   projector ignored it. `SubagentLaunchedV2` now takes an
   optional name, the projector prefers it (childId fallback for
   legacy), and `db.delegate_subagent` defaults parent-spawned
   children to `Subagent N` like the owner route. Strip,
   directory and dock share `subagentDisplayName` (positional
   fallback); raw keys survive only in tooltips. Tests: V2
   projection case in `threads.test.ts`, 2 strip/directory cases
   in `subagent-spawn.test.tsx`. b4-13 re-shoot pending suite
   approval.
9. `@chat` composer showed raw `[[session:id|title]]` while
   typing (Claude round 4). Picking now inserts `@title`, the id
   mapping lives in composer state (pruned when its text is
   deleted, reset per thread by the keyed remount), and send
   expands to markers via a new optional `send(steer, text)`
   override (missed/failed restores keep the display draft).
   Tests: 3 cases in `chat-refs.test.tsx` (insert, expand,
   drop-on-delete) + neighbors green.
10. Background AI spend died with file removal (Claude round 4):
    summary/compaction token counts lived only on the block row.
    Every call now records a `sector.context.ai_usage` event
    (kind, fileId, tokens, model; per-attempt idempotency key,
    zero-spend skipped) that is never deleted, and
    `usage.aiUsage` sums it for the spend total. Tests: record/
    read/dedup/survives-removal case in
    `api.context-files.test.ts`.
11. Token-usage trigger below the touch-target floor (full
    Playwright re-run): the A8 usage popover trigger measured
    327x26 against the audit 32px minimum (40px on coarse
    pointers). The trigger now centers its content in
    `min-h-8` (`min-h-10` below 481px). Tests: the 12
    `audit-workspace-*` views green.
12. Subagent strip crushed at 390px (full Playwright re-run):
    the A15/A16/A18 strip additions (pause/stop per chip, "New
    subagent") squeezed chip buttons to 24px wide in the
    iPhone-context audit (desktop-390 skips the targets check,
    which is why only the mobile run caught it). The strip
    now wraps and each chip keeps `min-w-36 flex-1`, so chips
    take their own line instead of crushing. Follow-up in the
    same run: the chips container kept `min-w-0`, so at 390 it
    squeezed below the 144px chip floor and overflowing pause
    buttons covered "View all 6" (SA-02 click timeout). The
    container now keeps `min-w-60`, forcing a clean wrap at
    every width. Tests: the same
    12 audit views green (visually confirmed crushed before,
    wrapping after, in `WS-audit-default-mobile-light-390`).
    Test-side fixes in the same run (expectations, not
    product): CP-02 scopes Stop to the composer tabpanel (A18
    added a second header Stop by design), WS-07 matches Pause
    exactly (A16 added `Pause <name>` row buttons), FL-02
    scopes to the file row (A6 added a second matching
    string), and `serveApi` mocks the new A6
    `POST .../global-context/files` route (PL-01).
13. B2 worker poisons the backend live battery (process, not
    product): the B2 stack worker polls the same `kardata-live`
    namespace and task queues as the in-process test workers. A
    battery launched while the B2 stack was up failed L-A3/L-A1
    with 480s reply timeouts: the B2 worker stole
    `appendEventActivity` for the test workflows and failed them
    with Postgres 23503 (suite sessions do not exist in its
    `kardata_live` DB), killing the workflows after the turns
    completed ok. Rule: never run the B2 stack concurrently
    with the backend live battery. The failed run burned 2
    real-Meta turns (2 + 4 rounds); all numbers in sections 3
    and 5 come from the clean re-run with the stack down.
14. L-A15 parent-spawn reply missed the code word twice
    (test-side, product exonerated): the parent-spawned child
    answered from global context instead of its inherited
    brief. A temporary probe proved the write was correct
    (parentThread == session, brief 297 chars containing
    HARBOUR-42); no code path wipes `inherited` (all upserts
    selective, projector never touches it); injection is
    shared with the passing owner-spawned child. The parent
    model wrote goals directing the child at shared context.
    The test now asserts every spawned child's stored
    `inherited` column (deterministic AC proof) and loops the
    reply check across up to 3 spawned children per B3.
    Green on re-run, tries=3.
15. L-A9 fixture fought the compaction prompt (test-side): 340
    identical "decisions" read as 340 keep-worthy decisions, so
    the model returned non-shrinking output twice ("Compaction
    did not shrink"), then attempt 3 stalled past StartToClose.
    Restructured to 3 distinct decisions + explicit filler at
    identical volume (20KB/22.4KB/3KB, same 120 number tokens);
    findings/questions fillers reworded as explicit no-new-facts
    restatements. Same product assertions, unambiguous
    duplicates. Green on re-run, tries=1.
16. Provider slow window killed long generations (infra, not
    product): L-A16's post-resume analysis and L-PLAN's plan
    turn each hit the pre-existing 60 s per-round total timeout
    3x consecutively (zero streamed deltas in the failed
    attempts), failing the activity/workflow while shorter turns
    around them passed. Mechanics verified correct in both
    (pause/freeze/sibling/resume-signal/checkpoint; plan-run
    flow). Both green on re-run (L-A16 115 s, L-PLAN 113 s,
    tries=1). Follow-up: consider a longer round budget for
    known-long generations (plan briefs); out of scope here.
17. Poisoned projector wedged every B2 route (test-DB hygiene):
    the bug-13 battery's B2 worker appended 4 suite-DB message
    events (seqs 795/798/801/804) into `kardata_live.events`;
    `projectNewEvents` FK-crashed on the missing threads and
    every projecting route returned 500, killing the first B4
    attempt at step 1. Fixed with zero deletion: terminated the
    93 zombie test workflows in `kardata-live` (2 reconciliation
    singletons left), advanced ONLY the `threads-v1` checkpoint
    794 -> 804 (orphan rows preserved as evidence), projector
    caught up on seq 807. B4 re-run green first try. Lesson:
    terminate live-namespace residue before reusing a live DB.

## 7. Blocked (FINAL)

None. Every A-item shipped, every live test passes, B4 green.

## 8. Follow-ups

- Sector research cancel (out of scope for A18).
- Karbot plan (out of scope for this plan).
- Exhaustive scenario testing (Phase 2, separate plan).
- Fence robustness: consider accepting an ExecutablePlan-shaped
  ```json block as a fallback instead of failing the plan run.
- (Fixed in sector-backend-v1.1, see section 10: planning
  turns, file summaries and compaction now get 180 s; chat
  keeps 60 s.)
- Live-namespace hygiene (bugs 13/17): terminate test-residue
  workflows before reusing a live DB; never run the B2 stack
  concurrently with the backend live battery.
- `sector-workspace` thousand-item render flaked its 5 s budget
  once mid-gate (772/772 on re-run); consider a targeted budget
  bump if it recurs.
- (Fixed in round 4: proposal PATCH semantics is bug 7,
  subagent names bug 8, @title composer bug 9, ai_usage spend
  bug 10.)

## 9. Self-review: the 10 weakest points (final)

1. B4 needed 12 runs pre-round-4 plus 2 in the final round (the
   first died on the poisoned projector, bug 17); a reviewer
   re-running B4 may still hit model variance (the step-9
   3-tries loop exists for exactly that) or a slow-provider
   window (bug 16).
2. Pre-round-4 live spend numbers are superseded and dropped;
   every row in section 5 is final-code green, but cross-campaign
   comparisons are gone.
3. L-A18 spend reads 0/0 (cancelled turns record no responses) -
   honest per the spend definition, but looks like missing data.
4. A13 PRODUCT_TOOLS deviation rests on the stacking argument; a
   stricter reviewer may want the tools out of the Karbot palette.
5. Auto-compaction's "no numbers lost" check is the same
   regex-based coverage as file blocks - robust for figures, blind
   to paraphrased facts.
6. Queue reorder's exact-set rule has no force path; a stale client
   must refresh and retry.
7. Pause mid-turn parks at the round boundary, not instantly; a
   long provider round keeps burning tokens until it lands.
8. Inheritance cap (12k) silently drops old parent messages; the
   child never learns what was cut.
9. `@chat` renders `@title` in the composer (id mapping in
   composer state, expanded on send) and chips in bubbles; the
   old raw-marker complaint is fixed.
10. Screenshots are asserted by hand (opened, not pixel-pinned);
    visual regressions rely on future eyes.

## 10. Follow-up sector-backend-v1.1 (two fixes, on main)

Branch `sector-backend-v1.1` (from `main @ 66ba3ce`).
Commit: `18f81a4` (fixes + docs; this hash recorded by a
follow-up commit).
Never pushed, never merged (merge needs the owner).

### Fix 1: subagents use inherited context, reliably

Before, the parent-spawned child in L-A15 ignored its inherited
brief on 2 of 3 tries. The inherited text now rides as the FIRST
preload entry, immediately after the system prompt and before
global context, under the heading `Context from your parent
conversation (authoritative for anything said there)` with the
rule "If the goal refers to something from the parent
conversation, answer from this context first."
(`backend/src/temporal/activities/turn.ts`, `loadInheritedContext`;
pinned/preload order `[...inherited, ...preload, ...sectorRefs]`.)
The `db.delegate_subagent` tool description now tells parent
agents to write self-contained goals and never point children at
global context for conversation facts.
(`backend/src/mcp/tools.ts`.) Spec:
`documentation/agents-context.md`.

Unit (failing first, then green): `tests/backend/karbot.turn.test.ts`
+ `tests/backend/subagent-delegate.test.ts`, 47/47 pass,
including multi-round ordering vs refreshed refs and initial-load
ordering vs sector refs.

Live proof (L-A15 with ONE child per run, 5 runs; pass bar 4/5
parent + 5/5 owner):

| Run | Owner child | Parent child | tries | input | output |
|---|---|---|---|---|---|
| 1 | code word | code word | 1 | 35841 | 4461 |
| 2 | code word | code word | 1 | 47274 | 5930 |
| 3 | code word | code word | 1 | 49518 | 13484 |
| 4 | code word | code word | 1 | 40724 | 10642 |
| 5 | code word | code word | 1 | 41096 | 8570 |

5/5 on both legs. Fix 1 live spend: input 214453,
output 43087.

### Fix 2: 180 s budget for planning turns, summaries, compaction

The 60 s per-round total timeout (bug 16) lives in
`agents/src/turnRunner.ts` (`DEFAULT_TIMEOUT_MS`, applied per
provider call in the round loop); the turn activity never passed
`timeoutMs`, so every turn shared it. `turnRoundTimeoutMs` in
`backend/src/temporal/activities/turn.ts` now chooses per turn
kind: sectorPlan workflow `plan:*` runKeys and research-session
turns get 180 s (`PLANNING_ROUND_TIMEOUT_MS`); chat turns keep
60 s. File-summary and compaction calls funnel through one chat
helper, now wrapped with `chatWithTimeout` at 180 s
(`CONTEXT_FILE_CALL_TIMEOUT_MS` in
`backend/src/temporal/activities/context-files.ts`). Chat and
planning share the same runner timeout; chat stays at 60 s by
choice, not by mechanism. Spec:
`documentation/agents-providers.md`.

Unit (failing first, then green):
`tests/backend/karbot.turn-timeout.test.ts` (7 tests: pure
chooser per kind + a `runKarbotTurn` spy proving the wired
value) and 3 `chatWithTimeout` cases in
`tests/backend/context-files.test.ts` (180 s default,
passthrough, abort on budget). Focused files:
`karbot.turn` + `subagent-delegate` + `context-files` +
`karbot.turn-timeout` = 67/67 pass; backend typecheck clean.

Live proof (L-PLAN 3 times in a row, all must pass):

| Run | Result | Test time | tries | input | output | slowest round |
|---|---|---|---|---|---|---|
| 1 | pass | 161.0 s | 1 | 38390 | 10416 | 27.7 s |
| 2 | pass | 139.0 s | 1 | 28467 | 9435 | 15.9 s |
| 3 | pass | 110.2 s | 1 | 31924 | 7910 | 19.1 s |

3/3 pass. Honest note: these ran in a fast window (slowest
single round 27.7 s, under the old ceiling), so they prove the
180 s path works end to end, not that the old ceiling tripped.
The motive stands on bug 16 (60 s timeouts seen in a slow
window) plus a 50.9 s slowest round seen on an older L-PLAN DB.
Fix 2 live spend: input 98781, output 27761.

Environment note: run 1's first attempt died mid-run when the
whole docker daemon restarted (`kardata-db-1`/`kardata-temporal-1`
have restart policy `no` and stayed down; backend/worker
crash-looped). `docker start` on those two containers restored
the stack (volumes untouched); all services healthy before the
re-run. That attempt does not count in the 3/3.

Follow-up live spend total: input 313234, output 70848.
