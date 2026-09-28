# Frontend verification (ops log: behavior + boundaries)

Wave 1 (revamp: shell, sidebar, TopBar, Dashboard counts). Screenshots live in
`frontend/test-results/visual/` (gitignored, Playwright `visual.spec.ts` asserts
anchors before every shot). Light desktop unless noted. Verdicts below are
human-reviewed from the PNGs on disk.

| component | scenario | seed | shots on disk | automated test | verdict |
|---|---|---|---|---|---|
| App shell | overview empty | `serveApi []` | `overview-empty.png` | `visual: overview empty state` | pass: single scroll, max-width cards, no spill |
| App shell | dock exit shared hook | unit | n/a (transition) | `Navigation: plays the chat dock exit before unmounting` | pass: exit plays, unmounts after EXIT_MS |
| Sidebar | collapsed rail + disabled Emails | `serveApi []`, click Collapse | `wave1-sidebar-collapsed.png` | `Sidebar: collapses...`, `Sidebar: marks Emails...`, `Navigation: keeps sidebar names...` | pass: icon rail, Expand toggle, Emails coming-soon disabled, no dead route |
| TopBar | clearable Overview search | type `Speciality` | `wave1-dashboard-filtered.png` (header X) | `TopBar: clears the search...` | pass: X appears with text only, clears on click, keyboard reachable |
| Dashboard | filtered counts truthful | `Speciality` needle | `wave1-dashboard-filtered.png` | `Dashboard filtered counts` (3 tests) | pass: `Showing 1 of 1` sector, `0 of 0` + filtered empty companies, View-all keeps total |
| Dashboard | preview cap | 60-row fixtures | unit only | `Dashboard landing preview` | pass: 5-row cap, truthful View-all 60 |
| Layouts | desktop 2-col cards | `serveApi []` | `overview-empty.png` | e2e 10/10 | pass: footers baseline-aligned, cards equal rhythm |

Gates (Wave 1): `npm run lint` 0 errors (5 pre-existing warnings), `typecheck`
clean, `npm test` 219 passed / 6 skipped (28 files), `npm run build` clean,
`npm run test:e2e` 10/10.

## Wave 2 (detail, lists, runs, chat polish, markdown, toolbar)

| component | scenario | seed | shots on disk | automated test | verdict |
|---|---|---|---|---|---|
| ResearchesPage | filtered count + truthful 50+ total | `Overflow sector 5` needle (11 matches) | unit only | `ResearchesPage: filters by text`, `counts the filtered total...` | pass: `Showing 1 of 1`, `of 11 matching`, chip uses filtered total |
| SectorDetailPage | company filter outcome, viewport columns, eye tooltips | `west` needle, 120-row section | `wave2-mobile-detail.png` | `SectorDetailPage body: states the company filter outcome`, 120-cap suite | pass: count line, stacked mobile readable, 120 total chip + filter reachability |
| SectorContextDrawer | unit list scroll cap | multi-unit file expanded | `sector-detail.png` | `SectorContextDrawer` suite green | pass: `max-h-64` island, meter + toggles unchanged |
| RunsPanel | cancelling paused tone + cancel failure | `CANCELLING` stub, 500 on cancel | `wave2-runs-cancelling.png` | `runs-staging: tones a cancelling run...`, `reports a failed cancel...` | pass: amber pill (paused tone, no failed tone), alert with recovery copy |
| ChatPanel | user bubble tint/shape/wrap, polite log, composer hint | unit + `chat-model-picker.png` | `chat-model-picker.png` | `chat-staging` suite green | pass: `bg-primary/10 rounded-2xl` + anywhere-wrap, `aria-live polite` on log |
| ModelToolbar | no autofocus steal, tighter mobile cap | unit | `chat-model-picker.png` | `models-staging` suite green (cap updated to `max-w-52`) | pass: search opens without stealing focus, pill truncates with full names in menu |
| Markdown | real heading levels | `# Title` fixture | unit only | `markdown: renders agent heading levels...` | pass: h1/h2 roles, hostile-input suite still green |
| Shell | dark collapsed rail | theme toggle + Collapse | `wave2-dark-collapsed.png` | e2e 13/13 | pass: dark tokens, rail icons, no spill |
| Infra | frozen-animation shots | Agents nav + shot | `wave2-runs-cancelling.png` | all visual specs | pass: mid-fade blank diagnosed (visibility ignores opacity), `animations: disabled` per shot |

Gates (Wave 2): lint 0 errors, typecheck clean, `npm test` 224 passed / 6 skipped,
`npm run build` clean, `npm run test:e2e` 13/13.

Skipped (stated): drawer overlay-vs-dock rebuild, approval-card renderer (no
lane emits yet). The per-component reduced-motion + contrast + keyboard audits
from the handoff plan are covered by the matrix (reduced-motion test),
dark-matrix review, and focus tests below.

## Wave 3 (full matrix, clips, reduced motion)

