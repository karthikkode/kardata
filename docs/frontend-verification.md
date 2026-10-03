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

## Wave 7 (sector workspace: landing + chat workspace, 2026-09-30)

Shots from `workspace.spec.ts` (landing dialog + workspace light/dark
1440/390, resources drawer), `matrix.spec.ts` (landing light/dark
1440/390), `polish.spec.ts` (workspace pins/hover/dark),
`scrollbars.spec.ts` (workspace rail thin), `visual.spec.ts` (landing,
mobile landing). All anchors asserted before capture, animations frozen.

| component | scenario | seed | shots on disk | automated test | verdict |
|---|---|---|---|---|---|
| SectorLanding | summary light 1440 | matrix draft/0cos | `matrix-light-1440-detail.png` | `matrix: light desktop 1440` | pass: status card (Draft + guidance + View progress + Open), Companies empty copy, no spill |
| SectorLanding | summary dark/mobile | matrix draft/0cos | `matrix-dark-1440-detail.png`, `matrix-light-390-detail.png`, `matrix-dark-390-detail.png`, `wave2-mobile-detail.png`, `sector-detail.png` | matrix dark/mobile, `wave2 mobile sector detail stacked`, `sector detail with context drawer content` | pass: stacks clean at 390, icon rail, cards full-width, dark coherent |
| SectorWorkspace | 3-rail chat light 1440 | workspace long+30 files | `workspace-1440-light.png`, `workspace-resources-1440-light.png` | `workspace visual 1440 light` | pass: session rail (Research/Chats + Approved state), subagent strip, markdown (h/table/quote/code), files + 4-section context rails |
| SectorWorkspace | 3-rail chat dark 1440 | workspace long+30 files | `workspace-1440-dark.png`, `workspace-resources-1440-dark.png` | `workspace visual 1440 dark` | pass: dark pairs legible, table/quote/code tinted, rails separated |
| SectorWorkspace | mobile + resources drawer | workspace long+30 files | `workspace-390-light.png`, `workspace-390-dark.png`, `workspace-resources-390-light/dark.png` | workspace 390 light/dark | pass: rails become drawers (Open sessions / Open files and global context), no sideways spill |
| Workspace pins | header+composer stay on scroll | long messages | `polish-workspace-sticky.png`, `polish-workspace-dark.png` | polish pins + dark pins | pass: header/composer intersect viewport at scrollTop 600, dark same |
| Workspace rows | hover/focus containment | research+2 chats | `polish-workspace-hover-focus.png` | polish hover/focus | pass: row hover visible, composer focusable, spill <= 1px |
| Workspace rails | thin scrollbars | 60 chats | `scroll-workspace-rail.png` | rail thin under overflow | pass: scroll-slim + computed thin on rail and conversation log |
| Progress dialog | plan + estimate | approved plan v1 | covered by workspace.spec dialog test (no PNG) | `sector summary opens the shared plan/progress dialog` | pass: dialog opens, Esc returns focus to View progress |

Gates (Wave 7): frontend lint 0 errors, typecheck clean, `npm test`
276 passed / 6 skipped, `npm run build` clean, `npm run test:e2e`
40 passed / 4 skipped exit 0. Backend live battery 78 files /
480 tests exit 0 (bounded workers; see status entry on the DB wedge).

## Hardening slice: plan editing and file preview

Fixture browser journeys passed at 1440×960 and 390×960 in light/dark.
Reviewed editor stills `hardening-editor-{1440,390}-{light,dark}.png`: pinned
Save/Cancel, contained scrolling, readable fields, no sideways spill. Reviewed
preview stills `hardening-preview-1440-light.png` and
`hardening-preview-390-dark.png`: original-file action and markdown remain
inside the dialog; mobile resources stay behind the preview. These are fixture
results, not the Meta pilot. The four maintained `hardening surfaces` journeys
assert anchors, Save bounds, Escape/focus return and contain no network data.
Their videos are `frontend/test-results/workspace-hardening-surfaces-<width>-<theme>-chromium/video.webm`.

