# Backend build plan — TypeScript + Temporal (day 1) + Postgres + top-tier observability

## Goal

Build the Kardata backend as a TypeScript service with Temporal durability from
day one, Postgres as the everything-log, and observability that stays clean
with 1000s of concurrent agents: per-operation heartbeats, stall detection
with recorded responses, and fleet dashboards with alerts.

## Success Criteria

- Every agents-layer seam (turn loop, providers, tools, subagents, context,
  gates, transcript, ledger, research, supervision) runs as a durable backend
  path; in-memory-only state is gone from the serving path.
- Every state-changing or notable backend action appends to the Postgres event
  log; any user-visible state can be rebuilt from the log (replay check).
- Every running operation emits heartbeats; a stalled operation is detected
  within its threshold and gets a recorded response (retry, fallback, suspend,
  alert) — verified by a chaos test, not by inspection.
- A load harness with 1000 synthetic agents shows detection latency, alert
  firing, and dashboard truthfulness within the budgets in B5.6.
- A paused research job resumes forward from its checkpoint: completed stages
  are never re-executed or re-verified on resume; stage loops and runaway
  runtimes are detected and suspended with a recorded reason (A11.x, B2.6).
- Each task below ships with its own acceptance criteria met, its own tests
  green, and its own doc updates merged — no task is done without all three.

## Context And Current Facts

- Workspace audit (2026-09-25): `backend/`, `common/`, `db/`, `mcp/`,
  `deployment/`, `knowledge_base/` are all empty. The only implemented product
  code is `agents/` (44 TS files, 126 tests green) and the mock-only
  `frontend/` (`src/mock/*`, `src/lib/*`, components). Tests live in
  `tests/frontend/...`; `tests/backend/...` does not exist yet (required by
  `documentation/tests.md` mirroring rule).
- Agents seams the backend must absorb: `loop.ts` run states
  (IDLE/RUNNING/PAUSED/CANCELLING/FINISHED/ERROR), `budgets.ts`,
  `providers.ts` + `deepseek.ts`/`meta.ts`/`router.ts`/`fake.ts`/`stub.ts`,
  `tools.ts` + `tasks.ts` + `queue.ts` (bounded FIFO, never silently drops),
  `subagents.ts` (6 ops, isolation), `context.ts` + `condense.ts`,
  `planning.ts` + `preflight.ts` + `gates.ts`, `transcript.ts`,
  `condense.ts` UnitLedger, `research.ts` (pipeline + evidence + refusal),
  `supervision.ts` (HeartbeatMonitor + sweep with recorded responses),
  `metrics.ts` (MetricsBoard fleet snapshot), `transport.ts`,
  `turn.ts`, `epochs.ts`, `manifest.ts`.
- `supervision.ts` already defines the stall contract the backend must
  promote to durable form: finding kinds `missing-heartbeat`,
  `repeated-calls`, `no-progress`, `budget-near`, `context-near`; "a stall is
  routine resume material, not an incident."
- Reported failure mode driving A11/B2.6: a research job could be paused,
  but on resume the model re-entered verification of prior stages and looped.
  The plan therefore treats resume-cursor integrity and loop/time guards as
  first-class requirements, not tuning.
- `documentation/frontend-thread-contract.md` fixes thread keys
  (`session id`, `agent:<child-id>`), `@name` routing, per-thread queues,
  `acceptingSteer` + depth exposure, and no-silent-relaunch on finished
  children. The backend API must implement exactly this.
- Root `package.json` workspaces are `frontend` + `agents`; backend joins as
  a third workspace. Gates per AGENTS.md: `npm run lint`, `typecheck`,
  `test`, `build`, plus `docs/environments.md` acceptance scripts for
  staging/API changes. Backend is TS-only, so `ruff`/`pytest` are N/A.
- Temporal grounding (inspected this run): activities require
  Start-To-Close or Schedule-To-Close; a missed `heartbeatTimeout` marks the
  activity timed-out and triggers retry per policy; cancellation delivery to
  an activity requires heartbeats. Worker-health minimal alerts: Workflow and
  Activity Schedule-To-Start latency (alert p99 > 200 ms), Sync Match Rate,
  Poll Success Rate, `temporal_worker_task_slots_available` = 0, backlog
  count, sticky-cache signals.

## Constraints And Non-goals

- Temporal from day one; TypeScript everywhere in backend; no Python service.
- No secrets in frontend, logs, or events; provider keys server-side only.
- `agents/` stays the pure, dependency-free domain core; backend adapts it,
  never forks its rules. No mock imports in serving paths.
