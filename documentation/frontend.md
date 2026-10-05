# Frontend

Stack: Vite + React + TypeScript SPA, Tailwind CSS v4, owned primitives in
`frontend/src/components/ui` (shadcn copy flow over Base UI), assistant-ui
headless chat primitives in adapter mode (`@assistant-ui/react`, transport
stays Kardata), Motion (`motion/react`) implementing the transition standard
alongside the CSS pairs. Tokens in `frontend/src/index.css` (`:root` + `.dark`).
Shared text scale in `frontend/src/components/text.tsx` (PageTitle,
PageDescription, WorkspaceTitle, SectionTitle, CardTitle, Body, BodySm,
Description, Caption, Label, Overline, Numeric, Mono, Kbd); no raw `text-[`
sizes in feature code (pinned by `tests/frontend/typography.test.ts` and
`tests/frontend/type-usage.test.ts`).

## Component anatomy (mandatory shape)

Every component follows props → render → states:

1. **Props first.** Explicit TypeScript props with plain names. No `any`, no
   unexplained casts. Data arrives via props; components never fetch, never
   import fixtures or mocks.
2. **Compose primitives.** Build from `components/ui` (button, input,
   …). Never fork a primitive for feature styling : compose it, or add a
   documented variant to the primitive itself.
3. **Every async surface states its case.** Loading, empty, error, success, and
   permission-denied where applicable. A spinner with no empty/error state is
   unfinished.

## UI rules live in docs/design-system.md

Styling, theming, interaction affordances, icons, containers, accessibility,
copy, typography, UX principles, transitions, composition, house markdown,
and the primitives inventory are canonical in `docs/design-system.md`.
This file keeps component anatomy and behavior only.

## What a frontend change ships with

1. The component or fix.
2. Its test in `tests/frontend/` (see `documentation/tests.md`).
3. Updates to this doc if a rule, token, or primitive changed.

## Assistant chat (live staging)

`ChatPanel.tsx` reads sessions, threads, messages, files, and runs from the
backend. Sends use commands; an immediate local copy of the user's own text
stays until its persisted message arrives. The server appends that message
before calling the provider. REST history and SSE frames merge by thread
message sequence, so either request may finish first without hiding a reply.
Replying also clears by the durable sequence: a resumed stream may contain
only a short tail, so its array length cannot identify the finished turn.

Provider text appears incrementally below the current conversation; the
persisted terminal message replaces the pending text. In-flight turns show
an inline ThinkingRow (Brain + shimmer "Thinking" + elapsed clock, no
border or background); settled replies carry a compact
ReasoningDisclosure ("Thought for 12s", or "Reasoning" without a
duration), the same instance keyed by message id so expanding during
streaming stays expanded after settle. Tool calls render in a separate
ToolActivity disclosure ("Used 3 tools" / "Using ...") with humanized
per-tool rows. Meta Responses may supply a summary, not raw private
reasoning; turns without either get no invented block. Running tool rows
show in-flight age from client-side first-seen stamps; wire frames are
unchanged. Agent replies render house markdown (`Markdown.tsx`: GFM subset,
no raw HTML, http(s)-only links, token styles) without a repeated avatar;
the subagent strip appears only when
a subagent exists. Sending with no session creates one first
(start-on-send, titled from the message); offline sends short-circuit with
"No connection" and keep the draft. Connection,
denied, empty, sending, thinking (elapsed clock while no frames have
arrived), stopped, and failed
states remain distinct. The live tail reconnects from its last sequence
after a silent connection. Three consecutive error snapshots end the wait:
the tail re-reads once (a reply may have landed without a frame) and, if
no fresh agent message arrived, clears Replying and shows the send failure
with the sent text restored for retry — a dead stream never spins the
indicator. Pinned by the dead-stream test in `chat-staging.test.tsx`.
A terminal thread status (FINISHED/ERROR/STOPPED) newer than the send
releases the owed reply even when no agent message arrives (orphan,
honest failure); staleness is judged by outbox seq, and in-flight
deltas/tools still win. An ERROR with reason `closed-owner` shows the
"Stopped unexpectedly" banner in both chat variants. Pinned by
`terminal-status.test.ts`, `workspace-conversation.test.tsx`,
`execution-epochs.test.ts`, and `live-state.spec.ts`.
MCP tool start/completion frames open the in-flight Activity disclosure and
show each running/done/failed status before the turn finishes. Persisted tool
messages take its place when they arrive; the stream carries no tool
arguments or result content.