A read-only walkthrough of an existing completed run exposed misleading future
work copy in its empty ledger. The complete/failed regression failed before the
fix; terminal runs now say no ledger was recorded and retain saved results.

## Stream and company-list hardening (2026-10-01)

Maintained browser matrix: 50 passed / 4 live-gated skips before the durable
receipt extension. Company polling preserves a loaded 200-row window, and the
1,000-row list remains navigable. The overflow journey hydrates 200 history rows
plus the terminal answer and captures `hardening-overflow-recovery.png`.
The two new receipt journeys capture `hardening-overflow-steering-consumed.png`
and `hardening-overflow-steering-missed.png`; their results are recorded after
verification, not inferred from fixtures. All these journeys use declared TEST
fixtures and do not establish live-provider or deployment readiness.

Latest full matrix: **52 passed / 4 live-gated skips**, exit 0. Inspected the
consumed/missed steering stills: terminal answer stays visible, Stop clears,
missed instructions return to the draft with a plain explanation and recovery
control. No horizontal spill in either inspected desktop capture. Fixture EOF
intentionally leaves the reconnect notice visible. Transition videos are:

- `frontend/test-results/workspace-overflow-recover-70c20-consumed-steering-in-the-UI-chromium/video.webm`
- `frontend/test-results/workspace-overflow-recover-8d4f1-s-missed-steering-in-the-UI-chromium/video.webm`

The independent reviewer reran 13 frontend recovery cases and 13 isolated live
DB/HTTP cases; this is additional verification of the slice, not a full release
verdict. Remaining UI matrices and real-provider journeys stay acceptance gaps.

Curated reviewed captures and the consumed/missed steering transition clips are
retained in `tests/evidence/hardening-2026-10-01/` for PR review. They are labeled
TEST fixture journeys; no production or real-provider claim is implied.


## Isolated real-HTTP file recovery

`files-db.spec.ts` passed its production-route journey with isolated Postgres and
filesystem archive: failed indexing shows an alert and no file; retry shows the
file; preview renders its extracted heading; downloaded bytes exactly equal the
chosen upload. Captures: `files-db-upload-failure.png` and
`files-db-upload-recovered.png`. Chat SSE alone is stubbed. The open-mode test
proves file behavior, while separate keyed HTTP suites prove authority. The
existing production deployment and Meta pilot are not involved.

The stricter Research-heading guard reproduced the remount initialization race
before its fix and now passes before file actions. The upload-error copy guard
likewise failed on the generic internal-error banner and now passes on its retry
instruction. Latest full matrix with isolated DB enabled: 53 passed/4 live-provider
skips. File recovery video remains local at
`tests/evidence/hardening-2026-10-01/files-db-upload-recovery.webm`.


## General Karbot context tools over real execution

`agent-context-db.spec.ts` drives the existing chat UI over real HTTP, Temporal,
MCP and Postgres with a scripted provider. Captured real tool replies include the
owned local notes and explicitly selected authorized sector scope. The visible
activity group has two done tools; Send returns after the durable terminal answer
without waiting for stream EOF. Screenshot/video: `agent-context-real-tools.png`
and its labeled Playwright clip. No Meta or first-send creation claim is made.

The full matrix initially failed before the composer appeared because a session
run directory scanned the whole accumulated Temporal fleet. Session reads now
use their recorded graph. The same unchanged 10-second interaction deadline now
passes: latest full matrix **54 passed / 4 Meta-gated skips**.

### Real stream disconnect recovery (2026-10-01)

`agent-context-db.spec.ts` now completes its scripted tool-backed UI turn, retains
an unsent draft, inventories the sole idle LISTEN connection in its UUID-isolated
DB, terminates that exact PID, observes a new browser stream request/DB listener,
and asserts one terminal reply, unchanged draft, Send visible and Stop absent.
The initial browser run failed because Karbot did not reconnect on graceful EOF;
the same deadline now passes. Screenshot visually reviewed: completed tool group,
terminal answer, draft retained in the composer, no Thinking/Stop residue. This
is real HTTP/Temporal/MCP/DB with scripted provider, not Meta or a deployment.
Local retained evidence: `tests/evidence/hardening-2026-10-01/agent-context-db-reconnected.png`
and `agent-context-db-reconnected.webm`. The existing CI browser-agent artifact
includes the generated still/video. No research records or owner workflows were
modified; disruptive drill is isolated.

