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

- `heartbeats` table (`backend/src/db/heartbeats.ts`): one row
  per (run, op), upserted on every operation heartbeat (turn, provider.chat,
  tool.call, research.stage) with a 5 s in-process write throttle. Run ids
  are workflow ids (`session-run-<session>` for session-scoped activities).
- Every finding records one `t.stall.response` event (run, kind, response,
  reason, timestamp) keyed `stall:<sweepId>:<runId>:<kind>` for retry
  dedup — zero silent stalls, including runs that never beat.
- `stallSweepActivity` (`backend/src/temporal/activities/stalls.ts`) reads
  the table, sweeps, and records supplied run observations. Starting thresholds (60 s
  idle, 120 s in-tool, 0.8 near-ratio) sit above the lane heartbeat
  timeouts; B5.6 tunes them.

The worker entrypoint now installs the shared Pino logger before connecting
Temporal and exposes SDK metrics at the configured port (9464 by default).
Prometheus scrapes `worker:9464`; this is the worker SDK, not Temporal server
metrics. Error bodies/stacks and activity task tokens stay out of operational
logs. Turn heartbeats attribute to the actual owning workflow, including children.
Native Core logs explicitly forward through the same logger; configuring only
the JS logger leaves Core's separate console active. Core keeps severity, target,
bounded correlation IDs and a message hash, excluding Rust-formatted failure
strings, raw conversion entries, message bodies and span payloads. The SDK's
default WARN/Core and ERROR/other filters are retained; metrics are unchanged.
## Durable production reconciliation

### Approved execution-epoch recovery contract

The source implementation persists an execution intent before every provider-owning
workflow start/restart, including workflow-owned child launches. Each intent has
a server-generated epoch, retry-stable request identity, workflow/thread/session
binding, timestamp/deadline, state and exact Temporal execution ID when confirmed.
A per-thread head records the latest confirmed/pending start boundary. Concurrent
requests retain separate durable rows; all pending/uncertain intents block
recovery, including an older RPC whose outcome arrives after a newer request.
Elapsed time never proves that a start had no effect.

A signal-with-start that reaches an existing execution adopts that execution's
canonical epoch rather than replacing its activity authority. Private workflow
arguments carry the reserved epoch on genuinely new executions. Activity lease
creation validates the epoch against trusted Temporal workflow/execution IDs and
the durable thread/session binding inside the workspace transaction, then stores
active epoch/workflow/execution with the lease. Model arguments cannot create or
bind intents. New workflow-owned child preparation is history-versioned; legacy
histories and missing epoch metadata retain advisory-only behavior.

Automatic abandoned-lease recovery requires a confirmed terminal **exact**
execution ID, unchanged current head and active epoch/workflow/execution/lease,
and zero unresolved start intents, all rechecked under the same DB transaction.
A new reserve commits before its Temporal start, so an old observation cannot
pause a same-ID execution starting before its first event or lease acquisition.
Recovery retains summaries, transcript, steering and uncertain operation records;
it parks for owner review rather than replaying mutations. Failed/expired/unknown
intents remain visible. A proven stop before dispatch or SDK duplicate-start
rejection settles a failed intent; other outcomes remain guarded. Continue-as-new
retains the canonical epoch but advances the exact run only from its recorded
predecessor; late callbacks cannot move ownership backwards. Verified deployment
activation is recorded separately in operations status.

### Owner resume of a terminal checkpoint

Owner Resume may start a successor for a confirmed terminal checkpointed turn,
using the existing approver/scope/sensitive command boundary. It must validate
the original scheduled activity contract from exact-run Temporal history against
the scoped durable continuation and epoch binding. A verified archived request
pins the model and effective tool manifest; the original transport grant shape
is preserved while executable tools stay restricted to that manifest. Matching
prompt text alone is never authorization. Missing legacy proof produces an
actionable parked-state error rather than inventing a replacement task.

