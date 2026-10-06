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

Hardening (2026-10-01): any supplied execution binding must validate fully;
invalid/partial bindings never downgrade to unbound access. Thread reads,
messages, file metadata and run controls validate scoped ownership. Run controls
require a run-reader capability on scoped contexts. Bound leaf agents cannot
delegate; raw sector-state writes cannot bypass the approved lifecycle;
conversation deletion and budget extensions require owner UI confirmation.
Unattributed fleet notifications are denied to scoped callers. Generated files
record their verified source thread. The HTTP/DB authority matrix is maintained
in `tests/backend/mcp.authority.test.ts`.

Plan lock (sector backend v1): `db.update_sector_plan` requires a
research-session main-thread execution; normal chats, research subagents
and Karbot get `permission_denied`. Palettes: the research parent sees
RESEARCH_TOOLS (SECTOR_TOOLS plus the plan writer), other sector chats
see SECTOR_TOOLS, Karbot sees PRODUCT_TOOLS. `planSectorResearch`
likewise requires the sector's bound research session.

Sector reads (sector backend v1): `db.get_sector_plan`,
`db.get_research_progress`, `db.list_sector_sessions` and
`db.read_sector_thread` are viewer tools on both SECTOR_TOOLS and
RESEARCH_TOOLS, so normal chats read the plan, progress, sibling chats
and subagent transcripts. The sector check still applies;
`db.read_sector_thread` is exempt from the local-conversation isolation
rule but stays denied to subagent actors reading siblings. The four
also ride PRODUCT_TOOLS for the stacking contract (sectorMcpClient sits
over productMcpClient); server-side workspace identity still denies
Karbot callers.

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
  caller (`<keyId>:<key>`), matching the HTTP wrapper. Context-change
  ids additionally namespace per sector
  (`<sectorId>:<keyId>:<key>`), so identical agent keys in different
  sectors never collide. Denied tool calls
  answer an MCP `isError` result carrying `permission_denied`, never a throw.

## Tools

`db.attach_sector_document` and the HTTP document-upload route share the existing
backend semantic attachment operation. PDF detection uses decoded bytes plus the
filename contract. PDFs require a file-processing runner capability and archive
on trusted tool context before any mutation, then retain original bytes and queue
the durable full-PDF job. Replies include current document status and the same
minimal `processing` progress as HTTP; queued is never described as indexed.
Text/image legacy ingestion remains unchanged. Missing runner/archive fails closed
before effects and is retry-safe; paid uncertain retries remain owner-only.
Validated execution context supplies source-thread provenance, never tool arguments;
it grants no research-parent, context-inclusion or owner-approval authority.

- 97 tools covering the binding table (rows bundle read/write pairs, so
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
  `db.ledger_list_problems`, plus Phase 5 Karbot parity: `ops.list_runs` /
  `ops.get_run` / `ops.thread_queue` / `ops.queue_remove` /
  `ops.queue_reorder`, `ops.list_alerts` / `ops.thread_health` /
  `ops.cost` / `ops.sector_evaluation` / `ops.recent_activity`,
  `ops.pause_run` / `ops.resume_run` / `ops.cancel_run`,
  `ops.spawn_subagent` / `ops.restart_sector_research`,
  `db.request_plan`, `ops.start_monitor` / `ops.stop_monitor` /
  `ops.list_monitors`, plus `db.delegate_subagent` (Karbot-only,
  operator: launches a leaf subagent researcher under the session's
  delegation parent; the retrieval seven and the delegate door bind to
  the retrieval modules and the runs gateway, not the db layer).
- Tool input schemas live in `backend/src/mcp/schemas.ts`, reusing the
  layer's exported zod schemas (`EventEnvelope`, `SectorState`,
  `CompanyStage`) and mirroring the layer's inline validation
  elsewhere. List and timeline tools (`db.list_companies`,
  `db.list_sector_companies`, `db.sector_activity`) take optional
  `limit` (1-500) and `offset` and answer `{ rows, total }` windows;
  unpaged calls return the first 100 with the full total, never a
  silent truncation. Results return as a single JSON text payload; layer
  `DbContractError`s answer `isError` with `validation_failed`, and
  unexpected failures answer `isError` `internal error` without detail.
