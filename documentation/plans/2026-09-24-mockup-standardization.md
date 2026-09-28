## Goal

Standardize the existing mockups so every component ships all of its states with professional, consistent transitions and disciplined overflow/underflow handling. No new features, no new pages, no new routes: only bring the current surfaces (Overview, Researches, Sector detail, Assistant chat with sessions/subagents/files, shell) up to the bar the repo already documents in `documentation/state-design.md`, `documentation/frontend.md`, and `documentation/pr-checklist.md`.

## Success Criteria

- Every data surface demonstrates all seven matrix states (loading, first-run empty, filtered empty, few, many/overflow, error, denied) or carries a written reason, previewable through the existing `?stats/sectors/companies/chat/role` scenario params.
- One documented motion scale governs all transitions; every enter has a matching exit; everything collapses to instant under reduced motion.
- One documented overflow scale governs all scroll regions, truncation, and count thresholds; no unbounded list remains.
- Touch targets, mobile shell behavior, and post-action focus are consistent and checkable.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` green, with a per-state test for each newly designed state.

## Context And Current Facts

- Surfaces and owners: `frontend/src/components/Dashboard.tsx` (StatsPanel, SectorPanel, CompanyPanel), `ResearchesPage.tsx` (FilterBar, FullList), `SectorDetailPage.tsx` (summary, CompanySection, ActivityBlock), `ChatPanel.tsx` (SessionsPanel, FilesMenu, mention index, MessageBubble, ApprovalCard, composer, queued/steer), `SubagentsPanel.tsx` (rows), `research-parts.tsx` (SectorRow, CompanyRow, ToolRow, PanelError, SkeletonRows, useFailed, useStagedArrival), `Sidebar.tsx`, `TopBar.tsx`, `StatusPill.tsx`, shell in `App.tsx`.
- State drivers already exist: `frontend/src/lib/useScenario.ts` (`stats/sectors/companies/chat/role`), `frontend/src/mock/scenarios.ts` (`few` = 1 row, `many` = 60 rows, `live`, `withFailed`, `withComplete`), `useFailed`/`useStagedArrival` hooks.
- Documented threshold: 50 rows, implemented once in FullList (`max-h-96` scroll + truthful total chip); landing previews slice to 5 with full-count View-all buttons.
- Current transitions: section crossfade (`fade-in-0 duration-200` + scroll-top + heading focus in `App.tsx`), chat dock mount fade, staged-arrival row fade+slide, skeleton pulse, hover color transitions, chevron rotate, streaming word chunks with a reduced-motion instant path.
- Gaps found in this audit (each becomes work below):
  1. No exit transitions anywhere: dock close, popovers (sessions, files, mention, context), subagent collapse, and approval/effect swaps unmount instantly.
  2. No shared motion scale: durations/easings scattered; `transition-transform` chevrons and `active:translate-y-px` are not `motion-safe` gated.
  3. Skeletons do not match content metrics (`SkeletonRows` h-12 vs `min-h-19` rows), so arrival shifts layout.
  4. Unbounded lists: `CompanySection` and `ActivityBlock` on Sector detail have no cap, unlike FullList.
  5. No chat autoscroll policy: new replies can land below the fold with no back-to-latest affordance.
  6. Missing filtered/empty states: `@` mention with no matches closes silently; `SessionsPanel` and `FilesMenu` have no empty-index states.
  7. Chat header title has no truncation (`min-w-0`/truncate missing), so long scope names squeeze header buttons.
  8. Touch targets: `icon-sm` buttons are 28px, below a usable mobile target; no coined standard.
  9. No mobile shell rule: `Sidebar` is a fixed `w-56` at every width; no collapse story below `md`.
  10. Post-action focus is partial: section change, chat close, context/sessions Escape, and steer/composer focus are handled; approve/deny/retry/flush land focus nowhere.
  11. Offline/session-expired/rate-limited variants of matrix item 7 do not exist anywhere (only permission-denied does); partial-failure copy does not exist (errors are all-or-nothing).
  12. Thresholds beyond FullList are undocumented (chat, subagents, sessions, files, activity).

## Constraints And Non-goals

- Constraints: TypeScript strict, tokens only, both themes verified, plain-words copy (no em dashes; scan test must stay green), keyboard reachability with visible focus, `components/ui` primitives composed not forked, every behavior change ships a failing-first test (`documentation/tests.md`), area docs updated in the same change.
- Non-goals: no new pages, routes, or features (no gallery page: state review uses scenario URLs plus e2e); no backend/MCP/data changes; no donor code; no dependency or framework additions; Agents/Emails/Settings stay placeholders; composer stays single-line.

## Key Decisions

- Motion: keep Tailwind enter keyframes, add matching exit keyframes driven by data-state, and centralize the scale (one duration, one easing) in `frontend/src/index.css` documented in `documentation/frontend.md`. Alternative rejected: a JS animation library (new dependency, banned by the PR checklist).
- Reduced motion: gate every transition class with `motion-safe:`, including chevrons and press translation; streams already land instantly and stay that way.
- Overflow: one scroll-region scale (`max-h-56` compact popovers, `max-h-64` menus, `max-h-96` full lists) with sticky section headers where lists scroll under titles; per-surface thresholds recorded in `documentation/state-design.md`.
- Chat autoscroll: stick to bottom on new content unless the user scrolled up, in which case show a back-to-latest button; never yank a reading user.
- Touch targets: icon buttons minimum 40px (`size-10`); dense multi-button rows may keep 32px only with 8px gaps and a written reason. Alternative rejected: leaving 28px (fails the repo's usable-target rule).
- Mobile shell: below `md`, the sidebar becomes an icon rail (labels visually hidden, `aria-label` kept); no overlay drawer (new chrome) and no content squeeze.
- Post-action focus: every async swap moves focus to its confirmation or back to its trigger; audited per surface, never left on `body`.
- Unavailable matrix variants: design one shared offline/unavailable notice pattern and apply it to the three async panels; document partial failure as not-applicable with reason (mock errors are all-or-nothing by fixture design).

## Recommended Approach

Work surface by surface in dependency order: motion scale first (everything else animates against it), then overflow caps, then missing states, then targets/shell/focus, then the verification sweep. Each unit lands with its tests and doc updates; nothing merges with a red gate or an undocumented threshold.

## Work Plan

1. Motion scale and exits (M). Centralize duration/easing; add exit keyframes for the chat dock, the four popovers (sessions, files, mention, context), the subagent collapse, and approval/effect swaps; `motion-safe` gate chevrons and press translation. Files: `frontend/src/index.css`, `ChatPanel.tsx`, `SubagentsPanel.tsx`, `research-parts.tsx`, `documentation/frontend.md`. Validates: focused unit tests for exit completion and reduced-motion instant path, plus `lint/typecheck`.
2. Skeleton metric match (S). Resize `SkeletonRows`/`SkeletonCards` to the exact content metrics they stand in for; verify no layout shift on arrival. Files: `research-parts.tsx`, `Dashboard.tsx`, related tests. Validates: unit tests on loading branches, visual before/after notes.
3. Overflow caps and autoscroll (M). Cap `CompanySection` and `ActivityBlock` on the documented scale; implement chat stick-to-bottom with a back-to-latest button; record every surface threshold in `documentation/state-design.md`. Files: `SectorDetailPage.tsx`, `ChatPanel.tsx`, `documentation/state-design.md`. Validates: `many`-scenario unit tests per capped list, manual long-thread check.
4. Missing empty/filtered states (S). No-match row for the `@` index; empty states for `SessionsPanel` and the file index; header title truncation. Files: `ChatPanel.tsx`, tests. Validates: one unit test per new state.
5. Targets, shell, focus (M). 40px icon-button standard; icon-rail sidebar below `md`; focus targets for approve/deny/retry/steer/flush/new-message. Files: `ui/button.tsx` (variant only, no fork), `Sidebar.tsx`, `ChatPanel.tsx`, `research-parts.tsx`, `documentation/frontend.md`. Validates: unit tests for focus moves, 360px manual pass, keyboard walkthrough note.
6. Unavailable and partial-failure coverage (S). Shared offline/unavailable notice on the three async panels; written not-applicable reason for partial failure. Files: `research-parts.tsx`, `Dashboard.tsx`, docs. Validates: unit tests where a new state is added.
7. Matrix verification sweep (M). Every surface times seven states via scenario params in both themes; truthful counts at `few`/`many`; close any remaining gap with a test or a written reason. Validates: full `npm test`, `test:e2e`, screenshot notes per state family.

## Validation Plan

- Per unit: focused `vitest run` on the touched area, then `npm run lint`, `npm run typecheck`; full `npm test` and `npm run build` before handoff of each unit; `npm run test:e2e` whenever a user path changed.
- Manual checklist per unit: 360px viewport, reduced-motion on, dark theme, keyboard-only walkthrough, one overflow and one underflow case.
- Highest-risk validation: unit 3 autoscroll (scroll-position assertions are timing-sensitive; assert stickiness policy, not pixel positions) and unit 1 exit transitions (assert end state and reduced-motion path, never animation frames).

## Risks / Rollback

- Animation assertions go flaky: mitigate by asserting end states and the reduced-motion instant path; keep fake-timer discipline from the existing suite.
- Visual-review confusion from stale dev transforms (observed twice this week): restart the dev server and hard-refresh before screenshot review.
- Scope creep into features/pages: each unit's file list is the boundary; anything outside it becomes a new proposal, not a drive-by.
- Rollback: each unit is UI-only and independently revertible; docs revert with their unit.

## Open Questions

None. All unknowns above were answered from the workspace; decisions with defaults are recorded under Key Decisions.
