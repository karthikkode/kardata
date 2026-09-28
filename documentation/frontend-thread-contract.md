# Frontend thread contract

Backend mirror of what `frontend/src/components/ChatPanel.tsx` already
implements (T4.3). No frontend code changes: this doc states what the harness
must emit so the existing UI binds without modification.

## Threads

- One session thread per session plus one native thread per subagent.
  Thread key mirrors the UI: session id for the session thread,
  `agent:<child-id>` for subagent threads.
- Every subagent owns a persistent thread (messages, tool calls, thinking
  blocks, queued drafts) with the same status as a parent thread.
- Switching threads is a view change: both threads persist, no data migrates.
- Reopening a subagent thread shows its own history; the first visit seeds a
  switch notice (`Switched to <name>. Take it from here...`) as a transcript
  entry, followed by that subagent's own tool calls.

## Routing

- `@name` in the session thread routes the send to that subagent's thread.
- A send with no mention routes to the parent.
- Inside a subagent thread, sends route to that subagent directly.

## Queues and steer

- Queued texts are per thread. Steer sends instantly to the addressed thread.
- `get(child)` exposes `acceptingSteer` plus queue depth so the UI renders
  each subagent window live and labels steer availability honestly.
- Sends to finished children never silently relaunch: the text lands as
  `missed_steer` on the completion entry or re-queues as an explicit new
  launch at the user's choice.

## Backend conformance (B1.2)

`backend/src/threads/project.ts` projects threads, messages, queues, and
routing from the event log (`projectBatch` incremental,
`rebuildFromEvents` for full replay; both proven identical in
`tests/backend/threads.test.ts`). Mapping notes:

- Queued texts are `thread_messages` rows with `payload.queued: true`;
  `threads.queue_depth` mirrors the count for cheap reads.
- `missed_steer` is a session-thread text message with
  `payload: { text, missedSteer: true, target }`. Sends target a FINISHED
  thread to trigger it; other states route normally.
- `@name` matching is `@` + full child name, case-insensitive, launch order
  wins. The child name record is the launch notice message.
- Unknown event types are ignored per batch (forward-compatible); the batch
  reports them instead of failing.
