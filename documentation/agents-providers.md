# Agents providers

One provider interface, canonical in-memory shapes, per-provider wire
projection (T2.1). Adopted shapes: Pi normalized core plus the index-keyed
delta accumulator.

## Canonical shapes

- `ToolDefinition { name, description, parameters }`, `parameters` a JSON
  Schema object. Schemas burn input tokens every turn: keep the surface tight.
- `ToolCallRequest { id, name, args }`, `args` a plain object.
- `ToolResult { toolCallId, toolName, content, isError }`.
- `Usage` normalized across providers: input, output, cache read, cache write,
  cache hit, cache miss. Missing counters stay zero. Cost is computed by Karbot
  metering, never trusted from a vendor field.
- `ProviderResponse.completion` is optional `complete|incomplete`. Chat terminal
  finish reasons `stop`, `tool_calls` and legacy `function_call` prove complete;
  `length` and `content_filter` prove incomplete. Responses terminal status
  `completed` proves complete; `incomplete`, `failed` and `cancelled` prove
  incomplete. Missing, unfamiliar or still-running metadata remains unknown
  (field absent). Partial text, calls and usage stay preserved; completion does
  not authorize another paid call or claim that the answer is factually correct.
  Stream terminal metadata carries the same optional field through normalized
  response checkpoints and resume; socket EOF or a plain done frame alone never
  proves complete. Existing turn behavior is unchanged. File image publication
  requires explicit complete status under the separate PDF ingestion contract.
- Stream events: `text_delta`, `toolcall_start(index,key)`,
  `toolcall_delta(index,string-append)`, `toolcall_end(index,call)`, `done`.

## Rules

- `DeltaAccumulator` assembles parallel calls by index in ascending order;
  deltas for unknown indexes are ignored.
- Chat and Responses SSE adapters emit a terminal `done` event with parsed
  usage even when the provider ends by closing the socket instead of sending
  `[DONE]`. LF and CRLF frame separators stream incrementally.
- `FakeProvider` consumes scripted steps in order; exhaustion throws. Errors
  are retryable only when the step says so.
  Successful fixtures default to explicit complete generation; a step can script
  incomplete generation or null completion for unknown metadata. This is fixture
  behavior, not evidence of live Meta terminal metadata.

## Adapters

- Meta: Chat wire default, Responses wire in `responses` mode. Chat wire
  supports only `tool_choice: "auto"` (live-verified 400 otherwise), so the
  adapter clamps every choice to auto. Cache reads map from nested
  `prompt_tokens_details.cached_tokens` (live-verified shape).
  On Responses requests with a listed reasoning effort, the adapter requests
  `reasoning.summary: "auto"` and maps
  `response.reasoning_summary_text.delta` to canonical `reasoning_delta`.
  The provider's private raw reasoning is not exposed as readable text;
  summaries may be absent for simple turns. Meta Spark 1.3 and 1.3
  Contributor are live-verified on this path.
  Meta Responses likewise accepts only auto tool choice; the Meta adapter clamps
  that wire choice while preserving an empty tool list for image analysis. The
  generic Responses transport does not inherit this Meta-specific restriction.
- Generic OpenAI-compatible: Chat wire, config-only binding.
- HTTP mapping: 429 and 5xx are retryable `ProviderError`; anything else is
  fatal. Unparseable tool arguments fail loudly, never silently dropped.
- Input-token counting has a narrower availability contract. Its endpoint alone
  may throw typed `TokenCountUnavailableError` for404/405/501 or402 with exact
  error code `billing_not_configured`. Error JSON is bounded and only whitelisted
  code is classified; raw message/body is never logged. Other402/auth/429/503,
  malformed replies and transport failures remain errors,never zero counts or
  permission to guess exact usage. Generation still uses the same key/model.

## Routing (T2.5)

Units declare capability needs; the router binds the cheapest satisfying
route. Per-unit overrides are config-only and still must satisfy the unit,
or routing throws `NoSatisfyingRouteError`. Token buckets (RPM plus TPM)
refill against the injected clock. Fixtures in `src/fixtures/` are checked-in
cassettes replayed through injected fetch: zero network in CI unless live
probe keys are present (the live suite skips without them).

## Stub endpoint (T2.6)

`startStubEndpoint` serves scripted `json`, `sse`, and `flaky` (fail-once)
scenarios over real HTTP on loopback for integration tests. Record every
request for assertions. Close it in `afterEach`.

## Live probes (T10.4)

`npm run test:live --workspace=@kardata/agents` runs `src/probe.test.ts`.
The key comes from `agents/.env` (copy `.env.example`, gitignored) or
`KARDATA_META_KEY`, with optional model, base URL, and mode overrides.
The live suite skips without the key.
Each live case forces one tool call and reports latency plus usage counters;
findings are shapes and counters only, never key material. A bad key proves
the error path: 401 maps to non-retryable `ProviderError`.

## Backend conformance (B4.1)

The backend reaches providers only through `backend/src/providers/gateway.ts`
(Meta in the product, fake in tests; default Meta) and `providerChatActivity` in
`backend/src/temporal/activities/providers.ts`. Rules the backend adds on
top of the agents contract:

- Per-call log carries shapes and counters only (`provider`, `ok`,
  `latencyMs`, `usage`, error `code`): no prompt/response text, no key
  material. Failure detail stays on the workflow return value, never in
  logs or events.
- Every failure — adapter errors, timeouts, and misconfiguration (missing
  key or unsupported selection) — appends exactly one typed `t.provider.error` event
  (`provider`, `code`, `retryable`, `latencyMs`) to the session partition,
  so provider failures are never silent.
- 401-shaped errors map to `provider_unauthorized` (non-retryable even when
  the adapter says retryable); timeouts are `provider_timeout` (retryable);
  unknown transport errors default to retryable under Temporal's retry
  policy. The 401 sniff is substring-based; re-check it when an adapter
  rewords auth errors.
- The per-round provider-call budget (`timeoutMs` in
  `agents/src/turnRunner.ts`, default 60 s) is chosen per turn kind by
  `turnRoundTimeoutMs` in `backend/src/temporal/activities/turn.ts`:
  planning-grade turns (sectorPlan workflow `plan:*` runKeys and
  research-session turns) get 180 s (`PLANNING_ROUND_TIMEOUT_MS`);
  chat turns keep 60 s. File-summary and compaction calls use the
  same 180 s through `chatWithTimeout` in
  `backend/src/temporal/activities/context-files.ts`
  (`CONTEXT_FILE_CALL_TIMEOUT_MS`).
- `probeProvider` repeats the agents probe round trip (forced ping tool,
  usage counters) through the backend path; the live backend cases assert
  the same shape as the direct probe and skip without keys.
- The session-run turn cutover is intentionally pending: `runTurnActivity`
  stays scripted until a latency-preserving fake exists, because the B2.2
  cancel-mid-tool proof needs a real tool window to cancel inside.
