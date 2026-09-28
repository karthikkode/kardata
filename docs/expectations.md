# Kardata Owner Expectations: Technical Spec for Agents

Source: every message the owner sent in the founding build session
(session `01a0cc03`, read from the session log on disk), distilled into
technical expectations. This is normative product context: when an
instruction here conflicts with a local shortcut, this file wins. It
describes what the application must become, not what is already built;
check `docs/implementation-status.md` before claiming anything below exists.

## 1. What the product is

Kardata Research OS: sector research → master ledger → deep research →
email outreach, executed by agents under owner supervision.

1. **Sector research phase.** A sector (e.g. Speciality Foods) runs to get
   *every* company in the category into the database first. That database
   is the master ledger (its own table, built for this purpose).
2. **Deep research phase.** Each company is researched for *all* of its
   worthy problems (never stop at the first one). Research proceeds only if
   the company can pay or worthy problems exist. A worthy problem solves
   the company's biggest problem or saves serious time/money, worth
   paying $3k–6k/month to fix. That band is an internal targeting filter,
   never a quoted price. Small nitpicky problems do not count. The pitch
   is: solve one evidenced problem free, then pitch long-term services
   (data layer is the core pitch, but it has no out-of-box demand, so the
   free wedge must be a closely related problem). Any tech problem may
   qualify.
3. **Email phase.** Worthy problems become the pitch; emails are drafted
   and scheduled (separate stage, deferred UI).
