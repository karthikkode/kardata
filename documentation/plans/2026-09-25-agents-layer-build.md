# Karbot Agents Layer Build Plan

## Goal

Build the Karbot agent harness in `agents/` as a TypeScript runtime library: own turn loop, provider adapters (DeepSeek and Meta Muse first-class), typed tools, subagents as first-class threads, context management with compaction units, planning with deterministic gates, append-only transcripts, the deep-research workflow, supervision with stall recovery, and a verification suite. Every feature ships with its docs update, its tests, and explicit completion criteria. A final whole-layer verification task proves the assembled layer before any backend work starts.

## Success Criteria

- All 56 listed features implemented in `agents/`, each with docs, tests, and met completion criteria.
- `npm run lint`, `npm run typecheck`, and the agents test suite pass; no `any` without explanation, no unvalidated external data.
- Whole-layer verification (Phase 10) passes: acceptance matrix, soak with 100s of subagents, chaos/resume matrix, live probes (with keys), docs audit.
- `third_party/manifest.yaml` pins every adopted donor primitive with repo, SHA, license, and what was taken.
- Zero unresolved research items remain open without a written deferral.

## Context And Current Facts

- Repo is TypeScript-only (React 19 frontend, vitest, eslint, strict TS per AGENTS.md). `agents/` exists and is empty. No git repo initialized yet (verified 2026-09-25).
- Frontend contract is fixed: per-session plus per-subagent native threads, take-from-here with switch notice, back with both threads kept, `@name` routing, per-thread queues, instant steer (`frontend/src/components/ChatPanel.tsx:314-376,477-509`).
- Eight donor-research verticals completed with verified licenses and exact file refs (session scratch reports `/tmp/verify-*.md`): Pi MIT, DeepAgents/langchain MIT, Hermes MIT (Nous Research 2025), OpenHands MIT, Codex CLI Apache-2.0, SmolAgents Apache-2.0, open_deep_research MIT, dzhng MIT (package.json says ISC, LICENSE says MIT, mismatch flagged), gpt-researcher Apache-2.0 (head only), deer-flow MIT, deepseek-harness MIT (generic runtime, not research). Unsloth verified absent as a donor. Meta caching semantics unverified everywhere.
- Standing rules: strict TypeScript with no unexplained `any` and no unvalidated external data; third-party donors pinned in `third_party/manifest.yaml`, never donor servers/persistence/auth/telemetry; every user-visible contract change updates docs in the same change.

## Constraints And Non-goals

- Agents layer only. No control API, no Temporal wiring, no Postgres/GCS, no real retriever backends, no email delivery, no company page. Units expose durability hooks; the backend phase consumes them.
- Single token-efficient provider as day-one default route; per-unit quality overrides are config, proven by tests with the fake provider standing in.
- Adopt-don't-depend throughout: vendor patterns and small primitives only, with attribution and license compliance.
- No new frontend features during this build; one controlled exception is T4.3, a backend contract doc describing what the existing UI already expects.

## Key Decisions

1. **TypeScript in npm workspace `agents/`.** Pi core, dzhng, and deepseek-harness are TS MIT; repo is TS-only; one toolchain. Rejected Python: second toolchain cost for donors we pattern-borrow rather than vendor.
2. **vitest + eslint matching frontend config.** Same gates (`lint`, `typecheck`, `test`), no new test framework to learn.
3. **Transcript-first durability.** Append-only JSONL per run with checkpoints now; Temporal/Postgres consume the same event shapes later. Rejected building persistence backends in this phase.
4. **Deterministic fake provider as the primary test double**, plus recorded cassettes for adapters, a local stub endpoint for integration, Ollama as optional real-loop sanity, live probes nightly with keys.
5. **Every adoption needs donor evidence (file plus line at pinned SHA) plus Karbot spec plus passing test**, or it does not ship. Unresolved research items are tracked to closure in Phase 10.

## Recommended Approach

Ten phases in dependency order. Each task lists its docs update, its tests, and its done-when criteria. Phases 1-9 build; Phase 10 verifies the whole layer and is run as a separate task after the build completes. Port donor tests alongside donor behavior in every phase.

## Work Plan

### Phase 0 — Scaffolding and policy

