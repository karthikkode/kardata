# Primary-source implementation comparisons

Inspected 2026-09-30/2026-10-01. These are frozen research references, not
claims that donor code was ported. No new dependency/service was added.
Verbatim adoption or adapted donor tests must follow `third_party/README.md`
and land a manifest entry before adoption. Our maintained regression results
below prove Kardata changes, not upstream performance claims.

| Area | Frozen source | Verified license | Decision and relevant differences |
|---|---|---|---|
| Agent context | [Hermes compression/caching](https://github.com/NousResearch/hermes-agent/blob/60ce574905b84b18cddce4681e73902daa9f7bfd/website/docs/developer-guide/context-compression-and-caching.md) | MIT, LICENSE at that SHA | Study failure cooldowns, independent context engine and no-progress guards. Keep our TypeScript harness and one compaction unit. Do not adopt a Python runtime, provider-specific thresholds or fixed summary fallback. Kardata failure/count regressions remain explicit. |
| Durable execution | [Temporal cancellation/heartbeats](https://github.com/temporalio/samples-typescript/tree/8907f2950c1d12936306667fca933c600a61cf7b/activities-cancellation-heartbeating/src) | MIT, LICENSE at that SHA | Use the installed SDK's cancellation scopes, heartbeats and history versioning instead of another scheduler. Our real-Temporal tests verify park/resume, child reuse, cancellation and isolated queues; capacity measurements remain required. |
| MCP | [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/433eb413dc305ebeb93b8ebcde0095a8fc0d5fa0) | LICENSE declares Apache-2.0 transition with unrelicensed MIT contributions; docs CC-BY-4.0 | Retain the existing official SDK. Transport authentication does not establish application resource authority: enforce tenant/sector/thread ownership and valid execution bindings separately. Do not copy transitional-license code without file-level review. Our HTTP/DB authority tests exercise these boundaries. |
| DB access | [node-postgres pool](https://github.com/brianc/node-postgres/blob/0980cefebe0ae461da8883703be049fe13ca96cf/packages/pg-pool/index.js) | MIT, LICENSE at that SHA | Retain shared pools and explicit transaction clients. Study acquire deadlines, idle errors and client release; never add per-agent pools. Cursor commit-order and concurrent-migration failures were reproduced in Kardata and fixed with PG locks. Pool/failure envelope is still under review. |
| Logs | [Pino redaction](https://github.com/pinojs/pino/blob/6ba157b1a6727399f9dc01a584d2e08d5094ea57/docs/redaction.md) | MIT, LICENSE at that SHA | Keep Pino as serializer/logger, not custom file logging. Static path redaction alone does not cover unknown credential variants, so our fail-closed scrub remains. Preserve only validated numeric token counters, handle cyclic metadata, and omit SQL error values from exported spans. Two scrub regressions and a trace-privacy regression failed before fixes. |
| Browser verification | [Playwright runner](https://github.com/microsoft/playwright/blob/8b552173e8d767db29b8baef8f4a1f08cf7f26bf/packages/playwright/src/runner/tasks.ts) | Apache-2.0, LICENSE at that SHA | Retain the installed runner, assertions, isolated contexts, traces and video. Use maintained scenarios rather than standalone screenshots as proof. The fixture browser battery is distinct from the UI-driven Meta pilot. |

## Current measurable differences

- Two delayed-commit cursor tests failed before the ordering fix and pass after;
  concurrent migrator races similarly failed before serialization and pass after.
- Thread directory now runs a metadata query rather than 2N+1 full-transcript
  queries. The maintained scale benchmark still needs to establish throughput
  and memory, so no production latency reduction is claimed yet.
- Provider timeout regression proves cancellation and zero late-frame delivery.
- Normal/research-parent/child proposal, protected decision, cross-tenant read,
  deletion and run-control authority are exercised over HTTP and real Postgres.
- Browser download, failed-plan-save and paused-context journeys have anchored
  screenshots. Real-provider campaign evidence is not yet available.

The supervision slice also inspected Temporal's [continue-as-new sample](https://github.com/temporalio/samples-typescript/blob/8907f2950c1d12936306667fca933c600a61cf7b/continue-as-new/src/workflows.ts)
and LICENSE at that same frozen MIT commit. It retains the already installed SDK
and transfers only its supported API pattern: pass the durable cursor into the
next execution, rather than grow an indefinite single history. No donor source
or tests were copied. A new cron service and process-local timers were rejected
because worker death loses their scheduling state. The owned Temporal regression
measures recovery after three failed page attempts and the next 30-second pass;
updated-source results remain in implementation-status. This is failure recovery
evidence, not a claim of throughput improvement or completed 100-page history
rotation/large-fleet stress verification.
