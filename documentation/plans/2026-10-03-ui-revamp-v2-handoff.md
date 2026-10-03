# Kardata UI/UX Revamp v2: completion handoff (2026-10-03)

Branch: `ui-revamp-v2` (from `codex/ui-revamp-complete` @ `709cfa2`).
Committed, not pushed, not merged. Evidence local (untracked) in
`tests/evidence/ui-revamp-v2/` (`before/`, `stage5/`, `stage6/`,
`stage7/`, `stage8/`).

## 1. Summary: what changed

Foundations (stage 1): section-2 design tokens in `index.css` (opaque
soft fills, sidebar tokens, status scale, radius/duration tokens),
system/light/dark theme with no-flash inline script, text.tsx primitive
scale (PageTitle 20/28 down to Overline/Kbd), 19 restyled ui wrappers,
ListRow inset-hover recipe, motion token system (120/180/240), icon map
+ IconButton, sonner toasts, cmdk palette, TanStack DataTable, shared
ResourceState, humanized labels. One e2e support kit
(`tests/frontend-e2e/support/`: fixtures/api/shot/audit/color).

Shell + Overview + Researches (stage 2): single `max-w-page` page frame
with PageHeader (breadcrumbs replace every "Back to Overview");
Supabase-like sidebar (sliding active indicator, persisted collapse,
disabled Emails + Soon badge); TopBar with palette trigger, Ask Karbot,
theme menu (Overview search removed); Overview stat tiles with count-up
and pre-filtered links; recent-sectors/companies panels; Researches
underline tabs with counts, toolbar with URL-persisted filters,
DataTable sectors/companies with server paging and stacked 390 cards;
New-sector dialog (single App-owned instance).

Sector landing (stage 3): breadcrumb header with status badge, meta
line, View-progress/Open-workspace actions; per-state status panel with
stat tiles and next-step hints; progress dialog with condensed plan;
new CompaniesSection (search + status select, 5s live poll, paging);
not-found/denied states; `?view=plan` deep link.

Workspace + conversation + Karbot (stage 4): 280/360 rail grid with
persisted right-rail hide and 1280/768 drawer breakpoints; session rail
header/segmented switch/list/new-chat/search; per-state workspace
header with labelled lifecycle actions; chat/plan tabs with
needs-approval dot; subagent strip + directory; shared `chat/`
conversation components (ThinkingRow, ReasoningDisclosure keyed by
message id, ToolActivity, ConversationEmpty, shared Composer) used by
both workspace and Karbot; rebuilt model picker on Base UI menu
(search, provider groups, effort submenu, Reasoning switch,
collision-aware, provider persist bug fixed); Karbot dock (440 sheet,
sessions menu, context popover, files view, full state coverage).

Plan + files + context + inspector (stage 5): plan header with version
badge and blocked-approval tooltip; at-a-glance tiles; PlanSteps
segmented-rail timeline (executable/running/long/390); brief timeline
with humanized headings + narrative-only notice; empty/planning states;
version history; 640 side-sheet edit dialog with grouped fields, live
counts, error summary, discard confirm; progress panel with counters
and searchable ledger; intake-review dialog; files rail (dropzone,
typed rows with preview-on-row-click, processing bars, optimistic
upload, preview dialog with section pager, retry dialog, truthful
paging); global context (overline blocks, pending list, edit/history/
review dialogs, dependency preview); local context sheet, operation
recovery, blocked/rebuild flows, execution inspector dialog.

Agents + models + emails + states (stage 6): agents header with
spinning refresh; alerts current/history toggle with humanized rows
and in-app navigation; runs DataTable with short-id copy, cancel
confirm, 5s poll; models session binding card, provider tiles with
selects/switch/save toast, full state coverage; Emails coming-soon
page; global not-connected/sector-not-found states (not-connected
boots a flag-off vite on 15175 inside its own spec).

Backend (stage 7): B1 calm-chat-prose Karbot prompt, B2
sector-identity preload block, B3 planningBrief format, B4 sweep junk
screening. Each failing-test-first; see section 5. Also repaired
v2-branch debt in the pinned backend inventories (ReasoningControl
parity entry + catalogue/acceptance regens).

Sweeps + docs (stage 8): section-6 sweeps green (radii/alpha/dashed/
min-h-19 grep checks, icons/type-usage/em-dash unit suites, full audit
matrix for hover/focus/targets/copy); docs updated
(`docs/design-system.md`, `documentation/frontend.md`,
`docs/frontend-verification.md`, `tests/frontend/coverage-registry.md`,
`documentation/tests.md`, `docs/implementation-status.md`); deep-check
inventories regenerated; full matrix + videos + this handoff.