The session picker and subagent thread controls use backend-owned records.
`@` references can address subagents and indexed files.
Karbot includes a Session Files tab with in-app artifact preview, download,
and file creation, a Plan Mode toggle for milestone planning (`/plan`), and
a live mid-run Steer action to guide agents and subagents on the fly.
The active sector surface is the landing/workspace described below, including
versioned global-context approval and durable thread compaction. The older
`SectorChatPanel`, `SectorContextDrawer`, `SectorDetailPage`,
`SectorPlanSection`, and `RunConsole` workbench remain legacy components;
App does not route their full layouts (the active landing renders the new
`CompaniesSection`, not the legacy `CompanySection`). Their old 60%
context meter and note-approval cards do not define the product's current
context/approval contract. Deletion awaits an owner decision.

The sector research strip states every lifecycle case: draft and failed
offer Plan, approved offers Start, running offers Pause, paused offers
Resume, planning/planned/queued/complete show the label with no action
(the backend cannot pause a queued or planning run). Buttons disable
with `researchBusy` and failures surface as an alert. While a sweep or
plan run is away, the detail page and the company window re-read every
5 seconds so the strip, the state, and new arrivals follow the run;
terminal and pre-start states stay quiet.
Proven by `tests/frontend/SectorChatPanel.test.tsx` (strip branches)
and `tests/frontend/SectorDetailPage.test.tsx` (follow poll).

The research plan panel (`SectorPlanSection`) renders the versioned
plan artifact with its version tag, or the honest empty/loading/error/
denied/offline states; drafts and failed sectors offer Plan from the
panel itself. It reads its own artifact and re-reads while planning.
Proven by `tests/frontend/SectorPlanSection.test.tsx` and
`tests/frontend/plan-api.test.ts`.

The run console (`RunConsole`) renders the sector activity timeline
(from the followed detail) plus steer targets across every chat in the
sector pool (capped at 20 sessions) with a Send/Steer composer behind
an explicit Review step; missed_steer reports honestly. Threads
failures degrade to inline notes while the timeline stands. Proven by
`tests/frontend/RunConsole.test.tsx` and the plan-02 live journey.

## Model selection

The Models tab and chat picker consume only `GET /v1/providers`; the client
never maintains a model-name list. The product catalog contains configured
Meta models confirmed by Meta's current `/models` response and local
capability checks. An unbound session shows Muse Spark 1.3 Contributor at
high effort. A stored per-session choice remains visible until changed.
The client rejects removed provider ids before sending a model PATCH.
(Owned primitives inventory: see `docs/design-system.md`.)

## Chat primitive adapter (assistant-ui, transport untouched)

Message iteration in `ChatPanel.tsx` (dock) and `SectorWorkspace.tsx`
(`ConversationView`) renders through `ThreadPrimitive.Messages` with a
render prop, driven by `AssistantRuntimeAdapter`
(`frontend/src/components/chat/AssistantRuntimeAdapter.tsx`) over
`useExternalStoreRuntime`. Row state maps through `toThreadMessages` and
`toThreadSegments` (`frontend/src/components/chat/assistantAdapter.ts`),
which preserve merge order, segment grouping, and failed plus live statuses
using the true `ThreadMessage` shapes. The empty state renders through
`ThreadPrimitive.Empty`. Transport stays Kardata: `followThread`, merge by
durable seq, resume tokens, dead-stream bound, abort-aware waits, and
`useChatStick` are unchanged, and no ComposerPrimitive owns the draft.
Proven by `tests/frontend/assistant-adapter.test.tsx`,
`tests/frontend/assistant-runtime.test.tsx`, `chat-staging.test.tsx`,
`follow-resume.test.ts`, `workspace-conversation.test.tsx`, and
`SectorChatPanel.test.tsx`. Iteration for static session lists stays
Kardata-owned: primitive lists render asynchronously on first paint while
owned lists paint synchronously, so lists keep owned iteration (parity gate
with failing-before evidence, 4 chat-staging failures reverted).