- Frontend stays on mocks until cutover (Phase 6); no frontend edits before.
- Non-goals: multi-tenancy, alert routing (pager), prod Kubernetes topology
  (self-host decision is fixed; exact prod sizing follows B5.6 numbers).

## Key Decisions

- Fastify + TypeScript in `backend/`, third npm workspace; Zod-validated
  routes; Pydantic-style discipline via Zod + exact types.
- Temporal self-hosted everywhere: dev server in Docker Compose for
  dev/staging, self-hosted cluster for prod (DECIDED — no Cloud evaluation).
  SDK metrics to Prometheus, traces via OTel, all self-hosted.
- Artifacts live in GCS on staging and prod (DECIDED); local-filesystem
  target exists only for unit tests and offline dev.
- Logs/metrics/traces are self-hosted (Loki/Grafana/Prometheus), so there is
  no vendor log bill; the only scale cost under test is provider token spend,
  measured in B5.6.
- Postgres is the system of record: append-only `events` table (idempotency
  key unique, global sequence, redaction flag), projections for transcript /
  ledger / threads, `heartbeats` table for stall detection, outbox for SSE.
- Logging: pino JSON everywhere (trace_id, run_id, op, attempt), OTel SDK
  for traces, Loki + Grafana for logs/dashboards, Prometheus alert rules
  from Temporal worker-health minimums.
- Stall detection is two layers: Temporal heartbeat timeouts (fast,
  per-activity retry/cancel) plus a DB sweeper activity (fleet-wide,
  ports `supervision.ts` sweep semantics, records every response).
- Task queues partitioned by lane (`turn`, `tool`, `research`, `sweep`) so
  one hot lane cannot starve the rest; worker counts scale per lane.

## Recommended Approach

Build strictly in task order B0 → B6. Each task is independently shippable
and independently verified: its acceptance criteria, its tests, its docs.
A task may start only after all earlier tasks are done; where a task consumes
an earlier task's output it is named in its Do line (B3.1 ← B0.2, B1.2 ← B1.1,
B5.x ← Phases 1–3, B2.5/B2.6 ← A11). Phase A11 reopens the agents layer first
so the backend (B2.5/B2.6) ports proven semantics, not fresh inventions.
Anything not known at plan time is marked ASSUMPTION or OPEN, never silently
decided during implementation.

## Work Plan

### Phase 0 — Scaffold, contract, local platform

#### B0.1 Backend workspace scaffold
- Do: `backend/` package (TS strict, Fastify, pino, Zod), root workspace
  wiring, `GET /healthz`, lint/typecheck/test scripts matching repo gates.
- Acceptance criteria: `npm run lint`, `typecheck`, `test --workspace backend`
  green; `/healthz` returns build sha + uptime; no `any` without comment.
- Tests: `tests/backend/health.test.ts` (health shape; 404 envelope).
- Docs: `README.md` (workspace map + backend commands),
  `docs/environments.md` (backend dev commands).

#### B0.2 Versioned API contract (StagingApi parity)
- Do: OpenAPI `backend/openapi/v1.yaml` covering threads, runs, commands
  (send/steer/pause/resume/cancel/approve), SSE envelope with resume token,
  error + denied envelopes; contract test harness.
- Acceptance criteria: every `frontend/src/mock/*` shape has a contract
  counterpart or an explicit deferral entry; breaking-change rule documented.
- Tests: `tests/backend/contract.test.ts` (spec examples validate; unknown
  fields rejected in strict mode).
- Docs: `docs/architecture.md` (contract location + versioning rule).

#### B0.3 Postgres schema v1 + migrations
- Do: `db/migrations/0001_init.sql` — `events` append-only table (global
  sequence, idempotency unique, redaction flag), `heartbeats`, `outbox`,
  projections tables; `backend` migrate up/down script.
- Acceptance criteria: migrate up/down round-trips cleanly on empty DB;
  duplicate idempotency key replays the first row (one row, same seq);
  sequence is gapless per partition.
- Tests: `tests/backend/db.migrations.test.ts` (up/down, constraint hits).
- Docs: `docs/architecture.md` (event-log section + schema diagram).

#### B0.4 Local platform compose
- Do: `deployment/compose.yaml` — Postgres, self-hosted Temporal dev server,
  backend, worker, Loki/Grafana/Prometheus; one-command boot; record the prod
  self-host topology inputs (sizing follows B5.6 numbers).