- **T0.1 Initialize git on main with ignore rules.** Docs: README setup section. Tests: none (verify `git status` clean). Done-when: `main` branch, `node_modules/`, `dist/`, tool-output style dirs ignored.
- **T0.2 Create `agents/` TS package in npm workspaces.** Strict tsconfig, vitest, eslint extended from repo config, `src/index.ts` barrel. Docs: `agents/README.md` (layout, commands, boundaries). Tests: sample test proving runner wiring. Done-when: `npm run lint`, `typecheck`, `test` pass for the workspace.
- **T0.3 Create `third_party/` policy and manifest schema.** `manifest.yaml` fields (donor, repo, SHA, license, license path, what taken, why, changes), `licenses/`, `patches/`, `upstream-tests/` dirs, adoption pipeline doc. Docs: `third_party/README.md` is the policy. Tests: schema validation test on a sample entry. Done-when: invalid entries (missing SHA, license, or what-taken) fail validation.
- **T0.4 Deterministic clock and seeded RNG utilities.** Docs: `agents/README.md` testing section. Tests: frozen-time heartbeat test, seeded sequence test. Done-when: stall/timeout tests run without real-time flakiness.

### Phase 1 — Turn loop core (features 1, 2, 3, 5, 6, 7)

- **T1.1 Loop states and transitions.** Implement `IDLE/RUNNING/PAUSED/CANCELLING/FINISHED/ERROR` with legal transition map; illegal transitions rejected with typed errors. Docs: `documentation/agents-loop.md`. Tests: transition table test (every edge), illegal-transition test. Done-when: 100 percent edge coverage, no unhandled state.
- **T1.2 Budgets, repetition, progress.** Turn/tool/token/cost/wall-clock/repeat caps; action fingerprints with warn, replan, block escalation; measurable-progress rule per turn. Docs: same file, budgets section. Tests: scripted-model tests tripping each cap; triple-repeat suspends; no-progress turn flagged. Done-when: each budget trips deterministically in tests.
- **T1.3 Pause, resume, cancel.** Epoch counter; pause parks at next boundary plus checkpoint; resume skips completed actions via idempotency keys; cancel aborts at boundary with terminal record. Docs: pause/continue semantics section. Tests: pause mid-tool then resume completes once; cancel never double-applies (idempotency test). Done-when: resume-from-checkpoint test passes after simulated kill.

### Phase 2 — Providers (features 9-15, 45, 54)

- **T2.1 Provider interface plus fake provider.** Canonical tool/call/result shapes, streaming start/delta/end events, scripted scenarios (plan, tool calls, submit; flaky tool; 429 storm; truncated stream). Docs: `documentation/agents-providers.md`. Tests: shape conformance tests per scenario. Done-when: loop runs end to end on fake with zero network.
- **T2.2 DeepSeek adapter.** Chat tools wire, usage with `prompt_cache_hit/miss_tokens`, reasoning metadata passthrough. Docs: adapter section plus cassette policy. Tests: cassette replay tests (recorded once, replay in CI). Done-when: replay byte-stable, no live calls in CI.
- **T2.3 Meta Muse adapter.** Responses plus Chat shapes, raw usage verbatim, abort mapping. Docs: same file; caching marked unverified. Tests: cassette replays for both shapes. Done-when: same as T2.2.
- **T2.4 Generic OpenAI-compatible adapter.** Docs: one paragraph. Tests: cassette replay against stub endpoint. Done-when: third provider binds with config only.
- **T2.5 Router, profiles, limits.** Capability profiles per unit, cheapest-satisfying routing, per-unit overrides via config, RPM/TPM limiters with backoff, cold-start cost surfaced on override. Docs: routing section. Tests: routing table test; override test; limiter test with fake 429s. Done-when: override changes route with config only, no code edits.
- **T2.6 Stub endpoint plus cassette infra.** Local OpenAI-wire stub serving scripted scenarios; record/replay helper for cassettes. Docs: testing section in `agents/README.md`. Tests: stub self-test. Done-when: integration tests run against stub in CI.

### Phase 3 — Tools (features 16-21, 46, 47, 48, 50)

- **T3.1 Registry, validation, dispatch.** Typed registration, schema plus permission validation, parallel dispatch with index-keyed accumulation. Docs: `documentation/agents-tools.md`. Tests: unknown-tool error, bad-args error, parallel-call accumulation test. Done-when: malformed calls become error tool-results, never exceptions.
- **T3.2 Planning and task tools.** `plan.create/update/add/list/block` (full-list replace, parallel-write rejection); `task.checkpoint/clarify/blocker/submit/fail`. Docs: tool reference section. Tests: donor-ported double-write rejection test; blocked-item rule test. Done-when: plan discipline enforced by errors, not prompts.
- **T3.3 Stub domain tools.** Sector, company, document, evidence, search, fetch interfaces with stub implementations returning fixtures. Docs: interface contracts per tool. Tests: contract tests per tool. Done-when: research workflow (Phase 8) runs against stubs.
- **T3.4 Approvals, timeouts, idempotency, queues.** Approve/edit/reject hooks for privileged tools; per-tool timeouts with abort; idempotency keys on execution; bounded per-thread FIFOs with reject-with-reason full policy. Docs: safety section. Tests: approval pause/resume; timeout abort; double-execution applies once; full-queue rejection keeps text. Done-when: each proven by dedicated test.