## Motion standard (Motion implements, CSS pairs coexist)

`motion@13.5.0` (exact) via `motion/react` implements transitions where it
is efficient; the `tw-animate-css` enter plus exit pairs remain sanctioned
implementations of the same 120/180/240 token standard (`MOTION` mirror in
`lib/motion.ts`, `EXIT_MS` 180 / `POPOVER_MS` 120). `MotionConfig
reducedMotion="user"` wraps both App roots so OS reduced-motion collapses
every JS-driven animation with focus plus scroll plus content work intact.
The centralized presets live in `frontend/src/lib/motion.ts`
(`EXIT_MS`/`POPOVER_MS` plus `popover`, `dock`, `dialog`, `page`, `row`,
and `notice` enter/exit pairs) and are pinned by
`tests/frontend/motion-presets.test.tsx`. Motion-powered feature markup
uses the lightweight `m` component under `LazyMotion features={domAnimation}`
(both App roots). Base UI overlay primitives carry their enter and exit in
the owned wrappers via `data-starting-style`/`data-ending-style`
transitions; `useExitState` retention stays only on the custom surfaces
(dock, composer menus, mention/skill lists). Page replacement crossfades
through the View Transitions API in `useNavigation` (instant swap with a
fade-in where unsupported). Only one system owns each exit.
See `docs/design-system.md` for the admitted pattern list.

## Owned primitives and shared shells (revamp completion)

Wrappers live in `frontend/src/components/ui/` (Base UI 1.8.0, shadcn copy
flow): button (with `pending`), input, textarea, field, select, searchable
(combobox), checkbox (indeterminate), switch (boolean settings only), tabs,
menu, popover, dialog, alert-dialog (plus `ConfirmAction`), tooltip,
collapsible, progress (determinate only), badge, skeleton, separator.
Pinned by `tests/frontend/ui-primitives.test.tsx`.

Shared presentational shells live in `frontend/src/components/shells.tsx`
(props only, never fetch): PageHeader, SectionCard, ResourceState (the
canonical loading/first-run/filtered/error/denied/offline treatment over
`Resource<T>`), SearchField, ListFooter, OperationNotice, StatusBadge,
ConversationComposer (visual layout; drafts and commands stay caller-owned),
PlanDocument. `ResourceNotice` delegates to ResourceState and `StatusPill`
delegates to Badge; the Researches list notices keep their pinned copy in
`research-parts.tsx`. Pinned by `tests/frontend/shells.test.tsx`.

Adopted (including review remediation): App page title/gutters with
the v2 page frame (Overview-only search removed in favor of the
palette); Researches type tabs (Base UI Tabs), state selection
(shared Select), sector creation (shared dialog), SectionCard/ListFooter
shells; Dashboard cards on SectionCard; PlanDocument in the workspace Plan
tab and landing dialog; ConversationComposer around both composers;
TopBar/files/session/subagent searches (SearchField); workspace and Karbot
session deletion (ConfirmAction with exact titles; touch-visible row
delete); settled-reply Copy with local failure reporting; separated
Karbot preview/download failure states with stale-preview sequencing;
workspace tablist arrow keys (drafts/scroll survive); Karbot file targets
at 32px; collapsed-sidebar tooltips; legacy drawer estimate labeling with
the 60% claim and amber removed; shared Select/checkbox on the Models
panel with "Configured"; 40px standard / 32px compact (+coarse 40px)
control scale; Markdown `variant="plan"` with renderer-owned grouped
rhythm; WorkspaceOverlay on the shared dialog with topmost-only sibling
Escape handling; real page crossfades under LazyMotion. The full
ID-to-evidence map is `tests/frontend/coverage-registry.md`.