- Acceptance criteria: cold `up` to green `/healthz` + Temporal UI reachable;
  telemetry stack reachable with zero external dependencies.
- Tests: `tests/backend/compose.smoke.test.ts` (TCP/HTTP reachability only).
- Docs: `docs/environments.md` (compose usage + acceptance scripts stub).

#### B0.5 Logging contract + trace propagation
- Do: pino JSON base logger (trace_id, run_id, op, attempt, tenant), W3C
  trace-context propagation Fastify ↔ Temporal ↔ pg, secret-scrub filter
  with unit-probed deny-list.
- Acceptance criteria: any log line joins to its trace; a probe secret never
  appears in output; log schema documented and frozen v1.
- Tests: `tests/backend/logging.test.ts` (trace join; scrub probe incl. one
  variant NOT on the deny-list, e.g. long-form alias).
- Docs: `docs/architecture.md` (logging contract).

### Phase 1 — Event log, projections, retention

#### B1.1 Event envelope + append path
- Do: `appendEvent` (Zod-validated envelope, idempotency, ordering,
  redaction hook) as the only write path; all callers reviewed.
- Acceptance criteria: concurrent duplicate appends → one row; redacted
  payload readable as redacted (never plaintext); 100 % of writes via helper.
- Tests: `tests/backend/events.append.test.ts` (duplicates, redaction,
  ordering).
- Docs: `docs/architecture.md` (write-path rule).

#### B1.2 Transcript projection
- Do: project threads/messages/tool-calls per thread contract from events;
  `@name` routing + per-thread queues + `missed_steer` semantics in DB.
- Acceptance criteria: replay of fixture events yields the exact thread
  views in `frontend-thread-contract.md`; finished-child send → missed_steer.
- Tests: `tests/backend/threads.test.ts` (routing, queues, missed steer).
- Docs: `documentation/frontend-thread-contract.md` (backend-conformance note).

#### B1.3 Ledger projection
- Do: usage/cost ledger from UnitLedger-shaped events; per-run and fleet
  totals; rounding rule fixed.
- Acceptance criteria: totals match hand-computed fixture to the cent;
  re-projection is idempotent.
- Tests: `tests/backend/ledger.test.ts` (fixture totals, idempotent replay).
- Docs: `docs/architecture.md` (ledger rules).

#### B1.4 Retention + cold archive
- Do: time-based retention job (Temporal schedule), archive interface with
  GCS as the real target (staging bucket wired in compose/staging config);
  local-filesystem target for unit tests and offline dev only.
- Acceptance criteria: rows older than window archive to GCS + drop from hot
  tables; replay including archive reproduces state; tests run against local
  target, staging acceptance runs against the staging bucket.
- Tests: `tests/backend/retention.test.ts` (archive + replay round-trip).
- Docs: `docs/architecture.md` (retention windows + GCS layout).

### Phase 2 — Temporal durability (day-1 core)

#### B2.1 Worker bootstrap + task-queue lanes
- Do: Temporal connection, worker fleet (`turn`, `tool`, `research`,
  `sweep` lanes), graceful shutdown, per-lane concurrency config.
- Acceptance criteria: worker crash mid-activity → Temporal redelivers;
  lane saturation in one lane leaves others unaffected (proven by test).
- Tests: `tests/backend/temporal.lanes.test.ts` (kill-worker redelivery;
  lane isolation).
- Docs: `docs/architecture.md` (Temporal topology).

#### B2.2 Session-run workflow
- Do: turn loop as workflow (`loop.ts` states as workflow states);
  signals send/steer/pause/resume/cancel; queries state/thread; history =
  event log writes.
- Acceptance criteria: pause/resume/cancel mid-tool-call behave per
  agents semantics; full run replays from events alone.
- Tests: `tests/backend/workflows.run.test.ts` (signal matrix incl.
  cancel-during-tool; replay-from-events).
- Docs: `docs/architecture.md` (run lifecycle diagram).

#### B2.3 Heartbeat + timeout + cancellation policy
- Do: every activity heartbeats with `heartbeatTimeout`; Start-To-Close /
  Schedule-To-Close set per lane; cancellation propagates to activities.
- Acceptance criteria: killed activity attempt retries within heartbeat
  window (not Start-To-Close); cancel cancels the attempt (no orphan tool).
- Tests: `tests/backend/temporal.heartbeats.test.ts` (stall→retry timing;
  cancel propagation).
