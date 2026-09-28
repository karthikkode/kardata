# Agents research

Staged deep-research workflow with governor, retriever seam, per-claim
evidence, and zero-evidence refusal (T8.1-T8.2).

## Pipeline (T8.1)

`runResearchWorkflow`: preflight receipt required, scope frozen, supervisor
fans out over brief questions bounded by `maxUnits`, each unit runs a bounded
react loop (`maxReactTurns`) with its own run, budgets, repetition screen,
and idempotency scope, then compress (dedupe) and assemble. Partial unit
failure degrades: dead units contribute nothing, surviving evidence still
reports. Model-driven question decomposition is a later upgrade; topology,
budgets, and evidence rules are what this phase proves.

## Governor (T8.1)

`maxUnits` caps fan-out, `maxReactTurns` caps each unit, `maxResultsPerQuery`
caps retrieval. Timeouts from the tool layer apply per call.

## Retriever seam (T8.1)

`Retriever` splits snippet `search` from full `fetch` behind a stable
schema. `StubRetriever` serves fixtures. Providers plug in behind the seam;
the workflow never names one.

## Evidence (T8.2)

`captureFinding` requires claim, doc id, URL, and excerpt, and hashes the
tuple. Claims without sources throw. `assembleReport` dedupes by hash and
renders inline claim links plus a sources section.

## Refusal (T8.2)

Zero findings across all units returns `refused` with a stated reason. A run
with no evidence says so instead of reporting. No donor implements this.

## Checkpoints and resume (A11.1-A11.2)

A stage is one briefed question-unit through its bounded react loop to
captured findings. Every `reported` outcome carries a `checkpoint` (version,
scope, completed stages with their findings, elapsed wall-clock). Resume passes it back as
`resumeFrom`: settled questions are skipped entirely — zero provider calls
reference them — and their findings seed the report first, byte-identical.
Settled stages are re-run only on explicit user order, never implicitly.
Resume with a mismatched scope blocks instead of mixing work.

## Loop detection (A11.3)

`StageMonitor` watches unit productivity: a unit that issues tool calls but
adds zero new evidence (same content hashes as settled findings) is
fruitless. `maxFruitlessUnits` consecutive fruitless units block the run with
a `research loop` reason. New evidence resets the counter, and units that
never act do not count — so zero-evidence refusal stays `refused`, never
`blocked`. Verdicts reuse the `budgets.ts` blocked/replan language and
surface through the `supervision.ts` sweep finding kinds.

## Time budgets and suspend (A11.4)

`maxUnitWallMs` bounds each stage, `maxRunWallMs` bounds the run, both read
from the injected `Clock` (fake-clock testable). Breach returns `suspended`
with a reason plus the cursor checkpoint: completed stages stay settled, the
interrupted unit is re-run whole on resume. Elapsed wall-clock accumulates
across the resume chain, so resume with no extended budget stays suspended;
an approved larger budget resumes from the cursor.

## Backend conformance (B2.5)

`backend/src/temporal/workflows/research.ts` (`researchRun`) ports this
pipeline durably: one `runResearchStageActivity` per question on the research
lane, findings carried opaque with content hashes, dedupe by hash, and the
report assembled by a local mirror of `assembleReport` (workflow code cannot
pull the agents runtime into the sandbox). Index-before-presentation is
structural: each stage appends `t.research.stage_completed` with its findings
and the cursor advances only after the log lands; the final
`t.research.reported` carries the assembled report. Zero evidence takes the
`refused` branch with the reason logged (`t.research.refused`); empty scope
blocks (`t.research.blocked`). Pause/resume signals hold stage boundaries —
an in-flight stage finishes, no new stage starts — and resume replays history
to the cursor with zero re-executed activities (each execution writes a
`stage_started` marker under an activity-owned idempotency scope; workflow
bookkeeping uses `run-*` scopes so the two can never collide). Proven by
`tests/backend/workflows.research.test.ts` against the real server (needs
`KARDATA_TEMPORAL_TEST=1`), including report equality with the real agents
assembler over event-sourced findings. Loop/time budgets stay B2.6 work.