Deliberately unchanged: composer drafts, mention/steering semantics,
and chat transport stay Kardata-owned (no ComposerPrimitive, no
ThreadList); approval/authority/persistence/file contracts untouched.
The model picker was rebuilt on the Base UI menu primitive
(`MenuRoot`/`MenuPopup`/submenu, `ui/switch` reasoning toggle,
collision-aware placement, full keyboard); `persist()` sends the
selected provider (the hardcoded `'meta'` bug is fixed with a unit
test). Pinned by `models-staging` menu suites and the CP-03 browser
proof.

## Sector workspace (landing → Open → chat)

Hardening additions: `ResearchPlanEditor` presents executable query/limit/target
controls and retains drafts on failed saves. `ExecutablePlanDetails` is shared
by Plan and progress dialog. `SectorFilePreview` displays retained extracts and
uses shared `downloadBlob` for original/extracted downloads. The data hooks own
all fetching. Queued, reconnecting and paused chat states are explicit; missed
steering remains visible. Work-item lists are searchable and windowed, with
source links and truthful counts. Tests are linked by [F:<id>] tags (registry arrives in Phase 1).

- The sector route lands on the summary page (`SectorLanding`): a
  `Research status` region (state copy, progress estimate, `View
  progress` dialog, `Open` button) plus the shared `CompanySection`
  (server-paged companies, or status-specific empty copy). `Open`
  enters the chat workspace; the landing back button returns to the
  sector list.
- The workspace (`SectorWorkspace`) keeps three rails: session rail
  left (`Session types` group toggling Research / Chats), conversation
  center with Chat / Plan (`Research views`) tabs for research
  sessions, files plus global-context rail right. Below 1280px the
  right rail becomes a drawer (`Open files and global context`); below
  768px the session rail does too (`Open sessions`).
- Dialogs and panels compose `WorkspaceOverlay` (`workspace-parts`):
  title plus close, never a bespoke modal. Every async resource renders
  through `ResourceNotice` (loading / error with retry / denied) plus
  an explicit empty state where the resource can be empty.
- Successful conversation creation publishes the server-acknowledged session
  into its scoped list before changing the URL. The following list refresh must
  not flash a foreign-session denial or disable the new composer. Resource
  acknowledgements from an earlier credential/sector scope are ignored; genuinely
  missing sessions still receive the scoped unavailable state. Regression:
  `tests/frontend/workspace-session-creation.test.tsx`.
- Proven by `tests/frontend/sector-workspace.test.tsx` (landing,
  editor, files, local context) and the landing-to-workspace journey
  tests in `navigation-url`, `SectorDetailPage`, and
  `research-staging` (all interaction via `user-event`).

## Shell and lists (revamp wave 1)
- The chat dock exit runs through the shared `useExitState` (`frontend/src/lib/motion.ts`): open, close, and reopen-cancel behave like every other popover. `App.tsx` keeps no bespoke exit timer. Focus returns to the chat toggle on close.
- Shell pages share one frame (`max-w-page`, `pt-6`/`pb-12`) with a
  `PageHeader` (breadcrumb row, title + optional status badge, description,
  right-aligned actions). Titles come from a label map, never raw ids;
  loading sectors show a title skeleton. No "Back to Overview" buttons;
  breadcrumbs replace back links. The audit asserts the h1 left edge
  equals the first content block's left edge (±1px). The sidebar sticks
  (`sticky top-0 h-screen`) with a persisted desktop collapse toggle
  (`Collapse sidebar` / `Expand sidebar`, `aria-expanded`); collapsed
  keeps the icon rail with accessible names and tooltips, and below
  768px it is always the rail. A sliding `layoutId` indicator marks the
  active item (`bg-sidebar-active`, no border/shadow); Researches stays
  active on sector views.
