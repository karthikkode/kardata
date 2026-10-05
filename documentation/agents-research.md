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
renders inline claim links plus a sources section. Findings may carry a
`field` tag (which outline field the claim covers) and `uncertain` marks
(unverified aspects): uncertain claims report under `## Uncertain`, never
silently beside certain ones, and the content hash ignores both tags so
dedupe and resume stay stable. Proven by `agents/src/research.outline.test.ts`.

## Outline (two-phase adoption)

`buildOutline` freezes the confirmed plan before any provider call:
versioned topic, named items, field definitions (`brief`/`moderate`/
`detailed`), and batch bounds. Empty items, bad batch config, and unknown
shapes throw loudly — an outline can never pass vacuously. The human
confirms the outline before deep research starts (explicit go-ahead,
runner pattern). Proven by `agents/src/research.outline.test.ts`.

## Coverage gate

`validateFindingsCoverage` requires every outline field covered by at
least one tagged finding. Fields may opt in with explicit `required`
markers; without markers every field is required. Uncertain-tagged
findings count as coverage (their doubt is flagged, not hidden);
untagged findings cover nothing; empty input throws. Donor pattern from
the pinned Deep-Research-skills validator, reimplemented against Karbot
shapes (see `third_party/manifest.yaml`).

## Direction shards (planned)

Per-shard strategy prompts for disjoint research directions (donor
module-routing pattern). Not yet built; lands with the sharded fleet
work. Until then the manifest entry points here as a placeholder spec.

## Refusal (T8.2)

Zero findings across all units returns `refused` with a stated reason. A run
with no evidence says so instead of reporting. No donor implements this.

## Pack cassette: record-once, replay-forever (Phase G)

`agents/src/researchPack.ts` freezes one capture as versioned JSON under
`agents/src/fixtures/`: scope plus its sha256, retriever documents,
per-claim findings, the assembled report, and a capture timestamp.
`createResearchPack` re-hashes findings through `captureFinding` and
assembles the report, so stored hashes are never pasted.
`validateResearchPack` re-derives scope hash, every content hash, and
the report byte-identical, and throws on any mismatch instead of
replaying silently. `CassetteRetriever` serves pack documents through
the `Retriever` seam and throws `unknown document` on misses: it
performs no fetch of its own, so replay with the network cut stays
green while any live fallback fails loudly. First pack:
`research-fintech-acme.json` (2 docs, 2 findings), proven by
`agents/src/research.pack.test.ts` (replay with `fetch` stubbed to
throw, round-trip equality, four tamper rejections, secrets scan).
Second pack `research-fintech-live.json` was recorded live against
the real Meta provider 2026-09-28 (1 finding) and replays in the
same per-pack loop; a sabotaged golden was observed to fail the
loop and pass after restore. Packs are test data, never
knowledge-base corpus: they never enter `knowledge_base/`, and no
pack is described as live capability.

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

## Basic discovery intake

The new backend coordinator screens every candidate before publication through
bounded source-only children. These are basic fit checks, not the deep-research
pipeline above. The parent validates each independent evidence field and owns
publication. See `documentation/backend.md` for the exact receipt, persistence,
replay and approval contract. Children expose their own conversation; parked
children report `paused` through their status query rather than `running`.

New company/discovery-child histories pin `company-child-steering-v1`: followup
turns retain the explicit parent assignment and the last completed steered outcome
is what the parent validates. A superseded initial answer cannot publish after a
later correction. Terminal status reports failures honestly and message counts
include followups. Existing histories retain their original contract via the
workflow marker. Source outcomes use archive refs on production activities; the
parent validates hydrated bytes, not model-authored citation claims alone.

Fan-out is a plan budget, not a constant: `budgets.concurrency` (1..64,
schema-enforced) sizes the intake, recovery, validation, and company
batches. Children run turns through the permit-wrapped provider gateway,
so wider fan-out stays under the global Meta limiter. Owner edits keep
the approved value (new plans default 2). Proven by the concurrency
barrier test in `tests/backend/workflows.coordinator.test.ts`.

## Compatible revision retention

