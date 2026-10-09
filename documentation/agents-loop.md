# Agents loop

Turn loop run states and transitions (T1.1). Budgets, epochs, pause/resume,
and dispatch are separate sections as their phases land.

## States

`IDLE` (created, not started), `RUNNING`, `PAUSED`, `CANCELLING`, `FINISHED`,
`ERROR`. `FINISHED` and `ERROR` are terminal: no outgoing transitions. Retry
is a new run, never a reset edge.

## Legal edges

- `IDLE -> RUNNING`
- `RUNNING -> PAUSED | CANCELLING | FINISHED | ERROR`
- `PAUSED -> RUNNING | CANCELLING | ERROR`
- `CANCELLING -> FINISHED | ERROR`

Any other edge throws `IllegalTransitionError` carrying `from` and `to`, and
the run keeps its state. Cancel works from both `RUNNING` and `PAUSED`;
a failed cancel lands in `ERROR`, never back in `RUNNING`.

## Budgets (T1.2)

`BudgetTracker` consults six caps every turn: turns, tool calls, tokens, cost,
wall clock (via injected `Clock`), stalled turns. `tripped()` lists every
breached cap; any breach halts the run. A turn with measurable progress resets
the stalled counter, anything else increments it.

## Repetition (T1.2)

`fingerprintAction(tool, args)` normalizes an action to `tool:json`. The
tracker escalates per fingerprint: first repeat `warn` (caller re-sends the
prior result), second `replan`, third and beyond `blocked` (run suspends).
Fingerprints are independent across tools and argument shapes.

## Pause, resume, cancel, epochs (T1.3)

`pauseRun` parks a running run (`RUNNING -> PAUSED`); `resumeRun` returns it
to `RUNNING` and bumps `run.epoch`. Anything recorded but unconsumed under an
older epoch is stale and must not be applied. `cancelRun` moves `RUNNING` or
`PAUSED` to `CANCELLING`; a second cancel is illegal, so cancel applies once.

`IdempotencyLog` records completed action keys. Resume replays the action
list through `pending()` and runs only unrecorded keys, giving exactly-once
effects across kills and retries. Keys are caller-chosen (tool plus canonical
arguments plus scope).

## Missed-steer redelivery (F13)

Turns never wait for steering: a quiet round completes at once. A steer
that lands too late for the current turn's rounds is receipted `missed`
at turn end (`finishSteering`) and redelivered as exactly one follow-up
turn carrying its text (workflow inbox push on `outcome.missedSteering`).
A steer landing while no turn holds the lease stays `pending` and wakes
one turn via the `runSteer` signal. Either way one steer wakes at most
one turn, and nothing is lost. Error/cancel paths release the lease
without reporting, so no turn wakes for a dead run. Child turns
redeliver identically; an idle child wakes via `childMessage`, while a
finished child is receipted `missed_steer` with a surfaced event and
never relaunches.
