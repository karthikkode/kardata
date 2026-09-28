# Plan: backend gap closure before frontend cutover

## Goal

Close every verified gap between what the repo promises (plans, docs,
rules) and what it does, so backend is genuinely finished and the
frontend cutover (B6.1) starts on a truthful contract.

## Success Criteria

- Every P0 item below is fixed, tested, and documented; P1 fixed or
  explicitly deferred with owner sign-off; P2 batched as a docs pass.
- `npm run lint`, `npm run typecheck`, `npm run build`, backend suite,
  and `promtool check/test rules` all green.
- No doc references a missing page; no rule contradicts the code.

## Context And Current Facts

A 4-surface review (backend-impl, tests-gates, docs-rules, frontend),
plus local verification, found:

- **P0 frontend blocked**: `frontend/src` has no `fetch`/`EventSource`/
  `WebSocket`, no `src/data`, no `/v1/` references. `ChatPanel.tsx`
  (1336 lines) is fully mock-driven (`mock/agents`, `mock/files`,
  `mock/sessions`). No client, flag, or staging test exists.
- **P0 contract gaps (unverified, must audit first)**: claimed missing
  routes for research lists, email/files, subagent launch,
  contextSummary/compact/feedback; frontend approvals shape vs backend
  `approvalId`+`runId`.
- **P0 backend wording**: `build.md:143` says duplicate idempotency keys
  "reject"; code replays the first seq (one row). Behavior is tested;
  the wording is ambiguous.
- **P1 config**: compose backend env omits `KARDATA_PG_WORKER_MAX`
  (code falls back to 5 — correct but undocumented asymmetry).
- **P1 schema**: `documentation/db.md` schema section covers only 0001;
  migrations 0002–0006 undocumented. `attempt` (heartbeats) and
  `delivered_at` (outbox) columns exist with comments but no product
  code reads or writes them (verified by grep).
- **P1 verification blind spots**: DB/Temporal-gated skips without env,
  docker-only smoke, detached e2e, no coverage gate, promtool unwired
  into any command, timer-flaky suites (loopguards flaked once, passed
  on re-run).
- **P2 docs**: `documentation/vision.md`, `mcp.md`, `common.md`,
  `knowledge-base.md` referenced by README but missing; `backend.md`
  stale at B3.3; `deployment.md` stale; `architecture.md:179-186`
  duplicated block; silent-vs-explicit skip contradiction.
- **P2 lint**: barrel-only imports not enforced (only the `pg` ban is).

## Constraints And Non-goals

- No new backend features beyond contract gaps the frontend actually
  needs; no schema changes except the attempt/delivered_at decision.
- `vision.md` is owner-written (product scope) — plan creates the slot,
  not the content.
- No PgBouncer, no MCP server, no guesswork tuning (prior decisions stand).

## Key Decisions

1. **Contract audit before contract code**: slice A first reconciles
   frontend needs vs backend routes from inspected bodies; only
   confirmed gaps get built. Rejected: building the claimed routes
   blind — half the claims are unverified.
2. **Replay wording, not replay behavior**: one-row idempotent replay
   is the tested contract; fix `build.md:143` to say so. Rejected:
   changing code to reject — breaks exactly-once resumption.
3. **Dead columns need an owner ruling**: keep-and-document vs
   drop-via-migration. Default recommendation: keep, document as
   reserved (outbox claiming will need `delivered_at`; heartbeats may
   need `attempt`). Reversible; removal later is one migration.
4. **Docs: stub what the system needs, flag what the owner owes**:
   system-owned stubs (`mcp.md`, `common.md`, `knowledge-base.md`)
   in-slice; `vision.md` stays an explicit owner action item.

## Work Plan

1. **Contract audit (read-only)**: DONE. Chat half covered
   (sessions/threads/messages/send/steer/pause/resume/approve/runs).
   Confirmed gaps: (a) no artifact read route → built in slice 2
   (`GET /v1/sessions/{id}/artifacts`); (b) approvals UI-local
   (`ChatPanel.tsx:768`, numeric ids) vs backend `approvalId` — binding
   is client work in B6.1, no backend route needed; (c) Researches /
   SectorDetail / files / Dashboard pages and explicit subagent launch
   (`SubagentsPanel.tsx:178`) have no backend domain at all — owner
   decision required (model company/sector tables vs descope pages),
   not a route gap.
2. **Contract gaps**: implement confirmed missing routes/shapes behind
   existing auth + idempotency + layer rules; tests per route.
   Validate: new tests + full gates.
3. **Backend consistency**: fix build.md wording; document 0002–0006
   in db.md; attempt/delivered_at ruling + doc; add
   `KARDATA_PG_WORKER_MAX` to compose (or document the asymmetry);
   dedupe architecture block. Validate: grep proves no stale refs.
4. **Docs pass**: system stubs, backend.md/deployment.md refresh,
   README test-count correction, skip-policy reconciliation.
   Validate: link check (every referenced page exists).
5. **Verification hardening**: wire `promtool check/test rules` into
   an npm script; document gated-vs-skipped matrix; quarantine or fix
   timer-flaky suites. Validate: new script green, matrix in
   environments.md.
6. **Frontend unblock (B6.1 entry)**: DONE. `frontend/src/data/staging-api.ts`
   (typed client: sessions, threads, messages, artifacts, approve,
   fetch-reader SSE stream) + `tests/frontend/staging-api.test.ts`
   proven live against compose backend (3 passed). Mock-import ban
   deferred to per-page migration (mocks are the whole UI today; a ban
   now breaks the build). Incidental finds fixed: Dockerfile never
   shipped `agents/src` (backend image never booted — fixed, plus an
   `agents` build with dist entry points) and alpine can't load the
   Temporal bridge (runtime is Debian-slim now).

## Validation Plan

- Per slice: `npm run lint`, `npm run typecheck`,
  `TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1 npm run test
  --workspace @kardata/backend`, promtool script from slice 5 on.
- Slice 1 has no code; its evidence is the cited gap list.
- Highest-risk step: slice 2 scope control — audit output caps it;
  anything beyond the confirmed list is a new decision.

## Risks / Rollback

- Audit may shrink slice 2 to zero (frontend needs already covered) —
  that is success, not failure.
- Attempt/delivered_at removal, if chosen, needs a down-migration test
  like every other migration.
- Rollback per slice via `git revert`.

## Open Questions

- `attempt` / `delivered_at`: reserved or removable? (Recommendation:
  reserved; needs owner ruling only if removal preferred.)
- `vision.md` content and timing: owner action, blocks nothing technical.