Plan edit/approval serializes with sector workspace decisions and checks committed
lifecycle state. Approval rejects a stale version even if it exists in history.
For discovery-only revisions, completed source-backed companies and settled intake
receipts remain eligible automatically only when the approved scope, company brief
and acceptance criteria are exactly unchanged. Direction completion also requires
an identical direction and unchanged company limit/target: raising capacity cannot
mistake a previously capacity-stopped query for exhausted discovery. Incomplete,
failed and uncertain work never becomes complete through retention.

Retention creates version-owned receipts linked by readable provenance to their
original version; source evidence, child conversations and files are preserved.
The approval transaction records retained identities and refuses a company limit
below the retained count. Budget usage remains sector-cumulative. Scope changes
require explicit owner review of eligibility; textual similarity never establishes
permission or compatibility. No automatic inference of a scope expansion.

New plan approvals also pin the protected Decisions text in approvedContext.
Readers accept legacy approvals without that optional field, but automatic
retention cannot assume their decisions were unchanged. Findings/clarifications
may advance the document version without invalidating an exact Scope/Decisions
match. This is an additive approval receipt, not authority granted to agents.

The workspace approval action sends the context version currently displayed and
is unavailable while global context has not loaded. The approval transaction
rejects a stale context version before copying work or pinning the plan. The API
field is optional for legacy clients; omitting it does not relax latest-plan,
role or sector checks. The current workspace always supplies it.

Compatible retention also carries unresolved intake identities, states and attempts.
They remain blockers; retaining a completed direction never hides its uncertain or
failed candidates. The coordinator must still resolve or explicitly review them
before acceptance. Old receipts remain immutable alongside the new version.

## Bounded coordinator transport

New discovery histories use a versioned compact-state contract. Status checks read
only committed scope/version/budget; they do not transport the complete work ledger
or context revision history. Initial/final snapshots use company counts/domains,
the deterministic50-company sample, direction checkpoints and bounded retry pages.
Full work details remain in Postgres and individual work reads are sector/version
scoped. Candidate receipt lookups use existing work identities rather than passing
all rejected domains through each workflow command. Cursor pages retain query/page
positions; the DB receipts are the authoritative dedup set.

History rotates only at checkpointed boundaries with no active children or signal
handlers. It preserves the approved version, recovery cursor, cumulative budget
and persistent research session; old histories retain their original contract via
Temporal patching. Oversized state fails recoverably rather than raising server
limits or pretending the missing work completed. The transport regression budget
is1.5MB, below Temporal's default2MB per-event limit. Reference:
[Temporal server limits](https://github.com/temporalio/temporal/blob/main/common/dynamicconfig/constants.go).

## Owner review of unresolved basic intake

Only the owner through an approver-keyed HTTP/UI decision can retry or exclude a
blocked/failed `:intake:` discovery candidate. Review is fenced by the displayed
latest approved plan version and a digest of the exact work receipt. A paused or
failed sector and no executing/unresolved-start candidate child are required.
Normal/model sessions have no exclusion tool or authority. Scope, acceptance,
objectives and budgets still require plan revision/reapproval.

Exclusion uses a distinct `excluded` state: it resolves that candidate blocker,
never publishes a company or completes a direction, acceptance or company work.
Retry changes only the state to pending under the same identity, preserving
attempts, source, evidence and reason; dispatch increments cumulative attempts.
Both journal the authenticated key, exact old receipt and explicit owner reason.
Completed and excluded receipts are immutable to late checkpoints. Parent intake
publication serializes against owner review and rejects excluded/stale attempts.

An owner retry remains pending until Resume/Restart. A live paused parent detects\nthe scoped review-journal sequence advancing, then reloads at a safe boundary\nwithout active children or signal handlers. A new execution loads the pending\nidentity; history rotation preserves cursors, attempts and cumulative budgets.\nNo elapsed time or normal session message authorizes a retry or exclusion.

New review-aware coordinator histories observe a scoped review sequence. After
Resume, a changed sequence rotates only at a checkpointed boundary with no live
children/handlers, then reloads pending retries. Query cursors and cumulative
budgets stay durable. Pending owner retries remain eligible even when their
original reason begins uncertain; the reason/history are preserved. Exclusion
and exact attempt/receipt fences also apply inside publication transactions.
