# Kardata complete UI revamp: implementation handoff (2026-10-02, revised twice after review)

Branch: `codex/ui-revamp-complete`, cut from `ui-revamp-perfect` head
`fdbc9d2` (preserved; `main` untouched; `vision.md` unchanged). Base commit
`fdbc9d24d9ee69272075648e139ecc24592f907a` plus the uncommitted working
tree described below; all evidence in this document was produced against
that exact tree. An earlier completion claim was reviewed and rejected
with eight blockers, and a second review returned six more; every blocker
is remediated below with its evidence. A plan visual redesign (timeline
rail) and a bottom-docked model-menu collision fix are also included.
Nothing below marked "pass" lacks an implementation.

## 1. What was built

Stage 1 foundations (all new, all pinned):

- Owned wrappers over Base UI 1.8.0 for the full inventory in
  `frontend/src/components/ui/`: button (40px standard, 32px compact with
  coarse-pointer 40px enlargement, `pending` state), input (40px),
  textarea, field, select, searchable (combobox), checkbox
  (indeterminate), switch, tabs (40px), menu, popover, dialog,
  alert-dialog (plus `ConfirmAction`), tooltip, collapsible, progress,
  badge, skeleton, separator. Menu/select/searchable rows enlarge to 40px
  under coarse pointers.
- Shared presentational shells in `frontend/src/components/shells.tsx`
  (props only, never fetch): PageHeader, SectionCard, ResourceState,
  SearchField, ListFooter, OperationNotice, StatusBadge,
  ConversationComposer, PlanDocument (+PlanSection).
- Centralized motion presets in `frontend/src/lib/motion.ts`; Base UI
  primitives carry enter AND exit via
  `data-starting-style`/`data-ending-style` transitions; `LazyMotion
  features={domAnimation}` wraps both App roots with the lightweight `m`
  indicator; page replacement crossfades through the View Transitions API
  in `useNavigation` (instant swap with fade-in where unsupported);
  sibling-overlay Escape coordination in `frontend/src/lib/overlay.ts`.
- Text primitives with typed refs/IDs/tabIndex forwarding and the exact
  scale. `Markdown` exposes an explicit `variant="plan"`; ordinary chat
  never receives keyword icons, and grouped plan rhythm lives on the
  renderer (the dead `.plan-brief` wrapper selectors were deleted).
- `ResourceNotice` delegates to ResourceState; `StatusPill` delegates to
  Badge (interactive variant stays a real button).
- Maintained scenario registry `tests/frontend/coverage-registry.md` with
  an enforceable gate (`coverage-registry.test.ts`): any component file
  without a mapping or a justified nonvisual classification fails the
  suite. Previously missing FileProcessing rows were added; false rows
  were corrected.

Prescribed migrations (copy and request semantics preserved):

- Researches: type tabs (Base UI Tabs), state selection (shared Select),
  sector creation (shared dialog), SectionCard shell, ListFooter
  counts/paging. TopBar search renders on Overview only; the query is
  preserved across navigation.
- Plan presentation: executable queries as full numbered rows on a
  timeline rail (icon medallions, mono index chips, stat boxes), acceptance
  as a neutral decimal list (no checkmarks), numeric target/cap text with
  the misleading progress bar removed, long instructions behind an
  explicit Show control, string-kept numeric drafts, cleared-populated
  targets erroring while never-set targets stay unset, field-level errors
  plus a focused error summary, and an explicit invariant backstop that
  can only surface as a form error. PlanDocument renders the workspace
  Plan tab and the landing progress dialog.
- Workspace + Karbot session deletion through ConfirmAction with exact
  titles (touch-visible 32px row target); workspace tablist arrow keys;
  settled agent replies carry the specified Copy action with local
  clipboard-failure reporting (dock, workspace, legacy).
- Overlays: WorkspaceOverlay is controlled (`open` + frozen exit content
  + reopen-cancel) across all sites including the inspector and rebuild
  flows; sibling Escape closes only the topmost entry with registration
  following actual open state and refused closes keeping registration;
  exits verified in a browser by detachment timing (~120ms).
- Model menus open collision-aware (above bottom-docked triggers).
- Karbot files: preview failure is an alert with retry (never rendered as
  file content), downloads fail visibly with dismissal, and request
  sequencing keeps stale previews off the current file.
- Models panel on shared Select/checkbox with "Configured" (never "Live").
- Legacy drawer labeled as an estimate with the 60% threshold claim and
  amber removed; Karbot file targets at 32px with 8px gaps;
  collapsed-sidebar tooltips; legacy timestamp buttons enlarged.

Deliberately unchanged (with reason): ModelToolbar custom menus keep their
pinned focus/search/select/Escape contract and durable draft/binding/save
orchestration (transplanting cost-adjacent binding logic onto primitives
would violate the durable-behavior rule); composer drafts,
mention/steering semantics, and chat transport stay Kardata-owned (no
ComposerPrimitive, no ThreadList); approval/authority/persistence/file
contracts untouched; no new dependency, framework, font, icon set, or
top-level directory.

## 2. Files changed