### Live UI preflight, not campaign completion (2026-10-01)

The actual app Models screen loaded Meta, five available choices, the default
muse-spark-1.3-contributor at high effort, and key-configured status after the
owner-authorized test credential setup. No session selection/model binding was
changed. Read-only Overview also showed historical government/news/guide entries
among company candidates, reinforcing that source/identity/geography screening
must precede the new campaign's accepted count. Existing records were not altered.
Local JPEG proof: `tests/evidence/hardening-2026-10-01/meta-models-preflight.jpg`.
This is real-app catalogue readiness, not a Meta research turn, current-worker
rollout proof, or the2000-company pilot. CUA exports JPEG; JPG/JPEG evidence is now
ignored alongside PNG/WebM. The browser tab is retained for later UI pilot work.

### Unconfirmed tool operation recovery (2026-10-01)

`workspace.spec.ts --grep 'operation recovery'` passed four routed browser
scenarios at1440/390px in light/dark with reduced motion. Each asserts a paused
conversation without Thinking, the readable pending-operation card, expandable
original identity, keyboard focus and Escape focus return. Screenshots/videos
are retained under frontend/test-results. This is fixture UI evidence, not Meta.
Visual review of the mobile dark screenshot caught an expanded long ID consuming
the editor viewport. The fix bounds that code region to128px, allows keyboard
scrolling and preserves the full ID; the same four cases passed after correction.
The final mobile still shows recovery status, local notes and both actions within
the dialog, without horizontal overflow. Other themes/sizes have matching layout
assertions and retained stills for review.

### Revision approval basis and retained work (2026-10-01)

Full routed workspace suite29 passed. Four plan-context conflict scenarios at
1440/390px light/dark assert the POST pins version/contextVersion, keep conflict
visible and leave the plan editable. Retained discovery provenance and original
source stay readable while percentage is pending. Context denial removes approval;
fresh503 context failure disables approval after the existing poll. Desktop/mobile
stills and transition videos are retained under frontend/test-results. The mobile
dark conflict still was visually inspected: visible banner, readable executable
limits, both plan actions and bounded scroll; no horizontal overflow. These are
explicit fixtures, not approvals performed on live pilot research.

### File processing and supervision preflight (2026-10-02)

The maintained browser matrix passed 122 with 7 explicit live/runtime skips on
owned port 15174. Source hashes for all 82 frontend/e2e files stayed unchanged.
The PDF cases cover 1440/390px, both themes, reduced motion, paid-retry review,
denied submission with retained acknowledgement, and bounded section paging.
Current screenshots/video are under
`frontend/test-results/final-browser-15174/playwright/file-processing-*`.
The mobile-light denied review and desktop-dark section preview were visually
inspected: readable copy, fully visible actions, no sideways spill, and full
content available through section controls/original download. The current file
list shows upload provenance separately from current processing status.

Alert cases cover both sizes/themes, long references, older-page loading,
denial and retry; stills/videos are in the matching `alerts-*` directories.
The long-reference captures preserve text through wrapping and paginate 20 rows;
desktop-dark and mobile-light geometry were inspected. Extremely long synthetic
identifiers produce tall cards, so these captures establish overflow safety,
not a measured large-fleet UX/performance claim.

An additional actual Meta journey used the retained isolated app, without route
interception or backend data population. One synthetic mixed-text/bitmap/vector
PDF completed 4/4 image analyses; native and AI-derived sections were visible,
the original downloaded exactly and no page errors occurred. Its desktop-light
preview was visually inspected. Safe screenshots and transition video are in
`backend/test-results/preflight-safe-visual-proof/`; raw credential-bearing traces
remain private and excluded. This is PDF production-path evidence, not a live
company-discovery campaign or complete OCR-quality evaluation.