- Docs: `docs/architecture.md` (timeout table per lane).

#### B2.4 Subagent child workflows
- Do: 6 subagent ops as child workflows, isolation record per launch,
  parent-thread contract conformance.
- Acceptance criteria: all 6 ops complete as children; isolation fields
  present on every launch record; parent sees child completion entry.
- Tests: `tests/backend/workflows.subagents.test.ts` (6 ops + isolation).
- Docs: `documentation/agents-subagents.md` (backend-conformance note).

#### B2.5 Deep-research pipeline workflow
- Do: research pipeline as workflow with evidence model + refusal paths as
  first-class branches; pause/resume signals preserve the stage cursor
  (resume replays history to cursor, never re-executes completed activities).
- Acceptance criteria: refusal fixture yields refusal branch with reason
  logged; evidence entries index before presentation; pause-then-resume
  continues at the next incomplete stage with zero re-executed activities.
- Tests: `tests/backend/workflows.research.test.ts` (pipeline + refusal +
  pause/resume cursor).
- Docs: `documentation/agents-research.md` (backend-conformance note).

#### B2.6 Research loop + time guards service
- Do: per-run stage-attempt counters in events; circular-transition detector
  activity (revisiting a stage without new evidence → `repeated-calls` /
  `no-progress` finding); per-stage and per-run wall-clock budgets from A11.4;
  breach → suspend + recorded reason; resume after suspend requires explicit
  operator action or an approved extended budget.
- Acceptance criteria: a synthetic A→B→A-without-progress loop suspends
  within its attempt bound with reason logged; an over-budget run suspends
  (never runs indefinitely); unauthorized resume-after-suspend is denied.
- Tests: `tests/backend/workflows.loopguards.test.ts` (circular loop,
  time-budget breach, resume-after-suspend auth).
- Docs: `docs/architecture.md` (loop/time guard rules + bounds table).

### Phase A11 — Agents-layer resume + loop guards (reopens agents layer)

#### A11.1 Research stage checkpoints
- Do: in `agents/`, stage completion markers (stage id + output hash) on the
  research pipeline; resume loads the cursor and skips completed stages.
- Acceptance criteria: resume fixture with 2/4 stages complete runs only
  stages 3–4; completed-stage outputs are byte-identical after resume.
- Tests: `agents/src/research.resume.test.ts` (cursor skip; output identity).
- Docs: `documentation/agents-research.md` (checkpoint rule).

#### A11.2 Resume-no-reverify prompt contract
- Do: on resume the model receives completed stages as settled facts
  (summaries + hashes); contract forbids re-verification of settled stages
  without an explicit user-ordered re-run with reason.
- Acceptance criteria: resume-transcript fixture advances to the next
  incomplete stage with zero verification calls against settled stages.
- Tests: `agents/src/research.resume.test.ts` (no-reverify assertion on the
  recorded tool-call sequence).
- Docs: `documentation/agents-research.md` (resume prompt contract).

#### A11.3 Pipeline loop detection
- Do: stage-revisit counter + circular-transition rule (same stage re-entered
  without new evidence counts as no-progress); verdicts reuse `budgets.ts`
  blocked/replan; surfaces through `supervision.ts` sweep findings.
- Acceptance criteria: fixture loop (verify→revise→verify, no new evidence)
  yields blocked/replan within the bound; genuinely new evidence resets the
  counter (no false positive, proven by test).
- Tests: `agents/src/research.loops.test.ts` (loop blocked; new-evidence reset).
- Docs: `documentation/agents-supervision.md` (research loop rule).

#### A11.4 Stage + run time budgets
- Do: per-stage and per-run wall-clock budgets on the research pipeline via
  Clock (fake-clock testable); breach → suspend with reason event, resumable
  only with explicit user-approved extended budget.
- Acceptance criteria: over-budget fixture suspends with reason; resume with
  no extended budget stays suspended; approved extension resumes from cursor.
- Tests: `agents/src/research.budgets.test.ts` (breach, suspended-resume,
  approved-extension).
- Docs: `documentation/agents-research.md` (budget table + suspend rule).

### Phase 3 — HTTP API + streaming + access control

#### B3.1 REST parity
- Do: sessions/threads/runs routes + commands per OpenAPI B0.2; Zod I/O;
  error/denied envelopes.
- Acceptance criteria: contract tests pass against the running server;
  every route has loading/empty/error/denied behavior documented.