4. **Lessons from prior attempts that must hold.** Subagents must think,
   not report: no rigid problem criteria (rigidity produced diminishing
   results), breadth over fixation (never build whole research around one
   symptom like out-of-stock ads pointing at out-of-stock products),
   worthy-problem judgment stays flexible and evidence-driven. Context
   given to agents is offer + capabilities ("this is what we offer, go
   pick a problem"), not scripts.

## 2. Agent layer (own harness)

Build our own harness layer; never vendor a provider's whole harness.
Adopt best-of-breed pieces and adapt them: tool-call definitions from one
provider, workflows from Hermes评估, subagent logic from Hermes, steer
logic from Hermes, context caching from pi, modified for our use case and
kept in our environment. Quality is controlled by us because
customisation is the point.

- Every workflow is an independent unit of execution that can run on its
  own provider: planning agent, deep research, compaction, image
  endpoints, etc. Start on one token-efficient provider; the architecture
  must already support per-workflow providers and quality tiers later.
- Planning workflows that gather everything before long operations.
- Stall detection and recovery, especially across 100s of subagents.
- Top-notch observability: every running operation visible, orphans
  impossible, clear outputs, no lost processes, robust workflow design.
- Token efficiency from day 1: compaction workflows, per-workflow
  providers, top-notch context management. Token costs are never ignored.
- Subagents are first-class, like parents: dedicated chat window, chatting
  with them, steering them ( Hermes recently added steer; we treat
  subagents fully like parents, with control).
- Harness carries product knowledge (offer, pricing, ICP, method) and
  domain skills invokable via `/`; tool definitions for our own system
  (e.g. adding a researched company to the DB) are part of the harness.
- Test everything: dummy providers/endpoints for workflow tests; adopted
  code is verified, never assumed. No place for assumptions anywhere.

## 3. Backend and operations

- Temporal from day 1 (self-hosted). TypeScript is fine.
- Everything logged in the database; logging layer top notch.
- Database is a black box behind `data-access` layer discipline: no API
  endpoint and no service hits the DB directly: all access routes through
  the intermediate DB layer (its own module with its own tests; rejects
  misaligned requests). Agents never touch the DB directly either; they go
  through MCP, and MCP routes to the DB layer. Reason: many agents
  touching the DB simultaneously cannot be managed otherwise.
- Research jobs pause and resume; resume must never send the model into
  verify-previous-work loops. Plan for loop detection and indefinite-time
  guards (agents layer included (missed in earlier turns, must not be
  missed again).
- Artifacts in GCS (staging too; migrate service-account creds from the
  prior kardata project). Logs self-hosted.
- Browser work (search fallback, screenshots when needed) runs in remote
  containers, never blocking the owner's laptop. Web search fully set up
  (Hound at fullest, no limitations); browser used when automated search
  is blocked.
- Tool-failure honesty: failed tool calls are source gaps: say what
  failed and what remains unknown, retry at most once narrower, never fill
  from parametric memory or prior turns. Never invent digests, document
  lists, counts, or progress.
- No mocks, no hardcoded staging data, no dummy sectors/companies/
  subagents in production paths. Surfaces without a backend render an
  explicit not-connected state, never sample data.

## 4. Frontend law (applies to every component, every change)

- Best-in-class, world-class, top-class UI and UX that scales (multiple
  sessions, subagents inside sessions, side chats, parallel agents). Take
  inspiration from top products (ChatGPT, Gemini, Claude, Codex VS Code
  extension, Hermes agent, Copilot tool UI, Zapier fluidity, Apollo dark
  theme), never exact copies.
- Minimal, fluid, consistent: light and dark themes (theme switch is an
  icon), standard font family, consistent chips/cards/counts, aligned
  elements, icons instead of text buttons wherever an icon works, no
  free-flowing text (everything inside chips, cards, or containers),
  pointer cursor on hover for interactive elements (with hover shadow
  where apt, never ugly defaults).
- Hard rule: no em dashes in static frontend copy (placeholders,
  headings, summaries). AI responses and thinking traces are uncontrollable
  and exempt.
- Every state designed: loading, empty, overflow, underflow, 100 vs 101
  items, single-item alignment, fixed row counts with view-all pages,
  butter-smooth transitions between states and routes, detailed pages
  behind summary components.
- Minimal element counts: remove repetitive/border-only/stat-text
  elements; every element and every corner planned from the root, not
  patched.
- Mobile touch targets, keyboard access, visible focus, reduced-motion
  support.
- Design in mockups/HTML prototypes first for big surfaces; states before
  backend; then integrate mockup to real backend surface by surface.

## 5. Chat and sessions (Karbot + sector)

- Real agentic chat window: instant token streaming with zero perceived
  lag, thinking blocks and tool calls with top-class treatment (tool calls
  read like thinking blocks, Hermes-style, never a separate heavy
  treatment that confuses them with subagents).
- Sessions are chats with a main agent; multiple sessions; previous
  sessions visible; new session creation; rename; delete that works.
- Subagents: opened in-chat like the parent window, back navigation,
  `@subagent1` tagging in the composer (removing the tag chats with the
  parent), running/done status icons, streaming tool calls and thinking
  same as the main agent. Spawning is the agent's autonomous decision;
  the UI supports it. Queued messages with steer while something runs.
- Side chats are read-only branches of a session (context from main,
  deletable anytime), creatable from inside the chat, never an outside
  plus button. Parallel (new) agents get global context. New agent ≠ side
  chat ≠ subagent, and the UI itself must show which is which (tabs with
  counts, not name parsing).
- Chat button must never act as stop; stop is its own control.
- Model picker ChatGPT-style inside the composer: model placeholder (not
  full names eating the input), hover flyout with reasoning effort per
  model, reasoning levels supported by endpoints, dynamic per-provider
  models (never hardcoded/renamed), effort visible on hover.
- Karbot sessions and sector sessions are fully separate pools that never
  leak into each other.
- Sector chat is an isolated world: only sector-relevant context and
  tools, same best-in-class UI as Karbot.
- Research starts only via the agent through MCP (`db.start_…` tools);
  no start buttons for the owner. A started research is state: no second
  session can start it; the research session is pinned in Chats;
  pause/resume lives in the chat window.

## 6. Sector research flow and context

- States: draft (topic + context + files, brainstorming chat open) →
  plan (agent has full history as context) → research → findings
  (problems found, re-openable agent chats) → satisfied → draft-email
  stage.
- Brainstorming (including subagents) happens before/during planning;
  every action updates the sector context: context is the sector's
  global memory: a living detailed text summary of everything happening,
  rewritten on every action, never a file list, no references section,
  omitting empty parts (no brainstorming section when none happened).
- Context is user-visible and user-editable in exact words: full system
  text, reference texts, file contents, history, tail, notes. Rewrite
  with AI ("too focused on X, focus on Y"), compact button, add-note
  action. Every context update is timestamped; the model stays
  time-series aware.
- Context meter with cost control: exact usage against the model window
  (used / window · percent), because context can explode on high-volume
  tasks and subagents carry their own context (tool calls etc.). Caching
  in place and actually working for us.
- Files: pdf/docx/images/sources uploaded per sector; processed our side
  (images via OCR endpoint, pdfs text-extracted never sent raw, image-only
  pdfs handled, md read as text); providers never receive blind uploads.
  Every file indexed in DB (indexing = stored for reuse with its own
  context, not vector search): files are the goldmine, never lost.
  Subagent-created files are referenceable from any chat via `@`.
  Per-file add/remove from context, per-unit toggles, processing state
  always visible, upload entry points where files live.
- Every session and subagent updates the shared global sector context so
  all agents know what's happening.

## 7. Working agreements with agents

- Plan (`/plan`) before big work, with rules followed; approval gates
  (`Approve` / `proceed` / `go`) before execution; complete everything
  then ask for review.
- Documentation updated in the same change (README as index map,
  per-area docs, this file when expectations evolve). README leads agents
  to the right folders; every service documents itself.
- Tests with every behavior change; coverage high; root-cause every
  issue (no symptom patching); verify changes visually (screenshots)
  every time; rules exist for a reason.
- Keep the repo under the owner's high-level understanding and control:
  simple structure, no scaffolds beyond comprehension, no out-of-control
  growth. Staging builds clean and crisp; state misunderstandings fixed
  across the UI, not per-spot.
- Permanent memories: no em dashes in static copy; icons over text;
  no free-flowing text; pointer discipline; theme icon; minimal fluid
  dark theme that matches references like Apollo.
