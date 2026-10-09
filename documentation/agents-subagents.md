# Agents subagents

Six delegation operations over a live registry (T4.1-T4.2). Adopted shapes:
Hermes verbs plus registry, DeepAgents async record, Pi control-inbox
semantics.

## Operations

- `launch(goal, { parentId, depth, mode, queueCapacity })`: depth and
  concurrency caps enforced; empty goals rejected.
- `get(id)`: status, `acceptingSteer`, queue depth, elapsed, last tool.
- `message(id, text)`: non-preemptive steer into the inbox for the next
  iteration boundary. Finished children and full inboxes reject with reason;
  rejected text lands as `missed_steer`, never relaunches.
- `redirect(id, newGoal)`: message plus goal rewrite; identical mechanics.
- `cancel(id)`: cooperative intent plus propagation to running direct
  children. Drivers check `cancelRequested` at each boundary.
- `collect(id)`: summary only (id, goal, status, depth, mode, thread length,
  missed steer). Parents never see intermediates.
- `finish(id, status)`: terminal mark plus final inbox drain into missed
  steer; bounded recent-completions map (200) keeps late attributions.

## Guards

- Depth default max 1; fork-mode children never delegate (`canDelegate`).
- Per-child activity timestamps plus `idleMs` feed Phase 9 stall sweeps.
- Threads persist per child; `thread(id)` returns a copy for rendering.

## Backend conformance (B2.4)

`backend/src/temporal/workflows/subagents.ts` runs the six operations as
durable child workflows (`delegateParent` + `subagentRun`): launch is
`startChild`, get/collect are child queries, message/redirect/cancel/finish
are child signals. State (inbox, goal, status) lives in workflow variables,
so a crashed worker resumes from history. Every launch appends a
`t.subagent.launched` isolation record (child, parent session + workflow,
depth, mode, goal, queue capacity, `canDelegate`); every close appends one
`t.subagent.completed` entry carrying the `ChildSummary`. The parent
partition holds only the delegation call plus those entries — child turn
replies land in the child's own `child:<id>` partition under
`agent:<child-id>`, never in the parent. Cancel is cooperative two-step
(cancel marks and stops the turn; finish closes), matching `cancel()` +
`finish()`; rejected text lands as missed steer, and the parent routes sends
to finished children to `t.subagent.missed_steer` without relaunching.
Parent cancel propagates as cancellation (`REQUEST_CANCEL` close policy),
so the child still records its completion. `ChildSnapshot`/`ChildSummary`
shapes are reused from `agents/` by type; `elapsedMs` stays an explicit -1
because durable children have no wall clock across replays. Proven by
`tests/backend/workflows.subagents.test.ts` against the real server
(needs `KARDATA_TEMPORAL_TEST=1`).
- Close guarantees: a parent with no delegation, steer, or finish for
  `parentIdleTimeoutMs` (default 24 h) cancel-then-finishes running
  children and completes with `t.subagent.parent_expired`
  (`parent-idle-timeout`); a cancelled child with no finish for
  `childFinishTimeoutMs` (default 1 h) completes itself as cancelled.
  Fan-out cap: delegations arriving while `maxInFlight` children run
  (default 50) wait in the durable queue (`t.subagent.queued`, cap
  `maxQueued` default 2000; past it they reject and the gateway refuses
  fast with 409). A freed slot promotes the queue head on
  `parentNoteDone`, and the parent feeds the promoted goal itself.
  Duplicate delegation for a running child rejects as `t.subagent.rejected`
  instead of failing the parent — and whoever observes a child close must
  signal `parentNoteDone`, or the parent's in-memory entry stays `running`
  and later relaunches of that id keep rejecting.
- Continue-as-new past 10k history events or 10 MB (`can-v1` patch):
  the parent carries pending signals, the durable queue, promotion sets,
  and the children map (running handles re-derive by id); the child
  carries inbox, missed steer, goal, thread length, and pause flags.
  Continued runs skip the created/launched row. Proven by
  `tests/backend/workflows.continue-as-new.test.ts`.

## Queued-child controls (C6/2)

A waiting child has no workflow yet, so pause/resume/cancel route through
its live parent: the gateway checks the parent's queue, signals
`parentChildControl`, and polls the projected state (5 s cap, then
accepted anyway). The parent drains controls with steers, ahead of
launches (`queued-controls-v1` patch): pause parks the id past promotion
(`pausedQueued`, carried across continue-as-new), resume releases it,
cancel completes it as cancelled without starting it. A control racing
promotion forwards to the live child; a stale QUEUED row with no parent is
409. Steers land as pending instructions for the first turn
(`enqueueQueuedSteering`), never missed. The HTTP run check accepts a
QUEUED or paused-queued subagent thread by its row when no workflow
describes (any other workflow-less id stays 404), so the routes reach
the gateway instead of rejecting before it; proven by
`tests/backend/commands.queued-runs.test.ts` over a live parent.
Parent unwind (cancel, finish, idle close) completes queued waiters as
cancelled — including promoted requests still awaiting launch — so no
thread sits QUEUED behind a dead parent; running children still cancel
through their (re-derived across continue-as-new) handles. Pinned by
the pre-continue cancel cases in
`tests/backend/workflows.continue-as-new.test.ts`.

## Delegation door (production launch path)

Workflows existed with no production door: nothing could signal
`parentDelegate`. Now `db.delegate_subagent` (Karbot-only, `operator`)
launches a leaf researcher: the gateway signal-with-starts the session's
parent (`delegation-<sessionId>` on the turn lane, served by the
subagents worker in `dev-worker.ts`), waits for the child to start, then
feeds the goal as its first work (a launched child with an empty inbox
would idle forever). Children launch at depth 0 with maxDepth 0:
pilot researchers research, never delegate further. Steering launched
children stays approver-gated (`db.send_message` / `db.steer_thread`);
collecting reads the child thread (`agent:<childId>`) plus
`childSummary`. Raising launch to approver waits on approval cards
(B6.1). Proven by `tests/backend/subagent-delegate.test.ts`
(hermetic) and `tests/backend/workflows.delegate.test.ts` (live
Temporal + DB, fake provider).

## Sector control (sector backend v1, 2026-10-04)

The owner spawns a child from the UI with a goal and optional name
(`POST /v1/sessions/{id}/subagents`, operator, 409 past 50 in flight);
parents spawn through `db.delegate_subagent` with the same inheritance
(see agents-context.md). Either way the inherited text is stored before
the goal message is processed. The display name is the given name, else
`Subagent N` by spawn order (both spawn paths default it); the launch
event records it and the thread header serves it. Strip chips, the
directory and the dock rows show the name (positional `Subagent N`
fallback when missing); the raw `agent:` key appears only in tooltips.

Pause and resume are per child: the route writes `thread_control`,
then signals `childPause`/`childResume`. A paused loop waits before
taking the next inbox item; a mid-turn pause parks at the next provider
round boundary via the resumable-turn park, keeps the checkpoint, and
resumes from it (`subagent-pause-v1` patch, replay-safe). The thread
header shows PAUSED through the regular state events.

Waiting inbox items carry `{id, text, queuedAt}` (`inbox-ids-v1` patch;
legacy strings wrap on read) in both `sessionRun` and `subagentRun`.
Query `queueItems` lists them, updates `queueRemove`/`queueReorder`
edit them, and the gateway exposes `listQueue`/`removeQueued`/
`reorderQueue` behind `GET|DELETE|POST
/v1/threads/{key}/queue[/reorder]` (viewer/operator/operator, 404 when
no workflow runs). Stop reuses the existing cancel path.
