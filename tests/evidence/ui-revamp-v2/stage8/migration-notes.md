# 8b-migrate: static QA notes (2026-10-03)

Owner decision: migrate all 94 failing pre-v2 tests to v2 contracts, no
deletions. Migration edits for all 15 spec files were written by
parallel workers; the workers died to machine FD exhaustion before
their green runs could be trusted, so every file below was re-verified
STATICALLY against the v2 source (components + v2 specs + labels).
Nothing here replaces a run: the fresh session must still run each
file green sequentially (`--workers=1`, one file at a time,
`KARDATA_E2E_PORT=15174`, Node 22 prefix, `ulimit -n 4096`,
`CHOKIDAR_USEPOLLING=1`).

## Method

For each file: read the migrated spec in full, then confirmed every new
locator/copy/flow against the current component source (role names,
aria-labels, button copy, dialog titles, POST bodies, pager/window
constants, label maps). Verdict CLEAN means no static defect found.

## Per-file verdicts (15/15 CLEAN)

- alerts.spec.ts (5): region 'Alerts' via SectionCard title; tabs
  Current/History; History shows ALL 20 items unfiltered (panel line 77:
  only Current filters); Older/Latest pager; denied + empty copy match
  ResourceState props; Base UI tabs activate on focus/Enter.
- smoke.spec.ts (3): trigger 'Choose a model' reads 'Model' + seeded
  'high' (DEFAULT_EFFORT='high'); effort models render as submenu
  triggers (role menuitem) with displayName + level/'Thinking' caption;
  menu portalled (page-level locators correct); 'Show/Hide reasoning',
  'Show tool activity', 'Used 1 tool', 'Using Listed sectors...' all
  match source; 'Listed sectors' in label map.
- transitions.spec.ts (1): model-menu test now targets the portalled
  unnamed menu + 'Search models' field; Esc refocus per Base UI.
- file-processing.spec.ts (4): '18 of 24 image analyses saved',
  'Review retry', dialog 'Review file processing retry' (SectorWorkspace
  overlay), checkbox-gated 'Resume file processing', denied alert,
  retry body {jobId, revision, allowDuplicatePaid} matches
  workspace-api; preview dialog + 'Browse indexed sections' + region
  'Indexed section N' (ord+1) + 'Uncertain' badge + pager names all
  match. RUN FLAG: after `indexed = true` the row click relies on a
  files refresh/poll flipping previewable; should pass via poll but
  watch for a disabled-button timeout.
- work-review.spec.ts (8): 'View progress'/tab 'Plan', trigger
  'Review' (fixture meets all four render conditions), dialog 'Review
  candidate intake', 'Owner reason', 'Exclude candidate',
  'Reload latest', 'Review latest receipt'; openReview captures
  planVersion=1 so the first decision is not stale; review body
  {planVersion, receiptVersion, decision, reason} matches
  workspace-api; counters group 'Work counters' with 'Excluded'/'1'/
  'Needs attention' tiles.
- scale.spec.ts (2): COMPANY_WINDOW=100 confirmed; 'Showing N of
  1,000' grouped copy; 5s poll keeps the window.
- context-recovery.spec.ts (4): test bodies were already v2-correct
  (light variants passed pre-migration); the dark fix is correct —
  the old failure was a click timeout on the deleted 'Use dark theme'
  button (see existing-run.txt §6 call log), replaced with
  Theme→menuitemradio 'Dark' (ThemeMenu source-verified). LC-02/LC-04
  copy (receipt, rebuild, conflict, draft-kept) matches v2-passing
  specs. Note: `local = {...local, contextBlocked: undefined}` is
  valid JS; typecheck only covers frontend/src so spec TS can't fail
  gates.
- execution-inspection.spec.ts (8): '/20 entries/' caption,
  'Request · Round 1 · #1' row names, 'Normalized execution JSON'
  64_000 cap (DISPLAY_CHARS), 'Shared plan observed' boundary label,
  download filename/body, pager enablement, afterSeq math (20 + 3),
  Esc focus return, draft kept; loading/empty/denied/error/offline/
  body-error copy via ResourceNotice label 'Execution inspection'.
- polish.spec.ts (2): log 'Conversation messages', main>header,
  composer 'Message this conversation' (SectorWorkspace label);
  tablist 'Session types' + list 'Chat sessions'; single Theme button
  in workspace (SectorChat early-returns without TopBar, so no
  strict-mode risk); html.dark assertion per theme effect.
- matrix.spec.ts (4): 'Recent sectors' region; rows-are-links
  navigation; landing region + 'Open workspace'; 'Search runs' always
  rendered (card actions); TopBar keeps Ask Karbot (icon button) +
  ThemeMenu at 390 (only the palette trigger collapses).
- visual.spec.ts (9 tests, 3 failed): 'Research has not started'
  draft title; portalled picker assertions; sidebar
  button 'Emails (coming soon)'; 'Key configured' untouched tests
  re-checked where adjacent.
