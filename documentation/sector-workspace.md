# Sector workspace

Owner-approved contract, 2026-09-30. Area authorities: frontend.md,
backend.md, db.md, agents-context.md and mcp.md. Operations and evidence
belong in ../docs/implementation-status.md.

Each sector has one persistent research session and any number of normal
sessions. Research owns planning and execution; normal chats brainstorm.
The landing page contains status, a progress dialog and company results.
Open enters the three-column workspace (240px sessions, flexible chat,
320px Files above Global context). Resource and session rails become drawers
below 1280px and 768px respectively. Research Chat/Plan tabs and landing
progress use the same plan and progress data.

Global context is a versioned document with Scope, Instructions, Decisions,
Findings and Open questions, plus Files. Owner edits are direct; every
agent edit needs owner approval, including research-parent edits. Research
children propose to the research parent, which forwards them as pending
owner proposals and never approves. Proposals use PATCH semantics: only
the provided sections change, omitted sections stay byte-identical, and
an explicit empty string clears. The server stores the merged whole, so
approval applies a complete document and the review diff shows only real
changes. Owner decisions and approved scope are
protected. Optimistic version checks prevent stale approvals. Changes to
scope/budgets require reapproval before affected work continues.

Local context belongs to one thread (parent or child). Durable compaction
links summaries to covered history and leaves transcripts immutable.
Whole-request input budget is min(100000, verified window minus output
reserve); compact at 80%, target 50%. Never split tool/result groups or
discard context on a failed summarizer. Stable prefixes precede changing
context and steering. Cache counters are provider observations, not claims.

The sector library unifies uploads and generated artifacts. Hidden files
remain stored but are unavailable to agent reads and context. File promotion
to global context always needs owner approval over exact version/units.
Importing another sector's file is explicit and preserves ownership.

Approved executable plans own discovery queries, company-research work,
dependencies, budgets and acceptance. Work is durable and retry-idempotent,
with two company researchers per sector. Completion estimates remain unknown
until discovery closes the queue. Blocked/failed work cannot count complete.
Steering and context changes apply before the next provider round after
in-flight work settles; next-turn sending is a separate action. Only the
research conversation's main agent and the owner's Edit plan button may
write the plan; normal chats, all subagents and Karbot cannot.

Additive migrations preserve all sessions, files, plans and history. Existing
Temporal histories retain their contract; new coordination requires an
explicit start after plan review. No new service, dependency or root folder.

## Hardening additions (2026-10-01)

Executable plans may select `researchDepth: discovery` and a `discoveryTarget`
of 1–2000. Omission preserves the legacy company-research execution contract.
New planning defaults to discovery and requires an executable specification.
Owner edits retain executable work and reopen approval; the Plan tab and landing
dialog expose the exact queries, limits and acceptance criteria. Failed editor
saves retain the draft. Planning writes its request, actual tool outcomes and
terminal readable reply to the persistent research conversation.

Discovery-only completion requires its target and a reproducible, fetched-source
validation sample (up to 50), split into ten-entry reviewer cohorts with at most
two active. All approved criteria and sample entries must pass; missing evidence,
geography/sector/identity failures and incomplete coverage block completion.
The parent indexes an acceptance report and records the structured checks.
Search pagination exhausts on an empty raw result page, never merely a page with
no new filtered domains. Count limits and partial outcomes remain explicit.

Sector file preview uses `GET /v1/sectors/{sectorId}/files/{fileId}/body`, returning
filename, mediaType, extracted text, originalAvailable and optional base64 bytes.
Visibility/scope and archive integrity are enforced. Legacy extracted-only files
state that their original was not archived. Hide/reveal never deletes bytes.

Workspace sends distinguish queued requests, active work, reconnecting and paused
conversations. Steering requires its durable consumption receipt; missed steering
is retained for an explicit next turn. Switching keeps drafts/history and closes
inactive listeners. Full release evidence and the real-provider pilot remain
separate from fixture browser verification.

Discovery acceptance rejects empty normalized source quotations. Its archived
report distinguishes the population count from the reproducible source-reviewed
sample; sampled identity/geography/sector checks do not verify every company.

Terminal runs with no work-item records explain the absent ledger rather than
promising future dispatch. This preserves legacy results without inventing
a measured completion percentage.

Research active-operation time is checkpointed at safe boundaries as append-only
sector events. Each coordinator workflow run reports monotonically increasing
usage; repeated checkpoints replay and resumed/restarted coordinators retain the
campaign total. Approved wall-minute budgets bound that cumulative total, not
a fresh allowance per restart. Legacy Temporal histories retain their original
contract through `research-budget-v1`. Progress displays recorded active minutes.