Review round (external review of the handoff + screenshots, all
addressed): nested brief steps are numbered instead of sharing one
icon (unit + e2e pins); Overview tile caption fixed (it counted
sectors from the 100-row window: "Across 1 sector" -> "Across 6
sectors", pinned) and the long thread rewritten as a real
conversation; markdown headings inside context sections render in
the label register; stale GC-06 reviews show a visible inline
warning above the actions (Approve stays disabled); SA-03 Karbot
subagents panel browser-captured (was unit-only); checklist
honesty pass (38 lines `PASS (opened)` against 25 distinct
screenshots + 12 video frames, 870 downgraded to
`NOT VISUALLY REVIEWED`, 2 stale WS-03 lines corrected); the
flagged FL-03 390px tuck-under resolved as a scroll artifact with
geometric proof + layout pin. Pre-v2 suite fully migrated (all 24
files green in the full matrix).

Review round 3 (also addressed): Karbot subagent rows show
humanized names (thread title or `Subagent N`, raw key in the
tooltip only) with one status each; the Karbot composer model
picker shows display name + effort like the workspace composer
(9 pre-v2 stub catalogs humanized so the real names show);
subagent rows moved to the shared ListRow recipe (review nit,
unit-pinned); SA-03 re-captured and re-opened. Separately, a
live send outage found during the run is fixed on this branch:
failed `karbot.turn` logs now carry the provider `errorDetail`
instead of swallowing the cause (stale workers had died on
Meta's 402 for the token-count endpoint before generating;
included in the stage 8 commit, containers rebuilt + verified
with a live send).

Commits on `ui-revamp-v2`:

- `9030720` UI v2 stage 0: setup
- `cbbf789` UI v2 stage 1: foundations
- `ee496d0` UI v2 stage 2: shell-overview-researches
- `dc6e097` UI v2 stage 3: sector-landing
- `0163993` UI v2 stage 4: workspace-conversation-karbot
- `f983266` UI v2 stage 5: plan-files-context-inspector
- `0ad4d31` UI v2 stage 6: agents-models-emails-appstates
- `941458a` UI v2 stage 7: backend B1-B4
- `7366d7d` UI v2 stage 8: sweeps, docs, e2e migration, handoff

How to view:

- Screenshots/videos/audit JSON: `tests/evidence/ui-revamp-v2/`
  (`before/` = pre-v2 captures, `stage8/` = final full-matrix set).
- Re-run browser proof: `cd frontend &&
  CHOKIDAR_USEPOLLING=1 KARDATA_E2E_PORT=15174 npx playwright test v2/`
  (fixtures only; there is no `npm run dev` against fixtures).
- Live app on the owner's 5173 with the real backend: check out
  `ui-revamp-v2` and reload.

## 2. Gates

Final gate run (2026-10-04 ~00:55 IST, branch `ui-revamp-v2`, Node
22, `KARDATA_E2E_PORT=15174`, `--workers=1`):

- `KARDATA_META_KEY= npm run pr:verify` — EXIT 0 (the `&&` chain
  reached the final build step). Full log (committed):
  `tests/evidence/ui-revamp-v2/stage8/pr-verify.txt`.
  - lint (all workspaces): 0 errors, 7 warnings
    (react-hooks/exhaustive-deps + 1 TS compile-skip note;
    pre-existing set, unchanged by this branch)
  - typecheck (agents/backend/frontend): clean
  - frontend unit: 81 files, 734 passed / 6 skipped
  - agents unit: 32 files, 281 passed / 2 skipped
  - backend unit: 86 files passed, 69 files skipped (live-gated),
    646 passed / 471 skipped, 0 failed
  - builds: agents + frontend clean
- Full Playwright suite — 485 passed / 22 skipped / 0 failed
  (37.1m, 507 total). Log (committed):
  `tests/evidence/ui-revamp-v2/stage8/full-run-final.txt`; archived
  `test-results/` (local only, gitignored):
  `stage8/full-run-final-results/` (217M). All 24 pre-v2 specs
  present and green; no coverage deleted in migration.
- v2 audit spec (`tests/frontend-e2e/v2/audit.spec.ts`) — 42/42
  green inside the full run (flagged slow file, 7.9m, no failure).

## 3. Before/after gallery

Before: `tests/evidence/ui-revamp-v2/before/`. After:
`tests/evidence/ui-revamp-v2/stage8/` (full-page audit captures at
1440; 390 column is the light mobile audit capture). All filenames
verified on disk.

| Page | Before | After light | After dark | After 390 |
|---|---|---|---|---|
| Overview | BEFORE-overview-default-light-1440.png | OV-audit-default-default-light-1440.png | OV-audit-default-default-dark-1440.png | OV-audit-default-mobile-light-390.png |
| Researches | BEFORE-researches-sectors-default-light-1440.png | RS-sectors-audit-default-default-light-1440.png | RS-sectors-audit-default-default-dark-1440.png | RS-sectors-audit-default-mobile-light-390.png |
| Sector landing | BEFORE-landing-default-light-1440.png | SL-audit-default-default-light-1440.png | SL-audit-default-default-dark-1440.png | SL-audit-default-mobile-light-390.png |
| Workspace chat | BEFORE-workspace-chat-default-light-1440.png | WS-audit-chat-default-light-1440.png | WS-audit-chat-default-dark-1440.png | WS-audit-chat-mobile-light-390.png |
| Workspace plan | (no BEFORE capture: `before/` has no workspace-plan PNG) | PL-audit-plan-default-light-1440.png | PL-audit-plan-default-dark-1440.png | PL-audit-plan-mobile-light-390.png |
| Karbot dock | BEFORE-karbot-default-light-1440.png | KB-audit-open-default-light-1440.png | KB-audit-open-default-dark-1440.png | KB-audit-open-mobile-light-390.png |
| Agents | BEFORE-agents-default-light-1440.png | AG-audit-default-default-light-1440.png | AG-audit-default-default-dark-1440.png | AG-audit-default-mobile-light-390.png |
| Models | BEFORE-models-default-light-1440.png | MO-audit-default-default-light-1440.png | MO-audit-default-default-dark-1440.png | MO-audit-default-mobile-light-390.png |

## 4. Component checklist blocks

(Evidence refs per ID. Format: section-3 block. `shot:` names are
`<ID>-<state>-<theme>-<width>.png` in `tests/evidence/ui-revamp-v2/`
(`stage5/` per-stage set, `stage8/` final full-matrix set). All shots
exist in light+dark x 1440+390 unless the ID notes otherwise.
Honesty marking (item 8): only lines marked `PASS (opened)` were
confirmed against pixels the agent opened; `NOT VISUALLY REVIEWED`
lines keep their citation for traceability but were verified only by
the green e2e/unit suite, never by eye. The full opened-file list is
in section 8.)

### PL-01 Plan header (file: plan/PlanTab.tsx, page: workspace Plan, parent: PlanTab)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked (CardTitle, Mono v2, badge, Caption)
 V2 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked (500 titles/badge only)
 V3 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked (tokens only)
 V4 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked (card header px-4 py-3, 8px action gap)
 V5 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked (title/meta left column, actions right)
 V6 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked (card rounded-lg)
 V7 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked (single card border)
 V8 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked ("Research plan", "Approve v2", no raw keys/dashes)
 V9 NOT VISUALLY REVIEWED shot: PL-01-planned/approved/blocked dark set (badge tones hold)
Interaction
 I1 N/A: header is not a hover row (no hover target) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: PL-01 focus state (Edit/Approve rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (button press is CSS active)
 I4 PASS test: plan-tab.test.tsx (buttons only clickable)
 I5 PASS test: plan-tab.test.tsx (Tab reaches actions, Enter activates)
 I6 N/A: no icon-only buttons (all actions labelled) shot: n/a
 I7 NOT VISUALLY REVIEWED shot: PL-01-blocked (aria-disabled + tooltip why)
States
 S1 N/A: header renders with the plan resource (no dedicated skeleton) shot: n/a
 S2 N/A: empty plan is PL-05 shot: n/a
 S3 N/A: no filtering shot: n/a
 S4 N/A: plan load errors render at the tab resource level shot: n/a
 S5 N/A: same as S4 shot: n/a
 S7 N/A: no paging shot: n/a
 S8 N/A: titles truncate via shared rules (no 120-char plan title state) shot: n/a
 S9 NOT VISUALLY REVIEWED shot: PL-01-planned (Approve pending while approving)
Motion
 M1 PASS (opened) video: PL-03-steps-enter (header rides the tab enter)
 M2 N/A: no unmount animation (page crossfade covers exit) video: n/a
 M3 NOT VISUALLY REVIEWED video: PL-03-steps-enter (badge/title swap is instant content)
 M4 PASS test: reduced-motion guard (no movement-only content)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-01 1440 + 390 sets (actions wrap, targets 40px at 390)
Accessibility
 A1 PASS test: plan-tab.test.tsx (heading order, one h1 per page)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 PASS test: plan-tab.test.tsx (approval outcome announced)
Evidence
 Unit test file(s): plan-tab.test.tsx, research-plan-editor.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-01-planned/approved/blocked
 Screenshots: PL-01-planned/approved/blocked (L/D 1440/390)
 Videos: PL-03-steps-enter (enter), SH-08-page-transition (press/page)
 Verdict: DONE

### PL-02 Plan at a glance (file: plan/PlanTab.tsx, page: workspace Plan, parent: PlanTab)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-02-default/390 (Label + Numeric stat tiles)
 V2 NOT VISUALLY REVIEWED shot: PL-02-default/390 (500 stat values only)
 V3 NOT VISUALLY REVIEWED shot: PL-02-default/390 (tokens only)
 V4 NOT VISUALLY REVIEWED shot: PL-02-default/390 (16px grid gap, wrap on small)
 V5 NOT VISUALLY REVIEWED shot: PL-02-default/390 (tiles align in one row, numbers tabular)
 V6 NOT VISUALLY REVIEWED shot: PL-02-default/390 (tiles rounded-lg)
 V7 NOT VISUALLY REVIEWED shot: PL-02-default/390 (single card borders)
 V8 NOT VISUALLY REVIEWED shot: PL-02-default/390 ("Search directions", counts, no raw keys)
 V9 NOT VISUALLY REVIEWED shot: PL-02-default/390 dark set
Interaction
 I1 N/A: tiles are not links (read-only stats) shot: n/a
 I2 N/A: no focusables shot: n/a
 I3 N/A: no press state shot: n/a
 I4 PASS test: plan-tab.test.tsx (nothing clickable, no pointer)
 I5 N/A: no keyboard interaction shot: n/a
 I6 N/A: no buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: tiles render with the plan (no dedicated skeleton) shot: n/a
 S2 N/A: hidden when no executable work (parent decision) shot: n/a
 S3-S7 N/A: no filter/error/denied/paging of its own shot: n/a
 S8 N/A: counts only shot: n/a
 S9 N/A: no pending action shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: PL-03-steps-enter (tiles stagger with the tab)
 M2 N/A: no unmount animation video: n/a
 M3 N/A: values render once (no live change animation) video: n/a
 M4 PASS test: reduced-motion guard
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-02-default + PL-02-390 (wrap, no scroll)
Accessibility
 A1 PASS test: plan-tab.test.tsx (tiles are text, not headings)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 N/A: static values (no async update) test: n/a
Evidence
 Unit test file(s): plan-tab.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-02-default/390
 Screenshots: PL-02-default, PL-02-390 (L/D)
 Videos: PL-03-steps-enter (enter)
 Verdict: DONE

### PL-03 Steps timeline (file: plan/PlanSteps.tsx, page: workspace Plan, parent: PlanTab)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (CardTitle + Caption meta + BodySm)
 V2 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (500 titles only; bodies 400)
 V3 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (opaque medallions, soft tones by state)
 V4 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (32px medallions, 4px grid gutters)
 V5 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (medallion column aligned, meta right-aligned tabular)
 V6 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (step cards rounded-lg, medallions pill)
 V7 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (2px segments between medallions, never crossing)
 V8 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries (direction titles, "Show more", no raw keys)
 V9 NOT VISUALLY REVIEWED shot: PL-03-executable/running/long-queries dark set (rail stops at medallion edges both themes)
Interaction
 I1 N/A: steps are not hover rows shot: n/a
 I2 NOT VISUALLY REVIEWED shot: PL-03 focus ("Show more", Start research rings)
 I3 NOT VISUALLY REVIEWED video: PL-03-steps-enter (Start research press)
 I4 PASS test: plan-steps.test.tsx (only controls clickable)
 I5 PASS test: plan-steps.test.tsx (Tab order, Enter/Space)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state (Start hidden unless approved) shot: n/a
States
 S1 N/A: planning skeleton is PL-05 shot: n/a
 S2 N/A: no-steps notice is PL-04 shot: n/a
 S3 N/A: no filtering shot: n/a
 S4-S6 N/A: plan load errors at tab level shot: n/a
 S7 N/A: no paging shot: n/a
 S8 NOT VISUALLY REVIEWED shot: PL-03-long-queries (300-char queries wrap, no truncation)
 S9 N/A: no pending button (Start navigates) shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: PL-03-steps-enter (steps stagger in)
 M2 N/A: no unmount animation video: n/a
 M3 NOT VISUALLY REVIEWED video: PL-03-steps-enter (Show more height animation; running pulse)
 M4 PASS test: reduced-motion (static ring, instant expand)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-03-executable + PL-03-390 (rail holds at 390)
Accessibility
 A1 PASS test: plan-steps.test.tsx (heading order under plan h2)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 N/A: static render (progress polls update PL-08, not the steps) test: n/a
Evidence
 Unit test file(s): plan-steps.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-03-*, v2/motion.spec.ts PL-03-steps-enter
 Screenshots: PL-03-executable/running/long-queries/390 (L/D)
 Videos: PL-03-steps-enter
 Verdict: DONE

### PL-04 Plan brief (file: plan/PlanSteps.tsx, page: workspace Plan, parent: PlanTab)
Visual
 V1 PASS (opened) shot: PL-04-brief/narrative-only/new-format (humanized titles + compact bodies)
 V2 NOT VISUALLY REVIEWED shot: PL-04-brief/narrative-only/new-format (500 section titles only)
 V3 NOT VISUALLY REVIEWED shot: PL-04-brief/narrative-only/new-format (tokens only)
 V4 PASS (opened) shot: PL-04-brief/narrative-only/new-format (PlanSteps medallion rhythm)
 V5 PASS (opened) shot: PL-04-brief/narrative-only/new-format (medallion column aligned)
 V6 NOT VISUALLY REVIEWED shot: PL-04-brief/narrative-only/new-format (rounded-lg section cards)
 V7 PASS (opened) shot: PL-04-brief/narrative-only/new-format (segmented rail, no crossing)
 V8 PASS (opened) shot: PL-04-brief/narrative-only/new-format ("Search directions", "Budget and limits", B3 Goal/Steps)
 V9 PASS (opened) shot: PL-04-brief/narrative-only/new-format dark set
Interaction
 I1-I7 N/A except Edit action: brief is read-only; notice action is a labelled button (I2/I4/I5 PASS via plan-steps.test.tsx) shot: PL-04-narrative-only
States
 S1-S7 N/A: brief renders with the plan; no dedicated skeleton/filter/error/paging shot: n/a
 S8 NOT VISUALLY REVIEWED shot: PL-04-brief (900-char instructions clamp with Show more)
 S9 N/A: no pending action shot: n/a
Motion
 M1 PASS (opened) video: PL-03-steps-enter (brief rides the tab enter)
 M2 N/A: no unmount animation video: n/a
 M3 NOT VISUALLY REVIEWED video: PL-03-steps-enter (Show more height animation)
 M4 PASS test: reduced-motion guard
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-04 set at 1440 + 390 (stacked, no scroll)
Accessibility
 A1 PASS test: plan-steps.test.tsx (section headings under plan h2)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 N/A: static render test: n/a
Evidence
 Unit test file(s): plan-steps.test.tsx, research-plan-editor.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-04-brief/narrative-only/new-format
 Screenshots: PL-04-brief/narrative-only/new-format (L/D 1440/390)
 Videos: PL-03-steps-enter (enter)
 Verdict: DONE

### PL-05 Empty plan (file: plan/PlanTab.tsx, page: workspace Plan, parent: PlanTab)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-05-empty/planning (CardTitle + Description)
 V2 NOT VISUALLY REVIEWED shot: PL-05-empty/planning (500 title only)
 V3 NOT VISUALLY REVIEWED shot: PL-05-empty/planning (muted medallion, tokens only)
 V4 NOT VISUALLY REVIEWED shot: PL-05-empty/planning (empty anatomy py-12, mt-3/mt-1/mt-4)
 V5 NOT VISUALLY REVIEWED shot: PL-05-empty/planning (centred column)
 V6 NOT VISUALLY REVIEWED shot: PL-05-empty/planning (medallion pill)
 V7 NOT VISUALLY REVIEWED shot: PL-05-empty/planning (no border, no dashed box)
 V8 NOT VISUALLY REVIEWED shot: PL-05-empty/planning ("No research plan yet", one sentence + action)
 V9 NOT VISUALLY REVIEWED shot: PL-05-empty/planning dark set
Interaction
 I1 N/A: empty has no hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: PL-05 focus (Create plan ring)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (primary press)
 I4 PASS test: plan-tab.test.tsx (Create plan clickable)
 I5 PASS test: plan-tab.test.tsx (Tab + Enter)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: PL-05-planning (PlanSteps skeleton + drafting caption)
 S2 NOT VISUALLY REVIEWED shot: PL-05-empty (medallion, title, one line, one primary)
 S3-S7 N/A: no filter/error/denied/paging shot: n/a
 S8 N/A: fixed copy shot: n/a
 S9 NOT VISUALLY REVIEWED shot: PL-05-planning (Create shows "Planning..." pending)
Motion
 M1 NOT VISUALLY REVIEWED video: PL-03-steps-enter (empty rides the tab enter)
 M2 N/A: no unmount animation video: n/a
 M3 N/A: skeleton swaps to steps on arrival (content swap, no animation) video: n/a
 M4 PASS test: reduced-motion guard (static skeleton)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-05 set at 1440 + 390
Accessibility
 A1 PASS test: plan-tab.test.tsx (empty title is not a page h1)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 PASS test: plan-tab.test.tsx (planning completion announced)
Evidence
 Unit test file(s): plan-tab.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-05-empty/planning
 Screenshots: PL-05-empty/planning (L/D 1440/390)
 Videos: PL-03-steps-enter (enter)
 Verdict: DONE

### PL-06 Version history (file: plan/PlanTab.tsx, page: workspace Plan, parent: PlanTab)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-06-open (Mono v2 + Caption date + badge)
 V2 NOT VISUALLY REVIEWED shot: PL-06-open (500 badge only)
 V3 NOT VISUALLY REVIEWED shot: PL-06-open (tokens only)
 V4 NOT VISUALLY REVIEWED shot: PL-06-open (dense rows min-h-9)
 V5 NOT VISUALLY REVIEWED shot: PL-06-open (version/date/status columns aligned)
 V6 NOT VISUALLY REVIEWED shot: PL-06-open (rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: PL-06-open (ListRow dividers)
 V8 NOT VISUALLY REVIEWED shot: PL-06-open ("Version history", status labels)
 V9 NOT VISUALLY REVIEWED shot: PL-06-open dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: PL-06-open (ListRow inset hover)
 I2 NOT VISUALLY REVIEWED shot: PL-06 focus (collapsible trigger ring)
 I3 N/A: expand is instant-appearing height animation (see M3) shot: n/a
 I4 PASS test: plan-tab.test.tsx (trigger clickable)
 I5 PASS test: plan-tab.test.tsx (Enter/Space toggle, Esc n/a)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1-S9 N/A except S7: no skeleton/empty/filter/error/paging; count caption covers S7 shot: PL-06-open
Motion
 M1 N/A: collapsible content has no mount enter (height animation only) video: n/a
 M2 N/A: collapse is instant (no exit choreography) video: n/a
 M3 NOT VISUALLY REVIEWED video: PL-03-steps-enter (collapsible height animation)
 M4 PASS test: reduced-motion guard (instant toggle)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-06-open at 1440 + 390
Accessibility
 A1 PASS test: plan-tab.test.tsx (trigger exposes expanded state)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 N/A: manual toggle (no async update) test: n/a
Evidence
 Unit test file(s): plan-tab.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-06-open
 Screenshots: PL-06-open (L/D 1440/390)
 Videos: PL-03-steps-enter (collapsible motion reference)
 Verdict: DONE

### PL-07 Edit plan dialog (file: ResearchPlanEditor.tsx, page: workspace Plan, parent: PlanTab)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 (CardTitle sections, Label fields, BodySm counts)
 V2 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 (500 labels/titles only)
 V3 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 (tokens only)
 V4 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 (640 sheet, 16px field gaps, sticky footer)
 V5 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 (two-column limits row aligned)
 V6 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 (sheet rounded-xl, direction cards rounded-lg)
 V7 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 (section dividers, single borders)
 V8 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 ("Edit research plan", helpers, no raw keys)
 V9 NOT VISUALLY REVIEWED shot: PL-07-open/errors/discard-confirm/390 dark set
Interaction
 I1 N/A: form has no hover rows shot: n/a
 I2 NOT VISUALLY REVIEWED shot: PL-07 focus (field + footer rings)
 I3 NOT VISUALLY REVIEWED video: PL-07-edit-discard (Save press)
 I4 PASS test: research-plan-editor.test.tsx (controls clickable)
 I5 PASS test: research-plan-editor.test.tsx (Tab order, Esc asks discard, arrows in selects)
 I6 N/A: no icon-only buttons (close is labelled X with tooltip: PASS shot PL-07-open)
 I7 NOT VISUALLY REVIEWED shot: PL-07-errors (invalid submit blocked with summary links)
States
 S1 N/A: dialog content is synchronous (draft loads with plan) shot: n/a
 S2-S3 N/A: no empty/filtered states shot: n/a
 S4 NOT VISUALLY REVIEWED shot: PL-07-errors (inline danger summary + field errors, focus moved)
 S5-S6 N/A: dialog requires the loaded plan (denied/offline at tab level) shot: n/a
 S7 N/A: no paging shot: n/a
 S8 NOT VISUALLY REVIEWED shot: PL-07-open (30-query textarea scrolls, counts live)
 S9 NOT VISUALLY REVIEWED shot: PL-07-open (Save pending, no double submit)
Motion
 M1 NOT VISUALLY REVIEWED video: PL-07-edit-discard (sheet enter 240ms)
 M2 NOT VISUALLY REVIEWED video: PL-07-edit-discard (sheet exit 180ms, discard confirm exit)
 M3 N/A: no state-change animation inside shot: n/a
 M4 PASS test: reduced-motion (opacity-only dialog)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-07-open + PL-07-390 (stacks, sticky footer holds)
Accessibility
 A1 PASS test: research-plan-editor.test.tsx (dialog title/description, focus trap)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 PASS test: research-plan-editor.test.tsx (error summary announced + focused)
Evidence
 Unit test file(s): research-plan-editor.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-07-*, v2/motion.spec.ts PL-07-edit-discard
 Screenshots: PL-07-open/errors/discard-confirm/390 (L/D)
 Videos: PL-07-edit-discard
 Verdict: DONE

### PL-08 Progress panel (file: workspace-parts.tsx PlanProgress, page: workspace Plan + SL-03 dialog, parent: PlanTab)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many (SectionTitle + Caption + stat tiles + ListRows)
 V2 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many (500 titles/counts only)
 V3 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many (status dots/tones, tokens only)
 V4 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many (counters row, list rows min-h-11)
 V5 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many (dot/title/badge/actions columns aligned, counts tabular)
 V6 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many (panel rounded-lg, rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many (ListRow dividers, progress track pill)
 V8 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many ("62% estimated", "Needs attention", humanized states)
 V9 NOT VISUALLY REVIEWED shot: PL-08-running/complete/attention/empty/filtered-empty/many dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: PL-08-running (ListRow inset hover)
 I2 NOT VISUALLY REVIEWED shot: PL-08 focus (search, rows, Review/source rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (Review press is CSS active)
 I4 PASS test: sector-workspace.test.tsx (rows Review/source clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Enter opens)
 I6 NOT VISUALLY REVIEWED shot: PL-08-running (Open-source IconButton labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: progress renders with the plan (panel-level skeleton at dialog) shot: n/a
 S2 NOT VISUALLY REVIEWED shot: PL-08-empty (labels-map empty per terminal state)
 S3 NOT VISUALLY REVIEWED shot: PL-08-filtered-empty (no matches + clear)
 S4 N/A: progress errors surface at the plan resource level shot: n/a
 S5-S6 N/A: same as S4 shot: n/a
 S7 NOT VISUALLY REVIEWED shot: PL-08-many (500 items, Show more with truthful counts)
 S8 NOT VISUALLY REVIEWED shot: PL-08-many (detail clamps, expands in place)
 S9 N/A: no pending button shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: PL-03-steps-enter (panel rides the tab enter; SL-03 dialog enter video)
 M2 N/A: no unmount animation (dialog exit covers SL-03) video: n/a
 M3 NOT VISUALLY REVIEWED video: SL-03-open-close (progress bar scaleX fill)
 M4 PASS test: reduced-motion guard (static bar)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-08 set at 1440 + 390 (counters wrap, rows hold)
Accessibility
 A1 PASS test: sector-workspace.test.tsx (Progress heading level)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 PASS test: sector-workspace.test.tsx (filter count aria-live)
Evidence
 Unit test file(s): sector-workspace.test.tsx, work-review.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-08-*, v2/motion.spec.ts SL-03-open-close
 Screenshots: PL-08-running/complete/attention/empty/filtered-empty/many (L/D 1440/390)
 Videos: SL-03-open-close (bar fill), PL-03-steps-enter (enter)
 Verdict: DONE

### PL-09 Intake review dialog (file: workspace-parts.tsx, page: workspace Plan + landing, parent: PlanProgress)
Visual
 V1 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 (CardTitle candidate/decision, Description reason, Mono attempts)
 V2 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 (500 titles only)
 V3 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 (tokens only, stale notice tone)
 V4 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 (880 dialog, two columns at 768+, stacks below)
 V5 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 (columns aligned, evidence rows inset)
 V6 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 (dialog rounded-xl, evidence rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 (single borders, collapsible dividers)
 V8 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 ("Review candidate intake", humanized states)
 V9 NOT VISUALLY REVIEWED shot: PL-09-open/stale/390 dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: PL-09-open (evidence ListRow hover)
 I2 NOT VISUALLY REVIEWED shot: PL-09 focus (textarea + action rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (decision press is CSS active)
 I4 PASS test: work-review.test.tsx (Retry/Exclude/Reload clickable)
 I5 PASS test: work-review.test.tsx (Tab order, Esc closes, focus returns)
 I6 N/A: no icon-only buttons shot: n/a
 I7 NOT VISUALLY REVIEWED shot: PL-09-stale (stale disables decisions with reason; draft kept)
States
 S1 N/A: receipt loads with the dialog trigger (dialog-level pending) shot: n/a
 S2-S3 N/A: no empty/filtered states shot: n/a
 S4 N/A: receipt errors keep the dialog open with notice (covered S7-stale pattern) shot: PL-09-stale
 S5-S6 N/A: denied/offline at tab level shot: n/a
 S7 N/A: no paging shot: n/a
 S8 NOT VISUALLY REVIEWED shot: PL-09-open (evidence list bounded, 4000-char reason count)
 S9 NOT VISUALLY REVIEWED shot: PL-09-open (decision pending, idempotency key retained)
Motion
 M1 NOT VISUALLY REVIEWED video: SL-03-open-close (dialog enter reference; same WorkspaceOverlay)
 M2 NOT VISUALLY REVIEWED video: SL-03-open-close (dialog exit reference)
 M3 N/A: no state-change animation shot: n/a
 M4 PASS test: reduced-motion (opacity-only dialog)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: PL-09-open + PL-09-390 (stacks, actions hold)
Accessibility
 A1 PASS test: work-review.test.tsx (dialog semantics, focus trap/return)
 A2 PASS test: audit contrast check on plan.spec pages
 A3 PASS test: work-review.test.tsx (decision outcome announced)
Evidence
 Unit test file(s): work-review.test.tsx
 Browser spec + test name(s): v2/plan.spec.ts PL-09-open/stale/390
 Screenshots: PL-09-open/stale/390 (L/D)
 Videos: SL-03-open-close (shared dialog motion reference)
 Verdict: DONE

### FL-01 Files header (file: workspace-parts.tsx WorkspaceFiles, page: workspace right rail, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-01-default/dragover (SectionTitle + Caption count)
 V2 NOT VISUALLY REVIEWED shot: FL-01-default/dragover (500 title only)
 V3 NOT VISUALLY REVIEWED shot: FL-01-default/dragover (tokens only; dropzone primary-soft)
 V4 NOT VISUALLY REVIEWED shot: FL-01-default/dragover (rail padding, 8px action gap)
 V5 NOT VISUALLY REVIEWED shot: FL-01-default/dragover (title/count left, actions right)
 V6 NOT VISUALLY REVIEWED shot: FL-01-default/dragover (dropzone rounded-lg)
 V7 NOT VISUALLY REVIEWED shot: FL-01-default/dragover (dropzone is the ONLY dashed border in the product)
 V8 NOT VISUALLY REVIEWED shot: FL-01-default/dragover ("Files", "Drop files to upload")
 V9 NOT VISUALLY REVIEWED shot: FL-01-default/dragover dark set
Interaction
 I1 N/A: header is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: FL-01 focus (upload/hidden-toggle rings)
 I3 NOT VISUALLY REVIEWED video: FL-01-drag-over (toggle press)
 I4 PASS test: sector-workspace.test.tsx (actions clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab + Enter/Space, arrows n/a)
 I6 NOT VISUALLY REVIEWED shot: FL-01-default (Upload + Show-hidden IconButtons labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: header renders with the rail (list skeleton below) shot: n/a
 S2-S7 N/A: header persists across list states (see FL-05/FL-08) shot: n/a
 S8 N/A: count only ("Showing 50 of 2,005 files" is FL-08) shot: n/a
 S9 N/A: no pending action shot: n/a
Motion
 M1 N/A: header is static chrome (dropzone overlay fades: see video) video: n/a
 M2 N/A: no unmount animation video: n/a
 M3 NOT VISUALLY REVIEWED video: FL-01-drag-over (dropzone overlay enter/exit)
 M4 PASS test: reduced-motion guard
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-01 set at 1440 + 390 (drawer holds)
Accessibility
 A1 PASS test: sector-workspace.test.tsx (heading level, toggle pressed state)
 A2 PASS test: audit contrast check on files.spec pages
 A3 PASS test: sector-workspace.test.tsx (hidden-toggle + count announced)
Evidence
 Unit test file(s): sector-workspace.test.tsx, workspace-files-scale.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-01-*, v2/motion.spec.ts FL-01-drag-over
 Screenshots: FL-01-default/dragover (L/D 1440/390)
 Videos: FL-01-drag-over
 Verdict: DONE

### FL-02 File row (file: workspace-parts.tsx, page: workspace right rail, parent: WorkspaceFiles)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types (BodySm name + Description meta)
 V2 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types (500 names only)
 V3 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types (sunken icon tiles, status badge tones)
 V4 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types (comfortable rows, 32px tiles)
 V5 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types (tile/name/meta/actions columns aligned)
 V6 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types (tiles rounded-md, rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types (ListRow dividers)
 V8 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types ("PDF · Uploaded · In global context", humanized)
 V9 NOT VISUALLY REVIEWED shot: FL-02-default/hover/included/hidden/long-name/types dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: FL-02-hover (ListRow inset hover; row is the preview target)
 I2 NOT VISUALLY REVIEWED shot: FL-02 focus (row + action rings)
 I3 NOT VISUALLY REVIEWED video: FL-06-preview (row press opens preview)
 I4 PASS test: sector-workspace.test.tsx (row + actions clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Enter previews)
 I6 NOT VISUALLY REVIEWED shot: FL-02-hover (context/hide IconButtons labelled + tooltip)
 I7 N/A: hidden rows simply do not preview (no disabled styling) shot: FL-02-hidden
States
 S1 N/A: list skeleton covers loading (row-level none) shot: n/a
 S2 N/A: empty list is FL-05 shot: n/a
 S3 N/A: no row filter (rail has no search) shot: n/a
 S4-S6 N/A: list errors at rail level; row failures are FL-03 badges shot: n/a
 S7 N/A: paging is FL-08 shot: n/a
 S8 NOT VISUALLY REVIEWED shot: FL-02-long-name/types (120-char truncate + tooltip; 6 type icons)
 S9 N/A: no pending action (upload is FL-04) shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: FL-01-drag-over (rows ride the rail enter)
 M2 N/A: no unmount animation video: n/a
 M3 N/A: badge swaps are instant content shot: n/a
 M4 PASS test: reduced-motion guard
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-02 set at 1440 + 390 (actions always visible on touch)
Accessibility
 A1 PASS test: sector-workspace.test.tsx (row button names, badge text)
 A2 PASS test: audit contrast check on files.spec pages
 A3 N/A: static rows (upload/hide toasts announce) test: n/a
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-02-*
 Screenshots: FL-02-default/hover/included/hidden/long-name/types (L/D 1440/390)
 Videos: FL-06-preview (row press opens preview)
 Verdict: DONE

### FL-03 Processing row (file: FileProcessingStatus.tsx, page: workspace right rail, parent: WorkspaceFiles)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review (Caption progress + 4px bar)
 V2 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review (400 only)
 V3 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review (track pill, tone by state)
 V4 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review (bar under Description, 4px grid)
 V5 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review (bar spans row width)
 V6 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review (track rounded-full)
 V7 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review (no borders)
 V8 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review ("Analysing images 4 of 9", "Review retry")
 V9 NOT VISUALLY REVIEWED shot: FL-03-processing/failed/needs-review dark set
Interaction
 I1-I5: bar is read-only; Review action is a labelled xs button (I2/I4/I5 PASS via file-processing.test.tsx) shot: FL-03-failed
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: processing IS the pending state shot: FL-03-processing
 S2-S3 N/A: no empty/filtered states shot: n/a
 S4 NOT VISUALLY REVIEWED shot: FL-03-failed (failed/paused/uncertain + Review retry)
 S5-S6 N/A: denied/offline at rail level shot: n/a
 S7 N/A: no paging shot: n/a
 S8 N/A: fixed captions shot: n/a
 S9 N/A: no pending button (processing is the state) shot: n/a
Motion
 M1-M2 N/A: bar renders with the row video: n/a
 M3 NOT VISUALLY REVIEWED video: FL-01-drag-over (determinate bar fill reference)
 M4 PASS test: reduced-motion guard (static bar)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-03 set at 1440 + 390
Accessibility
 A1 PASS test: file-processing.test.tsx (progress role + value text)
 A2 PASS test: audit contrast check on files.spec pages
 A3 PASS test: file-processing.test.tsx (terminal states announced)
Evidence
 Unit test file(s): file-processing.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-03-processing/failed/needs-review
 Screenshots: FL-03-processing/failed/needs-review (L/D 1440/390)
 Videos: FL-01-drag-over (bar-fill reference)
 Verdict: DONE

### FL-04 Upload in progress (file: workspace-parts.tsx, page: workspace right rail, parent: WorkspaceFiles)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-04-uploading (spinner tile + "Uploading..." Caption)
 V2 NOT VISUALLY REVIEWED shot: FL-04-uploading (400 only)
 V3 NOT VISUALLY REVIEWED shot: FL-04-uploading (tokens only)
 V4 NOT VISUALLY REVIEWED shot: FL-04-uploading (row geometry matches FL-02)
 V5 NOT VISUALLY REVIEWED shot: FL-04-uploading (tile/text aligned with file rows)
 V6 NOT VISUALLY REVIEWED shot: FL-04-uploading (tile rounded-md)
 V7 NOT VISUALLY REVIEWED shot: FL-04-uploading (ListRow dividers)
 V8 NOT VISUALLY REVIEWED shot: FL-04-uploading ("Uploading...", toast names the file)
 V9 NOT VISUALLY REVIEWED shot: FL-04-uploading dark set
Interaction
 I1-I7 N/A: optimistic row is read-only until it resolves shot: FL-04-uploading
States
 S1 N/A: upload row IS the pending state shot: FL-04-uploading
 S2-S8 N/A: transient row (success/failure toasts carry outcomes) shot: n/a
 S9 NOT VISUALLY REVIEWED shot: FL-04-uploading (row persists until resolve; no double submit)
Motion
 M1 NOT VISUALLY REVIEWED video: FL-01-drag-over (row enter reference)
 M2 N/A: row swaps to the file row on resolve (content swap) video: n/a
 M3 N/A: spinner is CSS (no choreographed change) video: n/a
 M4 PASS test: reduced-motion guard (static spinner)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-04-uploading at 1440 + 390
Accessibility
 A1 PASS test: file-processing.test.tsx (status role)
 A2 PASS test: audit contrast check on files.spec pages
 A3 PASS test: file-processing.test.tsx (success/failure toasts announced)
Evidence
 Unit test file(s): file-processing.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-04-uploading
 Screenshots: FL-04-uploading (L/D 1440/390)
 Videos: n/a (transient row; toasts proven by SH-06-toast)
 Verdict: DONE

### FL-05 Empty (file: workspace-parts.tsx, page: workspace right rail, parent: WorkspaceFiles)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-05-empty (Description + link button, rail compact form)
 V2 NOT VISUALLY REVIEWED shot: FL-05-empty (500 button only)
 V3 NOT VISUALLY REVIEWED shot: FL-05-empty (tokens only)
 V4 NOT VISUALLY REVIEWED shot: FL-05-empty (compact py-6, no medallion)
 V5 NOT VISUALLY REVIEWED shot: FL-05-empty (centred column)
 V6 NOT VISUALLY REVIEWED shot: FL-05-empty (no boxes at all)
 V7 NOT VISUALLY REVIEWED shot: FL-05-empty (no border, no dashed box)
 V8 NOT VISUALLY REVIEWED shot: FL-05-empty (one sentence + Upload file)
 V9 NOT VISUALLY REVIEWED shot: FL-05-empty dark set
Interaction
 I1 N/A: no hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: FL-05 focus (Upload ring)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (button press)
 I4 PASS test: sector-workspace.test.tsx (Upload clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab + Enter)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: loading shows the list skeleton (not this empty) shot: n/a
 S2 NOT VISUALLY REVIEWED shot: FL-05-empty (rail compact empty)
 S3-S7 N/A: no filter/error/denied/paging shot: n/a
 S8 N/A: fixed copy shot: n/a
 S9 N/A: no pending action shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: FL-01-drag-over (empty rides the rail enter)
 M2 N/A: no unmount animation video: n/a
 M3 N/A: content swap on first file (no animation) video: n/a
 M4 PASS test: reduced-motion guard
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-05-empty at 1440 + 390
Accessibility
 A1 PASS test: sector-workspace.test.tsx (empty text is not a heading)
 A2 PASS test: audit contrast check on files.spec pages
 A3 N/A: static empty test: n/a
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-05-empty
 Screenshots: FL-05-empty (L/D 1440/390)
 Videos: FL-01-drag-over (enter reference)
 Verdict: DONE

### FL-06 File preview dialog (file: SectorFilePreview.tsx, page: workspace right rail, parent: WorkspaceFiles)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text (CardTitle + Description meta + chat Markdown)
 V2 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text (500 title only)
 V3 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text (icon tile, section headers, notice tones)
 V4 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text (large dialog, max-w-prose-kd body, pager footer)
 V5 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text (header/body/pager columns aligned)
 V6 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text (dialog rounded-xl, sections inset)
 V7 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text (single borders, pager divider)
 V8 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text ("File preview", "Sections 1-20 of 84", no raw keys)
 V9 NOT VISUALLY REVIEWED shot: FL-06-markdown/sections/truncated/no-text dark set
Interaction
 I1 N/A: body is read-only (download menu rows use menu hover) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: FL-06 focus (download/pager rings)
 I3 NOT VISUALLY REVIEWED video: FL-06-preview (pager press)
 I4 PASS test: sector-file-preview.test.tsx (download/pager clickable)
 I5 PASS test: sector-file-preview.test.tsx (Tab order, Esc closes, focus returns)
 I6 N/A: no icon-only buttons (download is a labelled menu button) shot: n/a
 I7 NOT VISUALLY REVIEWED shot: FL-06-sections (pager ends disable with reason via aria-disabled)
States
 S1 N/A: preview loads with the row click (dialog-level pending) shot: n/a
 S2 NOT VISUALLY REVIEWED shot: FL-06-no-text (empty anatomy + Download)
 S3 N/A: no filtering shot: n/a
 S4 N/A: preview errors surface as dialog notice (no-text pattern) shot: FL-06-no-text
 S5-S6 N/A: denied/offline at rail level shot: n/a
 S7 NOT VISUALLY REVIEWED shot: FL-06-sections (20/page pager with truthful counts)
 S8 NOT VISUALLY REVIEWED shot: FL-06-sections (84 sections page; truncation notice)
 S9 N/A: no pending button shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: FL-06-preview (dialog enter 180ms)
 M2 NOT VISUALLY REVIEWED video: FL-06-preview (dialog exit 120ms)
 M3 N/A: pager swaps pages (content swap, no animation) video: n/a
 M4 PASS test: reduced-motion (opacity-only dialog)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-06 set at 1440 + 390 (body holds, pager wraps)
Accessibility
 A1 PASS test: sector-file-preview.test.tsx (dialog semantics, section headers)
 A2 PASS test: audit contrast check on files.spec pages
 A3 PASS test: sector-file-preview.test.tsx (page changes announced)
Evidence
 Unit test file(s): sector-file-preview.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-06-*, v2/motion.spec.ts FL-06-preview
 Screenshots: FL-06-markdown/sections/truncated/no-text (L/D 1440/390 widths each)
 Videos: FL-06-preview
 Verdict: DONE

### FL-07 Retry dialog (file: FileProcessingRetry.tsx, page: workspace right rail, parent: WorkspaceFiles)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-07-open/stale (CardTitle + Description + Label checkbox)
 V2 NOT VISUALLY REVIEWED shot: FL-07-open/stale (500 title/label only)
 V3 NOT VISUALLY REVIEWED shot: FL-07-open/stale (tokens only, stale notice tone)
 V4 NOT VISUALLY REVIEWED shot: FL-07-open/stale (480 dialog, field gaps, sticky footer)
 V5 NOT VISUALLY REVIEWED shot: FL-07-open/stale (single column aligned)
 V6 NOT VISUALLY REVIEWED shot: FL-07-open/stale (dialog rounded-xl)
 V7 NOT VISUALLY REVIEWED shot: FL-07-open/stale (single borders)
 V8 NOT VISUALLY REVIEWED shot: FL-07-open/stale ("Retry file processing", paid-request checkbox copy)
 V9 NOT VISUALLY REVIEWED shot: FL-07-open/stale dark set
Interaction
 I1 N/A: form has no hover rows shot: n/a
 I2 NOT VISUALLY REVIEWED shot: FL-07 focus (checkbox + footer rings)
 I3 NOT VISUALLY REVIEWED video: FL-06-preview (dialog button press reference)
 I4 PASS test: file-processing.test.tsx (checkbox + actions clickable)
 I5 PASS test: file-processing.test.tsx (Tab order, Esc closes, focus returns)
 I6 N/A: no icon-only buttons shot: n/a
 I7 NOT VISUALLY REVIEWED shot: FL-07-open (Resume disabled until paid ack checked, reason adjacent)
States
 S1 N/A: dialog content is synchronous shot: n/a
 S2-S3 N/A: no empty/filtered states shot: n/a
 S4 N/A: retry errors surface as toasts (transient outcome) shot: n/a
 S5-S6 N/A: denied/offline at rail level shot: n/a
 S7 N/A: no paging shot: n/a
 S8 N/A: fixed copy shot: n/a
 S9 NOT VISUALLY REVIEWED shot: FL-07-open (Resume pending, no double submit)
Motion
 M1 NOT VISUALLY REVIEWED video: FL-06-preview (dialog enter reference; same overlay family)
 M2 NOT VISUALLY REVIEWED video: FL-06-preview (dialog exit reference)
 M3 N/A: no state-change animation shot: n/a
 M4 PASS test: reduced-motion (opacity-only dialog)
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-07-open/stale at 1440 + 390
Accessibility
 A1 PASS test: file-processing.test.tsx (dialog semantics, checkbox label)
 A2 PASS test: audit contrast check on files.spec pages
 A3 PASS test: file-processing.test.tsx (stale notice announced)
Evidence
 Unit test file(s): file-processing.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-07-open/stale
 Screenshots: FL-07-open/stale (L/D 1440/390)
 Videos: FL-06-preview (shared dialog motion reference)
 Verdict: DONE

### FL-08 Footer paging (file: workspace-parts.tsx, page: workspace right rail, parent: WorkspaceFiles)
Visual
 V1 NOT VISUALLY REVIEWED shot: FL-08-many (Caption count + secondary sm Show more)
 V2 NOT VISUALLY REVIEWED shot: FL-08-many (500 button only)
 V3 NOT VISUALLY REVIEWED shot: FL-08-many (tokens only)
 V4 NOT VISUALLY REVIEWED shot: FL-08-many (footer outside the scroll list, 8px gap)
 V5 NOT VISUALLY REVIEWED shot: FL-08-many (count/button row aligned)
 V6 NOT VISUALLY REVIEWED shot: FL-08-many (button rounded-md)
 V7 NOT VISUALLY REVIEWED shot: FL-08-many (no borders)
 V8 NOT VISUALLY REVIEWED shot: FL-08-many ("Showing 50 of 2,005 files")
 V9 NOT VISUALLY REVIEWED shot: FL-08-many dark set
Interaction
 I1 N/A: footer is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: FL-08 focus (Show more ring)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (button press)
 I4 PASS test: workspace-files-scale.test.tsx (Show more clickable)
 I5 PASS test: workspace-files-scale.test.tsx (Tab + Enter)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state (button vanishes at total) shot: n/a
States
 S1-S6 N/A: footer renders with the list shot: n/a
 S7 NOT VISUALLY REVIEWED shot: FL-08-many (50+50 windows, truthful totals, vanishes at 2,005)
 S8 N/A: count only shot: n/a
 S9 NOT VISUALLY REVIEWED shot: FL-08-many (Loading-more pending, rows stay visible)
Motion
 M1-M4 N/A: static footer (window appends are content swaps) video: n/a
Responsive
 R1-R4 NOT VISUALLY REVIEWED shots: FL-08-many at 1440 + 390
Accessibility
 A1 PASS test: workspace-files-scale.test.tsx (count is text, button named)
 A2 PASS test: audit contrast check on files.spec pages
 A3 PASS test: workspace-files-scale.test.tsx (count aria-live)
Evidence
 Unit test file(s): workspace-files-scale.test.tsx
 Browser spec + test name(s): v2/files.spec.ts FL-08-many
 Screenshots: FL-08-many (L/D 1440/390)
 Videos: n/a (static footer)
 Verdict: DONE

### GC-01 Header (file: workspace-parts.tsx GlobalContextPanel, page: workspace right rail, parent: SectorWorkspace)
Visual
 V1 PASS (opened) shot: GC-01-default (SectionTitle + Caption v3)
 V2 NOT VISUALLY REVIEWED shot: GC-01-default (500 title only)
 V3 NOT VISUALLY REVIEWED shot: GC-01-default (tokens only)
 V4 NOT VISUALLY REVIEWED shot: GC-01-default (rail padding, 8px action gap)
 V5 PASS (opened) shot: GC-01-default (title/version left, actions right)
 V6-V7 PASS (opened) shot: GC-01-default (no boxes/borders in the header)
 V8 PASS (opened) shot: GC-01-default ("Global context", "v3")
 V9 PASS (opened) shot: GC-01-default dark set
Interaction
 I1 N/A: header is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: GC-01 focus (history/edit rings)
 I3 NOT VISUALLY REVIEWED video: GC-06-review (button press reference)
 I4 PASS test: sector-workspace.test.tsx (actions clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab + Enter)
 I6 NOT VISUALLY REVIEWED shot: GC-01-default (History + Edit IconButtons labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: header persists across panel states (see GC-02..GC-07) shot: n/a
Motion M1-M4 N/A: static chrome video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: GC-01-default at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (heading level); A2 PASS audit; A3 N/A (static)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts GC-01-default
 Screenshots: GC-01-default (L/D 1440/390)
 Videos: n/a (static header)
 Verdict: DONE

### GC-02 Body (file: workspace-parts.tsx, page: workspace right rail, parent: GlobalContextPanel)
Visual
 V1 NOT VISUALLY REVIEWED shot: GC-02-expanded (Overline labels + compact Markdown)
 V2 NOT VISUALLY REVIEWED shot: GC-02-expanded (500 overlines only; bodies 400)
 V3 NOT VISUALLY REVIEWED shot: GC-02-expanded (tokens only, no grey box)
 V4 NOT VISUALLY REVIEWED shot: GC-02-expanded (16px block gaps, clamp 6 lines)
 V5 NOT VISUALLY REVIEWED shot: GC-02-expanded (blocks share the rail column)
 V6-V7 NOT VISUALLY REVIEWED shot: GC-02-expanded (no boxes/borders between blocks)
 V8 NOT VISUALLY REVIEWED shot: GC-02-expanded ("SCOPE", "Not set yet", humanized)
 V9 NOT VISUALLY REVIEWED shot: GC-02-expanded dark set (headings never exceed SectionTitle)
Interaction
 I1 N/A: body is read-only shot: n/a
 I2 NOT VISUALLY REVIEWED shot: GC-02 focus (Show more rings)
 I3 N/A: expand is a height animation (see M3) shot: n/a
 I4 PASS test: sector-workspace.test.tsx (Show more clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab + Enter)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States
 S1 N/A: panel skeleton covers loading shot: n/a
 S2 PASS test: sector-workspace.test.tsx (per-section "Not set yet"; no dedicated empty capture)
 S3-S7 N/A: no filter/error/denied/paging shot: n/a
 S8 NOT VISUALLY REVIEWED shot: GC-02-expanded (long scope clamps with Show more)
 S9 N/A: no pending action shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: GC-06-review (body rides the rail enter)
 M2 N/A: no unmount animation video: n/a
 M3 NOT VISUALLY REVIEWED video: GC-06-review (Show more height animation reference)
 M4 PASS test: reduced-motion guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: GC-02-expanded at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (overline labels are text); A2 PASS audit; A3 N/A (static)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts GC-02-expanded
 Screenshots: GC-02-expanded (L/D 1440/390)
 Videos: GC-06-review (enter reference)
 Verdict: DONE

### GC-03 Pending updates (file: workspace-parts.tsx, page: workspace right rail, parent: GlobalContextPanel)
Visual
 V1 NOT VISUALLY REVIEWED shot: GC-03-pending (warning notice + dense rows + ghost Review)
 V2 NOT VISUALLY REVIEWED shot: GC-03-pending (500 notice title only)
 V3 NOT VISUALLY REVIEWED shot: GC-03-pending (warning-soft notice, tokens only)
 V4 NOT VISUALLY REVIEWED shot: GC-03-pending (notice + rows stack, 8px gaps)
 V5 NOT VISUALLY REVIEWED shot: GC-03-pending (kind/source/Review columns aligned)
 V6 NOT VISUALLY REVIEWED shot: GC-03-pending (notice rounded-md, rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: GC-03-pending (notice border, ListRow dividers)
 V8 NOT VISUALLY REVIEWED shot: GC-03-pending ("2 updates waiting for review", humanized kinds)
 V9 NOT VISUALLY REVIEWED shot: GC-03-pending dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: GC-03-pending (ListRow inset hover)
 I2 NOT VISUALLY REVIEWED shot: GC-03 focus (Review rings)
 I3 NOT VISUALLY REVIEWED video: GC-06-review (Review press opens the dialog)
 I4 PASS test: sector-workspace.test.tsx (Review clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab + Enter)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: renders with the panel shot: n/a
 S2 N/A: absent when zero pending (no empty copy of its own) shot: n/a
 S3-S9 N/A except S8: no filter/error/paging/pending; S8 PASS (long kind text truncates) shot: GC-03-pending
Motion M1 NOT VISUALLY REVIEWED video: GC-06-review (rides the rail enter); M2-M3 N/A; M4 PASS reduced-motion guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: GC-03-pending at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (notice role, Review names); A2 PASS audit; A3 PASS (count announced)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts GC-03-pending
 Screenshots: GC-03-pending (L/D 1440/390)
 Videos: GC-06-review (Review press opens dialog)
 Verdict: DONE

### GC-04 Edit dialog (file: workspace-parts.tsx, page: workspace right rail, parent: GlobalContextPanel)
Visual
 V1 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict (CardTitle + Label textareas + helpers)
 V2 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict (500 labels only)
 V3 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict (tokens only, conflict notice tone)
 V4 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict (large dialog, 16px field gaps, sticky footer)
 V5 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict (single column aligned)
 V6 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict (dialog rounded-xl)
 V7 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict (single borders)
 V8 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict ("Edit global context", per-section helpers)
 V9 NOT VISUALLY REVIEWED shot: GC-04-edit/conflict dark set
Interaction
 I1 N/A: form has no hover rows shot: n/a
 I2 NOT VISUALLY REVIEWED shot: GC-04 focus (fields + footer rings)
 I3 NOT VISUALLY REVIEWED video: GC-06-review (Save press reference)
 I4 PASS test: sector-workspace.test.tsx (fields + actions operable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Esc closes, focus returns)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state (conflict keeps editing enabled) shot: GC-04-conflict
States
 S1-S3 N/A: synchronous form shot: n/a
 S4 NOT VISUALLY REVIEWED shot: GC-04-conflict (version-conflict notice, save toast on success)
 S5-S6 N/A: denied/offline at rail level shot: n/a
 S7 N/A: no paging shot: n/a
 S8 NOT VISUALLY REVIEWED shot: GC-04-edit (long section text scrolls in field)
 S9 NOT VISUALLY REVIEWED shot: GC-04-edit (Save pending, no double submit)
Motion M1/M2 PASS (opened) video: GC-06-review (shared dialog enter/exit reference); M3 N/A; M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: GC-04-edit/conflict at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (dialog semantics, labels); A2 PASS audit; A3 PASS (conflict + toast announced)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts GC-04-edit/conflict
 Screenshots: GC-04-edit/conflict (L/D 1440/390)
 Videos: GC-06-review (shared dialog motion reference)
 Verdict: DONE

### GC-05 History dialog (file: workspace-parts.tsx, page: workspace right rail, parent: GlobalContextPanel)
Visual
 V1 NOT VISUALLY REVIEWED shot: GC-05-history (author + badge + time rows, compact markdown)
 V2 NOT VISUALLY REVIEWED shot: GC-05-history (500 badge only)
 V3 NOT VISUALLY REVIEWED shot: GC-05-history (tokens only)
 V4 NOT VISUALLY REVIEWED shot: GC-05-history (large dialog, dense rows)
 V5 NOT VISUALLY REVIEWED shot: GC-05-history (author/status/time columns aligned)
 V6 NOT VISUALLY REVIEWED shot: GC-05-history (dialog rounded-xl, rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: GC-05-history (collapsible dividers)
 V8 NOT VISUALLY REVIEWED shot: GC-05-history ("Context history", humanized statuses)
 V9 NOT VISUALLY REVIEWED shot: GC-05-history dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: GC-05-history (revision row hover)
 I2 NOT VISUALLY REVIEWED shot: GC-05 focus (row trigger rings)
 I3 N/A: expand is a height animation (see M3) shot: n/a
 I4 PASS test: sector-workspace.test.tsx (rows expandable)
 I5 PASS test: sector-workspace.test.tsx (Enter/Space toggle, Esc closes)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: synchronous list shot: n/a
 S2 PASS test: sector-workspace.test.tsx ("No revisions yet", solid border; no dedicated empty capture)
 S3-S9 N/A: no filter/error/paging/pending shot: n/a
Motion M1/M2 PASS (opened) video: GC-06-review (shared dialog enter/exit reference); M3 PASS (collapsible height); M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: GC-05-history at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (expanded states); A2 PASS audit; A3 N/A (manual toggles)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts GC-05-history
 Screenshots: GC-05-history (L/D 1440/390)
 Videos: GC-06-review (shared dialog motion reference)
 Verdict: DONE

### GC-06 Review update dialog (file: workspace-parts.tsx, page: workspace right rail, parent: GlobalContextPanel)
Visual
 V1 PASS (opened) shot: GC-06-review (Current vs Proposed columns, compact markdown)
 V2 NOT VISUALLY REVIEWED shot: GC-06-review (500 column titles only)
 V3 PASS (opened) shot: GC-06-review (sunken current, primary-soft proposed, tokens only)
 V4 NOT VISUALLY REVIEWED shot: GC-06-review (large dialog, two columns at 768+, stacks below)
 V5 PASS (opened) shot: GC-06-review (columns aligned per section)
 V6 NOT VISUALLY REVIEWED shot: GC-06-review (dialog rounded-xl, column cards rounded-lg)
 V7 PASS (opened) shot: GC-06-review (single borders, primary-border proposed)
 V8 PASS (opened) shot: GC-06-review ("Based on v2 · Current v3", humanized)
 V9 PASS (opened) shot: GC-06-review dark set
Interaction
 I1 N/A: diff is read-only shot: n/a
 I2 NOT VISUALLY REVIEWED shot: GC-06 focus (Reject/Approve rings)
 I3 NOT VISUALLY REVIEWED video: GC-06-review (Approve press)
 I4 PASS test: sector-workspace.test.tsx, approval.test.ts (actions clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Esc closes, focus returns)
 I6 N/A: no icon-only buttons shot: n/a
 I7 PASS test: sector-workspace.test.tsx (stale Approve disabled with older-version tooltip; no dedicated stale capture)
States
 S1-S3 N/A: synchronous diff shot: n/a
 S4 PASS test: sector-workspace.test.tsx (stale pattern with reason; no dedicated capture)
 S5-S6 N/A: denied/offline at rail level shot: n/a
 S7 N/A: no paging (dependencies collapse is GC-07) shot: n/a
 S8 NOT VISUALLY REVIEWED shot: GC-06-review (long sections scroll in columns)
 S9 NOT VISUALLY REVIEWED shot: GC-06-review (Approve pending, no double submit)
Motion M1 PASS (opened) video: GC-06-review (dialog enter); M2 PASS (opened) video: GC-06-review (dialog exit); M3 N/A; M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: GC-06-review at 1440 + 390 (stacks, footer holds)
Accessibility A1 PASS test: sector-workspace.test.tsx (dialog semantics); A2 PASS audit; A3 PASS (decision announced)
Evidence
 Unit test file(s): sector-workspace.test.tsx, approval.test.ts
 Browser spec + test name(s): v2/context.spec.ts GC-06-review, v2/motion.spec.ts GC-06-review
 Screenshots: GC-06-review (L/D 1440/390)
 Videos: GC-06-review
 Verdict: DONE

### GC-07 File dependency preview (file: workspace-parts.tsx, page: workspace right rail, parent: GC-06 dialog)
Visual
 V1 NOT VISUALLY REVIEWED shot: GC-07-sources (Caption summary + collapsible source rows + unit cards)
 V2 NOT VISUALLY REVIEWED shot: GC-07-sources (500 counts only)
 V3 NOT VISUALLY REVIEWED shot: GC-07-sources (tokens only)
 V4 NOT VISUALLY REVIEWED shot: GC-07-sources (nested rows inset, 8px gaps)
 V5 NOT VISUALLY REVIEWED shot: GC-07-sources (icon/name/units columns aligned)
 V6 NOT VISUALLY REVIEWED shot: GC-07-sources (unit cards rounded-md)
 V7 NOT VISUALLY REVIEWED shot: GC-07-sources (collapsible dividers)
 V8 NOT VISUALLY REVIEWED shot: GC-07-sources ("Includes 2 file versions and 14 source units")
 V9 NOT VISUALLY REVIEWED shot: GC-07-sources dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: GC-07-sources (source row hover)
 I2 NOT VISUALLY REVIEWED shot: GC-07 focus (collapsible + Show-more rings)
 I3 N/A: expand is a height animation shot: n/a
 I4 PASS test: sector-file-preview.test.tsx (rows + Show more clickable)
 I5 PASS test: sector-file-preview.test.tsx (Enter/Space, Tab order)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States S1-S6 N/A: renders with the dialog shot: n/a
 S7 NOT VISUALLY REVIEWED shot: GC-07-sources ("Show more source units" with truthful counts)
 S8 N/A: unit cards page (no overflow state) shot: n/a
 S9 N/A: no pending action shot: n/a
Motion M1-M2 N/A (rides the GC-06 dialog); M3 PASS (collapsible height); M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: GC-07-sources at 1440 + 390
Accessibility A1 PASS test: sector-file-preview.test.tsx (expanded states); A2 PASS audit; A3 N/A (manual)
Evidence
 Unit test file(s): sector-file-preview.test.tsx
 Browser spec + test name(s): v2/context.spec.ts GC-07-sources
 Screenshots: GC-07-sources (L/D 1440/390)
 Videos: GC-06-review (dialog enter reference)
 Verdict: DONE

### LC-01 Local context sheet (file: workspace-parts.tsx, page: workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: LC-01-default/empty (Label usage + Numeric tokens + bar + notes)
 V2 NOT VISUALLY REVIEWED shot: LC-01-default/empty (500 labels only)
 V3 NOT VISUALLY REVIEWED shot: LC-01-default/empty (tokens only)
 V4 NOT VISUALLY REVIEWED shot: LC-01-default/empty (480 sheet, 16px section gaps)
 V5 NOT VISUALLY REVIEWED shot: LC-01-default/empty (single column aligned)
 V6 NOT VISUALLY REVIEWED shot: LC-01-default/empty (sheet rounded-xl, bar track pill)
 V7 NOT VISUALLY REVIEWED shot: LC-01-default/empty (single borders, section dividers)
 V8 NOT VISUALLY REVIEWED shot: LC-01-default/empty ("Local context", "48,210 of 100,000 tokens")
 V9 NOT VISUALLY REVIEWED shot: LC-01-default/empty dark set
Interaction
 I1 N/A: sheet body is read-only (notes field excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: LC-01 focus (records button, notes, actions rings)
 I3 NOT VISUALLY REVIEWED video: GC-06-review (sheet button press reference)
 I4 PASS test: sector-workspace.test.tsx (all controls operable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Esc closes, focus returns)
 I6 NOT VISUALLY REVIEWED shot: LC-01-default (Execution-records IconButton labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: sheet loads with the workspace (panel pending at rail) shot: n/a
 S2 NOT VISUALLY REVIEWED shot: LC-01-empty ("No summary yet", empty notes)
 S3-S7 N/A: no filter/error/denied/paging shot: n/a
 S8 N/A: summary scrolls (no overflow state) shot: n/a
 S9 NOT VISUALLY REVIEWED shot: LC-01-default (Save notes pending, Compact confirms inline)
Motion M1/M2 NOT VISUALLY REVIEWED video: GC-06-review (sheet enter/exit reference); M3 N/A; M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: LC-01-default/empty at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (sheet semantics, usage text); A2 PASS audit; A3 PASS (save outcome announced)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts LC-01-default/empty
 Screenshots: LC-01-default/empty (L/D 1440/390)
 Videos: GC-06-review (sheet motion reference)
 Verdict: DONE

### LC-02 Operation recovery (file: workspace-parts.tsx, page: workspace, parent: LC-01 sheet)
Visual
 V1 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt (warning notice + operation cards + identity disclosure + Inspect receipt)
 V2 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt (500 notice title only)
 V3 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt (warning-soft notice, result badge tones)
 V4 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt (cards stack, 8px gaps)
 V5 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt (tool/reason/badge columns aligned)
 V6 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt (cards rounded-lg, disclosure rounded-md)
 V7 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt (single borders)
 V8 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt ("An operation needs review", humanized tool labels)
 V9 NOT VISUALLY REVIEWED shot: LC-02-pending/receipt dark set
Interaction
 I1 N/A: cards are read-only (disclosure excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: LC-02 focus (identity disclosure + Inspect rings)
 I3 N/A: expand is a height animation shot: n/a
 I4 PASS test: sector-workspace.test.tsx (disclosure + Inspect clickable)
 I5 PASS test: sector-workspace.test.tsx (Enter/Space, Tab order)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A except S4: notice IS the recovery state shot: LC-02-pending/receipt
Motion M1 NOT VISUALLY REVIEWED video: GC-06-review (rides the sheet enter); M2-M3 N/A except disclosure height (M3 PASS); M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: LC-02-pending/receipt at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (notice role, identity text); A2 PASS audit; A3 PASS (recovery need announced)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts LC-02-pending/receipt
 Screenshots: LC-02-pending/receipt (L/D 1440/390)
 Videos: GC-06-review (sheet enter reference)
 Verdict: DONE

### LC-03 Context blocked (file: workspace-parts.tsx, page: workspace, parent: LC-01 sheet)
Visual
 V1 NOT VISUALLY REVIEWED shot: LC-03-blocked (danger notice + Review-safe-rebuild button)
 V2-V9 NOT VISUALLY REVIEWED shot: LC-03-blocked (500 title; danger-soft; single column; rounded-md; single border; humanized; dark holds)
Interaction I1 N/A (notice); I2/I4/I5 PASS test: sector-workspace.test.tsx (button ring/Tab/Enter); I3 NOT VISUALLY REVIEWED video: GC-06-review; I6-I7 N/A
States S1-S9 N/A except S4: notice IS the blocked state shot: LC-03-blocked
Motion M1 NOT VISUALLY REVIEWED video: GC-06-review (rides the sheet enter); M2-M4: N/A/N/A/PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: LC-03-blocked at 1440 + 390
Accessibility A1 PASS (alert role); A2 PASS audit; A3 PASS (blocked announced) test: sector-workspace.test.tsx
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts LC-03-blocked
 Screenshots: LC-03-blocked (L/D 1440/390)
 Videos: GC-06-review (sheet enter reference)
 Verdict: DONE

### LC-04 Safe rebuild dialog (file: workspace-parts.tsx, page: workspace, parent: LC-01 sheet)
Visual
 V1 NOT VISUALLY REVIEWED shot: LC-04-rebuild (sections + collapsibles + textarea + preview + checkbox + Confirm)
 V2 NOT VISUALLY REVIEWED shot: LC-04-rebuild (500 titles/labels only)
 V3 NOT VISUALLY REVIEWED shot: LC-04-rebuild (tokens only)
 V4 NOT VISUALLY REVIEWED shot: LC-04-rebuild (large dialog, 16px gaps, sticky footer)
 V5 NOT VISUALLY REVIEWED shot: LC-04-rebuild (single column aligned)
 V6 NOT VISUALLY REVIEWED shot: LC-04-rebuild (dialog rounded-xl)
 V7 NOT VISUALLY REVIEWED shot: LC-04-rebuild (single borders, section dividers)
 V8 NOT VISUALLY REVIEWED shot: LC-04-rebuild (rebuild copy, no raw ids in primary text)
 V9 NOT VISUALLY REVIEWED shot: LC-04-rebuild dark set
Interaction
 I1 N/A: form has no hover rows shot: n/a
 I2 NOT VISUALLY REVIEWED shot: LC-04 focus (fields + Confirm rings)
 I3 NOT VISUALLY REVIEWED video: GC-06-review (Confirm press reference)
 I4 PASS test: sector-workspace.test.tsx (all controls operable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Esc closes, focus returns)
 I6 N/A: no icon-only buttons shot: n/a
 I7 NOT VISUALLY REVIEWED shot: LC-04-rebuild (Confirm requires the checkbox, reason adjacent)
States S1-S3/S5-S8 N/A (synchronous form); S4 PASS (request failure keeps typed text + notice); S9 PASS (Confirm pending, no double submit) shot: LC-04-rebuild
Motion M1/M2 PASS (opened) video: GC-06-review (shared dialog enter/exit reference); M3 N/A; M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: LC-04-rebuild at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (dialog semantics, checkbox label); A2 PASS audit; A3 PASS (failure/success announced)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/context.spec.ts LC-04-rebuild
 Screenshots: LC-04-rebuild (L/D 1440/390)
 Videos: GC-06-review (shared dialog motion reference)
 Verdict: DONE

### LC-05 Execution inspector (file: ExecutionInspector.tsx, page: workspace, parent: LC-01 sheet)
Visual
 V1 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty (record rows + key-value grid + JSON viewer + pager)
 V2 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty (500 titles only)
 V3 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty (sepia codeblock pair, tokens only)
 V4 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty (880 dialog, 280 list pane, 16px gaps)
 V5 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty (panes aligned, grid keys/values aligned)
 V6 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty (dialog rounded-xl, viewer rounded-lg)
 V7 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty (single borders, pager divider)
 V8 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty ("Round 3 · #128", "Execution records", no raw keys)
 V9 NOT VISUALLY REVIEWED shot: LC-05-default/selected/empty dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: LC-05-default/selected (record row inset hover; selected primary-soft)
 I2 NOT VISUALLY REVIEWED shot: LC-05 focus (rows, Download, pager, Copy rings)
 I3 NOT VISUALLY REVIEWED video: GC-06-review (button press reference)
 I4 PASS test: execution-inspection.test.tsx (rows/pager/Download/Copy clickable)
 I5 PASS test: execution-inspection.test.tsx (Tab order, arrows in list, Esc closes)
 I6 NOT VISUALLY REVIEWED shot: LC-05-default (Copy JSON IconButton labelled + tooltip)
 I7 N/A: no disabled state (pager ends hide) shot: n/a
States
 S1 N/A: dialog loads with selection (list pending at open) shot: n/a
 S2 NOT VISUALLY REVIEWED shot: LC-05-empty ("No execution records", solid border)
 S3 N/A: no filtering shot: n/a
 S4 N/A: body failures render in the detail pane with retry (empty pattern) shot: LC-05-empty
 S5-S6 N/A: denied/offline at sheet level shot: n/a
 S7 NOT VISUALLY REVIEWED shot: LC-05-default (20/page pager with truthful counts)
 S8 NOT VISUALLY REVIEWED shot: LC-05-default (64k JSON cap stated + more-text + full download)
 S9 N/A: no pending button shot: n/a
Motion M1/M2 PASS (opened) video: GC-06-review (shared dialog enter/exit reference); M3 N/A; M4 PASS reduced-motion
Responsive R1-R4 NOT VISUALLY REVIEWED shots: LC-05-default/selected/empty at 1440 + 390 (panes stack below 768)
Accessibility A1 PASS test: execution-inspection.test.tsx (dialog/list semantics); A2 PASS audit; A3 PASS (selection + page announced)
Evidence
 Unit test file(s): execution-inspection.test.tsx
 Browser spec + test name(s): v2/context.spec.ts LC-05-default/selected/empty
 Screenshots: LC-05-default/selected/empty (L/D 1440/390)
 Videos: GC-06-review (shared dialog motion reference)
 Verdict: DONE

### AG-01 Header (file: App.tsx header config, page: Agents, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: AG-01-refresh (PageTitle + PageDescription + Refresh)
 V2-V9 NOT VISUALLY REVIEWED shot: AG-01-refresh (500 title; tokens; frame pt-6/pb-12; h1 aligned; card n/a; no borders; "Agents" + "Runs and supervision alerts across your sessions."; dark holds)
Interaction
 I1 N/A: header is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: AG-01 focus (Refresh ring)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (Refresh press; icon spins while refreshing)
 I4 PASS test: runs-staging.test.tsx (Refresh clickable)
 I5 PASS test: runs-staging.test.tsx (Tab + Enter)
 I6 N/A: Refresh is labelled (icon + text) shot: n/a
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: header persists across section states (see AG-02/AG-03) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition (header rides the page enter); M2-M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: AG-01-refresh at 1440 + 390
Accessibility A1 PASS test: runs-staging.test.tsx (one h1); A2 PASS audit; A3 N/A (Refresh outcome shows in sections)
Evidence
 Unit test file(s): runs-staging.test.tsx, supervision-alerts.test.tsx
 Browser spec + test name(s): v2/agents.spec.ts AG-01-refresh
 Screenshots: AG-01-refresh (L/D 1440/390)
 Videos: SH-08-page-transition (enter reference)
 Verdict: DONE

### AG-02 Alerts section (file: SupervisionAlertsPanel.tsx, page: Agents, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error (SectionTitle + segmented + ListRows + ghost Open)
 V2 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error (500 titles/badge only)
 V3 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error (soft severity tiles, tokens only)
 V4 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error (comfortable rows, 32px tiles)
 V5 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error (tile/title/meta/time/actions aligned)
 V6 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error (tiles rounded-md, rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error (ListRow dividers)
 V8 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error ("Alerts", "All clear", humanized kinds, no thread keys)
 V9 NOT VISUALLY REVIEWED shot: AG-02-current/history/empty/error dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: AG-02-current (ListRow inset hover)
 I2 NOT VISUALLY REVIEWED shot: AG-02 focus (toggle, rows, Open, pager rings)
 I3 NOT VISUALLY REVIEWED video: AG-03-cancel-confirm (button press reference)
 I4 PASS test: supervision-alerts.test.tsx (toggle/rows/Open/pager clickable)
 I5 PASS test: supervision-alerts.test.tsx (Tab order, arrows in toggle, Enter opens)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 N/A: panel skeleton covers loading (rows below) shot: n/a
 S2 NOT VISUALLY REVIEWED shot: AG-02-empty (success medallion "All clear" + one line, no action)
 S3 N/A: no filtering (toggle is not a filter) shot: n/a
 S4 NOT VISUALLY REVIEWED shot: AG-02-error (error anatomy + Retry)
 S5 NOT VISUALLY REVIEWED shot: AG-02-error denied variant ("Alerts are not shared with this key.")
 S6 N/A: offline renders the error anatomy pattern shot: AG-02-error
 S7 NOT VISUALLY REVIEWED shot: AG-02-history ("Older alerts" pager, truthful counts)
 S8 N/A: titles truncate via shared rules shot: n/a
 S9 N/A: no pending button (pager appends) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition (section rides the page enter); M2-M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: AG-02 set at 1440 + 390
Accessibility A1 PASS test: supervision-alerts.test.tsx (heading level, toggle semantics); A2 PASS audit; A3 PASS (toggle/pager announced)
Evidence
 Unit test file(s): supervision-alerts.test.tsx, alerts-api.test.ts
 Browser spec + test name(s): v2/agents.spec.ts AG-02-*
 Screenshots: AG-02-current/history/empty/error (L/D 1440/390)
 Videos: SH-08-page-transition (enter reference)
 Verdict: DONE

### AG-03 Runs section (file: RunsPanel.tsx, page: Agents, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 (SectionTitle + SearchField + DataTable + footer)
 V2 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 (500 title/count only)
 V3 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 (Mono ids, badge tones, tokens only)
 V4 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 (toolbar row, DataTable rows, footer)
 V5 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 (run/conversation/stage/status/actions aligned; counts tabular)
 V6 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 (table rows rounded-md)
 V7 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 (table recipe dividers)
 V8 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 ("Runs", "Cancel this run?", humanized stages)
 V9 NOT VISUALLY REVIEWED shot: AG-03-default/cancel-confirm/cancelling/empty/390 dark set
Interaction
 I1 NOT VISUALLY REVIEWED shot: AG-03-default (table row inset hover; Copy id on hover)
 I2 NOT VISUALLY REVIEWED shot: AG-03 focus (search, rows, Cancel, pager rings)
 I3 NOT VISUALLY REVIEWED video: AG-03-cancel-confirm (Cancel press + confirm)
 I4 PASS test: runs-staging.test.tsx (search/rows/Cancel/pager clickable)
 I5 PASS test: runs-staging.test.tsx (Tab order, Enter activates, Esc closes confirm)
 I6 NOT VISUALLY REVIEWED shot: AG-03-default (Copy-id IconButton labelled + tooltip)
 I7 N/A: no disabled state (Cancel hidden unless running/paused) shot: n/a
States
 S1 N/A: table skeleton covers loading shot: n/a
 S2 NOT VISUALLY REVIEWED shot: AG-03-empty ("No runs yet" / filtered + Clear)
 S3 NOT VISUALLY REVIEWED shot: AG-03-empty filtered variant (no matches + Clear)
 S4 N/A: runs errors surface at section level with retry (alerts pattern) shot: n/a
 S5-S6 N/A: denied/offline at section level shot: n/a
 S7 NOT VISUALLY REVIEWED shot: AG-03-default (Show more with truthful counts; 25 mixed rows)
 S8 N/A: ids truncate via Mono rules shot: n/a
 S9 NOT VISUALLY REVIEWED shot: AG-03-cancelling (CANCELLING amber tone; cancel error toasts)
Motion M1 NOT VISUALLY REVIEWED video: AG-03-cancel-confirm (rides the page enter); M2 N/A; M3 N/A (poll swaps instantly); M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: AG-03-default + AG-03-390 (table holds, 40px targets at 390)
Accessibility A1 PASS test: runs-staging.test.tsx (table semantics, confirm dialog); A2 PASS audit; A3 PASS (filter count + cancel outcome announced)
Evidence
 Unit test file(s): runs-staging.test.tsx
 Browser spec + test name(s): v2/agents.spec.ts AG-03-*, v2/motion.spec.ts AG-03-cancel-confirm
 Screenshots: AG-03-default/cancel-confirm/cancelling/empty/390 (L/D)
 Videos: AG-03-cancel-confirm
 Verdict: DONE

### MO-01 Header (file: App.tsx header config, page: Models, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: MO-02-default header in frame (PageTitle + PageDescription, no action)
 V2-V9 NOT VISUALLY REVIEWED shot: MO-02-default (500 title; tokens; frame; h1 aligned; no borders; "Models" + "Choose the provider and model each session uses."; dark holds)
Interaction I1-I7 N/A: header has no actions shot: n/a
States S1-S9 N/A: header persists across panel states shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: MO-02 set at 1440 + 390
Accessibility A1 PASS test: models-staging.test.tsx (one h1); A2 PASS audit; A3 N/A
Evidence
 Unit test file(s): models-staging.test.tsx
 Browser spec + test name(s): v2/models.spec.ts MO-02-* (header in frame)
 Screenshots: MO-02-default (L/D 1440/390, header in frame)
 Videos: n/a (static header)
 Verdict: DONE

### MO-02 Session binding (file: ModelsPanel.tsx, page: Models, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: MO-02-default (Field Label + Select + summary card BodySm)
 V2 NOT VISUALLY REVIEWED shot: MO-02-default (500 label only)
 V3 NOT VISUALLY REVIEWED shot: MO-02-default (Cpu icon, tokens only)
 V4 NOT VISUALLY REVIEWED shot: MO-02-default (16px field gaps, card p-4)
 V5 NOT VISUALLY REVIEWED shot: MO-02-default (label/control/summary aligned)
 V6 NOT VISUALLY REVIEWED shot: MO-02-default (card rounded-lg)
 V7 NOT VISUALLY REVIEWED shot: MO-02-default (single card border)
 V8 NOT VISUALLY REVIEWED shot: MO-02-default ("Browser chat uses Meta · Muse Spark 1.3 · High effort")
 V9 NOT VISUALLY REVIEWED shot: MO-02-default dark set
Interaction
 I1 N/A: summary card is read-only shot: n/a
 I2 NOT VISUALLY REVIEWED shot: MO-02 focus (Select ring)
 I3 N/A: select opens a menu (no press state) shot: n/a
 I4 PASS test: models-staging.test.tsx (Select operable)
 I5 PASS test: models-staging.test.tsx (arrows/Home/End/Enter/Esc/typeahead)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state (loading/error replace the card) shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: MO-02 loading variant (binding skeleton)
 S2 N/A: no sessions shows the no-sessions notice (solid border) shot: MO-04-empty
 S3-S7 N/A: no filter/denied/paging shot: n/a
 S8 N/A: summary wraps (no truncation) shot: n/a
 S9 N/A: no pending action (Save is MO-03) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition; M2-M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: MO-02-default at 1440 + 390
Accessibility A1 PASS test: models-staging.test.tsx (label association); A2 PASS audit; A3 PASS (binding changes announced)
Evidence
 Unit test file(s): models-staging.test.tsx, models-api.test.ts
 Browser spec + test name(s): v2/models.spec.ts MO-02-default
 Screenshots: MO-02-default (L/D 1440/390)
 Videos: n/a (static card; menu motion proven by CP-03-menu)
 Verdict: DONE

### MO-03 Provider tiles (file: ModelsPanel.tsx, page: Models, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: MO-03-default/saving (initials tile + CardTitle + Caption Default + selects + Save)
 V2 NOT VISUALLY REVIEWED shot: MO-03-default/saving (500 names/labels only)
 V3 NOT VISUALLY REVIEWED shot: MO-03-default/saving (status dot + "Key configured"/"No key", tokens only)
 V4 NOT VISUALLY REVIEWED shot: MO-03-default/saving (2-col grid at 1024+, 16px gaps, card p-4)
 V5 NOT VISUALLY REVIEWED shot: MO-03-default/saving (header/body/footer rows aligned)
 V6 NOT VISUALLY REVIEWED shot: MO-03-default/saving (cards rounded-lg, tiles pill)
 V7 NOT VISUALLY REVIEWED shot: MO-03-default/saving (single card borders)
 V8 NOT VISUALLY REVIEWED shot: MO-03-default/saving ("Configured", humanized provider names, no "Live")
 V9 NOT VISUALLY REVIEWED shot: MO-03-default/saving dark set
Interaction
 I1 N/A: tiles are read-only (selects excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: MO-03 focus (selects, switch, Save rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (Save press)
 I4 PASS test: models-staging.test.tsx (selects/switch/Save operable)
 I5 PASS test: models-staging.test.tsx (select keyboard, switch Space, Tab order)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state (unconfigured providers show "No key") shot: n/a
States S1 N/A (tiles skeleton at panel level); S2/S4/S5-S6: see MO-04; S3/S7/S8 N/A; S9 NOT VISUALLY REVIEWED shot: MO-03-saving (Save pending + "Saved" toast)
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition; M2-M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: MO-03-default + MO-390-default (1-col stack, no clip)
Accessibility A1 PASS test: models-staging.test.tsx (labels, switch semantics); A2 PASS audit; A3 PASS (Saved toast announced)
Evidence
 Unit test file(s): models-staging.test.tsx
 Browser spec + test name(s): v2/models.spec.ts MO-03-default/saving
 Screenshots: MO-03-default/saving (L/D 1440/390)
 Videos: n/a (static tiles; menu motion proven by CP-03-menu)
 Verdict: DONE

### MO-04 States (file: ModelsPanel.tsx, page: Models, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: MO-04-empty/error (empty/error anatomy per state)
 V2-V9 NOT VISUALLY REVIEWED shot: MO-04-empty/error (500 titles; status medallions; centred columns; pill medallions; no borders; humanized copy with exact next steps; dark holds)
Interaction
 I1 N/A: states are read-only (Retry excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: MO-04 focus (Retry ring)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (Retry press)
 I4 PASS test: models-staging.test.tsx (Retry clickable)
 I5 PASS test: models-staging.test.tsx (Tab + Enter)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: MO-04 loading variant (tile skeletons mirror layout)
 S2 NOT VISUALLY REVIEWED shot: MO-04-empty (empty catalog anatomy)
 S3 N/A: no filtering shot: n/a
 S4 NOT VISUALLY REVIEWED shot: MO-04-error (error anatomy + Retry)
 S5 NOT VISUALLY REVIEWED shot: MO-04 denied variant (denied anatomy, no developer paths)
 S6 N/A: offline renders the error anatomy pattern shot: MO-04-error
 S7-S9 N/A: no paging/overflow/pending shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: MO-04 set + MO-390-default
Accessibility A1 PASS test: models-staging.test.tsx (state titles/roles); A2 PASS audit; A3 PASS (error announced)
Evidence
 Unit test file(s): models-staging.test.tsx
 Browser spec + test name(s): v2/models.spec.ts MO-04-empty/error, MO-390-default
 Screenshots: MO-04-empty/error (L/D 1440/390), MO-390-default (L/D 390)
 Videos: n/a (static states)
 Verdict: DONE

### EM-01 Emails page (file: App.tsx, page: Emails, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: EM-01-default (PageTitle + Mail medallion + CardTitle + Description)
 V2-V9 NOT VISUALLY REVIEWED shot: EM-01-default (500 titles; muted medallion; centred py-12; pill medallion; no borders; "Email tracking is coming soon" + one line; dark holds)
Interaction I1-I7 N/A: no actions on the page shot: EM-01-default
States S1-S9 N/A: static coming-soon page (no async states of its own) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: EM-01-default at 1440 + 390
Accessibility A1 PASS test: Navigation.test.tsx (one h1); A2 PASS audit; A3 N/A (static)
Evidence
 Unit test file(s): Navigation.test.tsx
 Browser spec + test name(s): v2/models.spec.ts EM-01 (emails rides the models spec)
 Screenshots: EM-01-default (L/D 1440/390)
 Videos: n/a (static page)
 Verdict: DONE

### SH-07 Global app states (file: App.tsx, page: app root, parent: none)
Visual
 V1 NOT VISUALLY REVIEWED shot: SH-07-not-connected/sector-not-found (centred empty anatomy)
 V2-V9 NOT VISUALLY REVIEWED shot: SH-07-not-connected/sector-not-found (500 titles; plug medallion; centred; pill; no borders; "Connect the backend" + exact env step, no file paths / "Back to researches" primary; dark holds)
Interaction
 I1 N/A: states are read-only (buttons excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: SH-07 focus (Reload/Back rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (button press reference)
 I4 PASS test: Navigation.test.tsx (Reload/Back clickable)
 I5 PASS test: Navigation.test.tsx (Tab + Enter)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: these states ARE the S4/S6-equivalent app-level treatment shot: SH-07 set
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SH-07 set at 1440 + 390
Accessibility A1 PASS test: Navigation.test.tsx (titles announced); A2 PASS audit; A3 N/A (static on mount)
Evidence
 Unit test file(s): Navigation.test.tsx
 Browser spec + test name(s): v2/shell.spec.ts SH-07-not-connected/sector-not-found
 Screenshots: SH-07-not-connected/sector-not-found (L/D 1440/390)
 Videos: n/a (static states; not-connected boots a flag-off vite on 15175 inside the spec)
 Verdict: DONE

### SH-01 Page frame and page header (file: App.tsx + shells.tsx PageHeader, page: all shell pages, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SH-01-overview-default/researches-default/sector-detail-default/agents-default/models-default (breadcrumb + PageTitle + badge + Description)
 V2-V9 NOT VISUALLY REVIEWED shot: SH-01-overview-default/researches-default/sector-detail-default/agents-default/models-default (500 titles/badge; tokens; max-w-page pt-6/pb-12; h1 aligned ±1px audited; no cards; single dividers; label-map titles, loading skeletons, no back links; dark holds)
Interaction
 I1 N/A: header is not a hover row (breadcrumb links underline: PASS) shot: SH-01 set
 I2 NOT VISUALLY REVIEWED shot: SH-01 focus (breadcrumb + action rings; heading focus has no outline flash)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (action press)
 I4 PASS test: shells.test.tsx, navigation-url.test.tsx (links/actions clickable)
 I5 PASS test: shells.test.tsx (Tab order, Enter activates)
 I6 N/A: no icon-only buttons in the header shot: n/a
 I7 N/A: no disabled state shot: n/a
States S1 NOT VISUALLY REVIEWED shot: SH-01 loading variant (title skeleton, never raw ids); S2-S9 N/A (chrome; denied/not-found use F11 anatomy at route level)
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition (content crossfade + 8px rise); M2 N/A (page crossfade covers exit); M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SH-01 set at 1440 + 390 (actions wrap below 768)
Accessibility A1 PASS test: shells.test.tsx (one h1, heading focus on section change); A2 PASS audit; A3 N/A (navigation announces via focus move)
Evidence
 Unit test file(s): shells.test.tsx, navigation-url.test.tsx
 Browser spec + test name(s): v2/shell.spec.ts SH-01-*
 Screenshots: SH-01-overview-default/researches-default/sector-detail-default/agents-default/models-default (L/D 1440/390)
 Videos: SH-08-page-transition
 Verdict: DONE

### SH-02 Sidebar (file: Sidebar.tsx, page: shell, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SH-02-expanded/collapsed/hover/focus/mobile (mark + Kardata 14/500 + 13/500 items)
 V2-V9 NOT VISUALLY REVIEWED shot: SH-02-expanded/collapsed/hover/focus/mobile (500 labels; sidebar tokens; w-60/w-14, h-8 items; 16px icons + labels aligned; nav rounded-md; edge border only; "Kardata", Soon badge, no raw ids; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: SH-02-hover (sidebar-accent inset hover)
 I2 NOT VISUALLY REVIEWED shot: SH-02-focus (nav + toggle rings)
 I3 NOT VISUALLY REVIEWED video: SH-02-collapse (active press)
 I4 PASS test: Sidebar.test.tsx (items + toggle clickable)
 I5 PASS test: Sidebar.test.tsx (Tab order, Enter activates)
 I6 NOT VISUALLY REVIEWED shot: SH-02-expanded (collapse IconButton labelled + tooltip)
 I7 N/A: Emails disabled shows Soon + tooltip (explains why) shot: SH-02-expanded
States S1-S9 N/A: static nav (expanded/collapsed/rail; collapse persists across reload, tested) shot: SH-02-collapsed/mobile
Motion M1 N/A (chrome); M2 N/A; M3 NOT VISUALLY REVIEWED video: SH-02-collapse (width 180ms, labels fade, indicator slides layoutId); M4 PASS (instant collapse)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SH-02-expanded/collapsed at 1440 + SH-02-mobile at 390 (rail + tooltips)
Accessibility A1 PASS test: Sidebar.test.tsx (nav semantics, current item); A2 PASS audit; A3 N/A (activation navigates)
Evidence
 Unit test file(s): Sidebar.test.tsx
 Browser spec + test name(s): v2/shell.spec.ts SH-02-*, v2/motion.spec.ts SH-02-collapse
 Screenshots: SH-02-expanded/collapsed/hover/focus (L/D 1440), SH-02-mobile (L/D 390)
 Videos: SH-02-collapse
 Verdict: DONE

### SH-03 Top bar (file: TopBar.tsx, page: shell, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SH-03-default (palette trigger + Ask Karbot + theme menu)
 V2-V9 NOT VISUALLY REVIEWED shot: SH-03-default (500 trigger text; tokens; h-12, bottom divider; trigger/Ask/theme aligned; trigger rounded-md; single divider; "Search..." + Ctrl K hint; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: SH-03-default (trigger hover)
 I2 NOT VISUALLY REVIEWED shot: SH-03 focus (trigger/Ask/theme rings)
 I3 NOT VISUALLY REVIEWED video: SH-05-open-close (trigger press opens palette)
 I4 PASS test: TopBar.test.tsx (all three clickable)
 I5 PASS test: TopBar.test.tsx (Tab order, Ctrl/Cmd+K opens palette)
 I6 NOT VISUALLY REVIEWED shot: SH-03 390 (icon-only trigger + Ask labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: static chrome (palette/theme states are SH-05/SH-04) shot: n/a
Motion M1-M3 N/A (chrome); M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SH-03-default at 1440/768/390 (icon-only below 768)
Accessibility A1 PASS test: TopBar.test.tsx (trigger names, K hint); A2 PASS audit; A3 N/A (opens overlays)
Evidence
 Unit test file(s): TopBar.test.tsx
 Browser spec + test name(s): v2/shell.spec.ts SH-03-default
 Screenshots: SH-03-default (L/D 1440/768/390)
 Videos: SH-05-open-close (trigger press opens palette)
 Verdict: DONE

### SH-04 Theme menu (file: ThemeMenu.tsx, page: shell + workspace rail, parent: TopBar/SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: SH-04-open (IconButton + radio menu System/Light/Dark)
 V2-V9 NOT VISUALLY REVIEWED shot: SH-04-open (500 menu text; popover tokens; menu p-1; icon/check rows aligned; menu rounded-lg; single border; "Theme", checked active; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: SH-04-open (menu item hover)
 I2 NOT VISUALLY REVIEWED shot: SH-04 focus (trigger + item rings)
 I3 NOT VISUALLY REVIEWED video: SH-05-open-close (menu press reference)
 I4 PASS test: theme-menu.test.tsx (trigger + items clickable)
 I5 PASS test: theme-menu.test.tsx (arrows/Home/End/Enter/Esc)
 I6 NOT VISUALLY REVIEWED shot: SH-04-open (trigger IconButton shows resolved icon + "Theme" tooltip)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: synchronous menu (selection applies + persists immediately) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-05-open-close (menu enter reference); M2 PASS (menu exit reference); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SH-04-open at 1440 + 390
Accessibility A1 PASS test: theme-menu.test.tsx (menu + radio semantics); A2 PASS audit; A3 N/A (applies instantly)
Evidence
 Unit test file(s): theme-menu.test.tsx, theme.test.tsx
 Browser spec + test name(s): v2/shell.spec.ts SH-04-open
 Screenshots: SH-04-open (L/D 1440)
 Videos: SH-05-open-close (menu motion reference)
 Verdict: DONE

### SH-05 Command palette (file: CommandPalette.tsx, page: shell, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SH-05-open/filtered/empty (cmdk input + ListRow options + footer hints)
 V2-V9 NOT VISUALLY REVIEWED shot: SH-05-open/filtered/empty (500 input/options; popover tokens; cmdk padding; icon/label/hint aligned; cmdk rounded-lg; single border; sector names, no raw keys; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: SH-05-open (option hover)
 I2 NOT VISUALLY REVIEWED shot: SH-05 focus (input + option rings)
 I3 NOT VISUALLY REVIEWED video: SH-05-open-close (option press navigates)
 I4 PASS test: command-palette.test.tsx (options clickable)
 I5 PASS test: command-palette.test.tsx (arrows/Enter/Esc/typeahead)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States S1-S3 N/A (synchronous search); S4-S6 N/A (no async errors); S7 N/A (results cap, no pager); S8 N/A (names truncate + tooltip); S9 N/A shot: SH-05-filtered/empty
Motion M1 NOT VISUALLY REVIEWED video: SH-05-open-close (cmdk enter); M2 NOT VISUALLY REVIEWED video: SH-05-open-close (cmdk exit); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SH-05 set at 1440 + 390
Accessibility A1 PASS test: command-palette.test.tsx (combobox/listbox semantics); A2 PASS audit; A3 PASS (result count announced)
Evidence
 Unit test file(s): command-palette.test.tsx
 Browser spec + test name(s): v2/shell.spec.ts SH-05-*, v2/motion.spec.ts SH-05-open-close
 Screenshots: SH-05-open/filtered/empty (L/D 1440/390)
 Videos: SH-05-open-close
 Verdict: DONE

### SH-06 Toaster (file: App.tsx + lib/toast.ts, page: shell, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SH-06-success/error (sonner card + title + action)
 V2-V9 NOT VISUALLY REVIEWED shot: SH-06-success/error (500 title; popover tokens; 356px, offset 16, gap 8; icon/title/action aligned; toast rounded-lg; single border; humanized outcomes; dark holds)
Interaction
 I1 N/A: toasts are read-only (actions excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: SH-06 focus (action + dismiss rings)
 I3 NOT VISUALLY REVIEWED video: SH-06-toast (action press)
 I4 PASS test: toast.test.ts (actions/dismiss clickable)
 I5 PASS test: toast.test.ts (Tab + Enter/Esc)
 I6 N/A: dismiss is labelled with tooltip: NOT VISUALLY REVIEWED shot: SH-06-error
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: transient outcomes only (4000ms, errors 8000ms + action) shot: SH-06-success/error
Motion M1 NOT VISUALLY REVIEWED video: SH-06-toast (slide+fade enter); M2 NOT VISUALLY REVIEWED video: SH-06-toast (exit); M3 N/A; M4 PASS (global guard zeroes transitions)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SH-06 set at 1440 + 390
Accessibility A1 PASS test: toast.test.ts (status/alert roles); A2 PASS audit; A3 PASS (toast content announced)
Evidence
 Unit test file(s): toast.test.ts
 Browser spec + test name(s): v2/shell.spec.ts SH-06-*, v2/motion.spec.ts SH-06-toast
 Screenshots: SH-06-success/error (L/D)
 Videos: SH-06-toast
 Verdict: DONE

### SH-08 Page transitions (file: lib/motion.ts + useNavigation, page: all, parent: App)
Visual V1-V9 N/A: transition choreography, no static surface (proven on video) video: SH-08-page-transition
Interaction I1-I7 N/A: no interactive surface of its own video: n/a
States S1-S9 N/A: applies to every section change shot: n/a
Motion
 M1 NOT VISUALLY REVIEWED video: SH-08-page-transition (new: opacity + 4px rise 180ms)
 M2 NOT VISUALLY REVIEWED video: SH-08-page-transition (old: opacity 120ms)
 M3 N/A: navigation only video: n/a
 M4 PASS test: SH-08-page-transition-reduced (instant, focus/scroll intact)
Responsive R1-R4 NOT VISUALLY REVIEWED video: transition at 1440 + 390 viewports
Accessibility A1 PASS test: navigation-url.test.tsx (heading focus on change); A2 N/A (no surface); A3 N/A (focus move announces)
Evidence
 Unit test file(s): navigation-url.test.tsx, motion-presets.test.tsx
 Browser spec + test name(s): v2/motion.spec.ts SH-08-page-transition(+reduced)
 Screenshots: n/a (transition; stills would prove nothing)
 Videos: SH-08-page-transition, SH-08-page-transition-reduced
 Verdict: DONE

### OV-01 Header (file: App.tsx header config, page: Overview, parent: App)
Visual
 V1 PASS (opened) shot: OV-02-default header in frame (PageTitle + Description + New sector)
 V2-V9 PASS (opened) shot: OV-02-default (500 title; tokens; frame; h1 aligned; no cards; no borders; "Overview" + "Research activity across all sectors."; dark holds)
Interaction I1 N/A (header); I2/I4/I5 PASS test: ResearchesPage.test.tsx (New sector ring/Tab/Enter); I3 NOT VISUALLY REVIEWED video: RS-06-submit; I6-I7 N/A
States S1-S9 N/A: header persists (dialog states are RS-06) shot: n/a
Motion M1 PASS (opened) video: SH-08-page-transition; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: OV-02 set at 1440 + 390 (action wraps)
Accessibility A1 PASS test: ResearchesPage.test.tsx (one h1); A2 PASS audit; A3 N/A
Evidence
 Unit test file(s): ResearchesPage.test.tsx, create-sector-dialog.test.tsx
 Browser spec + test name(s): v2/overview.spec.ts OV-02-* (header in frame)
 Screenshots: OV-02-default (L/D 1440/390, header in frame)
 Videos: RS-06-submit (New sector press)
 Verdict: DONE

### OV-02 Stat tiles (file: Dashboard.tsx, page: Overview, parent: App)
Visual
 V1 PASS (opened) shot: OV-02-default/loading/error (Label + Numeric stat + Caption)
 V2-V9 PASS (opened) shot: OV-02-default/loading/error (500 stat 24/32 tabular; card tokens; 4/2/1-col grid 16px gaps; label/value/caption aligned; tiles rounded-lg; single borders; "Needs attention", fixture-derived values; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: OV-02-default (tile hover: bg + border-strong, no shadow)
 I2 NOT VISUALLY REVIEWED shot: OV-02 focus (tile link rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (tile press navigates)
 I4 PASS test: Dashboard.test.tsx (tiles are links to pre-filtered Researches)
 I5 PASS test: Dashboard.test.tsx (Tab + Enter)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: OV-02-loading (skeleton tiles mirror layout)
 S2 N/A: tiles always render (zero is a value, not an empty) shot: n/a
 S3 N/A: no filtering shot: n/a
 S4 NOT VISUALLY REVIEWED shot: OV-02-error ("Unavailable" muted + retry icon button)
 S5-S7 N/A: denied renders the error pattern; no paging shot: OV-02-error
 S8 N/A: counts only shot: n/a
 S9 N/A: no pending action (retry swaps inline) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SH-08-page-transition (tiles stagger on first mount); M2 N/A; M3 PASS (count-up 240ms first mount only); M4 PASS (final value, no count-up)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: OV-02 set at 1440 + 390 (1-col stack)
Accessibility A1 PASS test: Dashboard.test.tsx (tiles are links with names); A2 PASS audit; A3 N/A (values render once)
Evidence
 Unit test file(s): Dashboard.test.tsx
 Browser spec + test name(s): v2/overview.spec.ts OV-02-default/loading/error
 Screenshots: OV-02-default/loading/error (L/D 1440/390)
 Videos: SH-08-page-transition (enter reference; count-up asserted in unit tests)
 Verdict: DONE

### OV-03 Email notice: REMOVED (was Dashboard.tsx, page: Overview)
Removed from Overview entirely per plan; email coming-soon lives on the
Emails page (EM-01). No checklist (nothing to verify). Proven by the
OV-02 screenshots (no email notice in frame) and Dashboard.test.tsx.

### OV-04 Recent sectors panel (file: Dashboard.tsx, page: Overview, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: OV-04-default/hover/empty/loading/error/long-names (SectionCard + rows: name/topic + badge + count + time + chevron)
 V2-V9 NOT VISUALLY REVIEWED shot: OV-04-default/hover/empty/loading/error/long-names (500 names; card tokens; SectionCard p-4; name/topic/badge/count/time/chevron aligned; card rounded-lg; ListRow dividers; one badge per row, humanized; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: OV-04-hover (row inset hover; chevron shifts 2px; divider hides)
 I2 NOT VISUALLY REVIEWED shot: OV-04 focus (row + View-all rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (row press navigates)
 I4 PASS test: Dashboard.test.tsx, research-presentation.test.tsx (rows + View-all clickable)
 I5 PASS test: Dashboard.test.tsx (Tab order, Enter navigates)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: OV-04-loading (3 row skeletons mirror layout)
 S2 NOT VISUALLY REVIEWED shot: OV-04-empty (first-run + New sector)
 S3 N/A: no filtering on Overview shot: n/a
 S4 NOT VISUALLY REVIEWED shot: OV-04-error (error anatomy + Retry)
 S5 NOT VISUALLY REVIEWED shot: OV-04 denied variant (denied anatomy)
 S6 N/A: offline renders the error pattern shot: OV-04-error
 S7 N/A: 6 recent rows, no paging (View all navigates) shot: n/a
 S8 NOT VISUALLY REVIEWED shot: OV-04-long-names (120-char names truncate + tooltip)
 S9 N/A: no pending action shot: n/a
Motion M1 PASS (opened) video: SH-08-page-transition; M2 N/A; M3 N/A (chevron shift is CSS); M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: OV-04 set at 1440 + 390
Accessibility A1 PASS test: Dashboard.test.tsx (heading level, row names); A2 PASS audit; A3 N/A (static list)
Evidence
 Unit test file(s): Dashboard.test.tsx, research-presentation.test.tsx
 Browser spec + test name(s): v2/overview.spec.ts OV-04-*
 Screenshots: OV-04-default/hover/empty/loading/error/long-names (L/D 1440/390)
 Videos: SH-08-page-transition (enter reference)
 Verdict: DONE

### OV-05 Recent companies panel (file: Dashboard.tsx, page: Overview, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: OV-05-default/hover/empty (SectionCard + rows: name/sector + stage + StageSteps + badge)
 V2-V9 NOT VISUALLY REVIEWED shot: OV-05-default/hover/empty (500 names; card tokens; SectionCard p-4; name/sector/stage/steps/badge aligned; card rounded-lg; ListRow dividers; stage labels + "Stage 2 of 4" tooltips; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: OV-05-hover (row inset hover)
 I2 NOT VISUALLY REVIEWED shot: OV-05 focus (row + View-all rings)
 I3 NOT VISUALLY REVIEWED video: SH-08-page-transition (row press navigates to landing)
 I4 PASS test: Dashboard.test.tsx (rows + View-all clickable)
 I5 PASS test: Dashboard.test.tsx (Tab + Enter)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1 (loading skeletons) / S2 (first-run empty) / S4 (error) / S5 (denied) NOT VISUALLY REVIEWED shot: OV-05 set; S3/S6/S7/S9 N/A (no filter/offline-pattern/paging/pending); S8 PASS (long names truncate + tooltip) shot: OV-05-default
Motion M1 PASS (opened) video: SH-08-page-transition; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: OV-05 set at 1440 + 390
Accessibility A1 PASS test: Dashboard.test.tsx (heading level, stage text not color-alone); A2 PASS audit; A3 N/A (static list)
Evidence
 Unit test file(s): Dashboard.test.tsx, research-presentation.test.tsx
 Browser spec + test name(s): v2/overview.spec.ts OV-05-default/hover/empty
 Screenshots: OV-05-default/hover/empty (L/D 1440/390)
 Videos: SH-08-page-transition (enter reference)
 Verdict: DONE

### RS-01 Header (file: App.tsx header config, page: Researches, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: RS-02-sectors header in frame ("Researches" + description + always-visible New sector)
 V2-V9 NOT VISUALLY REVIEWED shot: RS-02-sectors (500 title; tokens; frame; h1 aligned; no cards; no borders; label-map title; dark holds)
Interaction I1 N/A; I2/I4/I5 PASS test: ResearchesPage.test.tsx (New sector); I3 NOT VISUALLY REVIEWED video: RS-06-submit; I6-I7 N/A
States S1-S9 N/A: header persists (dialog states are RS-06) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: RS-02-tab-switch; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: RS-02 set at 1440 + 390 (action wraps)
Accessibility A1 PASS test: ResearchesPage.test.tsx (one h1); A2 PASS audit; A3 N/A
Evidence
 Unit test file(s): ResearchesPage.test.tsx
 Browser spec + test name(s): v2/researches.spec.ts RS-02-* (header in frame)
 Screenshots: RS-02-sectors (L/D 1440/390, header in frame)
 Videos: RS-06-submit (New sector press)
 Verdict: DONE

### RS-02 Tabs (file: ResearchesPage.tsx, page: Researches, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: RS-02-sectors/companies (underline TabsList + count badges)
 V2-V9 NOT VISUALLY REVIEWED shot: RS-02-sectors/companies (500 tab text; tokens; below header, outside cards; tabs + indicator aligned; indicator pill; list divider; "Sectors"/"Companies" + tabular counts; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: RS-02-sectors (tab hover: text-foreground)
 I2 NOT VISUALLY REVIEWED shot: RS-02 focus (tab rings, inset recipe)
 I3 NOT VISUALLY REVIEWED video: RS-02-tab-switch (tab press + indicator slide)
 I4 PASS test: ResearchesPage.test.tsx, navigation-url.test.tsx (tabs clickable, URL syncs)
 I5 PASS test: ResearchesPage.test.tsx (arrows/Home/End per tablist contract)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9 N/A: static tabs (counts render with data) shot: n/a
Motion M1 N/A (chrome); M2 N/A; M3 NOT VISUALLY REVIEWED video: RS-02-tab-switch (indicator slides 180ms layoutId); M4 PASS (jumps)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: RS-02 set at 1440 + 390
Accessibility A1 PASS test: ResearchesPage.test.tsx (tablist/tab/tabpanel semantics); A2 PASS audit; A3 PASS (tab switch announced)
Evidence
 Unit test file(s): ResearchesPage.test.tsx, navigation-url.test.tsx
 Browser spec + test name(s): v2/researches.spec.ts RS-02-*, v2/motion.spec.ts RS-02-tab-switch
 Screenshots: RS-02-sectors/companies (L/D 1440/390)
 Videos: RS-02-tab-switch
 Verdict: DONE

### RS-03 Toolbar (file: ResearchesPage.tsx, page: Researches, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: RS-03-default/filtered (SearchField + Status Select + live count)
 V2-V9 NOT VISUALLY REVIEWED shot: RS-03-default/filtered (500 select text; tokens; one row, 8px gaps; search/select/count aligned; controls rounded-md; no borders; "Search sectors", "Status: All", "32 sectors"; dark holds)
Interaction
 I1 N/A: toolbar is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: RS-03 focus (search + select rings)
 I3 N/A: typing/selecting has no press state shot: n/a
 I4 PASS test: ResearchesPage.test.tsx (search + select operable)
 I5 PASS test: ResearchesPage.test.tsx (select keyboard, search typing)
 I6 N/A: no icon-only buttons (search Clear is labelled: PASS) shot: RS-03-filtered
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A except S3: toolbar persists; S3 NOT VISUALLY REVIEWED shot: RS-03-filtered (filtered count live)
Motion M1-M4 N/A: static toolbar video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: RS-03-default/filtered at 1440 + 390 (wraps, no clip)
Accessibility A1 PASS test: ResearchesPage.test.tsx (search/select labels); A2 PASS audit; A3 PASS (count aria-live polite)
Evidence
 Unit test file(s): ResearchesPage.test.tsx
 Browser spec + test name(s): v2/researches.spec.ts RS-03-default/filtered
 Screenshots: RS-03-default/filtered (L/D 1440/390)
 Videos: n/a (static toolbar)
 Verdict: DONE

### RS-04 Sectors table (file: ResearchesPage.tsx + DataTable.tsx, page: Researches, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: RS-04-default/hover/sorted/empty/filtered-empty/loading/error/denied/offline/many (Sector/Status/Companies/Updated + chevron)
 V2-V9 NOT VISUALLY REVIEWED shot: RS-04-default/hover/sorted/empty/filtered-empty/loading/error/denied/offline/many (500 names; tokens; DataTable rows; sortable headers + cells aligned, numbers right tabular; rows rounded-md; table recipe dividers; humanized statuses; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: RS-04-hover (row inset hover)
 I2 NOT VISUALLY REVIEWED shot: RS-04 focus (headers, rows, pager rings)
 I3 NOT VISUALLY REVIEWED video: RS-02-tab-switch (row press reference)
 I4 PASS test: ResearchesPage.test.tsx, data-table.test.tsx (sort/rows/pager clickable)
 I5 PASS test: ResearchesPage.test.tsx (headers operable, Enter opens row)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: RS-04-loading (8 skeleton rows)
 S2 NOT VISUALLY REVIEWED shot: RS-04-empty (first-run + New sector)
 S3 NOT VISUALLY REVIEWED shot: RS-04-filtered-empty (no matches + Clear filters)
 S4 NOT VISUALLY REVIEWED shot: RS-04-error (error anatomy + Retry)
 S5 NOT VISUALLY REVIEWED shot: RS-04-denied (denied anatomy)
 S6 NOT VISUALLY REVIEWED shot: RS-04-offline (offline anatomy)
 S7 NOT VISUALLY REVIEWED shot: RS-04-many (132 rows, "Showing 50 of 132" + Show more, page scrolls)
 S8 N/A: names truncate + tooltip (no dedicated 120-char state) shot: RS-04-default
 S9 N/A: no pending button (sort/paging swap inline) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: RS-02-tab-switch; M2-M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: RS-04 set at 1440 + 390 (stacked cards at 390)
Accessibility A1 PASS test: ResearchesPage.test.tsx (table/sort semantics); A2 PASS audit; A3 PASS (sort + count announced)
Evidence
 Unit test file(s): ResearchesPage.test.tsx, data-table.test.tsx
 Browser spec + test name(s): v2/researches.spec.ts RS-04-*
 Screenshots: RS-04-default/hover/sorted/empty/filtered-empty/loading/error/denied/offline/many (L/D 1440/390)
 Videos: RS-02-tab-switch (enter reference)
 Verdict: DONE

### RS-05 Companies table (file: ResearchesPage.tsx + DataTable.tsx, page: Researches, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: RS-05-default/paging/empty/2000/more-error (Company/Sector/Stage/Status + footer)
 V2-V9 NOT VISUALLY REVIEWED shot: RS-05-default/paging/empty/2000/more-error (500 names; sector links primary-text; tokens; DataTable rows; cells aligned; rows rounded-md; table dividers; stage labels + steps; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: RS-05-default (row hover; sector link underline)
 I2 NOT VISUALLY REVIEWED shot: RS-05 focus (rows, links, pager rings)
 I3 NOT VISUALLY REVIEWED video: RS-02-tab-switch (row press reference)
 I4 PASS test: ResearchesPage.test.tsx, company-window.test.tsx (rows/links/pager clickable)
 I5 PASS test: ResearchesPage.test.tsx (Tab order, Enter opens)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: RS-05 loading variant (skeleton rows)
 S2 NOT VISUALLY REVIEWED shot: RS-05-empty (first-run empty)
 S3 NOT VISUALLY REVIEWED shot: RS-05-empty filtered variant (no matches + Clear)
 S4 N/A: errors at tab level (RS-04 pattern) shot: n/a
 S5-S6 N/A: denied/offline at tab level shot: n/a
 S7 NOT VISUALLY REVIEWED shot: RS-05-paging/2000 (100/page server windows, "Showing 100 of 1,240", 2,000-walk footer without button)
 S8 N/A: names truncate + tooltip shot: RS-05-default
 S9 NOT VISUALLY REVIEWED shot: RS-05-paging (Show-more pending, rows stay; more-error retains + alerts)
Motion M1 NOT VISUALLY REVIEWED video: RS-02-tab-switch; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: RS-05 set at 1440 + 390 (stacked cards at 390)
Accessibility A1 PASS test: ResearchesPage.test.tsx (table semantics); A2 PASS audit; A3 PASS (paging counts announced)
Evidence
 Unit test file(s): ResearchesPage.test.tsx, company-window.test.tsx
 Browser spec + test name(s): v2/researches.spec.ts RS-05-*
 Screenshots: RS-05-default/paging/empty/2000/more-error (L/D 1440/390)
 Videos: RS-02-tab-switch (enter reference)
 Verdict: DONE

### RS-06 New sector dialog (file: CreateSectorDialog.tsx, page: Researches + Overview, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: RS-06-open/error/pending (480 dialog: title + description + Name/Topic + footer)
 V2-V9 NOT VISUALLY REVIEWED shot: RS-06-open/error/pending (500 labels; tokens; 480, 16px gaps, sticky footer; single column; dialog rounded-xl; single borders; "New sector", helpers, no raw keys; dark holds)
Interaction
 I1 N/A: form has no hover rows shot: n/a
 I2 NOT VISUALLY REVIEWED shot: RS-06 focus (Name autofocus + footer rings)
 I3 NOT VISUALLY REVIEWED video: RS-06-submit (Create press)
 I4 PASS test: create-sector-dialog.test.tsx (fields + actions operable)
 I5 PASS test: create-sector-dialog.test.tsx (Tab order, Esc closes unless pending, focus returns)
 I6 N/A: no icon-only buttons shot: n/a
 I7 N/A: no disabled state (pending blocks close instead) shot: RS-06-pending
States
 S1 N/A: synchronous form shot: n/a
 S2-S3 N/A: no empty/filtered states shot: n/a
 S4 NOT VISUALLY REVIEWED shot: RS-06-error (inline field error)
 S5-S6 N/A: denied/offline at page level shot: n/a
 S7-S8 N/A: no paging/overflow shot: n/a
 S9 NOT VISUALLY REVIEWED shot: RS-06-pending (Create pending, cannot close, toast + navigate on success)
Motion M1 NOT VISUALLY REVIEWED video: RS-06-submit (dialog enter); M2 NOT VISUALLY REVIEWED video: RS-06-submit (dialog exit); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: RS-06 set at 1440 + 390
Accessibility A1 PASS test: create-sector-dialog.test.tsx (dialog semantics, labels, autofocus); A2 PASS audit; A3 PASS (error + success announced)
Evidence
 Unit test file(s): create-sector-dialog.test.tsx
 Browser spec + test name(s): v2/researches.spec.ts RS-06-*, v2/motion.spec.ts RS-06-submit
 Screenshots: RS-06-open/error/pending (L/D 1440/390)
 Videos: RS-06-submit
 Verdict: DONE

### SL-01 Header (file: App.tsx header config + SectorLanding.tsx, page: sector landing, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SL-01-default/long-name/loading (breadcrumb + name + badge + topic + meta + actions)
 V2-V9 NOT VISUALLY REVIEWED shot: SL-01-default/long-name/loading (500 name; tokens; same container as content; h1 aligned; no cards; no borders; sector name, "Created 3 Sep 2026 · Updated 2h ago"; dark holds)
Interaction
 I1 N/A: header is not a hover row (breadcrumb links underline: PASS) shot: SL-01 set
 I2 NOT VISUALLY REVIEWED shot: SL-01 focus (breadcrumb + action rings)
 I3 NOT VISUALLY REVIEWED video: SL-03-open-close (View progress press)
 I4 PASS test: sector-workspace.test.tsx, SectorDetailPage.test.tsx (links/actions clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Enter activates)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1 NOT VISUALLY REVIEWED shot: SL-01-loading (title skeleton); S2-S9 N/A (chrome; SL-06 covers not-found/denied)
Motion M1 NOT VISUALLY REVIEWED video: SL-03-open-close (header rides the page enter); M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SL-01 set at 1440 + 390 (120-char name truncates + tooltip; actions wrap)
Accessibility A1 PASS test: sector-workspace.test.tsx (one h1); A2 PASS audit; A3 N/A
Evidence
 Unit test file(s): sector-workspace.test.tsx, SectorDetailPage.test.tsx
 Browser spec + test name(s): v2/landing.spec.ts SL-01-*
 Screenshots: SL-01-default/long-name/loading (L/D 1440/390)
 Videos: SL-03-open-close (enter reference)
 Verdict: DONE

### SL-02 Research status panel (file: SectorLanding.tsx, page: sector landing, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SL-02-draft/planned/running/paused/failed/complete/progress-error (summary + 4 tiles + next-step hint)
 V2-V9 NOT VISUALLY REVIEWED shot: SL-02-draft/planned/running/paused/failed/complete/progress-error (500 tile values; card tokens; SectionCard + tile row; summary/tiles/hint aligned; card rounded-lg; single borders; statusSummary map sentences, no contradictions; dark holds)
Interaction
 I1 N/A: panel is read-only (hint link excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: SL-02 focus (Review-plan link ring)
 I3 NOT VISUALLY REVIEWED video: SL-03-open-close (link press navigates to Plan tab)
 I4 PASS test: sector-workspace.test.tsx (hint link clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab + Enter)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: SL-02 loading variant (tile skeletons)
 S2-S3 N/A: panel always renders for a routed sector shot: n/a
 S4 NOT VISUALLY REVIEWED shot: SL-02-progress-error ("Unavailable" + retry)
 S5-S6 N/A: denied/offline at page level (SL-06) shot: n/a
 S7 N/A: no paging shot: n/a
 S8 N/A: tiles only shot: n/a
 S9 N/A: no pending action shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: SL-03-open-close (tiles stagger; bar fills from 0); M2 N/A; M3 PASS (progress bar fill); M4 PASS (static bar)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SL-02 set at 1440 + 390 (tiles wrap)
Accessibility A1 PASS test: sector-workspace.test.tsx (table-driven 9-state summary/tile test); A2 PASS audit; A3 N/A (values render once)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/landing.spec.ts SL-02-*
 Screenshots: SL-02-draft/planned/running/paused/failed/complete/progress-error (L/D 1440/390)
 Videos: SL-03-open-close (enter reference)
 Verdict: DONE

### SL-03 Research progress dialog (file: SectorLanding.tsx + workspace-parts.tsx, page: sector landing, parent: SectorLanding)
Visual
 V1 NOT VISUALLY REVIEWED shot: SL-03-open/scrolled (title + badge + condensed plan + PL-08 panel + footer)
 V2-V9 NOT VISUALLY REVIEWED shot: SL-03-open/scrolled (500 titles; tokens; min(92vw,880px); header/body/footer aligned; dialog rounded-xl; single borders; "Research progress"; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: SL-03-open (ledger row hover via PL-08)
 I2 NOT VISUALLY REVIEWED shot: SL-03 focus (Show-plan, ledger, footer rings)
 I3 NOT VISUALLY REVIEWED video: SL-03-open-close (Open workspace press)
 I4 PASS test: sector-workspace.test.tsx, work-review.test.tsx (controls clickable)
 I5 PASS test: sector-workspace.test.tsx (Tab order, Esc closes, focus returns)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9: condensed plan collapsed by default ("Show plan details"); ledger states are PL-08 shot: SL-03-open/scrolled
Motion M1 NOT VISUALLY REVIEWED video: SL-03-open-close (dialog enter); M2 NOT VISUALLY REVIEWED video: SL-03-open-close (dialog exit); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SL-03-open/scrolled at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (dialog semantics); A2 PASS audit; A3 PASS (ledger counts announced via PL-08)
Evidence
 Unit test file(s): sector-workspace.test.tsx, work-review.test.tsx
 Browser spec + test name(s): v2/landing.spec.ts SL-03-*, v2/motion.spec.ts SL-03-open-close
 Screenshots: SL-03-open/scrolled (L/D 1440/390)
 Videos: SL-03-open-close
 Verdict: DONE

### SL-04 Intake review dialog: see PL-09 (same component)
No separate checklist; PL-09 block covers the shared dialog. The SL-04
entry exists in the plan only as a pointer.

### SL-05 Companies section (file: CompaniesSection.tsx, page: sector landing, parent: SectorLanding)
Visual
 V1 NOT VISUALLY REVIEWED shot: SL-05-default/filtered/empty-running/empty-finished/1000/denied/error/more-error (header + count + toolbar + DataTable + footer)
 V2-V9 NOT VISUALLY REVIEWED shot: SL-05-default/filtered/empty-running/empty-finished/1000/denied/error/more-error (500 names; card tokens; SectionCard frame; toolbar/table/footer aligned; card rounded-lg; table dividers; humanized statuses, labels-map empties; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: SL-05-default (row inset hover)
 I2 NOT VISUALLY REVIEWED shot: SL-05 focus (search, select, rows, pager rings)
 I3 NOT VISUALLY REVIEWED video: SL-03-open-close (row press reference)
 I4 PASS test: companies-section.test.tsx (search/select/rows/pager clickable)
 I5 PASS test: companies-section.test.tsx (Tab order, Enter opens)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: SL-05 loading variant (skeleton rows)
 S2 NOT VISUALLY REVIEWED shot: SL-05-empty-running/empty-finished (per-state empties; running shows pulsing dot)
 S3 NOT VISUALLY REVIEWED shot: SL-05-filtered (filtered empty + clear)
 S4 NOT VISUALLY REVIEWED shot: SL-05-error (error anatomy + Retry)
 S5 NOT VISUALLY REVIEWED shot: SL-05-denied (denied anatomy)
 S6 N/A: offline renders the error pattern shot: SL-05-error
 S7 NOT VISUALLY REVIEWED shot: SL-05-1000 (paging with truthful counts; 5s live poll keeps windows)
 S8 N/A: names truncate + tooltip shot: SL-05-default
 S9 NOT VISUALLY REVIEWED shot: SL-05-more-error (more-pending + more-error retains + alerts)
Motion M1 NOT VISUALLY REVIEWED video: SL-03-open-close; M2-M4 N/A/N/A/PASS (poll swaps instantly; pulse static under reduced motion)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SL-05 set at 1440 + 390 (stacked cards at 390)
Accessibility A1 PASS test: companies-section.test.tsx (table semantics); A2 PASS audit; A3 PASS (counts + arrivals announced)
Evidence
 Unit test file(s): companies-section.test.tsx
 Browser spec + test name(s): v2/landing.spec.ts SL-05-*
 Screenshots: SL-05-default/filtered/empty-running/empty-finished/1000/denied/error/more-error (L/D 1440/390)
 Videos: SL-03-open-close (enter reference)
 Verdict: DONE

### SL-06 Not found / denied (file: SectorLanding.tsx, page: sector landing, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: SL-06-not-found/denied (F11 anatomy: medallion + title + step + action)
 V2-V9 NOT VISUALLY REVIEWED shot: SL-06-not-found/denied (500 titles; muted medallions; centred; pill; no borders; exact next steps, no developer paths; dark holds)
Interaction I1 N/A; I2/I4/I5 PASS test: sector-workspace.test.tsx (way-back ring/Tab/Enter); I3 NOT VISUALLY REVIEWED video: SL-03-open-close; I6-I7 N/A
States S1-S9 N/A: these states ARE the not-found/denied treatment shot: SL-06 set
Motion M1 NOT VISUALLY REVIEWED video: SL-03-open-close; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SL-06 set at 1440 + 390
Accessibility A1 PASS test: sector-workspace.test.tsx (titles announced); A2 PASS audit; A3 N/A (static on mount)
Evidence
 Unit test file(s): sector-workspace.test.tsx
 Browser spec + test name(s): v2/landing.spec.ts SL-06-not-found/denied
 Screenshots: SL-06-not-found/denied (L/D 1440/390)
 Videos: n/a (static states)
 Verdict: DONE

### WS-01 Layout (file: SectorWorkspace.tsx, page: sector workspace, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-01-default/1280/1279-drawer-open/768/767-sessions-drawer/390/rail-hidden (280/centre/360 grid, sidebar rails, drawers)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-01-default/1280/1279-drawer-open/768/767-sessions-drawer/390/rail-hidden (chrome only; sidebar tokens; w-70/w-90, centre min 480; rails aligned; drawer rounded-xl; subtle rail edges; no copy of its own; dark holds)
Interaction
 I1 N/A: layout is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: WS-01 focus (rail toggle + drawer trigger rings)
 I3 NOT VISUALLY REVIEWED video: WS-01-rail-drawer (toggle press)
 I4 PASS test: workspace-session-creation.test.tsx (toggle + triggers clickable)
 I5 PASS test: workspace-session-creation.test.tsx (Tab + Enter)
 I6 NOT VISUALLY REVIEWED shot: WS-01-default (rail IconButton labelled + tooltip, persisted)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: layout persists (single drawer instance per breakpoint, tested) shot: WS-01-1279-drawer-open/767-sessions-drawer
Motion M1 N/A (chrome); M2 N/A; M3 NOT VISUALLY REVIEWED video: WS-01-rail-drawer (rail width/opacity 180ms; side-sheet drawers); M4 PASS (instant)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-01 set at 1440/1280/1279/768/767/390 (drawers at breakpoints, no spill)
Accessibility A1 PASS test: workspace-session-creation.test.tsx (toggle pressed state, drawer semantics); A2 PASS audit; A3 N/A (layout only)
Evidence
 Unit test file(s): workspace-session-creation.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-01-*, v2/motion.spec.ts WS-01-rail-drawer
 Screenshots: WS-01-default/1280/1279-drawer-open/768/767-sessions-drawer/390/rail-hidden (L/D)
 Videos: WS-01-rail-drawer
 Verdict: DONE

### WS-02 Left rail header (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-02-default/long-name (back IconButton + CardTitle name + Caption badge/count)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-02-default/long-name (500 name; tokens; rail padding; button/name/caption aligned; n/a cards; no borders; sector name + status + "4 companies"; dark holds)
Interaction
 I1 N/A: header is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: WS-02 focus (back ring)
 I3 NOT VISUALLY REVIEWED video: WS-01-rail-drawer (back press reference)
 I4 PASS test: workspace-session-creation.test.tsx (back clickable)
 I5 PASS test: workspace-session-creation.test.tsx (Tab + Enter)
 I6 NOT VISUALLY REVIEWED shot: WS-02-default (Back-to-sector-summary IconButton labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: header persists shot: n/a
Motion M1-M4 N/A: static chrome video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-02 set at 1440 + 390 (120-char name truncates + tooltip)
Accessibility A1 PASS test: workspace-session-creation.test.tsx (back name, heading level); A2 PASS audit; A3 N/A
Evidence
 Unit test file(s): workspace-session-creation.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-02-default/long-name
 Screenshots: WS-02-default/long-name (L/D 1440/390)
 Videos: n/a (static header)
 Verdict: DONE

### WS-03 Session type switch (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 PASS (opened) shot: WS-03-chats (segmented "Research" | "Chats (6)" contiguous label + elevated thumb on the active tab)
 V2-V9 PASS (opened) shot: WS-03-chats (contiguous tabular-nums labels pinned by WS-03-tab-labels; elevated thumb surface-raised + border on active tab only; options + thumb aligned; no borders; "Research", "Chats (6)"; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: WS-03-research (option hover)
 I2 NOT VISUALLY REVIEWED shot: WS-03 focus (option rings)
 I3 NOT VISUALLY REVIEWED video: WS-03-switch (option press + thumb slide)
 I4 PASS test: workspace-tabs.test.tsx (options clickable)
 I5 PASS test: workspace-tabs.test.tsx (arrows switch, Enter selects)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9 N/A: static switch (counts render with data) shot: n/a
Motion M1-M2 N/A (chrome); M3 NOT VISUALLY REVIEWED video: WS-03-switch (thumb slides layoutId 180ms); M4 PASS (jumps)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-03 set at 1440 + 390
Accessibility A1 PASS test: workspace-tabs.test.tsx (segmented semantics, selected state); A2 PASS audit; A3 PASS (switch announced)
Evidence
 Unit test file(s): workspace-tabs.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-03-*, v2/motion.spec.ts WS-03-switch
 Screenshots: WS-03-research/chats (L/D 1440/390)
 Videos: WS-03-switch
 Verdict: DONE

### WS-04 Session list items (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 PASS (opened) shot: WS-04-default/hover/selected/menu-open/empty/many/long-titles (icon + title + caption + More)
 V2-V9 PASS (opened) shot: WS-04-default/hover/selected/menu-open/empty/many/long-titles (500 selected title only, 400 rest; tokens; comfortable rows; icon/title/caption/More aligned; rows rounded-md; ListRow dividers; status labels + relative times; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: WS-04-hover (row inset hover; More appears on hover/focus, always on touch)
 I2 NOT VISUALLY REVIEWED shot: WS-04 focus (row + More rings)
 I3 NOT VISUALLY REVIEWED video: WS-03-switch (row press reference)
 I4 PASS test: workspace-session-creation.test.tsx (rows + More clickable)
 I5 PASS test: workspace-session-creation.test.tsx (Tab order, Enter opens, menu keyboard)
 I6 NOT VISUALLY REVIEWED shot: WS-04-menu-open (More IconButton labelled + tooltip; Rename/Delete menu)
 I7 N/A: no disabled state shot: n/a
States
 S1 NOT VISUALLY REVIEWED shot: WS-04 loading variant (5 skeleton rows)
 S2 NOT VISUALLY REVIEWED shot: WS-04-empty (compact rail empty + Start-a-chat link)
 S3 NOT VISUALLY REVIEWED shot: WS-04 search-no-match variant (no matches)
 S4-S6 N/A: list errors at rail level shot: n/a
 S7 NOT VISUALLY REVIEWED shot: WS-04-many (120 chats, "Show more (50 of 120)")
 S8 NOT VISUALLY REVIEWED shot: WS-04-long-titles (120-char titles truncate + tooltip)
 S9 N/A: no pending action (WS-05 covers creation) shot: n/a
Motion M1 PASS (opened) video: WS-03-switch (rows ride the rail enter); M2 N/A; M3 N/A (selection swaps instantly); M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-04 set at 1440 + 390
Accessibility A1 PASS test: workspace-session-creation.test.tsx (row names, selected state); A2 PASS audit; A3 PASS (selection + counts announced)
Evidence
 Unit test file(s): workspace-session-creation.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-04-*
 Screenshots: WS-04-default/hover/selected/menu-open/empty/many/long-titles (L/D 1440/390)
 Videos: WS-03-switch (enter reference)
 Verdict: DONE

### WS-05 New chat (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-05-pending (full-width secondary "New chat" + pending)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-05-pending (500 button; secondary tokens; full width; icon/label aligned; button rounded-md; button border; "New chat"; dark holds)
Interaction I1 N/A (button); I2/I4/I5 PASS test: workspace-session-creation.test.tsx (ring/Tab/Enter); I3 NOT VISUALLY REVIEWED video: WS-03-switch; I6-I7 N/A
States S1-S8 N/A (button only); S9 NOT VISUALLY REVIEWED shot: WS-05-pending (pending + row enter on success)
Motion M1 N/A; M2 N/A; M3 NOT VISUALLY REVIEWED video: WS-03-switch (new row enters); M4 PASS (instant)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-05-pending at 1440 + 390
Accessibility A1 PASS test: workspace-session-creation.test.tsx (button named); A2 PASS audit; A3 PASS (creation announced)
Evidence
 Unit test file(s): workspace-session-creation.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-05-pending
 Screenshots: WS-05-pending (L/D 1440/390)
 Videos: WS-03-switch (row-enter reference)
 Verdict: DONE

### WS-06 Search chats (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-06-filtered (SearchField "Search chats", shown when > 5 chats)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-06-filtered (400 input; input tokens; rail padding; input aligned; input rounded-md; input border; "Search chats"; dark holds)
Interaction I1 N/A (input); I2/I4/I5 PASS test: workspace-session-creation.test.tsx (ring/typing); I3 N/A (typing); I6 (Clear labelled: PASS); I7 N/A
States S1-S9 N/A except S3 NOT VISUALLY REVIEWED shot: WS-06-filtered (filtered list + no-match)
Motion M1-M4 N/A: static input video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-06-filtered at 1440 + 390
Accessibility A1 PASS test: workspace-session-creation.test.tsx (search label); A2 PASS audit; A3 PASS (filtered count announced)
Evidence
 Unit test file(s): workspace-session-creation.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-06-filtered
 Screenshots: WS-06-filtered (L/D 1440/390)
 Videos: n/a (static input)
 Verdict: DONE

### WS-07 Workspace header (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-07-draft/planned/approved/running/paused/chat/subagent/390 (WorkspaceTitle + subtitle + lifecycle + icons)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-07-draft/planned/approved/running/paused/chat/subagent/390 (500 title; tokens; header padding; title/subtitle/actions aligned; n/a cards; no borders; no eyebrow, labelled lifecycle, no unlabeled state text; dark holds)
Interaction
 I1 N/A: header is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: WS-07 focus (lifecycle + icon rings)
 I3 NOT VISUALLY REVIEWED video: WS-03-switch (lifecycle press reference)
 I4 PASS test: SectorChatPanel.test.tsx (lifecycle + More clickable)
 I5 PASS test: SectorChatPanel.test.tsx (Tab order, Enter activates, menu keyboard)
 I6 NOT VISUALLY REVIEWED shot: WS-07 set (resources + More IconButtons labelled + tooltip)
 I7 N/A: no disabled state (actions swap per state) shot: n/a
States S1-S9 N/A: header persists (lifecycle swaps per research state) shot: WS-07-draft/planned/approved/running/paused
Motion M1 PASS (opened) video: WS-03-switch; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-07 set + WS-07-390 (actions hold)
Accessibility A1 PASS test: SectorChatPanel.test.tsx (WorkspaceTitle level, action names); A2 PASS audit; A3 PASS (lifecycle outcomes announced)
Evidence
 Unit test file(s): SectorChatPanel.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-07-*
 Screenshots: WS-07-draft/planned/approved/running/paused/chat/subagent/390 (L/D 1440)
 Videos: WS-03-switch (enter reference)
 Verdict: DONE

### WS-08 Chat/Plan tabs (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-08-chat/plan/needs-approval (underline tabs + sliding indicator + warning dot)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-08-chat/plan/needs-approval (500 tab text; tokens; below header; tabs + indicator aligned; indicator pill; list divider; "Chat"/"Plan" + sr-only needs-approval; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: WS-08-chat (tab hover)
 I2 NOT VISUALLY REVIEWED shot: WS-08 focus (tab rings)
 I3 NOT VISUALLY REVIEWED video: WS-03-switch (tab press + indicator slide)
 I4 PASS test: workspace-tabs.test.tsx, workspace-conversation.test.tsx (tabs clickable)
 I5 PASS test: workspace-tabs.test.tsx (arrows/Home/End, drafts survive)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9 N/A: static tabs (planned dot is data) shot: WS-08-needs-approval
Motion M1-M2 N/A (chrome); M3 NOT VISUALLY REVIEWED video: WS-03-switch (indicator slides reference); M4 PASS (jumps)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-08 set at 1440 + 390
Accessibility A1 PASS test: workspace-tabs.test.tsx (tablist semantics, sr-only approval text); A2 PASS audit; A3 PASS (tab switch announced)
Evidence
 Unit test file(s): workspace-tabs.test.tsx, workspace-conversation.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-08-*
 Screenshots: WS-08-chat/plan/needs-approval (L/D 1440/390)
 Videos: WS-03-switch (indicator reference)
 Verdict: DONE

### WS-09 Subagent strip (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-09-default/many (Bot + "Subagents" + 3 chips + View-all link)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-09-default/many (500 chip text; tokens; under tabs; icon/caption/chips/link aligned; chips rounded-md; no borders; status dots + names; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: WS-09-default (chip hover)
 I2 NOT VISUALLY REVIEWED shot: WS-09 focus (chip + link rings)
 I3 NOT VISUALLY REVIEWED video: WS-03-switch (chip press reference)
 I4 PASS test: chat-staging.test.tsx (chips + View-all clickable)
 I5 PASS test: chat-staging.test.tsx (Tab + Enter)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9 N/A: strip renders when subagents exist (SA-02 covers the directory) shot: WS-09-many
Motion M1 NOT VISUALLY REVIEWED video: WS-03-switch (chips stagger); M2 N/A; M3 PASS (running dot pulses; static under reduced motion); M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-09 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (chip names include status); A2 PASS audit; A3 N/A (strip renders once)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-09-*
 Screenshots: WS-09-default/many (L/D 1440/390)
 Videos: WS-03-switch (enter reference)
 Verdict: DONE

### WS-10 Workspace errors (file: SectorWorkspace.tsx, page: sector workspace, parent: SectorWorkspace)
Visual
 V1 NOT VISUALLY REVIEWED shot: WS-10-error (inline notice under tab bar + dismiss)
 V2-V9 NOT VISUALLY REVIEWED shot: WS-10-error (500 title; status-soft tones; under tabs; icon/text/action aligned; notice rounded-md; notice border; humanized outcomes; dark holds)
Interaction I1 N/A (notice); I2/I4/I5 PASS test: workspace-conversation.test.tsx (dismiss ring/Tab/Enter/Esc); I3 NOT VISUALLY REVIEWED video: WS-03-switch; I6 (dismiss labelled: PASS); I7 N/A
States S1-S9 N/A: notice IS the blocking-error treatment (transients go to toasts) shot: WS-10-error
Motion M1 NOT VISUALLY REVIEWED video: WS-03-switch (notice enter reference); M2 N/A (dismiss is instant); M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: WS-10-error at 1440 + 390
Accessibility A1 PASS test: workspace-conversation.test.tsx (alert role); A2 PASS audit; A3 PASS (error announced)
Evidence
 Unit test file(s): workspace-conversation.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts WS-10-error
 Screenshots: WS-10-error (L/D 1440/390)
 Videos: n/a (dismiss is instant; toasts proven by SH-06-toast)
 Verdict: DONE

### CV-01 Message column (file: chat-parts.tsx + SectorWorkspace.tsx/ChatPanel.tsx, page: workspace + Karbot, parent: ConversationView/ChatPanel)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-01-long-thread (720px column, 24px turn gaps, 8px activity/text gaps)
 V2-V9 PASS (opened) shot: CV-01-long-thread (see CV-02/CV-03 for type; tokens; max-w-prose-kd centred; turns aligned; n/a cards; no borders; no copy of its own; dark holds)
Interaction I1-I7 N/A: layout column (messages carry interaction) shot: n/a
States S1-S9 N/A: column persists (40-message mixed thread proven) shot: CV-01-long-thread
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (turns ride the log enter); M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-01-long-thread at 1440 + 390 (column holds, no spill)
Accessibility A1 PASS test: workspace-conversation.test.tsx (log semantics); A2 PASS audit; A3 PASS (log aria-live polite)
Evidence
 Unit test file(s): workspace-conversation.test.tsx, chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-01-long-thread
 Screenshots: CV-01-long-thread (L/D 1440/390)
 Videos: CV-05-thinking-to-reply (enter reference)
 Verdict: DONE

### CV-02 User message (file: chat-parts.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-02-default/long/mentions (right bubble + mention chips)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-02-default/long/mentions (400 14/22; surface-active bubble; max 85%, 10/14 padding; right-aligned; rounded-xl/br-sm; no borders; humanized; dark holds)
Interaction I1-I7 N/A: user bubbles are read-only (chips are text) shot: CV-02-mentions
States S1-S9 N/A except S8 NOT VISUALLY REVIEWED shot: CV-02-long (long tokens wrap anywhere)
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-02 set at 1440 + 390
Accessibility A1 PASS test: chat-parts.test.tsx (message grouping); A2 PASS audit; A3 N/A (own text, echoed locally)
Evidence
 Unit test file(s): chat-parts.test.tsx, chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-02-*
 Screenshots: CV-02-default/long/mentions (L/D 1440/390)
 Videos: CV-05-thinking-to-reply (enter reference)
 Verdict: DONE

### CV-03 Agent message (file: chat-parts.tsx + Markdown.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-03-prose/table/code/lists (no bubble; chat Markdown: bold/code/tables/quotes/links)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-03-prose/table/code/lists (400 prose, 600 strong-in-markdown only; sunken code/frames; column width; blocks aligned; code rounded-lg, table frame rounded-lg; frame borders; humanized; dark holds)
Interaction
 I1 N/A: prose is read-only (Copy excepted) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: CV-03 focus (Copy rings)
 I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (Copy press reference)
 I4 PASS test: chat-parts.test.tsx (Copy clickable)
 I5 PASS test: chat-parts.test.tsx (Tab + Enter)
 I6 NOT VISUALLY REVIEWED shot: CV-03-code (Copy IconButton labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A except S8 NOT VISUALLY REVIEWED shot: CV-03-table (390 variant) (6-col table scrolls in frame; code scrolls; links wrap)
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (reply streams in); M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-03 set at 1440 + 390 (frames scroll in place)
Accessibility A1 PASS test: chat-parts.test.tsx, markdown.test.tsx (heading levels, table headers); A2 PASS audit; A3 PASS (terminal reply replaces pending text)
Evidence
 Unit test file(s): chat-parts.test.tsx, chat-staging.test.tsx, markdown.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-03-*
 Screenshots: CV-03-prose/table/code/lists (L/D)
 Videos: CV-05-thinking-to-reply (stream-in reference)
 Verdict: DONE

### CV-04 Message actions (file: chat-parts.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-04-hover (ghost xs Copy + Caption timestamp)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-04-hover (500 Copy; tokens; under settled messages; Copy/timestamp aligned; n/a boxes; no borders; "Copy", relative time; dark holds)
Interaction
 I1 N/A: actions appear on message hover/focus (always on touch/latest) shot: CV-04-hover
 I2 NOT VISUALLY REVIEWED shot: CV-04 focus (Copy ring)
 I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (Copy press + "Copied" toast)
 I4 PASS test: chat-parts.test.tsx (Copy clickable)
 I5 PASS test: chat-parts.test.tsx (Tab + Enter)
 I6-I7 N/A: Copy is labelled (icon + text); no disabled state shot: n/a
States S1-S9 N/A: settled-message chrome (no async states) shot: n/a
Motion M1-M4 N/A: appear instantly with the message video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-04-hover at 1440 + 390 (always visible on touch)
Accessibility A1 PASS test: chat-parts.test.tsx (Copy named per message); A2 PASS audit; A3 PASS (Copied toast announced)
Evidence
 Unit test file(s): chat-parts.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-04-hover
 Screenshots: CV-04-hover (L/D 1440/390)
 Videos: CV-05-thinking-to-reply (Copy press reference)
 Verdict: DONE

### CV-05 Thinking row (file: chat/ThinkingRow.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-05-thinking/thinking-expanded (Brain + shimmer Thinking + elapsed; no border/bg)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-05-thinking/thinking-expanded (Caption; tokens; inline row; icon/text/clock aligned; n/a boxes; no borders; "Thinking", "12s"; dark holds)
Interaction
 I1 N/A: row is not a hover target (expands when reasoning exists) shot: n/a
 I2 NOT VISUALLY REVIEWED shot: CV-05 focus (expand ring when a button)
 I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (expand press)
 I4 PASS test: chat-staging.test.tsx (expand clickable when live reasoning exists)
 I5 PASS test: chat-staging.test.tsx (Tab + Enter/Space, aria-expanded)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9 N/A: in-flight indicator (mounts only on live turns with zero frames) shot: CV-05-thinking
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (row mounts); M2 N/A (swaps to CV-06 same-instance); M3 PASS (shimmer pulse; static under reduced motion); M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-05 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (status role, expanded state); A2 PASS audit; A3 PASS (thinking announced, reply replaces)
Evidence
 Unit test file(s): chat-staging.test.tsx, workspace-conversation.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-05-*, v2/motion.spec.ts CV-05-thinking-to-reply
 Screenshots: CV-05-thinking/thinking-expanded (L/D 1440/390)
 Videos: CV-05-thinking-to-reply
 Verdict: DONE

### CV-06 Reasoning disclosure (file: chat/ReasoningDisclosure.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-06-collapsed/expanded/long-reasoning (ghost button + BodySm reasoning + 2px rule)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-06-collapsed/expanded/long-reasoning (Caption button; tokens; content-sized; icon/text/chevron aligned; n/a boxes; 2px border rule; "Thought for 12s"/"Reasoning"; dark holds)
Interaction
 I1 N/A: button, not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: CV-06 focus (button ring)
 I3 NOT VISUALLY REVIEWED video: CV-06-expand (expand press, height animation)
 I4 PASS test: chat-staging.test.tsx (button clickable)
 I5 PASS test: chat-staging.test.tsx (Tab + Enter/Space, aria-expanded)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9 N/A: settled disclosure (same instance as CV-05; open survives settle, unit-tested) shot: CV-06-expanded
Motion M1 N/A (rides the reply); M2 N/A; M3 NOT VISUALLY REVIEWED video: CV-06-expand (height animation, no layout jump); M4 PASS (instant expand)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-06 set at 1440 + 390 (max-h 320 scroll)
Accessibility A1 PASS test: chat-staging.test.tsx (disclosure semantics); A2 PASS audit; A3 N/A (manual expand)
Evidence
 Unit test file(s): chat-staging.test.tsx, workspace-conversation.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-06-*, v2/motion.spec.ts CV-06-expand
 Screenshots: CV-06-collapsed/expanded/long-reasoning (L/D 1440/390)
 Videos: CV-06-expand
 Verdict: DONE

### CV-07 Tool activity (file: chat/ToolActivity.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-07-collapsed/expanded/running/failed (summary row + tool rows + detail block)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-07-collapsed/expanded/running/failed (Caption summary; tokens; summary + list; icon/label/duration/state aligned; detail rounded-md; no summary borders; "Used 3 tools", humanized labels, raw ids only in detail; dark holds)
Interaction
 I1 N/A: summary is a button, not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: CV-07 focus (summary + detail + Copy rings)
 I3 NOT VISUALLY REVIEWED video: CV-06-expand (expand press reference)
 I4 PASS test: chat-staging.test.tsx (summary/detail/Copy clickable)
 I5 PASS test: chat-staging.test.tsx (Tab + Enter/Space, aria-expanded)
 I6 NOT VISUALLY REVIEWED shot: CV-07-expanded (detail Copy IconButton labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: activity chrome (live/settled/failed are data) shot: CV-07-running/failed
Motion M1 N/A (rides the reply); M2 N/A; M3 NOT VISUALLY REVIEWED video: CV-06-expand (expand height reference); M4 PASS (instant)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-07 set at 1440 + 390 (detail scrolls)
Accessibility A1 PASS test: chat-staging.test.tsx (disclosure semantics, state text); A2 PASS audit; A3 PASS (failed state announced)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-07-*
 Screenshots: CV-07-collapsed/expanded/running/failed (L/D 1440/390)
 Videos: CV-06-expand (expand reference)
 Verdict: DONE

### CV-08 Live tail states (file: chat-parts.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-08-queued/reconnecting/paused/failed (Caption/notice per state + action)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-08-queued/reconnecting/paused/failed (500 notice titles; status-soft tones; inline; icon/text/action aligned; notice rounded-md; notice borders; humanized + exact next steps; dark holds)
Interaction I1 N/A (notices); I2/I4/I5 PASS test: chat-staging.test.tsx, follow-resume.test.ts (Reconnect/Resume/Retry rings/Tab/Enter); I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; I6-I7 N/A
States S1-S9 N/A: these states ARE the tail treatment (queued clock, reconnect/paused/failed notices; failed restores draft) shot: CV-08 set
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-08 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (notice roles); A2 PASS audit; A3 PASS (each tail state announced)
Evidence
 Unit test file(s): chat-staging.test.tsx, follow-resume.test.ts
 Browser spec + test name(s): v2/conversation.spec.ts CV-08-*
 Screenshots: CV-08-queued/reconnecting/paused/failed (L/D 1440/390)
 Videos: CV-05-thinking-to-reply (tail reference)
 Verdict: DONE

### CV-09 Empty conversation (file: chat/ConversationEmpty.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-09-research/chat/karbot (medallion + title + line + 3 suggestions)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-09-research/chat/karbot (500 title; muted medallion; centred py-12; pill medallion; no borders; per-variant titles + fill-not-send suggestions; dark holds)
Interaction I1 N/A; I2/I4/I5 PASS test: workspace-conversation.test.tsx (suggestion rings/Tab/Enter fill + focus); I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; I6-I7 N/A
States S1-S9 N/A: empty IS the state (suggestions never auto-send) shot: CV-09 set
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-09 set at 1440 + 390
Accessibility A1 PASS test: workspace-conversation.test.tsx (suggestion names); A2 PASS audit; A3 N/A (static empty)
Evidence
 Unit test file(s): workspace-conversation.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-09-research/chat/karbot
 Screenshots: CV-09-research/chat/karbot (L/D 1440/390)
 Videos: n/a (static empty)
 Verdict: DONE

### CV-10 Jump to latest (file: SectorWorkspace.tsx + ChatPanel.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-10-visible (floating secondary sm pill "Latest" + ArrowDown)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-10-visible (500 pill; secondary tokens; bottom-centre above composer; label/icon aligned; pill rounded-full; button border; "Latest"; dark holds)
Interaction I1 N/A (pill); I2/I4/I5 PASS test: workspace-conversation.test.tsx (ring/Tab/Enter jumps); I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; I6-I7 N/A (pill is labelled)
States S1-S9 N/A: appears > 48px from bottom (fade+rise 180ms) shot: CV-10-visible
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (pill fade+rise reference); M2 N/A (hides instantly at bottom); M3 N/A; M4 PASS (instant)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-10-visible at 1440 + 390
Accessibility A1 PASS test: workspace-conversation.test.tsx (pill named); A2 PASS audit; A3 N/A (manual)
Evidence
 Unit test file(s): workspace-conversation.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-10-visible
 Screenshots: CV-10-visible (L/D 1440/390)
 Videos: CV-05-thinking-to-reply (appear reference)
 Verdict: DONE

### CV-11 Missed steer (file: chat-parts.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CV-11-default (info notice + quoted instruction + Send now)
 V2-V9 NOT VISUALLY REVIEWED shot: CV-11-default (500 title; info-soft; inline; text/quote/action aligned; notice rounded-md; notice border; "Steering saved for your next turn", single notice; dark holds)
Interaction I1 N/A (notice); I2/I4/I5 PASS test: chat-staging.test.tsx (Send-now ring/Tab/Enter); I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; I6-I7 N/A
States S1-S9 N/A: notice IS the missed-steer treatment (duplicate alert line removed) shot: CV-11-default
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CV-11-default at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (notice role); A2 PASS audit; A3 PASS (steering saved announced)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CV-11-default
 Screenshots: CV-11-default (L/D 1440/390)
 Videos: n/a (static notice)
 Verdict: DONE

### CP-01 Container (file: chat/Composer.tsx, page: workspace + Karbot, parent: log)
Visual
 V1 NOT VISUALLY REVIEWED shot: CP-01-empty/focus/multiline/disabled (shared card + autosize textarea + per-surface placeholder)
 V2-V9 NOT VISUALLY REVIEWED shot: CP-01-empty/focus/multiline/disabled (400 14/22 textarea; card tokens; p-3, 1-8 lines; textarea/toolbar aligned; container rounded-xl; border + ring/30 focus; per-surface placeholders; dark holds)
Interaction
 I1 N/A: container is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: CP-01-focus (focus-within border-ring + outline)
 I3 N/A: focusing has no press state shot: n/a
 I4 PASS test: chat-staging.test.tsx (textarea focusable/typable)
 I5 PASS test: chat-staging.test.tsx (Tab reaches, Enter sends, Shift+Enter newline, IME safe)
 I6-I7 N/A: no icon-only buttons; disabled (denied) blocks typing with reason shot: CP-01-disabled
States S1-S8 N/A (input chrome); S9 N/A (send states are CP-02) shot: n/a
Motion M1-M4 N/A: static container (autosize is layout, not animation) video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CP-01 set at 1440 + 390 (max-w-prose-kd, min-h 56)
Accessibility A1 PASS test: chat-staging.test.tsx (composer label); A2 PASS audit; A3 N/A (draft is local)
Evidence
 Unit test file(s): chat-staging.test.tsx, shells.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CP-01-*, v2/karbot.spec.ts KB-06
 Screenshots: CP-01-empty/focus/multiline/disabled (L/D 1440/390)
 Videos: n/a (static container)
 Verdict: DONE

### CP-02 Toolbar row (file: chat/Composer.tsx, page: workspace + Karbot, parent: Composer)
Visual
 V1 NOT VISUALLY REVIEWED shot: CP-02-idle/busy-empty/busy-draft/plan-on (32px controls, 8px gaps; send/Steer/Queue/Stop)
 V2-V9 NOT VISUALLY REVIEWED shot: CP-02-idle/busy-empty/busy-draft/plan-on (500 Steer/Queue; primary/secondary/ghost tokens; 32px row; left/right clusters aligned; send circle, buttons rounded-md; secondary borders; "Steer", "Queue", Plan chip pressed; dark holds)
Interaction
 I1 N/A: toolbar is not a hover row (controls hover per recipe) shot: CP-02 set
 I2 NOT VISUALLY REVIEWED shot: CP-02 focus (every control ring)
 I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (Send press starts the turn)
 I4 PASS test: chat-staging.test.tsx (all controls clickable; send disabled on empty draft)
 I5 PASS test: chat-staging.test.tsx (Tab order, Enter sends, shortcuts)
 I6 NOT VISUALLY REVIEWED shot: CP-02 set (context/attach/send/Stop IconButtons labelled + tooltip)
 I7 NOT VISUALLY REVIEWED shot: CP-02-idle (send disabled on empty draft, tooltip explains)
States S1-S8 N/A (toolbar chrome); S9 NOT VISUALLY REVIEWED shot: CP-02-busy-draft (busy set: Steer + Queue + Stop; no double send)
Motion M1-M4 N/A: instant control swaps video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CP-02 set at 1440 + 390 (clusters hold)
Accessibility A1 PASS test: chat-staging.test.tsx (control names, Plan pressed state); A2 PASS audit; A3 PASS (busy/no-steer outcomes announced)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CP-02-*
 Screenshots: CP-02-idle/busy-empty/busy-draft/plan-on (L/D 1440/390)
 Videos: CV-05-thinking-to-reply (Send press reference)
 Verdict: DONE

### CP-03 Model picker (file: ModelToolbar.tsx, page: workspace + Karbot, parent: Composer)
Visual
 V1 NOT VISUALLY REVIEWED shot: CP-03-trigger/menu-open/menu-bottom-docked/search-empty/effort-submenu (ghost chip + popover menu + submenu + switch)
 V2-V9 NOT VISUALLY REVIEWED shot: CP-03-trigger/menu-open/menu-bottom-docked/search-empty/effort-submenu (500 chip/menu text; popover tokens; chip borderless, menu p-1; search/groups/rows/footer aligned; menu rounded-lg; single border; display names + efforts, "Thinking" captions; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: CP-03-menu-open (ListRow-dense option hover, check on selected)
 I2 NOT VISUALLY REVIEWED shot: CP-03 focus (trigger + menu rings)
 I3 NOT VISUALLY REVIEWED video: CP-03-menu (option press persists + closes)
 I4 PASS test: models-staging.test.tsx (trigger/options/submenu/switch clickable)
 I5 PASS test: models-staging.test.tsx (arrows/Home/End/Enter/Esc/typeahead; submenu keyboard)
 I6-I7 N/A: no icon-only/disabled elements (Reasoning switch hides when unsupported) shot: n/a
States S1-S9 N/A: synchronous menu (no bottom border in any variant, audited; persist sends the selected provider, unit-tested) shot: CP-03-menu-bottom-docked (opens above)
Motion M1 NOT VISUALLY REVIEWED video: CP-03-menu (menu enter 120ms); M2 NOT VISUALLY REVIEWED video: CP-03-menu (menu exit 100ms); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CP-03 set at 1440 + 390 (collision-aware placement)
Accessibility A1 PASS test: models-staging.test.tsx (menu/radio semantics, checked states); A2 PASS audit; A3 PASS (selection announced)
Evidence
 Unit test file(s): models-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CP-03-*, v2/motion.spec.ts CP-03-menu
 Screenshots: CP-03-trigger/menu-open/menu-bottom-docked/search-empty/effort-submenu (L/D 1440/390)
 Videos: CP-03-menu
 Verdict: DONE

### CP-04 Composer hint (file: chat/Composer.tsx, page: workspace + Karbot, parent: Composer)
Visual
 V1 NOT VISUALLY REVIEWED shot: CP-04-hint (Caption + Kbd chips, 768+ while focused)
 V2-V9 NOT VISUALLY REVIEWED shot: CP-04-hint (Caption + Kbd; tokens; under container; text/chips aligned; Kbd rounded-sm; Kbd border; "Enter to send, Shift + Enter for a new line"; dark holds)
Interaction I1-I7 N/A: hint text (not interactive) shot: CP-04-hint
States S1-S9 N/A: shows only while focused at 768+ shot: n/a
Motion M1-M4 N/A: appears instantly with focus video: n/a
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CP-04-hint at 1440 (hidden below 768, asserted)
Accessibility A1 N/A (hint is text); A2 PASS audit; A3 N/A
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CP-04-hint
 Screenshots: CP-04-hint (L/D 1440)
 Videos: n/a (static hint)
 Verdict: DONE

### CP-05 Mention and skill listboxes (file: ChatPanel.tsx, page: Karbot, parent: Composer)
Visual
 V1 NOT VISUALLY REVIEWED shot: CP-05-mentions/skills/empty (popover + dense options + hint + empty row)
 V2-V9 NOT VISUALLY REVIEWED shot: CP-05-mentions/skills/empty (500 option text; popover tokens; listbox padding; icon/label/hint aligned; listbox rounded-lg; single border; thread/file/skill names; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: CP-05-mentions (highlighted option surface-active)
 I2 NOT VISUALLY REVIEWED shot: CP-05 focus (listbox ring)
 I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (option press inserts reference)
 I4 PASS test: chat-staging.test.tsx (options clickable)
 I5 PASS test: chat-staging.test.tsx (mention keys: arrows/Enter/Esc)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1-S9 N/A: synchronous listboxes (empty row covers no-match) shot: CP-05-empty
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply (enter 120ms); M2 N/A (@ list re-derives per keystroke: enter only, no flicker); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CP-05 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (listbox/option semantics, active option); A2 PASS audit; A3 PASS (match count announced)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CP-05-*
 Screenshots: CP-05-mentions/skills/empty (L/D 1440/390)
 Videos: CV-05-thinking-to-reply (enter reference)
 Verdict: DONE

### CP-06 Send failure (file: chat/Composer.tsx, page: workspace + Karbot, parent: Composer)
Visual
 V1 NOT VISUALLY REVIEWED shot: CP-06-failure (danger notice + Retry under composer)
 V2-V9 NOT VISUALLY REVIEWED shot: CP-06-failure (500 title; danger-soft; under container; text/action aligned; notice rounded-md; notice border; "That did not go through."; dark holds)
Interaction I1 N/A (notice); I2/I4/I5 PASS test: chat-staging.test.tsx (Retry ring/Tab/Enter); I3 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; I6-I7 N/A
States S1-S9 N/A: notice IS the send-failure treatment (draft restored) shot: CP-06-failure
Motion M1 NOT VISUALLY REVIEWED video: CV-05-thinking-to-reply; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: CP-06-failure at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (alert role); A2 PASS audit; A3 PASS (failure announced, draft kept)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/conversation.spec.ts CP-06-failure
 Screenshots: CP-06-failure (L/D 1440/390)
 Videos: n/a (static notice)
 Verdict: DONE

### KB-01 Dock container (file: ChatPanel.tsx, page: Karbot dock, parent: App)
Visual
 V1 NOT VISUALLY REVIEWED shot: KB-01-open (440 sheet at 768+, full screen below; popover + left border + shadow-lg)
 V2-V9 NOT VISUALLY REVIEWED shot: KB-01-open (chrome; popover tokens; 440/full; dock aligned; sheet edge rounded-xl; left border; no copy of its own; dark holds)
Interaction
 I1 N/A: container is not a hover row shot: n/a
 I2 N/A: container takes no focus (Esc closes unless a nested menu is open) shot: n/a
 I3 N/A: open/close has no press state shot: n/a
 I4-I5 N/A: container only (see KB-02 for controls) shot: n/a
 I6-I7 N/A: no buttons on the container shot: n/a
States S1-S9 N/A: container persists (KB-09 covers content states) shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: KB-01-open-close (x 16px + opacity 240ms); M2 NOT VISUALLY REVIEWED video: KB-01-open-close (exit 180ms via useExitState); M3 N/A; M4 NOT VISUALLY REVIEWED video: KB-01-reduced (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: KB-01-open at 1440 + 390 (full-screen sheet below 768)
Accessibility A1 PASS test: Navigation.test.tsx, chat-staging.test.tsx (non-modal sheet semantics, Esc, focus returns to Ask Karbot); A2 PASS audit; A3 N/A (open/close only)
Evidence
 Unit test file(s): Navigation.test.tsx, chat-staging.test.tsx, nested-overlays.test.tsx
 Browser spec + test name(s): v2/karbot.spec.ts KB-01-open, v2/motion.spec.ts KB-01-open-close(+reduced)
 Screenshots: KB-01-open (L/D 1440/390)
 Videos: KB-01-open-close, KB-01-reduced
 Verdict: DONE

### KB-02 Header (file: ChatPanel.tsx, page: Karbot dock, parent: dock)
Visual
 V1 NOT VISUALLY REVIEWED shot: KB-02-default/long-title (48px: Sparkles + session trigger + New/files/More/Close)
 V2-V9 NOT VISUALLY REVIEWED shot: KB-02-default/long-title (500 trigger; tokens; h-12; trigger/actions aligned; n/a cards; no borders (custom tablist removed); session titles; dark holds)
Interaction
 I1 N/A: header is not a hover row shot: n/a
 I2 NOT VISUALLY REVIEWED shot: KB-02 focus (trigger + icon rings)
 I3 NOT VISUALLY REVIEWED video: KB-01-open-close (Close press reference)
 I4 PASS test: chat-staging.test.tsx (trigger + all four icons clickable)
 I5 PASS test: chat-staging.test.tsx (Tab order, Enter activates, menus keyboard)
 I6 NOT VISUALLY REVIEWED shot: KB-02-default (New/files/More/Close IconButtons labelled + tooltip; files count dot)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A: header persists shot: n/a
Motion M1-M4 N/A: static header (rides the dock enter) video: KB-01-open-close
Responsive R1-R4 NOT VISUALLY REVIEWED shots: KB-02 set at 1440 + 390 (long title truncates + tooltip)
Accessibility A1 PASS test: chat-staging.test.tsx (trigger names, icon labels); A2 PASS audit; A3 N/A (header only)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/karbot.spec.ts KB-02-default/long-title
 Screenshots: KB-02-default/long-title (L/D 1440/390)
 Videos: KB-01-open-close (enter reference)
 Verdict: DONE

### KB-03 Sessions menu (file: ChatPanel.tsx, page: Karbot dock, parent: header)
Visual
 V1 NOT VISUALLY REVIEWED shot: KB-03-open/many (320 popover: New-chat row + dense session rows + empty)
 V2-V9 NOT VISUALLY REVIEWED shot: KB-03-open/many (500 row text; popover tokens; 320px; title/time/check/delete aligned; popover rounded-lg; single border; session titles + relative times; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: KB-03-open (row hover; Delete appears on row hover)
 I2 NOT VISUALLY REVIEWED shot: KB-03 focus (rows + Delete rings)
 I3 NOT VISUALLY REVIEWED video: KB-01-open-close (row press switches session)
 I4 PASS test: chat-staging.test.tsx (rows + New + Delete clickable; Delete confirms)
 I5 PASS test: chat-staging.test.tsx (arrows/Enter/Esc)
 I6 NOT VISUALLY REVIEWED shot: KB-03-open (Delete IconButton labelled + tooltip)
 I7 N/A: no disabled state shot: n/a
States S1-S9 N/A except S7: synchronous menu; S7 NOT VISUALLY REVIEWED shot: KB-03-many (60 sessions scroll); empty PASS ("No chats yet")
Motion M1 NOT VISUALLY REVIEWED video: KB-01-open-close (menu enter reference); M2 PASS (menu exit reference); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: KB-03 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (menu semantics, checked active); A2 PASS audit; A3 PASS (switch announced)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/karbot.spec.ts KB-03-open/many
 Screenshots: KB-03-open/many (L/D 1440/390)
 Videos: KB-01-open-close (menu reference)
 Verdict: DONE

### KB-04 Context pill/popover (file: ChatPanel.tsx, page: Karbot dock, parent: header)
Unit-tested only: no KB-04 browser capture exists (karbot.spec.ts has no
KB-04 shot). Proof is the "shows the scoped context popover for a
sector-linked chat" test.
Visual
 V1 PASS test: chat-staging.test.tsx (Context chip + region "Chat context" with "What this chat knows", summary line, Sector key-value row)
 V2-V9 PASS test: same render (Caption chip; tokens; header chip; keys/values aligned; popover rounded-lg; single border; humanized keys)
Interaction
 I1 N/A: unit-tested (no hover capture) test: chat-staging.test.tsx
 I2 N/A: unit-tested (no focus capture) test: chat-staging.test.tsx
 I3 PASS test: chat-staging.test.tsx (chip click opens the region)
 I4 PASS test: chat-staging.test.tsx (chip clickable; scope-gating per source `{scope ? ... : null}`)
 I5 N/A: keyboard path unpinned (no dedicated test) test: n/a
 I6-I7 N/A: chip is labelled text; no disabled state shot: n/a
States S1-S9 N/A: synchronous popover (absent when unscoped) test: chat-staging.test.tsx
Motion M1-M4 N/A: no motion capture test: n/a
Responsive R1-R4 N/A: no responsive capture (dock header chip; KB-01-open shows the dock frame) test: n/a
Accessibility A1 PASS test: chat-staging.test.tsx (region "Chat context" semantics); A2 N/A (no dedicated audit page); A3 N/A (manual)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): n/a (no KB-04 capture)
 Screenshots: n/a (unit-tested; no dedicated capture)
 Videos: n/a
 Verdict: DONE (unit-tested; no browser capture — gap noted, not hidden)

### KB-05 Chat view: CV-01..CV-11 components (file: chat/ + chat-parts.tsx, page: Karbot dock, parent: dock)
No separate checklist; the CV-01..CV-11 blocks cover the shared
components, proven on both surfaces. Karbot-specific shots:
KB-05-thread/thinking/tools PASS (same components, dock width).
 Screenshots: KB-05-thread/thinking/tools (L/D 1440/390)
 Verdict: DONE (via CV blocks + karbot.spec KB-05-*)

### KB-06 Composer: CP-01..CP-06 Karbot variant (file: chat/Composer.tsx, page: Karbot dock, parent: dock)
No separate checklist; the CP-01..CP-06 blocks cover the shared
composer, proven on both surfaces. Karbot-specific shot: KB-06-default
PASS ("Ask Karbot..." placeholder, attach + Plan + picker toolbar).
 Screenshots: KB-06-default (L/D 1440/390)
 Verdict: DONE (via CP blocks + karbot.spec KB-06-default)

### KB-07 Mentions/skills: CP-05 (file: ChatPanel.tsx, page: Karbot dock, parent: Composer)
No separate checklist; the CP-05 block covers the shared listboxes,
proven in the Karbot surface (v2/conversation.spec.ts CP-05-* runs the
Karbot composer).
 Verdict: DONE (via CP-05)

### KB-08 Session files view (file: ChatPanel.tsx, page: Karbot dock, parent: dock)
Visual
 V1 NOT VISUALLY REVIEWED shot: KB-08-list/empty/create/preview (Caption header + count + New file + FL-02-like rows + create dialog + preview dialog)
 V2-V9 NOT VISUALLY REVIEWED shot: KB-08-list/empty/create/preview (500 names; tokens; dock width; rows aligned; rows rounded-md; ListRow dividers; humanized sources; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: KB-08-list (row inset hover; row click previews)
 I2 NOT VISUALLY REVIEWED shot: KB-08 focus (rows, New, create fields, preview rings)
 I3 NOT VISUALLY REVIEWED video: KB-01-open-close (row press reference)
 I4 PASS test: chat-staging.test.tsx, sector-file-preview.test.tsx (rows/New/create/preview/download clickable)
 I5 PASS test: chat-staging.test.tsx (Tab order, Enter previews, Esc closes, focus returns)
 I6 NOT VISUALLY REVIEWED shot: KB-08-list (Preview/Download IconButtons labelled + tooltip)
 I7 N/A: no disabled state (download failure toasts with error) shot: n/a
States
 S1 N/A: list renders with the view shot: n/a
 S2 NOT VISUALLY REVIEWED shot: KB-08-empty (compact empty, no actions beyond New file)
 S3-S7 N/A: no filter/error/denied/paging shot: n/a
 S8 N/A: names truncate + tooltip shot: KB-08-list
 S9 N/A: no pending button (create shows pending inline) shot: KB-08-create
Motion M1 NOT VISUALLY REVIEWED video: KB-01-open-close (view rides the dock enter); M2 N/A (view swaps instantly); M3 N/A; M4 PASS guard
Responsive R1-R4 NOT VISUALLY REVIEWED shots: KB-08 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (view/row/dialog names); A2 PASS audit; A3 PASS (create/download outcomes announced)
Evidence
 Unit test file(s): chat-staging.test.tsx, sector-file-preview.test.tsx
 Browser spec + test name(s): v2/karbot.spec.ts KB-08-*
 Screenshots: KB-08-list/empty/create/preview (L/D 1440/390)
 Videos: KB-01-open-close (enter reference)
 Verdict: DONE

### KB-09 Dock states (file: ChatPanel.tsx, page: Karbot dock, parent: dock)
Visual
 V1 NOT VISUALLY REVIEWED shot: KB-09-denied/history-error/loading/offline/send-failure (per-state anatomy)
 V2-V9 NOT VISUALLY REVIEWED shot: KB-09-denied/history-error/loading/offline/send-failure (500 titles; status medallions; centred/inline per state; aligned; pill medallions; no borders; exact next steps, no developer paths; dark holds)
Interaction I1 N/A (states); I2/I4/I5 PASS test: chat-staging.test.tsx (Retry/Reconnect rings/Tab/Enter); I3 NOT VISUALLY REVIEWED video: KB-01-open-close; I6-I7 N/A
States
 S1 NOT VISUALLY REVIEWED shot: KB-09-loading (3 alternating message-shaped skeletons)
 S2 N/A: empty conversation is CV-09 shot: n/a
 S3 N/A: no filtering shot: n/a
 S4 NOT VISUALLY REVIEWED shot: KB-09-history-error/send-failure (error anatomy + retry; draft kept)
 S5 NOT VISUALLY REVIEWED shot: KB-09-denied (denied anatomy)
 S6 NOT VISUALLY REVIEWED shot: KB-09-offline (offline/not-connected anatomies)
 S7-S9 N/A: no paging/overflow/pending shot: n/a
Motion M1 NOT VISUALLY REVIEWED video: KB-01-open-close; M2-M4 N/A/N/A/PASS
Responsive R1-R4 NOT VISUALLY REVIEWED shots: KB-09 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (state roles); A2 PASS audit; A3 PASS (each state announced)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/karbot.spec.ts KB-09-*
 Screenshots: KB-09-denied/history-error/loading/offline/send-failure (L/D 1440/390)
 Videos: n/a (static states)
 Verdict: DONE

### KB-10 Rename / delete (file: ChatPanel.tsx, page: Karbot dock, parent: More menu)
Visual
 V1 NOT VISUALLY REVIEWED shot: KB-10-rename/delete (SO-01-style dialog + ConfirmAction)
 V2-V9 NOT VISUALLY REVIEWED shot: KB-10-rename/delete (500 labels; tokens; 480 dialog; single column; dialog rounded-xl; single borders; exact chat titles; dark holds)
Interaction I1 N/A (dialogs); I2/I4/I5 PASS test: chat-staging.test.tsx, session-options.test.tsx (field/buttons rings/Tab/Enter/Esc); I3 NOT VISUALLY REVIEWED video: KB-01-open-close; I6-I7 N/A
States S1-S9 N/A: synchronous dialogs (Rename toasts "Renamed"; Delete confirms) shot: KB-10 set
Motion M1/M2 NOT VISUALLY REVIEWED video: KB-01-open-close (dialog enter/exit reference); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: KB-10 set at 1440 + 390
Accessibility A1 PASS test: session-options.test.tsx (dialog semantics, autofocus select-all); A2 PASS audit; A3 PASS (rename/delete announced)
Evidence
 Unit test file(s): chat-staging.test.tsx, session-options.test.tsx
 Browser spec + test name(s): v2/karbot.spec.ts KB-10-rename/delete
 Screenshots: KB-10-rename/delete (L/D 1440/390)
 Videos: KB-01-open-close (dialog reference)
 Verdict: DONE

### SA-01 Strip: see WS-09 (same component)
No separate checklist; the WS-09 block covers the strip.

### SA-02 Directory dialog (file: SectorWorkspace.tsx, page: sector workspace, parent: WS-09 strip)
Visual
 V1 NOT VISUALLY REVIEWED shot: SA-02-open/filtered (SearchField + count + Bot rows + Show more + empty)
 V2-V9 NOT VISUALLY REVIEWED shot: SA-02-open/filtered (500 names; tokens; dialog padding; icon/name/badge/caption aligned; rows rounded-md; ListRow dividers; status badges + "2 queued"; dark holds)
Interaction
 I1 NOT VISUALLY REVIEWED shot: SA-02-open (row inset hover)
 I2 NOT VISUALLY REVIEWED shot: SA-02 focus (search, rows, pager rings)
 I3 NOT VISUALLY REVIEWED video: WS-03-switch (row press opens the child conversation)
 I4 PASS test: chat-staging.test.tsx (search/rows/pager clickable)
 I5 PASS test: chat-staging.test.tsx (Tab order, Enter opens, Esc closes)
 I6-I7 N/A: no icon-only/disabled elements shot: n/a
States S1 N/A (synchronous list); S2 N/A (directory lists existing subagents); S3 NOT VISUALLY REVIEWED shot: SA-02-filtered (no matches); S4-S6 N/A; S7 PASS (Show more with counts); S8 N/A (names truncate); S9 N/A
Motion M1/M2 NOT VISUALLY REVIEWED video: WS-03-switch (dialog enter/exit reference); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SA-02 set at 1440 + 390
Accessibility A1 PASS test: chat-staging.test.tsx (dialog + row names with status); A2 PASS audit; A3 PASS (filtered count announced)
Evidence
 Unit test file(s): chat-staging.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts SA-02-open/filtered
 Screenshots: SA-02-open/filtered (L/D 1440/390)
 Videos: WS-03-switch (dialog reference)
 Verdict: DONE

### SA-03 Karbot subagents panel (file: SubagentsPanel.tsx, page: Karbot dock, parent: dock)
Browser-captured (SA-03-open, light/dark x 1440/390, opened and
confirmed: dock open, "3 subagents" toggle expanded, three agent rows
with statuses) plus SubagentsPanel.test.tsx (6 tests, no mocks, no
fixtures).
Visual
 V1 PASS test: SubagentsPanel.test.tsx (count toggle "2 subagents, 1 running" + dense rows + Stop/Open/Chat-with actions)
 V2-V9 PASS test: same render (500 names; tokens; above composer; dot/name/status/actions aligned; rows rounded-md; ListRow dividers; single status text each)
Interaction
 I1 N/A: unit-tested (no hover capture) test: SubagentsPanel.test.tsx
 I2 N/A: unit-tested (no focus capture) test: SubagentsPanel.test.tsx
 I3 PASS test: SubagentsPanel.test.tsx (toggle/Stop/Tag/Open all fire through callbacks)
 I4 PASS test: SubagentsPanel.test.tsx (collapsible/Stop/Tag/Open clickable)
 I5 N/A: keyboard path unpinned (no dedicated test) test: n/a
 I6 PASS test: SubagentsPanel.tsx source (Stop/Open IconButtons labelled `Stop <name>` / `Open <name> chat`; "Chat with <name>" tag button; raw key in title tooltip only)
 I7 N/A: no disabled state (Stop shows only while running) test: SubagentsPanel.test.tsx
States S1-S8 N/A except S2 PASS test: SubagentsPanel.test.tsx ("no subagents yet" empty); S9 N/A
Motion M1-M4 N/A: no motion capture test: n/a
Responsive R1-R4 N/A: no responsive capture test: n/a
Accessibility A1 PASS test: SubagentsPanel.test.tsx (toggle/action names carry humanized name + status); A2 N/A (no dedicated audit page); A3 PASS test: SubagentsPanel.test.tsx (stop announces)
Evidence
 Unit test file(s): SubagentsPanel.test.tsx
 Browser spec + test name(s): karbot.spec.ts SA-03-open
 Screenshots: shot: SA-03-open (light/dark x 1440/390, opened)
 Videos: n/a
 Verdict: DONE (browser-captured + unit-tested)

### SO-01 Rename dialog (file: SectorWorkspace.tsx, page: sector workspace, parent: session menu)
Visual
 V1 NOT VISUALLY REVIEWED shot: SO-01-default (480 dialog: Field "Chat name" autofocus select-all + Save)
 V2-V9 NOT VISUALLY REVIEWED shot: SO-01-default (500 label; tokens; 480; single column; dialog rounded-xl; single borders; "Rename chat"; dark holds)
Interaction I1 N/A (dialog); I2/I4/I5 PASS test: session-options.test.tsx (field/Save rings/Tab/Enter/Esc); I3 NOT VISUALLY REVIEWED video: WS-03-switch; I6-I7 N/A
States S1-S9 N/A: synchronous dialog (Save toasts "Renamed") shot: SO-01-default
Motion M1/M2 NOT VISUALLY REVIEWED video: WS-03-switch (dialog enter/exit reference); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SO-01-default at 1440 + 390
Accessibility A1 PASS test: session-options.test.tsx (dialog semantics, select-all); A2 PASS audit; A3 PASS (rename announced)
Evidence
 Unit test file(s): session-options.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts SO-01
 Screenshots: SO-01-default (L/D 1440/390)
 Videos: WS-03-switch (dialog reference)
 Verdict: DONE

### SO-02 Delete (file: SectorWorkspace.tsx, page: sector workspace, parent: session menu)
Visual
 V1 NOT VISUALLY REVIEWED shot: SO-02-default (ConfirmAction: `Delete "{title}"?` + audit-log line + Delete chat)
 V2-V9 NOT VISUALLY REVIEWED shot: SO-02-default (500 title; destructive tokens; alert padding; title/description/actions aligned; dialog rounded-xl; single borders; exact title, history-stays copy; dark holds)
Interaction I1 N/A (dialog); I2/I4/I5 PASS test: session-options.test.tsx (Cancel/Delete rings/Tab/Enter/Esc); I3 NOT VISUALLY REVIEWED video: WS-03-switch; I6-I7 N/A
States S1-S9 N/A: synchronous confirm (research sessions: menu item absent, tested) shot: SO-02-default
Motion M1/M2 NOT VISUALLY REVIEWED video: WS-03-switch (dialog enter/exit reference); M3 N/A; M4 PASS (opacity-only)
Responsive R1-R4 NOT VISUALLY REVIEWED shots: SO-02-default at 1440 + 390
Accessibility A1 PASS test: session-options.test.tsx (alert-dialog semantics, destructive focus guard); A2 PASS audit; A3 PASS (delete announced)
Evidence
 Unit test file(s): session-options.test.tsx
 Browser spec + test name(s): v2/workspace.spec.ts SO-02
 Screenshots: SO-02-default (L/D 1440/390)
 Videos: WS-03-switch (dialog reference)
 Verdict: DONE

## 5. Backend fixes B1-B4

Tests added (all in `tests/backend/`):

- B1: `karbot.turn.test.ts` — system prompt pins calm-chat-prose rule
  ("never as a label").
- B2: `karbot.turn.test.ts` — sector turn preloads `Current sector:`
  identity block first (name falls back to id); new `loadSectorName?`
  deps seam wired to `getSector`.
- B3: `workflows.plan-brief.test.ts` — `planningBrief` uses
  Goal/Search directions/Steps/Budget and limits/Risks/Open questions
  headings plus the single-word rule.
- B4: `sweep.rules.test.ts` — junk screening rejects gov/article-title
  junk (`NON_COMPANY_SUFFIXES` + 6 `ARTICLE_TITLE_RULES` over
  title+snippet copy); 6 realistic company near-miss controls must pass.

Fail-before / pass-after evidence (local):
`tests/evidence/ui-revamp-v2/stage7/v2-b{1,2,3,4}-{before,after}.txt`.
Results: B1 1/1, B2 2/2, B3 2/2, B4 17/17 pass-after.
Backend gate: lint/typecheck clean, 645 passed / 471 skipped / 0 failed
across 86 files (`stage7/backend-gate.txt`).

Product changes: `backend/src/temporal/activities/turn.ts` (prompt +
preload), `backend/src/temporal/workflows/plan.ts` (brief),
`backend/src/temporal/sweep-rules.ts` (screening),
`backend/src/contract.ts` (ReasoningControl parity entry, MessageSegment
precedent), `docs/deep-checks/catalogue.json` + `acceptance.json`
(sanctioned regens; stale since the waves 8-12 checkpoint because v2
stages 1-6 added frontend surface without updating them).

## 6. Blocked

CLEARED 2026-10-04: the full Playwright run is green (485
passed / 22 skipped / 0 failed; `stage8/full-run-final.txt`),
so CI's `e2e` job is unblocked. All 24 pre-v2 specs are
migrated to the v2 contracts with no coverage deleted.

(Original note, kept for the record: the first full run of
the 15 pre-v2 specs was 41 passed / 9 skipped / 94 failed
(15.5m, EXIT 1; `stage8/existing-run.txt`,
`stage8/existing-failures.txt`, `stage8/existing-raw/`).
Every failure signature asserted pre-v2 markup/copy/flows
the revamp intentionally removed (verified: base `709cfa2`
carries those strings, this branch does not; the v2 suite
pins the replacements). Owner decision (2026-10-03):
migrate all 94 to the v2 contracts, no deletions.)

## 7. Follow-ups

From plan section 8 (out of scope, owner decisions):

- Company website/location/source columns (needs schema + projection
  change; owner approval).
- File size / page count in file rows (not on the wire).
- Deleting legacy unrouted files (`SectorDetailPage`,
  `SectorChatPanel`, `SectorContextDrawer`, `SectorPlanSection`,
  `RunConsole`, `CompanySection`): owner decision. They compile, their
  tests are green, and the sweeps keep their classes token-clean.
- Live 2,000-company campaign; live provider/Temporal/DB suites (state
  skipped in gates).
- Any change to approval/authority/persistence contracts.

New findings from this run:

- Pinned backend inventories (`docs/deep-checks/catalogue.json`,
  `acceptance.json`) go stale whenever files are added/removed,
  including untracked `tests/evidence/` files (the scan uses
  `git ls-files --cached --others`). Regenerate via the sanctioned
  `UPDATE_HARDENING_CATALOG=1` / `UPDATE_ACCEPTANCE_SURFACES=1` modes
  (separate invocations) after any file-set change.
- v2 evidence binaries stay local: `tests/evidence/**/*.png|jpg|webm`
  is gitignored (pre-existing rule), so stage commits carry only the
  text evidence (logs, notes); never force-add binaries.
- SH-07-not-connected cannot run on the shared e2e webServer (it bakes
  `VITE_STAGING_API` at serve time); the spec boots its own flag-off
  vite on 15175 with group cleanup.

## 8. Self-review: visual audit + worst issues

Two passes opened pixels. Pass 1 (prior session, no shell): 9 shots
(FL-03-failed-light-390, OV-04 1440-probe + 390-fix, WS-03 Chats fix,
OV-01-dark-1440, SA-02-dark-1440, OV-01-390, KB-01-docked-1440,
WS-04-dark-390, FL-03-failed-dark-1440). Pass 2 (item 8, shell
available): 17 shots + 12 video frames. The 17: PL-04-new-format,
OV-02-default, CV-01-long-thread, GC-01-default, GC-06-review,
SA-03-open (each light+dark x 1440, post-fix product),
WS-03-chats + WS-04-selected (each light+dark x 1440, matrix5 set,
current for tabs/rows), FL-03-failed-light-390 (matrix5). The 12
frames: start/mid/end of SH-08-page-transition, GC-06-review,
WS-03-switch, PL-03-steps-enter (starts are blank pre-paint).
Pass 3 (final run): 1 shot — SA-03-open-light-1440 from
`full-run-final-results/`, re-opened because the subagent rows
moved to the shared ListRow recipe after pass 2 (names still
humanized, one status each, no raw keys, model picker still
`Muse Spark 1.3 Contributor · High`).
Distinct screenshots opened across all passes: 26
(FL-03-failed-light-390 in passes 1+2). Checklist lines confirmed against
these pixels carry `PASS (opened)` (38 lines); every other cited
line is marked `NOT VISUALLY REVIEWED` (870 lines) and stands on
the green e2e/unit suite only. The evidence tree now holds 4897
PNGs + 438 webm (stage sets + matrix5 + full-run-final archival
+ before/, heavily duplicated across stages); the unopened
remainder was verified by the suite, not by eye.

1. FL-03-failed-light-390 tuck-under (RESOLVED as artifact, was the
worst anomaly): a live 390px probe measured search bottom == list
clip top at y=194, row layout top at y=173 after the spec's
scrollIntoViewIfNeeded. The row is static content inside the
list's overflow-y-auto box, so its top 21px are clipped by the
list edge, not painted under the search; the still frame cannot
tell clip from overlap, but the geometry can. No product change;
FL-03-list-below-search-390 pins the real contract (list box
never starts above the search bottom).
2. OV-04 long names (reviewed and cleared at 1440, fixed at 390): a
live-browser probe (scrollWidth === offsetWidth with fonts loaded)
proved the 1440 "hard clip" is the fixture string itself ending
mid-word at exactly 120 chars ("...licensed c"), with no overflow, so
no ellipsis is correct there. The same probe found the real bug at
390: the shrink-0 meta cluster (badge + count + age + chevron)
starved the name to ~1 char. Secondary meta now steps aside below
sm (badge + chevron stay; companies keep their stage segments), and
OV-04-long-names-ellipsis pins real overflow + ellipsis + tooltip +
readable width, red-before/green-after.
3. Workspace "Chats ( 6 )" gaps (FIXED after owner report): the label
was three flex items (text + Numeric + text) inside the tab's
inline-flex wrapper, so the 6px gaps rendered inside the parens.
The label is now one contiguous tabular-nums node ("Chats (6)"),
pinned by WS-03-tab-labels (red-before/green-after). The same pass
elevated the segmented thumb (surface-raised + border, was flat
bg-card) and the selected session row (raised card + strong edge,
was a flat surface-active slab), each pinned in unit + e2e. Pass 2
re-verified all three in WS-03-chats + WS-04-selected (light+dark)
and corrected the two stale WS-03 checklist lines ("Chats (3)",
"sunken track, card thumb").
4. GC-06 stale reason (FIXED by review item 5, was tooltip-only): a
stale proposal disabled Approve with only a title attribute. The
dialog now shows a visible warning notice above the actions ("This
update is based on v2; the current version is v3. Ask for a
refreshed proposal."), pinned by unit + e2e and confirmed in
GC-06-review light+dark. Approve stays disabled.
5. GC-06-review Approve state (reviewed and cleared): the shot shows
"Based on v2 / Current v3" with an Approve that reads enabled at
thumbnail scale. The v2 e2e suite asserts toBeDisabled on that button
and passes, and disabled primary is opacity-50; the pixel read was
wrong, the behavior is correct. No action.
6-9. Clean on open, no issues. Pass 1: OV-01-dark-1440 (tiles,
recent lists), SA-02-dark-1440 (founder badges/avatars), OV-01-390
(2-col tiles, no overflow), KB-01-docked-1440 (composer, Plan,
model picker), WS-04-dark-390 (KB rail preset truncates with
chevron), FL-03-failed-dark-1440 (explainer wraps fully, Review
retry visible). Pass 2: PL-04-new-format (nested 1/2 numbers,
distinct top icons, rail stops at medallions), OV-02-default
("2,000 Across 6 sectors" consistent with the sector list),
CV-01-long-thread (real conversation), GC-01-default (COVERAGE
in the label register), GC-06-review (stale notice + disabled
Approve), SA-03-open (3 subagents, statuses), WS-03-chats
("Chats (6)" contiguous + elevated thumb),
WS-04-selected (raised selected card); dark holds on all eight.
10. Not opened: everything else in the evidence tree. Video
rulings from the 12 frames: SH-08-page-transition shows section
landing mid-flight and Overview arrived (endpoint claims for
visible components kept; all press/timing claims downgraded);
GC-06-review shows the dialog opening then closed (dialog
enter/exit + shared-dialog references kept; presses and
rail/sheet claims downgraded); WS-03-switch shows the tab
switch with skeletons landing on Research (switch-arrival
claims kept; presses/slide specifics downgraded);
PL-03-steps-enter shows Chat -> Plan steps -> Chat (tab-enter
arrival for visible header/brief kept; stagger/press/height
claims downgraded). Any remaining visual risk lives in the
unopened set; the passing suite is its only cover.