- Proven by `tests/backend/mcp.tools.test.ts` (binding-table parity,
  schema/layer validation parity per tool, role floors, transport auth,
  idempotent replay; fake/di doubles only, no live keys).
- Monitor lifecycle: a tick skips while the Karbot thread runs a turn; a
  stopped row ends the workflow run; starting on a target whose active
  row passed `until` retires it instead of conflicting.

Thread-directory MCP reads return metadata and empty message arrays. A directory
lookup never hydrates parent, sibling or child local transcripts; conversation
reads retain their independent execution-scope authorization.

Authenticated scoped callers cannot invoke global event-log, projection, key,
quota, heartbeat or exactly-once plumbing, even with the approver role. Those
bindings remain internal test/embedding interfaces; they are not product
capabilities. Product monitoring uses authorized semantic health/read tools.
Artifact imports validate both source and destination scope; unattributed task
files fail closed for scoped callers.

General Karbot executions read their own local context without a sector binding;
`db.get_local_context` still accepts no caller-selected thread and requires
validated execution context. `db.get_global_context` accepts optional `sectorId`:
a general chat/keyed human selects an authorized sector explicitly, while sector
executions remain pinned to their binding. Approved sections are readable;
proposal visibility remains source-thread/research-parent-only. Cross-tenant reads
remain denied and no owner approval or research authority is granted by arguments.

Phase 5 sector scope: `db.get_research_progress`, `db.get_sector_plan`,
`db.list_sector_sessions`, `db.read_sector_thread` and
`db.propose_global_context` take optional `sectorId` (required outside a
sector session, must match inside; Karbot proposals stay pending-only).
Karbot's palette holds every new tool; `SECTOR_TOOLS` gets sector-bound
reads, health/cost/alerts and spawn; `RESEARCH_TOOLS` adds plan update;
children keep restrictions. OpenAPI→MCP parity is scripted:
`scripts/mcp-parity.mjs` writes `docs/mcp-parity.md` (owner-only =
protected approvals or binary downloads). `db.request_plan` sends an
instruction to the research session; Karbot never writes the plan.

### MCP operation replay authority

Execution bindings and tool grants are validated before any replay lookup.
Read tools execute afresh so revoked visibility and current context are checked.
Mutation identity excludes the transient JSON-RPC ID and includes caller role,
scope, validated execution thread and grant. A replay preserves the completed
mutation but responds with the current RPC ID. Authority changes conflict rather
than replaying a privileged result. Old records without this authority identity
are not silently trusted; their conflicts require reconciliation before retrying
an uncertain mutation. This remains a rollout compatibility gate.

General-chat children also retain own-thread/parent-session isolation. They
cannot read or control a parent conversation merely because the parent has no
sector binding. Human UI inspection and general Karbot parent monitoring remain
separate authorized paths.

Only server-typed missing-runner preconditions are marked retry-safe before
an effect. Those failures release their replay guard so the same operation can
recover after configuration returns. Ordinary/uncertain mutation errors remain
recorded and are not blindly re-executed. Children cannot rename parent sessions.

The internal outbox subscription tool rejects a supervised connection failure
instead of returning a healthy timeout. Its wait timer is cleared on failure;
lease cleanup shares the subscription's single close result. It remains excluded
from scoped product palettes; no new agent authority is granted.

`web_fetch` now shares its existing15-second deadline across headers, redirect hops
and streamed body consumption. It rejects above2 MiB before buffering the rest,
cancels blocked/error/late bodies, and returns the actual final fetched URL.
Redirects are manual (maximum five) with URL checks before each request. Operational
fetch logs contain operation/code/latency, not body or credential-bearing URLs.
Resolved-DNS pinning and guarded browser transport now complement these bounds;
see `documentation/backend.md`. Shared rollout and Meta acceptance remain open.