### Phase 4 — Subagents and threads (features 22-26, M)

- **T4.1 Six operations plus registry.** launch/get/message/redirect/cancel/collect_result, batch launch, wait-for-next; live map plus bounded recent map; per-subagent persistent thread transcript. Docs: `documentation/agents-subagents.md`. Tests: lifecycle test per op; late-completion attribution test. Done-when: full lifecycle green on fake provider.
- **T4.2 Isolation, depth, budgets, propagation.** Empty-default context with fork opt-in; depth max 1 default with cycle prevention; per-child envelopes plus inactivity timeout with warning steer; parent-cancel fan-out soft/hard; `missed_steer` on completions. Docs: same file. Tests: fork-child delegation refusal; depth violation; cancel propagation to grandchildren; missed_steer recorded. Done-when: all guard tests green.
- **T4.3 Frontend thread contract doc.** Documents what ChatPanel already expects: thread ids, switch notices as transcript entries, per-thread queues, `accepting_steer` plus backlog in `get`. Docs: `documentation/frontend-thread-contract.md` (no frontend code changes). Tests: contract fixture test (mock thread payloads validate). Done-when: doc reviewed against ChatPanel lines cited above.

### Phase 5 — Context (features 27-30, 52, 53, 55)

- **T5.1 Assembler and cache adapters.** Stable-prefix-first ordering, deterministic serialization, append-only history, volatile-last; Anthropic breakpoint/TTL adapter, OpenAI key/retention adapter, no-op for DeepSeek/Meta. Docs: `documentation/agents-context.md`. Tests: serialization stability test; breakpoint placement test; prefix A/B test (volatile inside vs after breakpoint). Done-when: reordered-input test fails (proves determinism matters) and correct order passes.
- **T5.2 Compaction unit and snapshots.** Event/token/explicit triggers, linked summaries, metered summarizer on own route, ContextSnapshot with hash per provider call, per-unit ledger dimensions. Docs: same file. Tests: condensation projection test (originals intact); snapshot resume test; per-unit cost attribution test. Done-when: post-condensation prefix re-hits cache in stub tests.

### Phase 6 — Planning, gates, pre-flight (planning set, feature 8, J)

- **T6.1 Gate chain and tripwire.** Deterministic chain (todos complete, output schema, budgets, no delegated submit); tripwire halt on violation; model-graded rubric advisory with iteration cap. Docs: `documentation/agents-gates.md`. Tests: submit-with-incomplete-todos rejected; empty-result tripwire; rubric needs_revision resumes; max-iterations terminates intact. Done-when: no bypass path exists in tests.
- **T6.2 Pre-flight checks.** Budget sufficiency, tool/provider reachability, duplicate-run detection, policy pin; frozen brief plus check receipt required before long ops. Docs: same file. Tests: each failing check blocks with reasons; passing checks emit receipt. Done-when: long op cannot start without receipt in tests.

### Phase 7 — Transcript, ledger, learning fields (features 31-34, 49)

- **T7.1 JSONL transcript plus ledger plus redaction.** Versioned line schema (session, turn, message, tool_call/result, provider_envelope, usage, checkpoint, UI-only events excluded from replay); per-call usage and cost; envelope redaction and snippet scrubbing. Docs: `documentation/agents-transcript.md`. Tests: schema validation; replay determinism (double-replay byte-identical); redaction test with secret fixtures. Done-when: transcript replays exactly, secrets absent.
- **T7.2 Replay harness and learning fields.** Scripted-model runner, golden transcript fixtures, annotation-to-candidate fields with turn pointers. Docs: testing section. Tests: harness self-tests; unconsumed-steps-fail test. Done-when: a known loop bug reproduced from a golden fixture.

### Phase 8 — Research workflow (features 35-39)

- **T8.1 Staged pipeline plus governor plus retriever seam.** clarify, frozen brief, supervise with bounded fan-out, per-researcher react loop, compress, assemble, explicit exit; breadth/depth governor with timeouts; search vs fetch split behind stable schema against stub retrievers. Docs: `documentation/agents-research.md`. Tests: end-to-end run on stubs; governor caps fan-out; partial-failure degrades without abort. Done-when: full pipeline green without network.
- **T8.2 Evidence model and refusal.** Per-claim chains (Finding to Evidence to Document with spans and hashes); inline links plus sources section; zero-evidence refusal. Docs: same file. Tests: claim-without-source rejected; empty run refuses with stated reason. Done-when: report without provenance cannot assemble in tests.

### Phase 9 — Supervision and observability (features 40, 41, K, L)

