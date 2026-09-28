# Agents transcript

Append-only JSONL transcript, replay assertions, learning-candidate fields
(T7.1-T7.2).

## Schema (T7.1)

Line: `{ v, ts, seq, runId, kind, payload }`, `v` strict at 1. Kinds:
`session`, `turn`, `message`, `tool_call`, `tool_result`,
`provider_envelope`, `usage`, `checkpoint`, `event`. Parse validates version,
types, and known kinds; anything else throws. Empty input parses to no lines.

## Replay projection (T7.1)

`replayable()` drops `event` (UI-only) lines. Replay reproduces decisions,
not pixels. Double serialization round-trips byte-identically.

## Redaction (T7.1)

Writer takes a secret list applied recursively to every payload at write
time. Secrets never reach the stored bytes; redacted markers show where
values were removed.

## Replay assertions (T7.2)

`assertReplayMatches` compares recorded `tool_call` order plus arguments
against a golden fixture with key-order-insensitive comparison. Count, name,
or argument mismatches throw with the differing index. Tools never
re-execute during replay.

## Learning fields (T7.2)

`LearningStore` holds annotation candidates with turn refs through
`candidate -> promoted | rejected`, single transition only. The eval gate
that promotes lives outside this package for now; the fields it needs are
here.
