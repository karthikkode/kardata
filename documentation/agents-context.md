# Agents context

Assembly rules, provider cache policy, snapshots, condensation, per-unit
ledger (T5.1-T5.2).

## Assembly (T5.1)

Order is fixed: system lines, pinned references, append-only history, then
the volatile tail (timestamps, fresh retrieval, newest user message).
`canonicalRequestBytes` is the hash input: same logical request always
produces identical bytes. Tool order is registry order; history is never
edited in place. Corrections are new appended messages.

## Cache policy (T5.1)

`describeCachePolicy` states the documented rules: Anthropic explicit
breakpoints (max 4, 5-minute default TTL, 20-block lookback), OpenAI
automatic from 1,024 tokens, Meta caching semantics unknown (TTL and
breakpoint behavior unprobed). Meta's
usage reporting shape is live-verified (`prompt_tokens_details.cached_tokens`
maps to cache reads). Adapters consume these; unknown stays unshaped.

The product Meta path follows the documented stable-prefix guidance at
<https://dev.meta.ai/docs/cookbook/prompt-caching>. Stable instructions/tools
precede versioned shared references and volatile history. TTL assumptions and
cache hits must not be invented; actual provider counters are recorded.

## Product compaction and recovery (2026-10-01)

`agents/src/compaction.ts` is the shared automatic/manual execution unit.
The assembled request includes instructions, tools, references and history.
Input budget is the lower of 100,000 and the verified window minus 16,384
output reserve. Trigger at 80%, target 50%; label heuristic counts as estimates.
Native counting is preferred where supported. Failed/empty summaries and failed
post-summary counts preserve context and return recoverable ContextBudgetError.
No extractive fallback or empty placeholder substitutes for a failed summary.
Explicitly incomplete provider output or unexpected summary tool calls are
recoverable failures even when accompanied by nonempty text. Neither can replace
working memory; the original history stays immutable. Missing terminal metadata
retains the existing generic-adapter contract and does not prove completion.
The shared whole-request measurement uses native counting first. Only the typed
count-endpoint unavailability defined in agents-providers.md permits fallback to
an estimated count of system/references,history,complete tool schemas and images.
Every individual pre/post-summary measurement records its actual exact/estimated
method; hook presence never labels a fallback exact. Generic counter errors or
invalid counts still park recoverably. No error becomes zero or removes the
100,000/window-minus-output-reserve caps. File image callers supply their existing
conservative pixel estimate through this same helper rather than bypassing caps.

Backend manual compaction repairs the parked continuation as well as its linked
durable summary. Commit rejects active turns and changed checkpoints. New
session/subagent workflow histories park ContextBlocked and resume the original
operation; patch markers preserve legacy execution histories. Provider round
timeouts abort the request and suppress late deltas. Original transcripts remain
visible. Tests and remaining release gaps are catalogued in
`../docs/deep-checks/README.md`.

## Snapshots (T5.1)

The turn runner exposes awaited request, response and tool-result persistence
boundaries. Request records use the exact normalized adapter input after context
refresh/compaction, including tools, selection and generation options; they omit
transport signals and credentials. Responses preserve text, reasoning, calls and
actual normalized usage before tool execution. These are adapter-level records,
not a claim to retain raw vendor HTTP bytes. Failed persistence blocks further
execution; operational logs must contain references rather than these bodies.
Production archive/DB wiring and owner inspection need separate verification.

`createSnapshot` runs before every provider call: sha256 over canonical
bytes plus message/tool counts, tool versions, prompt and policy versions,
and optional parent hash. The product rehydrates durable working messages and
linked summaries, never worker memory. Snapshot hashes are logged; persisting
full request snapshots with context-version coverage remains a hardening gate.

## Condensation (T5.2)

`condense` projects a new view over the immutable log: pinned head, one
summary message linked to its forgotten range, recent tail. Triggers are
event count, token cap, or explicit request. Forget edges snap to group
boundaries so a tool call never separates from its result. Trivial ranges
throw instead of silently doing nothing. The summarizer is injected, so the
compaction unit owns its route and metering.

## Ledger (T5.2)

`UnitLedger.record(unit, usage, prices)` attributes tokens and computed cost
per execution unit and rolls up run totals. Cost math lives here, never in a
vendor field.

Tool transport requests have a 60-second default deadline covering headers and
body reads. Activity cancellation aborts MCP transport as well as provider calls;
a session lookup failure cannot widen a sector tool grant. Initialization remains
a stateless compatibility probe, but every subsequent request is independently
bounded. Turn setup failures release the active-run/steering state.