Matrix: `tests/frontend-e2e/matrix.spec.ts` walks Overview, Researches,
SectorDetail, Agents, Models, and the open chat dock in light + dark x 1440 +
390 (24 shots) plus a reduced-motion navigation + dock test. Clips:
`tests/frontend-e2e/transitions.spec.ts` records dock open/close, section
crossfade with heading focus, and model-menu open/Esc-refocus (3 webm in
`frontend/test-results/`).

| surface | light 1440 | dark 1440 | light 390 | dark 390 | verdict |
|---|---|---|---|---|---|
| Overview | `matrix-light-1440-overview.png` | `matrix-dark-1440-overview.png` | `matrix-light-390-overview.png` | `matrix-dark-390-overview.png` | pass: rail/labels, empty CTAs, no spill |
| Researches | `matrix-light-1440-researches.png` | `matrix-dark-1440-researches.png` | `matrix-light-390-researches.png` | `matrix-dark-390-researches.png` | pass: form + filters wrap; row names wrap below meta (zero-width fix) |
| SectorDetail | `matrix-light-1440-detail.png` | `matrix-dark-1440-detail.png` | `matrix-light-390-detail.png` | `matrix-dark-390-detail.png` | pass: stacked mobile, viewport columns, context meter exact |
| Agents | `matrix-light-1440-agents.png` | `matrix-dark-1440-agents.png` | `matrix-light-390-agents.png` | `matrix-dark-390-agents.png` | pass: filter + rows, amber cancelling tone |
| Models | `matrix-light-1440-models.png` | `matrix-dark-1440-models.png` | `matrix-light-390-models.png` | `matrix-dark-390-models.png` | pass: selects styled, binding line, server-default chip |
| Chat dock | `matrix-light-1440-chat.png` | `matrix-dark-1440-chat.png` | `matrix-light-390-chat.png` | `matrix-dark-390-chat.png` | pass: composer + Model pill + send, overlay dismissible |
| Reduced motion | `matrix-reduced-motion.png` | n/a (same code path) | n/a | n/a | pass: nav focus, dock Esc, focus returns to trigger |
| Clips | dock `video.webm` | section `video.webm` | menu `video.webm` | | pass: paired enter/exit, focus contracts hold on video |

Live catches while completing: (1) mobile row names squeezed to zero width
(debug probe: 0x20px at 390) — rows wrap now, matrix mobile is the regression
test; (2) dark-matrix shots rendered light — suite reloaded after the theme
toggle, fixed with a dark flag; (3) menu Esc missing its handler after
autofocus removal — focus moves into the menu on open (unit test `moves focus
into the menu...`); (4) mid-fade blanks — animations frozen per still. Minor
note: the 390px sector session title truncates beside the rename pencil; full
title lives in the session list.

Gates (Wave 3): lint 0 errors (5 pre-existing warnings), typecheck clean,
`npm test` 225 passed / 6 skipped, `npm run build` clean, `npm run test:e2e`
21/21 (smoke 4 + visual 9 + matrix 5 + clips 3).

Remaining skips (stated, not buildable now): drawer overlay rebuild (decision:
keep docked), approval-card renderer (no lane emits), per-row 120-shot for
every list (covered by unit overflow suites + representative matrix).

## Wave 4 (accent palette + formatter revamp)

Formatter: `tests/frontend-e2e/formatter.spec.ts` serves a durable table-heavy
agent reply (the exact shape from the owner's screenshot: filename/status/id
table, quoted brief with heading, 64-char hash) and shots it in three
configurations. Unit: table headers carry `scope="col"` inside a scroll frame.

| shot | anchors | verdict |
|---|---|---|
| `formatter-light-1440.png` | filename columnheader + intact `speciality-foods-context.md` | pass: bordered table, tinted head, no mid-token breaks, tinted quote, bordered code |
| `formatter-dark-1440.png` | filename columnheader + brief filename | pass: same structure, dark tokens, indigo buttons/links |
| `formatter-light-390.png` | id columnheader + `Files attached:` | pass: table scrolls in place, quote + composer clean |

Palette review (same shots): indigo lands on primary buttons, user-bubble
tint, links, quote rule, send button; surfaces stay neutral; dark mode holds.
Contrast kept at AA (primary/white ~4.8:1 light; light-indigo/dark-text dark).

Gates (Wave 4): lint 0 errors, typecheck clean, `npm test` 226 passed /
6 skipped, `npm run build` clean, `npm run test:e2e` 24/24 (smoke 4 + visual 9
+ matrix 5 + clips 3 + formatter 3).

## Wave 5 (scrollbars: thin, token-matched, every component)

`tests/frontend-e2e/scrollbars.spec.ts` forces overflow everywhere (60 sectors,
20 chat messages with a wide table + 12-line code block, 20 models, 30 drawer
units, 15 documents) and asserts the `scroll-slim` hook plus computed
`scrollbar-width: thin` before every shot. Unit:
`tests/frontend/scrollbars.test.ts` pins the engine rules, token fills, and
utility (failed 3/3 before the fix, passes after).

