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

## Snapshots (T5.1)

`createSnapshot` runs before every provider call: sha256 over canonical
bytes plus message/tool counts, tool versions, prompt and policy versions,
and optional parent hash. Continuation rehydrates from snapshots, never from
worker memory.

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