- `Emails` has no backend: the sidebar entry stays disabled with a "Soon"
  badge and an "Email tracking is coming soon" tooltip, and the routed
  Emails page is the full coming-soon empty state (no actions).
- `TopBar` (48px, bottom divider) holds a command-palette trigger styled
  as a search box ("Search..." + Ctrl K hint; icon-only below 768px),
  an "Ask Karbot" button, and the theme menu. The Overview text search
  field is removed; sector search lives in the palette and Researches
  filters.
- Dashboard preview panels ("Recent sectors", "Recent companies") show
  six recent rows with a plain "View all" header link. Overview stat
  tiles (Sectors, Companies found, Needs attention, Awaiting approval)
  link to pre-filtered Researches URLs.

## Lists and detail (revamp wave 2)

- Company lists filter and page server-side: `ResearchesPage` companies
  tab and `SectorDetailPage` company section fetch their own
  `useStagingCompanies` windows (`state`/`query` params in,
  `{ companies, total }` out) instead of filtering a loaded array, so
  counts read the server total and a filter never silently searches a
  partial window. The Dashboard preview keeps its local first-N window
  but counts `View all` from the server total and says so when a search
  runs over a partial window. `ResearchesPage` full lists count the filtered set (`Showing X of Y matching`; overflow chip uses the filtered total), so a filter past 50 rows never shows the unfiltered total.
- Company windows append with `Show more (X of Y)`: the hook fetches
  the next 100-row window and id-dedupes by row id (double clicks
  overlap safely); the button disables with `Loading more…` while the
  rows stay visible, and vanishes at the total. Filter changes reset
  to window one.
- `SectorDetailPage` company sections state their filter outcome the same way with a filtered overflow total. The workspace columns scale with the viewport (`calc(100vh-14rem)`, min 480px) instead of a fixed 760px, and eye toggles carry tooltips naming the file.
- The context drawer caps open unit lists at `max-h-64` with internal scroll; it stays a docked panel (overlay decision recorded as follow-up, not built). The meter header and add-note composer stick to the scrollport edges so fixed elements stay on scroll; unit islands chain the wheel to the column instead of trapping it; file summaries read `N units · Nk chars` and unit rows cite `filename:ord` with notes numbered by position, so no storage id or content hash reaches the reader. The drawer content is not itself a scroll container (that would trap the sticky pins). Canonical rule in `docs/design-system.md`.
- `RunsPanel` tones `CANCELLING` as paused (amber), never failed red, and a failed cancel surfaces `Could not cancel run <id>. Try again.` as an alert instead of swallowing the error.
- Chat: user bubbles are `bg-surface-active`, `rounded-xl` with
  `rounded-br-sm`, max 85% width, with anywhere-wrap for long tokens;
  agent messages have no bubble. The Karbot log announces politely like
  the sector log; both composers expose the Enter/Shift+Enter contract
  via tooltip and a focused hint row at 768px and up. The model picker
  trigger is a ghost chip (display name + effort); its menu is a
  collision-aware Base UI menu with search, provider groups, an effort
  submenu, and a Reasoning switch.
