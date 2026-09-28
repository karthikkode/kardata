# @kardata/agents — Karbot harness

Own turn loop, provider adapters, typed tools, subagents, context management,
planning gates, transcripts, research workflow, supervision. TypeScript runtime
library; no donor servers, persistence, auth, or telemetry.

## Commands (repo root)

- `npm run test --workspaces` — all suites
- `npm run lint`, `npm run typecheck` — same, all workspaces

## Layout

- `src/` — harness source plus colocated `*.test.ts` suites
- `src/index.ts` — public barrel

## Boundaries

- Never imports `frontend/`, mock fixtures, or donor code.
- Provider credentials never enter this package; adapters receive call parameters only.
- Durability hooks (checkpoints, event shapes) are exposed for the backend phase;
  no database or workflow engine lives here.

## Testing

- Deterministic fake provider is the primary double; no network in unit tests.
- `npm run test:live` runs opt-in live probes (skips without keys in `.env`).
- Time-sensitive behavior uses `src/clock.ts` (frozen time, seeded RNG), never wall time.