Browser tool ownership is server-derived from scope, key and validated execution
thread. All five browser tools carry that identity through the pool facade; session
IDs are opaque UUIDs, not authority. Foreign-owner operations fail with `blocked`
before browser access, including close. The existing tool schemas and role floors
are unchanged. Browser destinations use the public-only guarded proxy described below; shared
rollout still requires compatibility and live acceptance.

Conversation `sessionId` guards apply only to DB product tools. Browser tools use
their own session namespace and execution-derived ownership, so a validated child
or sector parent can operate its own browser without treating its ID as a product
conversation. Initial browser navigation shares the fetch literal-address policy;
The guarded proxy applies admission and pinned connections to subsequent browser
requests too, including frames and popups; isolated Chromium tests cover these
paths, not the eventual Meta campaign.

Production web_fetch now pins each HTTP(S) connection to an admitted DNS address,
rejecting mixed/private/empty resolutions before transport. Redirects resolve and
validate independently. Source cancellation, byte caps and decoding retain the
existing tool surface. Browser requests use the authenticated public-web proxy on the existing backend
listener. See backend/deployment contracts and explicit test evidence.

Browser proxy credentials derive from validated execution code and never appear
in tool arguments/results. They authorize public-web transport only, not product
API operations. Browser contexts fail closed without an authenticated configured
proxy or required Chromium flags. Existing role/thread/sector grants still govern
tools. Internal proxy transport is not an advertised MCP capability.

### Uncertain operation recovery contract

Advertised read-only annotations derive from the server capability registry, not
model arguments. A server-proven pre-dispatch failure is retry-safe; an uncertain
mutation result/transport failure parks the original operation before another
provider round. Recovery retries retain the same logical tool call identity and
arguments; they never create a fresh operation to bypass its guard. Long internal
identities are deterministically hashed to the existing128-character header cap.

Unresolved operations remain durable independently of compaction. Resume retries
the original operation and can reuse its verified completed reply; pending,
authority-conflicting or legacy-unprovable effects remain parked for owner review.
Owner inspection/reconciliation is scoped and cannot grant agent approval,
release an uncertain effect blindly or expose another thread/sector's records.
Legacy records are reconciled only with exact request/result and current authority
proof; otherwise explicit parking is the compatible outcome, not silent trust.

Bound mutation calls record an intent and a successful transport result in the
existing event log under the validated execution thread. Receipts bind caller
key, request fingerprint and operation identity. The result is recorded before
the response-cache completion, so an identical authorized retry can repair that
specific failure window without re-running the tool. Tool errors, absent results
and legacy claims never prove success. A viewer can inspect receipts only through
the owning thread; inspection omits arguments and reply bodies. Inspection does
not release claims. Unproven effects remain explicitly blocked for investigation.

Receipt-based cache repair accepts only the same-fingerprint in-progress claim;
different-request conflicts remain409. Completion and pre-dispatch release use
fingerprint/state compare-and-swap. Retained receipts therefore cannot overwrite
a newer request's guard after response-cache retention.

File read/query and indexed artifact reads record exposure receipts before returning
content to a bound agent. Derived global edits require owner review of exact
file/version/unit dependencies, even when the research parent omits fileRef.
Owner review renders these dependencies and source units. Hidden/version-changed
sources are denied again on approval and on all subsequent agent context reads;
owner historical inspection retains its stored evidence.

An owner safe rebuild preserves original operation metadata but deliberately
excludes covered historical messages and pre-rebuild outbox frames from subsequent
agent reads. Owner transcript/history APIs remain immutable. Hidden-source tool
arguments in unresolved operations prevent rebuild until their original effects
or sources can be safely reconciled; rebuild never removes their authority guard.