- Agent markdown renders real heading levels (h1/h2/h3/h4 with house sizes) instead of flattening everything to paragraphs.
- Checked and kept: `SubagentsPanel` rows already use explicit buttons (tag/stop/open), so no mis-tap change; `ModelsPanel` selects already share the design-system classes; the attach file input stays button-proxied (keyboard path is the Attach button).
- Visual specs freeze animations per shot (`animations: disabled`) after a mid-fade blank was caught on the Agents page: Playwright visibility ignores opacity, so section fades must complete before capture. Motion is verified by transition clips, not stills.
- List rows wrap below 400px: the name keeps a 128px floor (`min-w-32 basis-32`) with meta wrapping underneath, after a zero-width name was caught on mobile Researches. The menu-focus contract: opening the models menu moves focus into the menu itself (never the search field), so Escape closes and returns focus to the trigger.
- Accent: `primary` is a restrained indigo (`--primary`, light and dark pairs in `frontend/src/index.css`) with a matching `ring`; charts are categorical hues instead of gray. Surfaces stay neutral; color lands on actions (buttons, active states, links, quote rules, switches, progress) only.
- Agent markdown (`Markdown.tsx`): tables size to content (`w-max min-w-full`) inside a bordered scroll frame with a tinted head and scoped headers, so long filenames and ids scroll instead of breaking mid-token; blockquotes are tinted panels with an accent rule; inline code carries a hairline border; links use the accent; lists breathe (`space-y-1`, muted markers).
- Scrollbars: every scroll container carries `scroll-slim` over the global thin token-matched base (canonical rule in `docs/design-system.md`): chat lists, popovers, mention/skill menus, model flyout, research overflow lists, detail columns, drawer unit lists, `pre` and table wrappers.

Company polling retains and refreshes the window the user has loaded. A filter
or credential change resets it; a poll does not. Next-page failures retain rows
and display a recoverable alert. Offline company reads show a connection state.

Overflow stream snapshots rehydrate message history through bounded REST pages,
including hidden-only pages, before advancing the resume token. Failure retries
that same snapshot; stale transient thinking is cleared after durable hydration.
Regression: `tests/frontend/follow-resume.test.ts`.

A caller-owned resume cursor survives graceful EOF follower replacement, so
reconnecting the workspace does not replay old reasoning or tool frames.

First-load research-session initialization caches only confirmed permission
failures. A discarded/remounted request cannot mark initialization complete
before its result is delivered. Concurrent ensures rely on the backend's
persistent one-session binding; denied viewer requests are not repeatedly sent.

Server upload failures show a concrete retry instruction and confirm existing
files are retained. Internal failure codes stay in correlated backend logs.

Persistent Karbot background tails opt into graceful-EOF reconnection in the
shared follower, preserving the accepted sequence and accumulated messages. EOF
emits a recoverable connection error and uses the existing bounded failure policy;
a closed transport never means research completed. One-shot legacy send flows
retain terminal refetch/settling behavior; the sector workspace owns its existing
cursor and reconnect loop. A real browser regression disconnects only its isolated
DB listener, observes a fresh stream request, and verifies retained draft, one
terminal reply, and restored Send control. No surrounding layout changes.

Reconnect waits are abort-aware. Closing/switching a conversation cancels a pending
wait, and the follower checks abort again before dispatching any stream request;
old followers cannot reopen transport after cancellation.

The local-context view displays durable pending-operation recovery separately
from context compaction. It shows the tool/reason and keeps long operation IDs
behind a keyboard-accessible disclosure. Resume checks that original identity;
compaction retains it. No control silently issues a replacement mutation.

Workspace plan approval includes the global-context version currently shown.
While context is loading, denied or unavailable, approval is unavailable; stale
context conflicts remain visible with the plan editable. Retained completed work
shows its source version and original source link through shared progress, without
claiming a percentage while the revised discovery queue can still expand.

Pending-operation cards offer **Inspect receipt** in local context. The workspace
loads its scoped receipt through the data layer and displays confirmed versus
unresolved effects and the exact recovery explanation. The original identity is
retained; inspection does not release guards or mark an effect successful. Notes
and drafts remain editable and loading/errors use the shared resource notice.

File-derived context proposals render exact file hashes and included units before
approval. Source previews render fifty units at a time. Local context shows a
source-recovery notice and preserves its stored summary; failed dependencies never
produce a blank working-memory display. The safe-rebuild review presents original
task, stored summary, dependency identities, an independent replacement preview
and explicit owner confirmation. It keeps typed text on request failure, rejects
stale versions, and does not automatically resume work.

