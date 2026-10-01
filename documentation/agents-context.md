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

Backend manual compaction repairs the parked continuation as well as its linked
durable summary. Commit rejects active turns and changed checkpoints. New
session/subagent workflow histories park ContextBlocked and resume the original
operation; patch markers preserve legacy execution histories. Provider round
timeouts abort the request and suppress late deltas. Original transcripts remain
visible. Tests and remaining release gaps are catalogued in
`../docs/deep-checks/README.md`.

## Snapshots (T5.1)

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