| shot | anchors | verdict |
|---|---|---|
| `scroll-researches.png` | `Overflow sector 60` in the 60-total overflow list | pass: list scrolls in place under the truthful total, rows wrap, no page growth |
| `scroll-chat-table.png` | filename columnheader + `overflow-doc-1.md` | pass: 20-message chat list scrolls, wide table + code keep their own horizontal scroll, no mid-token breaks |
| `scroll-model-menu.png` | `scroll-model-20` in the open Models menu | pass: 20-model flyout scrolls internally with contained overscroll, trigger stays put |
| `scroll-detail.png` | `Overflow sector 1` heading with 15 documents + 30-unit file | pass: Files and Context columns scroll independently, drawer units contained |
| `scroll-chat-dark.png` | filename columnheader + `overflow-doc-8.md` (dark) | pass: same thin treatment in dark, muted thumb on dark tokens, table intact |

Live catches while completing: (1) substring locators matched `Overflow
sector 1` inside 10-19 and `Scroll probe message 1` inside 11/13/15/17 —
exact-match anchors now; (2) first thumb pass used `var(--border)` and read
near-invisible on light — idle thumbs now use muted-foreground at 45% via
`color-mix`, hover at full muted; (3) headless overlay scrollbars auto-hide,
so the contract is asserted via computed `scrollbar-width` plus shots proving
no layout break, not via thumb pixels.

Gates (Wave 5): lint 0 errors (5 pre-existing warnings), typecheck clean,
`npm test` 229 passed / 6 skipped, `npm run build` clean, `npm run test:e2e`
29/29 (smoke 4 + visual 9 + matrix 5 + clips 3 + formatter 3 + scrollbars 5).

## Wave 6 (human-readable context citations + drawer pins)

Backend: storage ids no longer reach model-visible prose. Reference units
cite `filename:ord` (repeats take a stable `name (2)` suffix), notes cite
`[note:1]` by creation order, and the digest text carries no content hash
(the version stays in its own field). Selection refs, document reads, and
tool args still use the `sdoc-*`/`snote-*` ids. Proven by
`tests/backend/sector-context.test.ts` (4 tests failed before the product
change, pass after, including the new repeat-filename case) and the live
`tests/backend/api.sector-context.test.ts` (4/4 against Postgres on 5433).

Frontend: the drawer mirrors the same readable citations (unit rows cite
`filename:ord`, file summaries read `N units · Nk chars`, notes numbered by
position). `tests/frontend-e2e/polish.spec.ts` pins the drawer
micro-contracts in a real browser: meter and add-note stay pinned to the
column scrollport mid-scroll (with a scrolled-away System control proving
the scroll happened), inner unit lists chain the wheel to the column,
hover/focus introduce no page-level sideways spill, plus a dark pass.

| shot | anchors | verdict |
|---|---|---|
| `polish-drawer-sticky.png` | meter img + add-note region, System control out of port | pass: meter pinned top with hairline rule, add-note pinned bottom, `[long-file.md:3]` labels, `30 units · 30.0k chars` meta |
| `polish-drawer-hover-focus.png` | hovered eye button + focused note input | pass: single offset ring separated from Add, `[ref:0]` digest without hash, no spill |
| `polish-drawer-dark.png` | meter img + add-note region (dark) | pass: same pins, filename citations, hovered eye, dark tokens hold |

Live catches while completing: (1) sticky pins were dead on arrival: the
drawer content div itself carried `overflow-y-auto`, which made it the
nearest scrollport and trapped the pins; the content is plain flow now and
the column scrolls; (2) `scroll-slim` (containment) on the inner unit list
trapped the wheel at list end; islands stay containment-free and the
chaining test fails with the trap restored, passes without; (3) dark shots
rendered light again (suite re-navigated after the toggle); toggle now
happens after navigation; (4) Playwright `toBeVisible` ignores overflow
clipping, so pin assertions use port-intersection math, not visibility;
(5) focus ring read as a heavy double halo at `ring-3`: the composer input
now composes `ring-2` with a 2px offset.

Gates (Wave 6): frontend lint 0 errors (5 pre-existing warnings),
typecheck clean, `npm test` 231 passed / 6 skipped, `npm run build` clean,
`npm run test:e2e` 33/33 (29 + polish 4). Backend lint/typecheck clean,
hermetic 262 passed / 174 skipped (live-gated), live sector-context 4/4.
Agents 178 passed (untouched sanity).

## Scale proof (thousand-row UI, 2026-09-28)

`tests/frontend-e2e/scale.spec.ts` serves a stubbed 1000-company sector
and walks all ten Show-more windows: first window asserts
`Scale company 100` + `Showing 100 of 1000 companies`, each click
asserts the next hundred plus its count line, the tenth asserts
`Showing 1000 of 1000 companies` with no Show-more button left.
Stubbed, hermetic, no backend: `thousandWalkMs=1405` on the run that
proved it. Verdict: pass, counts truthful at every window.
