# MCP

Agent tool boundary (built, Phase 2). The server lives in
`backend/src/mcp/` and mounts at `POST /mcp` on the Fastify app:
Streamable HTTP via `@modelcontextprotocol/server` (stateless, one
exchange per request, JSON responses), guarded by the existing API-key
auth before any JSON-RPC dispatch.

Rules in force:

- Tools wrap `backend/src/db/` layer functions one-to-one (see the MCP
  binding table in `documentation/db.md`). The server adds auth,
  transport, and tool schemas — never SQL.
- `publishOutboxFrame` and `runCheckpointTx` stay projector-only and
  never become tools.
- Tool schemas generate from the layer zod schemas so docs and runtime
  cannot drift; a test pins the match.
- Agents never receive database credentials (see `AGENTS.md`).

## Transport

- One stateless exchange per `POST /mcp` (`WebStandardStreamableHTTPServerTransport`
  with `sessionIdGenerator: undefined`, `enableJsonResponse: true`): a
  fresh `McpServer` is built per request, closing over the request's
  pool, scope, and role. No sessions, no SSE streams, no retained state.
- The request body passes through as raw JSON-RPC; `Idempotency-Key` is
  honored exactly like other mutations (identical retries replay the
  first response byte-identical, key reuse for a different request is
  409). Without a pool the route fails closed with 503 `overload`;
  without a JSON body it answers 400 `validation_failed`.
- Spec: `POST /mcp` (`operationId: mcpRpc`) in `backend/openapi/v1.yaml`.

## Auth

- Keyed mode resolves the caller with the shared `resolveCaller` gate
  (absent/unknown/under-viewer callers 403 `permission_denied`) and
  binds the tenant/project scope plus role into every tool call. Open
  mode (no `auth` flag) stays open and unscoped, as with the v1 routes.
- Each tool names a role floor: reads take `viewer`, writes plus the
  projector/plumbing tools take `operator`, except `db.find_key` and
  `db.project_batch`, which take `approver` (key material and raw
  projection writes stay top-tier). `db.append_event` refuses
  `t.approval.*` types at every role — verdicts flow only through
  `POST /v1/commands/approve`. Idempotency tools namespace keys per
  caller (`<keyId>:<key>`), matching the HTTP wrapper. Denied tool calls
  answer an MCP `isError` result carrying `permission_denied`, never a throw.

## Tools

- 64 tools covering the binding table (rows bundle read/write pairs, so
  tools outnumber rows): `db.append_event`,
  `db.read_partition`, `db.find_event`, `db.read_events_after`,
  `db.create_session`, `db.rename_session` / `db.delete_session`, `db.get_session` / `db.list_sessions`,
  `db.list_sectors` / `db.get_sector`, `db.list_companies` /
  `db.list_sector_companies`, `db.sector_activity`, `db.create_sector`,
  `db.attach_sector_document` / `db.list_sector_documents`,
  `db.set_sector_state`, `db.mark_company_found`, `db.set_company_stage` /
  `db.set_company_state`, `db.list_artifacts`, `db.reference_artifact`,
  `db.resolve_artifact_scope`, `db.list_tenant_artifacts`,
  `db.find_launch_parent`, `db.get_thread` / `db.list_threads`,
  `db.pause_run` / `db.resume_run` / `db.cancel_run`,
  `db.project_batch`, `db.record_heartbeat` / `db.list_heartbeats`,
  `db.read_outbox` (backlog frames plus latest seq),
  `db.subscribe_outbox` (waits once for the next notification, then
  closes), `db.project_usage` / `db.run_totals` / `db.fleet_totals`,
  `db.find_key`, `db.check_rate`, `db.claim_idempotency` /
  `db.complete_idempotency` / `db.release_idempotency`, `db.kb_search`,
  `db.ledger_upsert_company` / `db.ledger_get_company` /
  `db.ledger_list_companies`, `db.ledger_record_problem` /
  `db.ledger_list_problems`.
- Tool input schemas live in `backend/src/mcp/schemas.ts`, reusing the
  layer's exported zod schemas (`EventEnvelope`, `SectorState`,
  `CompanyStage`) and mirroring the layer's inline validation
  elsewhere. Results return as a single JSON text payload; layer
  `DbContractError`s answer `isError` with `validation_failed`, and
  unexpected failures answer `isError` `internal error` without detail.
- Proven by `tests/backend/mcp.tools.test.ts` (binding-table parity,
  schema/layer validation parity per tool, role floors, transport auth,
  idempotent replay; fake/di doubles only, no live keys).