Research-plan approval requires the existing approver role. New approvals pin
the reviewed shared scope and context revision beside the plan version. Start
and resume reject a changed scope until the owner revises and reapproves the
plan; findings-only context revisions do not invalidate approved scope. Legacy
approvals without the scope binding retain their earlier contract.

A paused research plan can be edited into a new review version. Starting that
approved revision replaces the confirmed paused coordinator; it waits for
cancellation completion before launching the new execution. Superseded
coordinators cannot write lifecycle state for the new plan. Stored completed
work and cumulative usage remain historical data.

### Durable steering recovery

`GET /v1/threads/{threadKey}/steering-receipts` is a viewer read guarded by the
owning session scope. It returns only consumed/missed instruction IDs and states,
in ascending ID pages of at most 200, with `nextAfterId` (null at the end).
Overflow hydration reads these durable receipts before accepting the snapshot
token. It never relies on retained outbox frames for an instruction's outcome.

### Basic discovery filtering contract

Basic filtering is required for the final discovery campaign; advanced company
qualification and deep research remain future features. Search metadata must not
publish obvious directories, ranked lists, articles, job listings, social/search
profiles or invalid/non-HTTP URLs as companies merely because sector words match.
Brand/service pages remain eligible for further sector/geography/source checks.
New coordinated executions opt into the strengthened gate through a workflow
patch; old histories keep their recorded extraction contract until explicit
pause/review/start adoption. This metadata gate alone does not establish company
identity/geography; fetched-source validation remains an acceptance requirement.

## Sector backend v1 additions (2026-10-04)

Files join global context as one standardized AI summary block each, never as
raw unit lines (pre-block approvals keep raw injection under a `legacy` state
until summarized). Approving an agent file proposal inserts a `summarizing`
block and starts the summary workflow; the context version bumps exactly once,
when the summary lands. The owner add refuses with 409 when usage is already
at budget. Every number, date, currency and unit from the source must appear
in the summary, main text or an appended Additional figures section.

Removing a file deletes its block instantly with no AI call, clears its
inclusion flag and approval link, strips it from every section file-ref list,
bumps the version and records an owner-approved history row. A summary still
in flight is cancelled best effort; a late completion finds no row and stays
out. This replaces the former raw-units provenance for files: the block row
is the provenance record.

Usage is estimated (4 chars per token), never provider-billed: 30,000 budget,
per-section and per-file breakdown. At 70% the context auto-compacts silently
with no approval; a manual Compact does the same. Compaction may shorten only
Decisions, Findings and Open questions; Scope, Instructions and all blocks
stay byte-identical, no number is lost, and the old version stays restorable.
Compaction history rows carry author `system:compaction`. Any approved version
restores as a new owner version, text sections only. Every file-summary and
compaction provider call also records a `sector.context.ai_usage` event
(kind, fileId, input/output tokens, model) on the sector partition; the
events are never deleted, and `usage.aiUsage` sums them, so background
spend survives file removal.

Each sector chat and the research chat carries a "use global context" switch,
default on, affecting only that chat's future turns. A rewrite direction opens
a tracked `Context rewrite:` chat that ends in one pending proposal; the
context is unchanged until the owner approves.

Normal chats read everything in their sector: plan, progress, sibling chats
and subagent transcripts, through four viewer MCP tools. Writes stay
isolated: context proposals and subagent spawns only, and subagents cannot
read sibling threads. In the research chat, `@chat` inserts `@title`
while the id mapping stays in composer state; send expands it to a
`[[session:id|title]]` marker, and deleting the text drops the mapping.
That turn reads the referenced chats and
advises, with the plan writer narrowed out of the palette, and the plan
changes only after the owner confirms in a later message.

Subagents spawn from the UI or from a parent agent with inherited context:
the parent's summary plus its recent messages, capped at 12,000 estimated
tokens and written before the goal is processed. The owner route caps at 50
in flight (409 past it). Each subagent pauses and resumes individually; a
mid-turn pause parks at the next provider round boundary, keeps the
checkpoint, and resumes from it. Waiting inbox messages list with stable ids
under `GET /v1/threads/{key}/queue`; the running item is never listed, and
reorder requires exactly the current set. Stop (header, every running
subagent row, Runs) confirms with "Stop this agent?" and toasts "Stopped".
