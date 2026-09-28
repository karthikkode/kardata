# Agents tools

Typed registry, validation, dispatch with approvals, timeouts, and
exactly-once execution (T3.1, T3.4).

## Rules

- Unknown tools, invalid arguments, and handler throws become error
  `ToolResult`s. The model sees its own errors and corrects; nothing throws
  past dispatch except approval-gate transport failures (caller-owned).
- Validation is strict for Karbot-authored schemas: required presence, property
  types, enums, and no unknown arguments.
- Privileged tools (`requiresApproval`) pause for an `ApprovalGate` verdict:
  approve runs, edit runs with replaced args, reject returns the reason.
  No gate configured is itself an error result, fail-closed.
- Timeouts race the handler and abort its signal; the result reports
  `timed out after Nms`. Timer functions are injectable for deterministic tests.
- Exactly-once needs a caller key (tool plus canonical args plus scope):
  repeated keys return the recorded result. Calls without keys always execute,
  so legitimate repeats like status polls never collide.
- `BoundedQueue` is the per-thread FIFO primitive: past capacity, enqueue
  rejects with a reason and keeps the caller's text. Nothing drops silently.

## Planning and task tools (T3.2)

- `PlanStore` with `create/update/add/list/block`; full-list replace; exactly
  one `in_progress` unless all completed; blocked items stay in progress with
  the blocker appended pending. Never mark complete when blocked.
- `suppressDuplicatePlanWrites`: at most one plan mutation per turn, first
  wins, rest become error results (adopted TodoListMiddleware rule).
- `TaskLedger` with `task.checkpoint/request_clarification/report_blocker/
  submit/fail`. Submit consults an acceptance hook; T6.1 wires the real gate
  chain. Records only: drivers map clarify/blocker to waiting states later.

## Turn runner (T3.2)

`runTurn` executes one deterministic turn: requires `RUNNING`, halts on
tripped budgets before calling the provider, appends assistant plus tool
messages to history, screens repeats (warn dispatches, replan/blocked skip
dispatch and report), serves cross-epoch repeats from cache, dispatches the
rest in parallel with gate, timeout, and epoch-scoped idempotency keys.

`runKarbotTurn` sends each streamed text/reasoning delta to its sink with
the provider round number. The backend includes that round in the ephemeral
stream key so later model rounds replace earlier pre-tool text in the pending
answer. It emits provisional tool `running` at provider `toolcall_start`,
updates the name at `toolcall_end`, then emits `done` or `failed` after MCP
settles. Frames carry call id, name, state, and round only: no arguments or
result body. The terminal reply remains one persisted message.

## Stub domain tools (T3.3)

`domainTools()` registers `sector.list`, `company.list`, `documents.search`,
`documents.get`, `evidence.capture`, `hound.search` with canned fixtures.
Shapes are the contract: the backend phase replaces handlers, never shapes.
Evidence items always carry doc id, URL, and excerpt (provenance minimum).

## Backend conformance (B4.2)

The backend executes plan/task tools through `toolCallActivity` in
`backend/src/temporal/activities/tools.ts`, reusing agents `dispatch`,
`planTools`, and `taskTools`. Rules the backend adds on top of the agents
contract:

- Workers hold no plan/task state: the workflow carries `PlanSnapshot`
  (todos plus the id counter, via `PlanStore.snapshot/restore`) and the
  task arrays through history; the activity rehydrates fresh stores per
  call and returns updated snapshots.
- Sensitive tools (`plan.create`, `plan.update`, `task.submit`) need an
  upstream approval verdict carried in the activity input (Temporal waits
  on signals; activities cannot). No verdict or a reject records
  `t.approval.decided` (denied) and never executes — fail-closed. Applied
  approve/edit verdicts are recorded as `approved`/`edited`.
- Every attempt records `t.tool.executed` (result plus snapshots) under
  the caller's idempotency key: retries replay the row instead of
  re-executing. Timeouts additionally record `t.tool.timeout` (the
  finding); the error result is the recorded response, so timed-out tools
  are never silent. Timeout detection observes dispatch's own timer firing,
  not message text.
- Activity logs carry shapes only (`tool`, `ok`, `latencyMs`, flags):
  never args or result content.
