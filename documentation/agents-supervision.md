# Agents supervision

Heartbeats, supervisor sweep with recorded responses, audit log, fleet
metrics board (T9.1-T9.2).

## Heartbeats (T9.1)

`HeartbeatMonitor` tracks last-beat time plus busy flag per run and child
against the injected clock. Separate staleness thresholds for idle and
in-tool work. Missing beats surface as `missing-heartbeat` findings; runs
that never beat are findings too.

## Sweep (T9.1)

`sweep` maps run stats to findings: missing heartbeat, repeated calls
(from repetition verdicts), no progress (stalled turns at bound),
budget-near and context-near (usage ratios at threshold). `decide` maps each
finding to a recorded response: stalls suspend for checkpointed resume,
repeats retry once, exhaustion alerts. Every decision lands in the `AuditLog`
with trigger, response, reason, and timestamp.

## Metrics (T9.2)

`MetricsBoard` records provider observations (latency plus ok flag) and
snapshots runs by state, queue depth plus oldest age, per-provider
calls/errors/average latency, per-unit tokens plus cost from the unit
ledger, and run total cost. The payload mirrors what overview screens read;
no external telemetry services.

## Backend conformance (B5.3)

The backend sweeper ports the agents sweep without forking its policy:
`backend/src/observability/stalls.ts` replays heartbeat-table rows into an
agents `HeartbeatMonitor` (via `beatAt`, so stored ages drive the same
thresholds), builds agents `RunStats` from per-run observations, and maps
every finding through the agents `decide` policy. Research stage-loops
(B2.6 loop evidence) enter as `no-progress` findings, which `decide`
suspends for checkpointed resume.

Backend additions on top of the agents contract:

- `heartbeats` table (`backend/src/observability/heartbeats.ts`): one row
  per (run, op), upserted on every operation heartbeat (turn, provider.chat,
  tool.call, research.stage) with a 5 s in-process write throttle. Run ids
  are workflow ids (`session-run-<session>` for session-scoped activities).
- Every finding records one `t.stall.response` event (run, kind, response,
  reason, timestamp) keyed `stall:<sweepId>:<runId>:<kind>` for retry
  dedup — zero silent stalls, including runs that never beat.
- `stallSweepActivity` (`backend/src/temporal/activities/stalls.ts`) reads
  the table, sweeps, and records; the future sweeper schedule calls it with
  per-run message cursors and loop evidence. Starting thresholds (60 s
  idle, 120 s in-tool, 0.8 near-ratio) sit above the lane heartbeat
  timeouts; B5.6 tunes them.
