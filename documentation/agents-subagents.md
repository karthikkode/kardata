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
  (default 50) reject as `t.subagent.rejected` with
  `max in-flight children N reached` instead of starting — backpressure,
  never a wedged queue. Finished slots free on `parentNoteDone`, so a
  re-signalled delegation starts once room opens.
  Duplicate delegation for a running child rejects as `t.subagent.rejected`
  instead of failing the parent — and whoever observes a child close must
  signal `parentNoteDone`, or the parent's in-memory entry stays `running`
  and later relaunches of that id keep rejecting.
