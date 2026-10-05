# Phase 4 review: capacity, recovery and fault drills

Branch `p2-4-capacity` (stacked on `p2-3-observability`, D2), 30 commits,
one item each. Diff: 219 files, +5822/−1331. Registry 951 entries, 0 todos
in agents/backend/db/http (P4.3a–f). Gates right before this file:
`typecheck` 0, `lint` 0 errors (backend warnings still 71), `quality` 0.
Per D1 no suite ran; all Phase 4 tests are written but unverified.

## AC

- Settings in `docs/environments.md` ✓ (`P4.4n`): slots, Meta cap,
  child caps, pool sizes, plan budget 1–64, /mcp bucket, replicas.
- 1000 queued children ✓ (`tests/backend/workflows.children-1000.test.ts`):
  50 in flight + 950 queued asserted pre-drain, pump to 1000 `finished`,
  1000 `t.subagent.completed` with matching summary ids, 1000 replies,
  0 rejections, can-chain ≥ 2 via visibility list. Unrun per D1.
- F1–F16 green: tests written, runs deferred to final verification (D1).
  Each drill asserts exact end-state (counts, codes, times logged).
- Registry agents+backend no `todo` ✓ (P4.3a–f, carried unchanged; P4.4
  added no scanned surfaces so no sync ran).

## Items → proof (all tests unrun per D1)

- P4.2.1 slots+limiter (`lanes.ts:17`, `db/meta-limiter.ts:24`, pg permit
  table: task-queue limits are per-worker) → unit tests in P4.2 commits.
- P4.2.2 replicas (`stack.mjs worker --replicas`, 1–16).
- P4.2.3 durable queue (`subagents.ts:414`, 50/2000, immediate 409).
- P4.2.4 can (`can.ts`, `patched('can-v1')`) → replay test + 1000-child.
- P4.2.5 pool validation (`pool.ts:71`) + /mcp bucket (600/min).
- P4.2.6 plan budget (`research-plan.ts:8`, 1–64). P4.2.7
  `toolOperationId` (`turnRunner.ts:57`) → F4/F5 `:1:0` asserts.
- P4.3a–f matrices: 0 todos, 0 unknown tags; 3 dead activities deleted.
- P4.4a harness: `test:fault`, `test:stress`, `stack:toxi`
  (`deployment/scripts/stack.mjs`), `tests/fault/toxiproxy.ts`.
- P4.4b F1–F3 (`provider.faults`): hang 60 s/3 attempts/honest fail,
  flap backoff + usage-once, truncate retry-clean.
- P4.4c F4–F5 (`worker-kill` + `kill-worker.mjs` on dist): SIGKILL
  mid-turn resumes, effects once with stable keys, no dupes.
- P4.4d F6–F7 (`infra-cuts`): 10 s pg cut → SSE replay 8 contiguous;
  +2 s latency drains 20, 57014 fails fast, pool recovers.
- P4.4e 503 mapping (`runs-gateway.ts:78`, `runs-types.ts:31`,
  `http.ts:250`): `isTemporalConnectivity` + `TemporalUnavailableError`
  → unit test `tests/backend/temporal-unavailable.test.ts`.
- P4.4f F8: 30 s Temporal cut → 503 + code, delayed turn resumes.
- P4.4g–i F9/F10/F13/F14 (`turn-faults`): mcp-down gap reported with
  archived round-2 proof; RO archive 3 tries + honest error; 3 steers
  consumed/missed/missed all receipted; pause parks, resume keeps usage.
- P4.4j F11/F12/F15 (`db-faults`): stale prefix + exact-once catch-up;
  key ×5 sequential replays + ×5 race one effect; 20 same-key ok,
  nested opposite-order one 40P01 then retry ok.
- P4.4k F16 (`archive-faults`): RLIMIT_FSIZE worker, honest error,
  worker alive, refs null; ENOSPC/EACCES/EFBIG parity.
- P4.4l 1000 children (above). P4.4m drill tags (IDs verified present).
- P4.4n docs, P4.4o knip `ignoreBinaries: [prlimit]`.

## Step-4 suites (deferred)

`npm run verify:full`; `npm run test:fault` (needs `stack:toxi up`,
KARDATA_TEMPORAL_TEST, TEST_DATABASE_URL, TOXIPROXY_URL, prlimit,
`npm run build -w backend` for kill-worker dist).

## Deviations

- No `loadContinuation` exists in production, so F4/F5 prove full re-run
  + stable keys, not checkpoint resume (plan language aspirational).
- F6 has no in-flight turn (10 s cut exceeds the 3-attempt budget);
  it proves pg-path recovery instead. F11 compresses 60 s (call-driven).
- F16 uses EFBIG-under-prlimit as the ENOSPC proxy + a parity test.
- F13 covers consumed/missed/missed; instruction-steers never carry to
  the next turn (terminal + receipted). Only `send` maps 503 (steer,
  pause, getRun still 500 on cuts); sweep-start 503 is future work.
- `docs/implementation-status.md` has no Phase 2/3 sections (those phases
  skipped them); Phase 4 adds its own at top. Not backfilled.

## Blocked

None.

## 3 weakest points

1. 30 commits on static signal only; blind spots (detector markers,
   ton/gateway behaviors) surface at final verification.
2. Drill worker wrappers skip `recordTurnExecution` and leases (except
   F13); production-preamble drift is possible.
3. Fault-file setup (~5 near-identical worker harnesses) duplicates
   instead of sharing a helper (§2.1.6 forbids unlisted helpers).
