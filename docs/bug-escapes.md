# Bug escapes

Every bug that reached a suite, a review, or a live run gets one row: what
should have caught it, the test that now does, and the rule that prevents
recurrence. New rows append at the top.

| date | bug | found by | tier that should have caught it | test added | rule added |
|---|---|---|---|---|---|
| 2026-10-06 | Pre-entry pause/cancel/resume dropped: first-WFT signals dispatch while the session box is IDLE, failing the RUNNING/PAUSED guards, and the run proceeded | fix loop (B2a CAN carry) | temporal | workflows.run-first-signal.test.ts (worker starts after signalling) | record pre-entry state intent, apply at entry behind patched() |
| 2026-10-06 | Child CAN unwind caught as failure: phantom noteDone(failed) freed the parent slot and stretched the CAN across WFTs, losing mid-unwind signals | fix loop (B2b CAN carry) | temporal | workflows.continue-as-new.test.ts child case (correction+m2) | CAN-unwind rethrows before any failure note (mirror delegateParent guard) |
| 2026-10-04 | Poisoned projector (orphan events from a bad run) wedged every route at 500 | B4 walkthrough | live | hygiene rule, no test | terminate live-namespace residue before reusing a DB |
| 2026-10-04 | Provider slow window hit the 60s round budget on long generations | live battery (L-A16, L-PLAN) | live | karbot.turn-timeout.test.ts, context-files.test.ts | per-kind round budgets (180s plan/summary/compaction) |
| 2026-10-04 | Compaction fixture (340 identical decisions) fought the prompt | live battery (L-A9) | live | restructured fixture, same assertions | fixtures must not fight the prompt |
| 2026-10-04 | Parent-spawned child answered from global context, ignoring its brief | live battery (L-A15) | live | stored-column pin + reply loop | self-contained child goals (v1.1 prompt order) |
| 2026-10-04 | B2 stack worker stole battery activities (shared namespace) | live battery | live | live-stack-guard.test.ts | port-probe refusal both ways (was a process rule) |
| 2026-10-04 | Subagent strip crushed at 390px; chips covered View-all | full Playwright | e2e | audit-workspace views | wrap + min-w floors at 390px |
| 2026-10-04 | Token-usage trigger below the 32px touch floor | full Playwright | e2e | audit-workspace views | min-h-8 (min-h-10 < 481px) |
| 2026-10-04 | Background AI spend died with file removal | Claude review | db | api.context-files.test.ts | immutable sector.context.ai_usage events |
| 2026-10-04 | @chat composer showed raw [[session:id\|title]] while typing | Claude review | unit | chat-refs.test.tsx | @title display, expand to markers on send |
| 2026-10-04 | Subagent rows showed raw child-<uuid> | Claude review | unit | threads.test.ts, subagent-spawn.test.tsx | display names; raw keys in tooltips only |
| 2026-10-04 | Approving an Instructions-only proposal wiped other sections | Claude review | db | global-context.test.ts (3 cases) | PATCH proposal semantics |
| 2026-10-04 | Context-change ids collided across sectors | B4 walkthrough | live | mcp.authority.test.ts cross-sector case | ids namespaced per sector |
| 2026-10-04 | Live-test setup gaps (queued default, compaction refusal) | live battery | live | compaction.test.ts pin | fixtures match product defaults |
| 2026-10-04 | CORS preflight omitted Idempotency-Key, killing keyed mutations | B4 walkthrough | live | api.cors.test.ts | preflight allows the key header |
| 2026-10-04 | Planning brief fenced the spec as json, failing artifact parsing | live battery (L-PLAN) | temporal | workflows.plan-brief.test.ts | brief names the exact fence |
| 2026-10-04 | Compaction prompt returned arrays instead of strings | stage-2 tests | unit | compaction suites | explicit shape + strip + normalize |
| 2026-10-04 | Subagent children never parked ResearchPaused (pause would fail) | stage-3 tests | temporal | workflows.subagent-pause.test.ts | park at boundary, resume from checkpoint |