- **T9.1 Heartbeats and supervisor sweep.** Per-run and per-child heartbeats with idle/in-tool staleness thresholds; sweep detects missing heartbeat, repeated calls, no progress, near-exhausted context/budget; recorded responses (retry, fallback, suspend, alert); resume from checkpoint. Docs: `documentation/agents-supervision.md`. Tests: injected stall detected within threshold; each response path tested; resume-after-suspend test. Done-when: stall-to-recovery proven in tests.
- **T9.2 Fleet metrics and audit.** Queue depth/age, run state counts, per-unit token/cost rates, provider latency/errors, heartbeat lag, clarification age; every supervisor decision in the audit log; in-memory API shaped for the future control API. Docs: same file plus endpoint reference. Tests: metrics accuracy test against scripted fleet; audit completeness test. Done-when: dashboard-shape payload validated by fixture test.

### Phase 10 — Whole-layer verification (separate task, after build)

- **T10.1 Acceptance matrix.** Every one of the 56 features exercised against its completion criteria in the assembled layer; results recorded per feature. Done-when: matrix all green or with written deferrals.
- **T10.2 Soak.** Hundreds of fake subagents, mass-stall injection, scheduling fairness, memory growth, recovery times measured and within declared bounds. Done-when: numbers recorded, regressions vs bounds fail the gate.
- **T10.3 Chaos and resume matrix.** Kill at every phase (tool, provider call, checkpoint write, compaction, gate); resume from transcript; exactly-once effects asserted. Done-when: full matrix green.
- **T10.4 Live probes and closeout.** Opt-in nightly runs against DeepSeek and Meta (keys required): cache counters, abort semantics, tool deltas; Meta caching verified or still marked unverified; docs audit against implementation; unresolved research lists closed or deferred in writing. Done-when: probe results recorded, docs match code, zero silent gaps.

## Validation Plan

- Per task: `npm run lint`, `npm run typecheck`, agents `vitest run` for the touched package unmodified, plus the task's own new tests. Highest-risk validation: T10.3 chaos/resume matrix, because exactly-once resumption is the foundation every other guarantee rests on.
- Phase gates: Phase 10 runs only when Phases 0-9 completion criteria are all met; it is a different task, not a continuation.
- Manual checks: T4.3 doc review against ChatPanel; T10.4 docs audit; manifest review per adoption.

## Risks / Rollback

- Donor behavior differs at pin time: manifest gate (re-read at SHA) catches drift; assumption then resolved, never carried.
- Meta semantics unverified: adapters ship with probes pending; nothing designs around assumed Meta caching.
- dzhng ISC mismatch and gpt-researcher NOTICE tail: resolved in T8.1 before vendoring anything beyond budget tables.
- Rollback: agents/ is a new package with no dependents; each phase merges only on green gates, so rollback is per-phase revert. No git history rewrite; old repos stay read-only.

## Open Questions

None that block planning. Live-probe keys (DeepSeek, Meta) needed before T10.4. Ollama tier is optional, decision at T2.6.

## Sources

- Workspace (inspected this run): `frontend/package.json` (vitest/eslint/TS), `frontend/src/components/ChatPanel.tsx:314-376,477-509` (thread model), `AGENTS.md` (monorepo rules), repo layout plus empty `agents/` plus absent git (shell-verified).
- Researcher-inspected donor sources (full bodies read by researchers, reports read this run): Pi `packages/ai/src/types.ts`, `api/openai-completions.ts`, `api/openai-responses-shared.ts`, `api/anthropic-messages.ts`; langchain `agents/middleware/todo.py`; DeepAgents `middleware/subagents.py`, `middleware/rubric.py`, `middleware/async_subagents.py`, `graph.py`; Hermes `tools/delegate_tool*.py`, `agent/interrupt_control.py`, `agent/conversation_loop.py`, `agent/learn_prompt.py`; OpenHands `context/condenser/llm_summarizing_condenser.py`, event store; Codex rollout/history sources; open_deep_research `deep_researcher.py`, `state.py`, `configuration.py`; dzhng `src/deep-research.ts:176-294`; gpt-researcher retrievers plus `config/variables/default.py`; deer-flow `extensions/run_evidence.py`; SmolAgents `tools.py`, `models.py`.
- Researcher-opened provider docs: `https://developers.openai.com/api/docs/guides/function-calling`, `https://developers.openai.com/api/docs/guides/prompt-caching`, `https://platform.claude.com/docs/en/build-with-claude/prompt-caching`, `https://api-docs.deepseek.com/api/create-chat-completion`, `https://api-docs.deepseek.com/guides/kv_cache`, `https://dev.meta.ai/docs/tool-calling`, `https://docs.openhands.dev/sdk/guides/context-condenser`.