- Tests: `tests/backend/api.rest.test.ts` (CRUD + command matrix).
- Docs: `docs/architecture.md` (route catalogue).

#### B3.2 SSE from Postgres outbox
- Do: per-thread SSE via outbox + LISTEN/NOTIFY; resume token; backpressure
  documented; reconnect test.
- Acceptance criteria: dropped connection resumes without gap or duplex;
  backlog beyond threshold returns snapshot + token (rule named).
- Tests: `tests/backend/api.sse.test.ts` (resume, backpressure rule).
- Docs: `docs/architecture.md` (streaming contract).

#### B3.3 AuthN/Z + tenancy stub
- Do: API-key auth, tenant/project scoping columns, RBAC
  (read/write/approve), denied paths return denied envelope.
- Acceptance criteria: cross-tenant read denied + logged; approval requires
  approve role (ASSUMPTION: single-tenant default until multi-tenancy lands).
- Tests: `tests/backend/api.auth.test.ts` (matrix incl. denied paths).
- Docs: `docs/architecture.md` (auth model + deferred multi-tenancy).

#### B3.4 Rate limits + mutation idempotency
- Do: per-key rate limits, Idempotency-Key on mutations, 429/409 envelopes.
- Acceptance criteria: duplicate POST with same key → same result, one
  effect; limit breach → 429 with retry-after, logged.
- Tests: `tests/backend/api.idempotency.test.ts` (replay + limits).
- Docs: `docs/architecture.md` (limits table).

### Phase 4 — Providers, tools, artifacts behind the boundary

#### B4.1 Provider gateway activities
- Do: DeepSeek/Meta/fake/router activities reusing `agents/` providers;
  keys from env/secret store only; per-call latency/ok logged, payloads redacted.
- Acceptance criteria: live probe via backend matches direct agents probe;
  no key material in any log/event; provider failure → typed error event.
- Tests: `tests/backend/providers.gateway.test.ts` (fake matrix; redaction).
- Docs: `documentation/agents-providers.md` (backend-conformance note).

#### B4.2 Plan/task tool activities + approvals
- Do: plan/task tools as activities with approval gates, timeouts,
  idempotency keys; timeout → finding + response.
- Acceptance criteria: unapproved sensitive tool blocks with approval event;
  timed-out tool maps to recorded response, never silent.
- Tests: `tests/backend/tools.activities.test.ts` (approval + timeout).
- Docs: `documentation/agents-tools.md` (backend-conformance note).

#### B4.3 Artifact pipeline (index-before-present)
- Do: task/session-scoped artifact tools; artifacts indexed before served;
  proposals never mutate company state.
- Acceptance criteria: unindexed artifact is unservable (proven by test);
  proposal path writes zero company mutations.
- Tests: `tests/backend/artifacts.test.ts` (index gate; no-mutation proof).
- Docs: `docs/architecture.md` (artifact rule).

### Phase 5 — 1000-agent observability (the top-notch bar)

#### B5.1 Structured logs everywhere + Loki
- Do: pino JSON on every route/activity/workflow-signal; Loki + Grafana in
  compose; trace_id joins logs ↔ traces ↔ events.
- Acceptance criteria: any alert links to exact logs in one click; disk
  usage per 1000-agent soak stays within the capacity budget (number in report).
- Tests: `tests/backend/observability.logs.test.ts` (field presence;
  secret scrub re-proven).
- Docs: `docs/environments.md` (log access + query cookbook).

#### B5.2 OTel traces + Prometheus metrics
- Do: OTel spans Fastify/pg/Temporal; SDK metrics exported; cardinality
  budget enforced (label allow-list).
- Acceptance criteria: a run's full trace renders end-to-end; metric
  cardinality stays under budget at soak scale.
- Tests: `tests/backend/observability.traces.test.ts` (span join;
  cardinality guard).
- Docs: `docs/architecture.md` (telemetry pipeline).

#### B5.3 Stall detection service (per-operation)
- Do: `heartbeats` writes on every operation heartbeat; sweeper activity
  ports `supervision.ts` sweep (all 5 finding kinds); every finding writes
  its response (retry/fallback/suspend/alert) to the event log.
- Acceptance criteria: injected stall of each kind is detected within its
  threshold and carries a recorded response; zero silent stalls in chaos run;
  research stage-loops from B2.6 surface as findings with suspend responses.
- Tests: `tests/backend/observability.stall.test.ts` (5-kind chaos matrix).
- Docs: `documentation/agents-supervision.md` (backend-conformance note).