The sector Files panel renders fifty matching metadata records initially and adds
fifty with the existing Show more button. Its footer stays reachable outside the
independently scrolling list and states the displayed and filtered totals. Search
still covers the entire loaded library; changing search or hidden-file visibility
resets the display window. Metadata refresh preserves an expanded window. Upload,
generated-file preview, hide/reveal and context inclusion retain their existing
permissions and processing/error/OCR states.

Nonindexed file states use readable Processing, Failed and Needs OCR labels,
including the legacy underscore OCR spelling.

Local context has a compact Execution records entry. The owner inspector reads
twenty metadata boundaries per page; next/previous controls stay in the modal
footer. Selecting one loads its verified normalized JSON. Display initially caps
at64,000 characters, explicitly states partial display, and offers additional text
and complete JSON download. Provider/model and observed global/shared-plan/local
versions appear separately from expandable actual execution identity. History
inspection preserves local-note drafts and returns focus on close. Loading,
empty, denied, offline and metadata/body failures remain distinct. This UI does
not assert that a stored provider response is automatically recovered after a
post-provider storage failure; that durable recovery has its own acceptance gate.

### Basic intake review

Shared PlanProgress on the landing progress dialog and workspace Plan tab offers
Review intake for blocked/failed candidates. A dialog shows the exact saved source,
evidence, reason, attempts and plan version, and collects an explicit owner reason
for Retry or Exclude. Data hooks own requests. Loading, denied/offline/errors and
stale receipt conflicts preserve the open review and reason draft; review latest
refreshes the displayed receipt before another decision. Controls require a paused
or failed sector. Excluded candidates remain visible and never count completed.

Intake decisions carry a request idempotency key. The data hook retains it while
an exact reviewed work/version/decision/reason submission has failed, allowing a
lost reply to recover the original HTTP receipt. Changing any submitted decision
field generates a fresh key; success clears the pending submission identity.

## In-app supervision alerts

The Agents page includes a compact, props-only alert panel over an authenticated
`GET /v1/alerts` data hook. It polls the latest bounded page and lets owners read
older pages or return to latest. Alerts derive from durable scoped supervision
records, not un-attributed fleet metrics. Only a backend-confirmed matching
recovery pause is labeled a current warning; advisory/old observations remain
explicitly historical. Fixed kind labels explain the finding without exposing
raw execution bodies. Sector findings link to their exact session/thread
workspace. General-session findings show the current session title and exact identifier;
the existing chat picker also exposes that identifier so duplicate titles remain
distinguishable. Owners use the existing agent directory for child threads; no
unsupported general-session deep link is invented.
Loading, empty, denied, offline and error use the shared resource states. No
alert automatically resumes, cancels or modifies work. This is in-app delivery,
not external notification delivery or a guarantee the owner has read an alert.

## Complete PDF processing in Files

PDF uploads enqueue the existing worker after exact original-byte archival.
Files shows queued, reading-pages, processing, paused, failed/uncertain and
indexed states, with durable saved-image counts rather than a timer or an early
100% claim. Original downloads remain available while a visible file is processing.
A review dialog pins job/revision and requires renewed review after state changes;
possible duplicate paid work requires an explicit owner acknowledgement. Failed
requests retain review state. Hidden files cannot retry until revealed.

Large extracted content uses a bounded preview and20 indexed sections per page;
Next/Previous replace the page rather than appending an unbounded transcript.
Native page text and AI-derived image/chart descriptions retain page/image
provenance; model interpretation is explicitly uncertain. This presentation does
not truncate the stored content or promote it into shared context automatically.
The body refreshes after a file's terminal status changes. Design authority:
[PDF ingestion](plans/2026-10-01-pdf-ingestion.md).