Continuation recovery requires both the same durable operation ID and assignment
text. Identical text in a later turn cannot resurrect a cancelled operation's
history, sources, or cumulative budgets. Same-operation retries retain them.

Uncertain side effects stop the turn before a further provider round. Persist the
original operation/tool-call/arguments outside the summarized history as well as
the paired tool result. Resume checks that operation first; compaction cannot
turn uncertainty into permission to issue a new mutation identity. Operation
recovery is distinct from context-budget recovery in visible receipts/events.

Before tool dispatch, the working checkpoint records the original operation
identities, arguments and execution-authority fingerprint. A worker cancellation
or failed result checkpoint therefore cannot allow a replacement task to bypass
unconfirmed effects. Successful confirmed results clear these provisional
receipts; thrown client failures preserve them. Recovery uses the same identities
before another provider round, including after compaction.

The production turn's source-collection MCP wrapper must preserve authorityId,
as do palette/grant wrappers. Credential rotation cannot bypass recovery merely
because an intermediate wrapper records fetched evidence. The HTTP/activity/DB
regression exercises rotation under a new API-key identity and proves one effect.

## File dependency policy

The backend records the exact versions and units actually exposed to each
validated execution thread. File dependencies are server-derived; missing model
`fileRef` arguments cannot permit a research parent to promote file-derived text.
Proposals retain dependency receipts through owner approval. Changed sections,
working checkpoints and summaries retain their dependencies independently of
visible history. Child assignments conservatively inherit parent exposures.

Hidden or changed file versions block subsequent agent context/summary/history
assembly with recoverable ContextBlocked. Stored transcript and owner revision
history remain intact. No empty replacement summary silently drops objectives.
Reveal the exact file version, or perform an explicit safe context rebuild before
resuming. Existing summaries/checkpoints with unknown legacy provenance remain
blocked rather than being certified file-free.

Owner safe rebuild is approver-only and version-fenced. The owner reviews stored
context/source dependencies, supplies a nonempty independent replacement, and
explicitly confirms it preserves required objectives without hidden-source
content. Active leases are rejected. The visible transcript, original run/task,
source archive references, cumulative usage/budget and steering remain intact.
Unresolved operation receipts are preserved; rebuild is denied when their original
arguments may depend on blocked sources. Agents have no self-rebuild tool.

A completed provider response is checkpointed with exact per-round response,
paid usage and original execution/context metadata before archive publication.
Archive/journal failure parks the operation. Resume records that original pending
response before any tool dispatch or further provider call; it never pays for the
same provider response again. The checkpoint retains cumulative counters and
source fences. Owner rebuild cannot discard a pending paid response or its source
lineage; restore storage/source availability and resume the original turn first.

Prepared and uncertain tool receipts retain the original serialized call. Resume
checks semantic equality before restoring wire argument order, so Postgres JSONB
key ordering cannot turn an identical retry into a request-fingerprint conflict.
Changed arguments and changed execution authority remain blocked. Terminal paid
responses remain staged until final continuation clearing succeeds; repeated
finalizer failures preserve original producer lease/context/usage and archive hash.

## Global context model (sector backend v1, 2026-10-04)

Global context renders in a fixed order: Scope, Instructions, Decisions,
Findings, Open questions, then Files. Files are standardized AI summary
blocks, one per file; the block row is the provenance record. Ready blocks
render from their stored summaries (hidden files and changed hashes are
skipped, the latter failing the block); only pre-block `legacy` approvals
still inject raw unit lines. Injection skips the whole context only when the
chat's switch is off; the sector id line, local notes and steering still
apply, and the boundary records `contextVersion: null`.

The budget is 30,000 estimated tokens (4 chars per token), with per-section
and per-file breakdowns; counting never calls the provider. At 70% the
context auto-compacts silently: Decisions, Findings and Open questions shrink
to at most half, every number/company/question kept, while Scope, Instructions
and all blocks stay byte-identical. A version conflict re-reads and retries
once, then stands down with a log line. Manual Compact and version restore
share the same guarantees; restore rewrites text sections only.

Sector turns carry two prompt additions: a nudge to propose durable owner
directions via `db.propose_global_context` (never claiming they are applied),
and a rewrite brief for `context-rewrite` chats that ends in exactly one
pending proposal. Agent file proposals still travel the pending-approval path;
approval starts summarization instead of including raw units.
