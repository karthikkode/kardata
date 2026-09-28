# Agents acceptance matrix (T10.1)

Every feature from the approved build plan mapped to its proving evidence.
Status is green unless noted. Live probes (T10.4) are pending provider keys.

## Loop core (1-8)

- 1 Turn loop states: `loop.test.ts` full edge coverage plus illegal-transition rejection.
- 2 Pause/resume epochs: `epochs.test.ts` park plus epoch bump; stale-epoch rule documented.
- 3 Cancel: cancel-once test from running and paused; terminal record asserted.
- 4 Queue/steer/redirect: `BoundedQueue` plus subagent inbox tests; redirect covered in subagents suite.
- 5 Budgets: `budgets.test.ts` trips every cap deterministically on frozen time.
- 6 Repetition: warn/replan/blocked escalation plus fingerprint independence.
- 7 Progress: stalled-turn counting with reset on progress.
- 8 Completion gate: `gates.test.ts` chain plus tripwire plus rubric; no bypass path in tests.

## Providers (9-15, 45, 54)

- 9 Interface: `fake.test.ts` shape conformance per scenario.
- 10 Former second-provider adapter: removed by owner on 2026-09-26;
  the product and public package now expose Meta only.
- 11 Meta: chat plus responses wires mapped; Chat wire live-verified (auto-only clamp, nested cached_tokens mapped, forced tool call round-trips). Responses mode still unprobed.
- 12 Generic adapter: third provider binds with config only.
- 13 Fake provider: scripted scenarios, exhaustion throws, retryable flags.
- 14 Routing plus 54 overrides: cheapest-satisfying default, config-only override, unsatisfiable throws.
- 15 Abort mapping: 429/5xx retryable, 400 fatal, timeout verdict wins over late resolve.
- 45 Rate limits: token-bucket admit/deny/refill on frozen time.

## Tools (16-21, 46-48, 50)

- 16 Registry plus 17 validation: unknown/ bad-arg/ handler-throw become error results.
- 18 Planning tools plus 19 task tools: discipline enforced, submit gated by hook.
- 20 Stub domain tools: contract tests per tool; shapes frozen for backend phase.
- 21 Parallel dispatch: index-keyed accumulation plus parallel-call stream test.
- 46 Approvals: approve/edit/reject/missing-gate paths; fail-closed default.
- 47 Timeouts: abort delivered, verdict wins, injectable timers.
- 48 Idempotency: keyed repeats served from cache; unkeyed repeats execute.
- 50 Bounded queues: reject-with-reason at capacity, FIFO order kept.

## Subagents plus threads (22-26, M)

- 22 Six operations: lifecycle test per op on the fake path.
- 23 Registry: live map plus bounded recent map; late attribution asserted.
- 24 Isolation modes: fork no-delegate rule; empty default.
- 25 Budgets plus timeouts: envelopes, inactivity timestamps, warning steer documented for driver.
- 26 Cancel propagation plus missed steer: grandchild fan-out, final drain.
- M Thread contract: `frontend-thread-contract.md` reviewed against ChatPanel; snapshot shapes asserted in suite.

## Context (27-30, 52-53, 55)

- 27 Assembler: fixed order, deterministic bytes, append-only history, volatile tail.
- 28 Cache adapters: Anthropic/OpenAI rules encoded; Meta unknown.
- 29 Compaction: projection over immutable log, group-snapped edges, trivial refusal, injected summarizer.
- 30 Snapshots: hash stability, change sensitivity, parent linkage.
- 52 Execution units: router plus per-unit ledger dimensions.
- 53 Capability profiles: five-axis matching with minimum context window.
- 55 Compaction as unit: own route, metered summarizer, per-unit attribution.

## Planning extras (J)

- J Pre-flight: budget/tool/duplicate/policy checks; receipt with frozen brief hash required.

## Transcript (31-34, 49)

- 31 JSONL schema: strict parse, version gate, round-trip byte-identical.
- 32 Ledger: per-call usage plus computed cost in unit ledger.
- 33 Replay: golden order-plus-args match, mismatch failures, no re-execution.
- 34 Learning fields: propose/promote/reject with single-transition guard.
- 49 Redaction: recursive secret scrub at write time, nested fixtures asserted.

## Research (35-39)

- 35 Pipeline: end-to-end run on stubs plus fixtures.
- 36 Governor: fan-out cap asserted (5 questions, 2 units).
- 37 Retriever seam: search/fetch split behind stable schema.
- 38 Evidence: hashed per-claim chains, inline links plus sources, dedupe.
- 39 Refusal: zero-evidence run refuses with stated reason.

## Supervision (40-41, K, L)

- 40-41 Detection plus responses: every stall class detected, each mapped to a recorded response, audit complete.
- K Recovery: suspend plus checkpointed resume proven in chaos matrix.
- L Observability: dashboard-shape snapshot accuracy asserted against scripted fleet.

## Deferred with reason

- T10.4 live probes: Meta Chat and Responses wires verified live (tool calling,
  streaming, usage, and requested reasoning summaries). The removed provider
  has no live probe.
- Ollama real-loop tier: optional, decision recorded for later.
- Upstream test ports: donor regression tests port per adoption at vendoring time (manifest gate); no vendoring happened in this build.
