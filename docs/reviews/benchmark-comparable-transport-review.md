# Comparable review: bounded transport recovery

- The complete-core review encountered one terminal provider transport error after a passing gate. No benchmark revision was computed. The exact private receipt remains in the readiness report folder; no company data is committed.
- Only `src/domain/benchmark/comparable-jobs.ts` changes behavior: one additional attempt for transient transport/timeout errors, with a one-second backoff and provider-readiness checks. Quota/auth holds stay pending; schema/domain errors and exhausted attempts remain visible.
- Additional errors in the same failed run confirmed repeated Muse connection failures. In auto mode only, a Muse transport retry can use Codex after its separate auth/model/quota/hold checks. Explicit provider modes and global settings remain unchanged. This comparable-only fallback avoids repeating an unavailable endpoint; it does not alter the extraction worker.
- Status preserves attempt counts, selected providers and errors on both recovered and exhausted results. `usageIncomplete` marks unavailable failed-call token usage; recorded totals remain known usage only. Elapsed time includes retry/backoff.
- Review rules, input hashes and `adv-comparable-v4` stay unchanged, so existing successful reviews remain reusable. `FEE_VERSION` remains `adv-2a-v8`. No extraction code/facts/job control, new dependency, migration, tool, import or website work.
- Synthetic MCP tests cover Muse/Codex transport and network-open/timeout recovery, two-attempt exhaustion, non-transient/auth refusals, quota pauses, readiness changes during backoff, stopped-worker recovery and unchanged extraction facts/jobs. Fallback tests cover ready, exhausted, unauthenticated and held Codex, plus explicit Muse mode and unchanged global settings.
- Expected selectable population remains 687 core firms. The change recovers occasional transport failures without approving a missing or malformed review. Future acceptance uses a fresh random gate and a complete new review job; the failed job's history is preserved.

| Acceptance | Implementation | Evidence |
|---|---|---|
| Bounded transport recovery | comparable worker attempt loop | synthetic transient/timeout recovery and exhaustion |
| Preserve holds and real errors | quota/readiness checks, narrow classifier | quota/auth/schema tests |
| Visible recovery telemetry | persisted attempt metrics | standard status MCP assertions |
| Safe stop/resume | worker lifecycle guards and leases | backoff-stop and existing stale-lease tests |
| Preserve extraction and review rules | independent worker boundary | fee-fact/job equality, unchanged version tests |

Validation: 35 focused MCP tests passed on Node 22. Full-suite, lint/typecheck/build and final-commit CI results are recorded in the PR. After green CI, the owner's current instruction authorizes merging, deploying via `scripts/deploy-live.sh`, drawing a fresh gate and continuing acceptance. The full-review test has failed once; another failed complete attempt must stop the task.
