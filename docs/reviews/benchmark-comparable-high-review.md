# Comparable review: high reasoning

- Codex comparable-review calls use a per-async-call high effort override in `src/harness/codex-config.ts`, scoped by `src/domain/benchmark/comparable-jobs.ts`. Concurrent ordinary reads retain medium, including after a rejected call. No provider-setting or quota-breaker change.
- `src/domain/benchmark/comparable-review.ts` advances to `adv-comparable-v6`; cached v1–v5 reviews cannot qualify new benchmarks. The only prompt change clarifies that a stated minimum account size remains an account minimum when generally preferred, with negotiable lower balances requiring a waiver. No scope or pricing rule changes.
- Synthetic tests: concurrent high/medium isolation and rejection cleanup (`tests/unit/codex-config.test.ts`); preferred negotiable minimum and prior-version exclusion (`tests/unit/comparable-review.test.ts`); actual worker context, grounded minimum, unchanged extraction facts and old-review exclusion (`tests/mcp/comparable-review.test.ts`).
- `FEE_VERSION` remains `adv-2a-v8`; fee extraction, provider selection, job controls, schema and dependencies are unchanged.
- Selection remains exact comparables plus numeric two-reading firms: saved checkpoint 687 core firms. Post-deploy gate: earlier 57 plus 20 new seeded firms. Production evidence and firm identities remain private. Full review and benchmark computation require the owner's live acceptance tests; a failure or Codex quota pause stops this experiment.
- Validation: focused tests passed (68); lint, typecheck, build, full suite and final CI are reported in the PR.
- Deviation: none. This changes reasoning depth and the requested minimum clarification only.
