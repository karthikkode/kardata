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

Global context is a versioned document with Scope, Decisions, Findings and
Open questions. Owner edits are direct; normal-session edits need owner
approval. Research children propose to the research parent, which commits
autonomously. Owner decisions and approved scope are protected. Optimistic
version checks prevent stale approvals. Changes to scope/budgets require
reapproval before affected work continues.

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
in-flight work settles; next-turn sending is a separate action.

Additive migrations preserve all sessions, files, plans and history. Existing
Temporal histories retain their contract; new coordination requires an
explicit start after plan review. No new service, dependency or root folder.