## Wave 8 (revamp completion: primitives, shells, prescribed migrations)

Branch `codex/ui-revamp-complete` from `ui-revamp-perfect` head `fdbc9d2`.
Owned wrappers for all 19 primitives (`frontend/src/components/ui/`) over
Base UI 1.8.0 plus 9 shared shells (`frontend/src/components/shells.tsx`),
centralized motion presets (`EXIT_MS`/`POPOVER_MS` + six enter/exit pairs),
and typed text primitives with ref/ID/tabIndex forwarding. Adopted:
Researches Tabs/Select/creation-dialog, SearchField unification
(TopBar/files/sessions/subagents), ConfirmAction deletion in workspace and
Karbot (row delete touch-visible, 32px), workspace tablist arrows,
Karbot file targets at 32px with 8px gaps, collapsed-sidebar tooltips, App
title/gutters/page-enter, legacy drawer estimate labeling with the 60%
claim and amber removed. ID-to-evidence map:
`tests/frontend/coverage-registry.md`.

Gates: `npm run lint -w frontend` 0 errors (5 pre-existing warnings),
`typecheck` clean, `npm test -w frontend` 421 passed / 6 skipped (53
files), `npm run build -w frontend` clean. Failing-before/passing-after
pairs observed in-session: kept-mounted panels hid rows (reverted),
tooltip role + StatusPill structure fixes, drawer meter copy, stale
tab/select/confirm names moved to the intended contracts
(`Approve vN`, alert-dialog deletion, tab roles, combobox options).
Core browser re-verification (smoke/visual/matrix/transitions) re-ran on
isolated port 15174 with fresh screenshots inspected; full-matrix,
workspace, states, and plans/scale batches re-ran likewise (live-gated
plan-02/plan-03 skip explicitly). `npm run pr:verify` remains blocked by
the pre-existing backend lint on generated
`backend/test-results/preflight-merged-readonly-ui.mjs` (not this diff).

Explicit follow-ups (not silent): ConversationComposer visual migration for
both composers, Select-primitive model menus, 200%-zoom/touch-keyboard
matrices, live DB/Temporal/provider suites, 2,000-company campaign.

## Wave 9 (review remediation: plan, markdown, motion, files, sizing, registry)

Owner review rejected the completion claim with eight blockers; all are
remediated on `codex/ui-revamp-complete`, each with failing-before evidence:

- Plan presentation: executable queries render as full numbered rows (no
  truncated chips), acceptance is a neutral decimal list (no checkmarks),
  the target/cap progress bar is removed (numeric text kept), numeric
  drafts stay strings until submit (blank never coerces to zero), and
  field-level errors plus a focused error summary gate submit.
- Markdown: keyword icons leave ordinary chat (explicit `variant="plan"`
  only); grouped plan rhythm lives on the renderer, and the dead
  `.plan-brief` wrapper selectors were deleted.
- Motion: `LazyMotion features={domAnimation}` wraps both App roots with
  the lightweight `m` indicator; Base UI primitives carry enter AND exit
  via `data-starting-style`/`data-ending-style`; WorkspaceOverlay is the
  shared dialog (native `<dialog>` removed) with a topmost-only Escape
  guard for sibling overlays (`lib/overlay.ts`, race-hardened); page
  replacement crossfades through the View Transitions API (instant swap
  with fade-in where unsupported).
- Karbot files: preview failure is an alert with retry (never file-body
  text), downloads fail visibly with dismissal, and stale previews cannot
  overwrite the current file (request sequencing).
- Sizing: standard controls 40px, compact 32px with coarse-pointer 40px
  enlargement, file/row/menu targets at 32px+, timestamp buttons enlarged;
  TopBar search renders on Overview only with the query preserved.
