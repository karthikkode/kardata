# Frontend

Stack: Vite + React + TypeScript SPA, Tailwind CSS v4, owned primitives in
`frontend/src/components/ui` (shadcn copy flow over Base UI). Tokens in
`frontend/src/index.css` (`:root` + `.dark`).

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
persisted terminal message replaces the pending text. One quiet Activity
disclosure precedes the answer and contains tool calls plus reasoning text
actually sent by the provider. It reads Reasoning when such text exists and
Activity otherwise. It stays collapsed for settled replies and opens during
live reasoning. Meta Responses may supply a summary, not raw private
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
MCP tool start/completion frames open the in-flight Activity disclosure and
show each running/done/failed status before the turn finishes. Persisted tool
messages take its place when they arrive; the stream carries no tool
arguments or result content.

The session picker and subagent thread controls use backend-owned records.
`@` references can address subagents and indexed files.
Karbot includes a Session Files tab with in-app artifact preview, download,
and file creation, a Plan Mode toggle for milestone planning (`/plan`), and
a live mid-run Steer action to guide agents and subagents on the fly.
Sector chat provides Global Context Update Approval Cards to push agent insights
into the global sector context upon operator confirmation.
The Context Studio (`SectorContextDrawer`) features a 60% compaction threshold
marker, raw verbatim digest inspector, and `compactSectorContext` trigger.
The Sector Detail Page presents a 4-Pillar Workbench (`Workbench (All)`,
`Research Activity`, `Sector Chat`, `Context Studio`, `Files Hub`) with a
Linear-grade command header.

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

## Sector workspace (landing → Open → chat)

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
- Proven by `tests/frontend/sector-workspace.test.tsx` (landing,
  editor, files, local context) and the landing-to-workspace journey
  tests in `navigation-url`, `SectorDetailPage`, and
  `research-staging` (all interaction via `user-event`).

## Shell and lists (revamp wave 1)
- The chat dock exit runs through the shared `useExitState` (`frontend/src/lib/motion.ts`): open, close, and reopen-cancel behave like every other popover. `App.tsx` keeps no bespoke exit timer. Focus returns to the chat toggle on close.
- The app column caps at `max-w-6xl` and the sidebar sticks (`sticky top-0 h-screen`) with a desktop collapse toggle (`Collapse sidebar` / `Expand sidebar`, `aria-expanded`). collapsed keeps the icon rail with accessible names.
- `Emails` has no backend and stays a disabled coming-soon entry (`Emails (coming soon)`, no navigation) instead of a dead placeholder route.
- `TopBar` search is Overview-scoped (placeholder says so) with a keyboard-reachable `Clear search` icon button that appears only with text.
- Dashboard preview panels state their filter outcome (`Showing X of Y matching`, `aria-live polite`) whenever a search is active or the preview cap hides rows. `View all N` keeps the truthful unfiltered total because navigation drops the Overview needle.

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
- Chat: Karbot user bubbles share the sector tint and shape (`bg-primary/10`, `rounded-2xl`) with anywhere-wrap for long tokens; the Karbot log announces politely like the sector log; both composers expose the Enter/Shift+Enter contract via tooltip. The model menu search no longer autofocuses on open, and the bare composer pill caps tighter on small screens (`max-w-32`, `sm:max-w-52`) with full names in the menu.
- Agent markdown renders real heading levels (h1/h2/h3/h4 with house sizes) instead of flattening everything to paragraphs.
- Checked and kept: `SubagentsPanel` rows already use explicit buttons (tag/stop/open), so no mis-tap change; `ModelsPanel` selects already share the design-system classes; the attach file input stays button-proxied (keyboard path is the Attach button).
- Visual specs freeze animations per shot (`animations: disabled`) after a mid-fade blank was caught on the Agents page: Playwright visibility ignores opacity, so section fades must complete before capture. Motion is verified by transition clips, not stills.
- List rows wrap below 400px: the name keeps a 128px floor (`min-w-32 basis-32`) with meta wrapping underneath, after a zero-width name was caught on mobile Researches. The menu-focus contract: opening the models menu moves focus into the menu itself (never the search field), so Escape closes and returns focus to the trigger.
- Accent: `primary` is a restrained indigo (`--primary`, light and dark pairs in `frontend/src/index.css`) with a matching `ring`; charts are categorical hues instead of gray. Surfaces stay neutral; color lands on actions (buttons, active states, links, quote rules, switches, progress) only.
- Agent markdown (`Markdown.tsx`): tables size to content (`w-max min-w-full`) inside a bordered scroll frame with a tinted head and scoped headers, so long filenames and ids scroll instead of breaking mid-token; blockquotes are tinted panels with an accent rule; inline code carries a hairline border; links use the accent; lists breathe (`space-y-1`, muted markers).
- Scrollbars: every scroll container carries `scroll-slim` over the global thin token-matched base (canonical rule in `docs/design-system.md`): chat lists, popovers, mention/skill menus, model flyout, research overflow lists, detail columns, drawer unit lists, `pre` and table wrappers.