- scrollbars.spec.ts (3): SECTOR_WINDOW-style 'Showing 50 of 60'
  (RS sectors window 50); no inner .scroll-slim in table; dock log
  'Chat messages' + pre.scroll-slim; model menu list scroll-slim;
  rail 'Show more (50 of 60)' (sessionLimit init 50); tablist
  'Session types'; .scroll-slim sets scrollbar-width: thin.
- files-scale.spec.ts (6): region 'Sector files'; row buttons named
  by filename; 50-window ('Showing 50 of 2,004 files', hidden
  excluded); 'Upload file'; Hide/Add row actions; status badges;
  Show more → 100; search 1-of-1; preview h1 from markdown;
  Esc focus return; 'No matching files.'; 'Show hidden files' →
  disabled row → Reveal PATCH → enabled; clear → 2,005.
  ResourceNotice label 'Files' explains 'Files is loading' /
  'Files is not shared with this key.'; empty substring
  'Upload PDFs, documents or data' matches the longer sentence.
- workspace.spec.ts (30): 'The plan is approved. Start research when
  ready.' (labels.ts); 'View progress' → dialog 'Research progress'
  → 'Show plan details'; drawer boundaries 768 (md:) and 1281
  (min-[1281px]) match source; 'Close Sessions' via `Close ${title}`;
  PL-07 'Plan text'/'Save plan'/conflict/draft-kept; deep-link Chats
  tab + 'View all 6' + 'Open Source review' + URL thread;
  denied drawer copy; preview download menu; region 'Executable
  research work' (shared ExecutablePlanDetails) with 'Up to 2,000'
  (no discoveryTarget in fixture) + 'Company limit' spinbutton 2000;
  paused 'This conversation is paused.' + 'Resume';
  'Research depth' combobox 'Discovery only'; steering 'Steer'/
  region 'Unapplied steering'/draft kept; LC-02 region 'Pending
  operation recovery' with humanizeKey('db_create_session') =
  'DB create session' ('db' is an acronym).
- revamp-evidence.spec.ts (15): tabs 'Sectors 1'/'Companies 0',
  combobox 'Status: All', dialog 'New sector' fields + Esc focus
  (unchanged, was passing); overlay transitionDuration '0.18s'
  matches dialog.ui duration-180; deletion alertdialog (was
  passing); 'Key configured' (ModelsPanel); palette Ctrl+K +
  trigger /Search\.\.\. Ctrl K/ (TopBar text + Kbd); 720px zoom
  no-spill + dialog; filter probe 'Showing 50 of 2,005 files';
  longtask/heap tripwires; dialog-exit lag ≥50ms; plan timeline
  region + query/acceptance/'Discovery only' + dark setup added
  (light passed pre-migration); narrative brief heading
  'Search directions' via planSectionLabels['direction shards'];
  bottom-docked menu viewport bounds + Esc refocus.
  RUN FLAGS (timing-sensitive, cannot prove statically): filter
  p95 ≤125ms, longtask worst ≤200ms, heap growth ≤20% — all have
  headroom by design but watch for full-matrix contention flakes.
  The 'New sector'.first() calls race SH-08 page-exit overlap
  (two buttons during transition); either opens the same
  App-owned dialog, so .first() is safe.

## Dark-setup pattern (shared across files)

Several files wrap Theme clicks in `width < 768` drawer open/Escape.
The v2 ThemeMenu contract (button 'Theme' + menuitemradio 'Dark') is
source-verified; the drawer dance mirrors the pre-migration shape and
is harmless where unneeded. If a 390-dark variant fails on the Theme
click, simplify to direct clicks (TopBar keeps Theme at 390).

## Green-run verification (2026-10-03, sequential --workers=1, 15174)

All 15 files green, no flakes on re-run: transitions 3,
scale+files-scale 16 (one invocation matches both), polish 3,
smoke 4, scrollbars 5, file-processing 4, context-recovery 8,
matrix 5, alerts 5, work-review 8, execution-inspection 10,
visual 9, revamp-evidence 15 (filter p95 19.5ms vs 125 tripwire,
longtask max 0.0ms, heap growth 0.0%, dialog exit 388ms),
workspace 37. Timing tripwires hold with wide headroom.

Two failures needed product fixes (not test edits); both verified
red-before/green-after: (1) hardening surfaces x4 -- depth
combobox showed raw 'discovery' (ResearchPlanEditor now passes
valueText); (2) plan-approval-denied -- sessions rail collapsed
when context reads were denied (sector-workspace loader now falls
back to kind-based research resolution on denial only). One
WS-05-pending failure appeared only in a combined
v2+pre-v2 invocation and passes standalone; left for the final
full matrix to re-confirm. Run `workspace.spec.ts` with the exact
path `tests/frontend-e2e/workspace.spec.ts` to avoid matching
`v2/workspace.spec.ts` (same for `scale.spec.ts` matching
`files-scale.spec.ts`).