- Models panel on shared Select/checkbox with "Configured" (never "Live");
  settled agent replies gained the specified Copy action with local
  clipboard-failure reporting (wired in dock, workspace, and legacy).
- Registry: false rows corrected (`approval.test.ts`, real copy/queries/
  acceptance/target entries, named FileProcessing rows) and an enforceable
  gate (`coverage-registry.test.ts`) fails on any unmapped component file.
- Evidence: `revamp-evidence.spec.ts` extended (exit-transition arming,
  search scoping, profiling); filter 79/40/36ms, zero sustained long
  tasks over 200ms across transitions, 0.0% heap growth over 20 dialog
  cycles (numbers carry host-load noise; bounds hold with margin).
  Environment note: user inotify instances were exhausted (169/128, mostly
  editor/servers), so e2e web servers run with `CHOKIDAR_USEPOLLING=1`;
  counts of inotify pressure belong to the host, not the product.
- Toolchain: backend eslint now ignores generated `test-results/**`
  (unblocks the false-red lint); hardening catalogue and acceptance
  surfaces regenerated through their sanctioned maintenance modes (new
  entries honestly `pending`); `npm run pr:verify` passes exit 0.

Gates: lint 0 errors, typecheck clean, `npm test -w frontend` 442 passed /
6 skipped, build clean, browser 126+ passed with 2 live-gated skips.

## Wave 10 (second review remediation + plan timeline redesign)

Owner review round two returned six blockers; all fixed with
failing-before evidence on `codex/ui-revamp-complete`:

- Overlay registry follows actual open state (reopening re-registers;
  nothing registers while closed) and refused closes keep registration.
- WorkspaceOverlay is controlled (`open` + frozen exit content +
  reopen-cancel) across all 14 sites plus ExecutionInspector and
  OwnerContextRebuild (nullable-source threading); exits verified in a
  browser by detachment timing (~120ms) and ending-style assertions.
- Discovery target distinguishes cleared-populated (field error) from
  never-set (stays unset, schema-optional); the invariant backstop can
  only surface as a form error, never a silent default.
- Structural coverage gate validates test/source existence, per-area ID
  rows, and primitive adopters; adoption extended to activity
  disclosures, plan history, file/operation disclosures, textareas,
  progress, skeletons, StatusBadge, PageHeader, OperationNotice, and the
  Models selects.
- Performance per the agreed acceptance: 20-query p95, 50 overlay cycles
  with a 20% heap bound, dialog-exit detachment timing, and initial
  2,005-row render timing. Live populated workflows reviewed on the
  admitted dev server (`live-overview/researches/models-1440.png`, zero
  page errors).
- Model menus gained collision-aware placement after a bottom-docked
  clipping report (unit + viewport-containment browser proof).
- Plan presentation redesigned to a timeline rail (medallions, numbered
  query/acceptance rows, stat boxes) in both themes
  (`revamp-plan-timeline-light/dark.png`), preserving every pinned
  string, role, and request semantic.

Gates: lint 0 errors, typecheck clean, full unit green, `npm run
pr:verify` exit 0, browser matrix green with 2 live-gated skips.

## Wave 11 (narrative brief headings)

Owner screenshot of a narrative-only plan showed plain h2 sections with
no glyphs: the plan Markdown variant applied keyword icons and grouped
rhythm to h3 only, while briefs use arbitrary valid headings. The variant
now treats h2 identically (icon + divider + muted body). Pinned by new
markdown cases (h2 glyph in plan, absent in chat); timeline evidence
re-captured in both themes.

## Wave 12 (narrative brief timeline)

Owner comparison against the reference design showed the narrative-only
plan still rendering as flat headings: the plan Markdown variant covered
h3 but briefs use arbitrary levels. New `PlanBriefTimeline` splits any
brief into heading-led sections (fences opaque, all lines preserved) and
renders a medallion timeline shared by workspace, progress dialog, and
legacy views; unknown sections get the neutral document glyph. Pinned by
splitter/timeline unit cases plus light/dark browser shots
(`revamp-plan-brief-light/dark.png`).