Product (`frontend/src/`): `components/ui/` (16 new + button/input/tabs/
menu/popover/tooltip/select/searchable/collapsible/dialog/alert-dialog
scale + exits), `shells.tsx` (new), `text.tsx`, `lib/motion.ts`,
`lib/overlay.ts` (new), `lib/useNavigation.ts` (view transitions),
`index.css` (view-transition keyframes, dead plan selectors removed),
`App.tsx` (LazyMotion, title/gutters, Overview-only search),
`ResearchesPage.tsx`, `Dashboard.tsx`, `SectorLanding.tsx`,
`SectorPlanSection.tsx`, `ResearchPlanEditor.tsx` (queries/acceptance/
bar/numerics/validation), `Markdown.tsx` (plan variant),
`SectorWorkspace.tsx`, `SectorContextDrawer.tsx`, `SectorChatPanel.tsx`
(copy wiring), `ChatPanel.tsx` (deletions, file failure states, `m`,
composer shell), `ModelsPanel.tsx`, `ModelToolbar.tsx` (32px targets),
`Sidebar.tsx`, `StatusPill.tsx`, `TopBar.tsx`, `text.tsx`,
`workspace-parts.tsx` (dialog overlay, searches), `chat-parts.tsx`
(copy), `SectorFilePreview.tsx` (untouched), plus backend
`eslint.config.js` (ignore generated `test-results/**`, one line).

Tests: `ui-primitives`, `shells`, `motion-presets`, `session-options`,
`workspace-tabs`, `session-files`, `nested-overlays`,
`coverage-registry` (new); expanded `research-plan-editor`,
`markdown`, `chat-parts`, `TopBar`, `Button`, `models-staging`;
updated `ResearchesPage`, `navigation-url`, `SectorContextDrawer`,
`SectorChatPanel`, `chat-staging`; new `revamp-evidence.spec.ts`
(surfaces/zoom/search/exits/timings/profiling/videos) and the registry.

Regenerated through sanctioned maintenance modes (new entries honestly
`pending`): `docs/deep-checks/catalogue.json`
(`UPDATE_HARDENING_CATALOG=1`), `docs/deep-checks/acceptance.json`
(`UPDATE_ACCEPTANCE_SURFACES=1`).

Docs (same change): `documentation/frontend.md`, `docs/design-system.md`,
`docs/implementation-status.md`, `docs/frontend-verification.md`
(Waves 8+9). No `README.md` map change was needed.

## 3. How it was verified (exact tree above)

- `npm run pr:verify`: exit 0 (full gate: lint, typecheck, all workspace
  tests, frontend build, e2e smoke). Backend suites: 640 passed / 471
  skipped (live-gated). The earlier reds were a generated evidence file
  in backend lint (fixed by ignoring generated output) and stale
  catalogue/acceptance inventories (regenerated by their own maintenance
  modes).
- `npm test -w frontend`: 457 passed / 6 skipped, 56 files (was 377/6).
  Every red suite during the work was root-caused as a stale expectation
  or a real defect and fixed on the side that was wrong, with
  failing-before observed (kept-mounted panels, tooltip role, StatusPill
  structure, drawer copy, tab/select/confirm names, meter/drawer wording,
  nested-Escape double dismissal, refused-close retention, stale-preview
  guard, cleared-vs-never-set targets, numbering/exit classes,
  checkbox PointerEvent shim, overlay conversion leftovers).
- Browser on isolated port 15174 (mockup port untouched, no campaign,
  synthetic fixtures): core 21/21, workspace/states/plans/evidence with 2
  live-gated skips (plan-02/plan-03) — full matrix green on the final
  tree. Fresh screenshots and per-test transition videos inspected
  (`revamp-researches-dialog-light/dark`,
  `revamp-plan-timeline-light/dark`, `revamp-deletion-dialog`,
  `revamp-models-select`, `revamp-zoom-dialog`, files/workspace/dialogs/
  alerts/receipts); curated history stays in
  `tests/evidence/hardening-2026-10-01/`.
- Performance, measured (not claimed): build JS ~1.1–1.2MB / ~326–375kB
  gzip; loaded-list filtering over 2,005 records p95 95.8ms over 20
  queries (design target 100ms; committed tripwire 125ms for
  shared-runner noise); dialog-exit detachment ~123ms (exit plays, bound
  50–2000ms); worst sustained long task 52ms over 50 overlay cycles;
  0.0% heap growth over those cycles. Environment note: this host's user
  inotify instances were exhausted (169/128, mostly editor/servers), so
  e2e web servers ran with `CHOKIDAR_USEPOLLING=1`.
- Verified previews: production build of this tree served at
  `http://127.0.0.1:15175/` (crash-free shell and designed states; live
  data blocked only by backend CORS, out of scope) plus read-only live
  populated workflows reviewed on the admitted dev server with zero page
  errors (`test-results/visual/live-overview/researches/models-1440.png`:
  real 32-sector/298-company lists, truthful counts, aligned footers).
  Nothing was published outside loopback; no live record was mutated.

Skipped verification (stated, never silent): live DB/Temporal/provider
suites, files-db, agent-context-db, runtime-preflight, Meta pilot, the
2,000-company campaign, per-row 120-shot coverage beyond the
representative matrix (unit overflow suites + matrix stand in), and
long-task/memory profiling beyond the scripted journey above.

## 4. What was left out

1. Per-row 120-shot coverage beyond the representative matrix.
2. Profiling beyond the scripted transitions/dialog journey (no
   production trace instrumentation added).
3. Live-gated suites and the 2,000-company campaign (no research started).

## 5. Decision needed next

Review this branch (code + the evidence above) and merge per the
repository checklist with the stated skips, or direct further work. Per
the handoff rules this revamp is not merged before the requested
follow-up review.