#### B5.4 Fleet dashboards + alerts
- Do: provisioned Grafana boards (runs-by-state, lanes, providers, ledger,
  stalls); Prometheus alerts from worker-health minimums (sched-to-start
  p99 > 200 ms, slots = 0, backlog, poll/sync-match drops).
- Acceptance criteria: each alert has a runbook link; alert fires on
  induced backlog in staging (proven, not asserted).
- Tests: `tests/backend/observability.alerts.test.ts` (rule presence +
  induced-backlog firing).
- Docs: `docs/environments.md` (dashboards + alert runbooks).

#### B5.5 Run inspector + ops actions
- Do: ops read endpoints (run detail, history, findings) + actions
  (retry/suspend/cancel) with RBAC; every action logged.
- Acceptance criteria: stuck run is findable, diagnosable, and actionable
  from the inspector; unauthorized action denied + logged.
- Tests: `tests/backend/ops.inspector.test.ts` (find→diagnose→act flow).
- Docs: `docs/environments.md` (inspector guide).

#### B5.6 1000-agent soak + tuning report
- Do: synthetic fleet harness (1000 agents, mixed lanes/failures); measure
  detection latency, alert precision, dashboard truthfulness, cost/ledger
  accuracy; tune thresholds; publish report.
- Acceptance criteria: p99 stall-detection latency within threshold budget;
  zero missed induced stalls; report checked in with numbers, including
  provider token spend at 1000-agent scale (the only usage-based cost).
- Tests: harness itself + `tests/backend/soak.report.md` (numbers, not vibes).
- Docs: `docs/implementation-status.md` (scale claim with evidence link).

### Phase 6 — Cutover to real frontend (next task after backend)

#### B6.1 Real StagingApi client (flag-gated)
- Do: `frontend/src/data/staging-api.ts` real client behind env flag; mocks
  retained for tests; no mock imports in the real client.
- Acceptance criteria: flag on → all panels read live; flag off → mocks;
  no component imports mock fixtures directly (lint-proven).
- Tests: `tests/frontend/staging-api.test.ts` + existing panel suites green.
- Docs: `documentation/frontend.md` (data-source flag).

#### B6.2 Connected acceptance against Compose
- Do: run `docs/environments.md` acceptance scripts end-to-end; record
  skipped verification explicitly.
- Acceptance criteria: scripts green; any skip named with reason and owner.
- Tests: the acceptance scripts themselves.
- Docs: `docs/implementation-status.md` (implemented vs deferred refresh).

#### B6.3 Doc + status sweep
- Do: stale-claim pass over README, architecture, design-system,
  environments, implementation-status; deferred list updated honestly.
- Acceptance criteria: no doc describes a fixture/simulated/read-only path
  as live capability.
- Tests: doc-lint (no-banned-claims grep) in `tests/backend/docs.test.ts`.
- Docs: the sweep itself.

## Validation Plan

- Per task: its listed tests run via `npm run lint`, `npm run typecheck`,
  `npm test --workspace backend` (plus specified suites); gates green before
  the next task starts. Highest-risk validations: B2.1 redelivery,
  A11.2 no-reverify, A11.3 loop blocking, B5.3 chaos matrix, B5.6 soak numbers.
- Phase exits: compose acceptance scripts (`docs/environments.md`) for
  Phases 0, 2, 3, 5; replay-from-events check at B1.2, B2.2, B5.6.
- Backend is TS-only: `ruff`/`pytest` N/A (recorded, not skipped-silently).

## Risks / Rollback

- Temporal versioning: workflow changes follow versioning rules from B2.2 on;
  incompatible change → new workflow version, never in-place edit.
- Postgres queue growth: outbox + heartbeats partitioned from B1.1; retention
  B1.4 bounds growth; soak B5.6 proves it.
- DeepSeek key / Meta probe pending: provider faults are typed events; fake
  provider keeps every phase testable without keys.
- Rollback: migrations reversible to Phase 0; workflows are new (no legacy
  to preserve); frontend flag-off restores mocks instantly.

## Open Questions

- Log/event retention windows (disk-capacity sizing, not vendor cost):
  proposed in B1.4, confirmed by soak numbers in B5.6.
- None other: Temporal self-hosting, GCS artifacts, and self-hosted telemetry
  are decided above.

## Sources

- <https://docs.temporal.io/develop/typescript/activities/timeouts>
- <https://docs.temporal.io/cloud/worker-health>
