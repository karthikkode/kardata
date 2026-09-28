# Deep-check baseline catalogue (Phase 0)

Generated from code inspection, 2026-09-28. Ground truth for all deep-check phases.
Normative expectations: `docs/expectations.md`. Repo rules: `AGENTS.md`.

## 1. Logging / observability layer

Files: `backend/src/observability/logging.ts` (createLogger, childLogger,
createWorkerLogger, scrubSecrets), `requestLog.ts`, `stalls.ts`
(DEFAULT_STALL_THRESHOLDS, stalledTurnsFor, sweepStalls), `trace.ts`,
`tracing.ts`, `metrics.ts`. Agents side: `agents/src/metrics.ts`.

Tests: `tests/backend/logging.test.ts`, `observability.logs.test.ts`,
`observability.stall.test.ts`, `observability.traces.test.ts`,
`observability.boards.test.ts`.

## 2. DB layer

Files (`backend/src/db`, 22 modules): checkpoints (runCheckpointTx), events
(appendEvent, findEventByKey, readPartition, 681 lines — event backbone),
index (sessions CRUD, setSessionModel), threads (378 lines), sectors
(623 lines), sector-context, sector-documents, sector-start, file-pipeline
(321 lines, classifyUpload, chunkTextUnits, extractFileUnits), document-units,
kb-ingest (runKbIngest), knowledge (searchKb), ledger + company-ledger
(recordLedgerProblem, rebuildLedger), outbox (readOutboxBacklog,
publishOutboxFrame, subscribeOutbox), pool (createDbPool, serverPoolBudget,
workerPoolBudget, poolStats), quotas, heartbeats (recordHeartbeat,
pruneHeartbeats), keys, migrate, errors, cli.

Tests: `db.contract`, `db.migrations`, `db.pool`, `db.sectors`,
`db.artifacts`, `db.document-units`, `db.knowledge`, `events.append`,
`sector-start`, `sector-context`, `sector-documents`, `file-pipeline`,
`ledger`, `retention`, `retrieval`, `archive.targets`, `soak.harness`
(+ `soak.report.md`).

## 3. Backend layer

Routes (`backend/src/routes`): artifacts, commands, http (envelopes), inspector,
providers, runs, sectors (387 lines — largest), sessions, skills, threads.
Contract: `backend/openapi/v1.yaml`, `backend/src/contract.ts`.
Temporal: `workflows/` (research, run, subagents, sweep, loopguards),
`activities/` (research, turn, tools, sweep, stalls, loopguards, providers),
`worker.ts`, `gateway.ts`, `lanes.ts`, `timeouts.ts`, `guards.ts`,
`sweep-rules.ts`. Providers: `catalog.ts`, `gateway.ts`, `registry.ts`.

Tests: `api.*` (artifacts, auth, cors, idempotency, inspector, live, rest,
sector-context, sectors, session-model, session-sector, sse),
`workflows.*` (research, run, subagents, sweep, loopguards),
`temporal.*` (cancel, heartbeats, lanes, session-start, timeouts),
`providers.*`, `sweep.*`, `loopguards.*`, `tools.activities`,
`contract`, `compose.smoke`, `karbot.turn`, `skills.slash`,
`no-hardcoded-staging`.

Known-red at last status: `api.sector-context` / `db.document-units`
extraction and test-projection paths (6 failures, untouched paths).

## 4. MCP layer

Files: `backend/src/mcp/tools.ts` (489 lines — TOOL_LAYER, toolCapability,
TOOL_META, McpToolError, invokeTool, createMcpServer), `schemas.ts`
(255 lines), `routes.ts` (80 lines). Role gating via roleAtLeast.

Tests: `tests/backend/mcp.tools.test.ts`.

## 5. Agents layer

Files (`agents/src`): loop, turn, turnRunner, subagents (SubagentManager),
supervision (SupervisorFinding, decide, AuditLog), research
(runResearchWorkflow), planning, router, queue, budgets, clock, condense,
context, domain, epochs, gates, manifest, meta, metrics, openai-compat,
preflight, probe, prompt, providers, replay, responses, skills, stub, tasks,
tools, transcript, transport. Test coverage per module is broad
(`subagents`, `supervision`, `research.*`, `budgets`, `chaos`, `soak`,
`context`, `domain`, `epochs`, `fake`, `gates`, `index`, `loop`,
`manifest`, `planning`, `probe`, `prompt`, `router`, `skills`, `stub`,
`tools`, `transcript`, `turnRunner` test files).

## 6. Frontend (rescue track)

Components (`frontend/src/components`, 16 files): ChatPanel, chat-parts,
SectorChatPanel, SectorDetailPage, SectorContextDrawer, ModelToolbar,
Dashboard, ResearchesPage, research-parts, RunsPanel, SubagentsPanel,
ModelsPanel, Sidebar, TopBar, StatusPill, Markdown, ui/ primitives.
Data via `frontend/src/data` (StagingApi). Tests: `tests/frontend`
(approval, Button, chat-parts, chat-staging, Dashboard, FilesMenu,
follow-resume, markdown, SectorChatPanel, SectorContextDrawer,
SectorDetailPage, karbot.turn, ...), `tests/frontend-e2e`.

Flagged defect: sector chat thinking indicator runs ~3000s after response
arrived — FIXED 2026-09-28 (send loop breaks on the fresh terminal agent
message; held-open-stream regression test).
Visual matrix: `tests/frontend-e2e/visual.spec.ts` (overview, researches,
sector detail, chat picker; assert-then-capture PNGs to
`test-results/visual`). Full e2e 8/8 green. Note: e2e specs sit outside any
eslint gate (no shared config covers `tests/frontend-e2e`) — lint gap to
close when the quality gate expands.