A new pre-start epoch carries private original logical run identity and a
checkpoint hash. The activity rechecks that snapshot before adopting it; the
workflow omits already-recorded user/assignment messages. Paid pending responses,
tool receipts, completed work and cumulative usage are reused. A research child
also requires the same approved plan version/scope and uses its parent retry
path. A scope revision needs owner review. These private recovery parameters are
not model/tool arguments or a permission grant; implementation and live owner-UI
verification remain distinct from the already-verified safe parking contract.

The worker entrypoint ensures one `kardata-execution-reconciliation-v1` workflow
per configured namespace on the existing research task queue. Multiple worker
starts adopt the running singleton. `executionReconciliation` persists a keyset
cursor, runs one bounded page, waits 30 seconds, and continues as new after 100
pages. There is no extra service or dependency. A matching worker rollout is
required; source implementation alone does not activate an older deployed image.

Each page first catches up the projector and inspects at most 100 active/queued
threads, with four concurrent Temporal owner reads and a two-second RPC deadline.
The page activity has a 90-second attempt/5-minute overall bound, 15-second
heartbeat timeout and at most three attempts. Exhausted retries log a coded
failure, retain the cursor and try on the next pass. Unavailable Temporal status,
including missing histories, never proves an owner is dead.

Detection latency includes the full cursor rotation: a page handles at most 100
threads, then waits 30 seconds, in addition to activity time/retries. Thresholds
are not guarantees of a fleet-wide notification within that time. Large-fleet
latency, queue starvation and outbound alert delivery require separate measured
stress evidence before claiming an operating envelope.

Owner IDs derive from persisted thread/assignment identity: session-run ID for a
normal session turn, recorded child ID for an `agent:` thread, and sector-plan ID
for a planning run whose run key matches the session's durable sector binding.
Missing/mismatched planning bindings remain unknown rather than inventing a chat
owner. Heartbeats belong to that actual owner, not the fleet.
Durable agent replies and tool-result boundaries are separate progress signals;
user messages, heartbeat writes and the supervisor's own notices do not count.
Starting advisory thresholds are 120 seconds without a heartbeat, 15 minutes
without a durable reply/tool boundary and five minutes waiting without an active
turn. These are observations, not automatic cancellation rules. Healthy slow
provider work remains subject to existing Temporal activity deadlines/retries.

Legacy terminal descriptions without validated epoch metadata remain advisory.
Modern epoch-bearing attempts can be parked only under the exact execution/head/
lease/unresolved-intent conditions above. Recovery emits PAUSED with a tagged
recovery epoch and an `execution.recovery` tool notice. A validated successor
supersedes that recovery pause; a manually paused state without the tag stays
untouched. A new reservation blocks an old observation even before its first
workflow event or lease. Saved history/context/instructions remain intact. No
lease expiry is inferred from age; start deadlines diagnose unresolved admission,
not proof that a start never happened. The older deployed worker has not been
activated with this source/migration; these source capabilities require a matching
rollout, distinct from the owned Temporal test executions.

Findings record `t.reconciliation.finding` in the session partition, with a
15-minute identity bucket for repeated advisory observations; closed-owner notices
deduplicate for the lease lifetime. Reads and observation operations
use correlated start/done/error logs; operational logs contain IDs/codes, not
execution content. Existing thread streams expose recovery pause/notices and
unresolved/rejected start notices. `db.research_health` returns the latest 20 observations from that sector's
actual session/thread set as `recentSupervision`, explicitly historical rather
than a list of still-active alerts.

Busy/idle heartbeat transitions bypass the five-second identical-state throttle.
Failed writes do not advance the throttle and clock rollback cannot suppress new
beats. Historical pure sweep response names remain compatibility records; a
recorded `suspend` decision alone is not proof a workflow was actually suspended.
Parent/child ancestry reconciliation, browser-process restart reconciliation,
outbound alert delivery and performance-envelope release gates remain separate
requirements; this page does not claim those have passed.
