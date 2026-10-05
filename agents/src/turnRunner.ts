import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
// Karbot turn runner (Phase 3). Library only: no credentials, no database,
// no environment reads. The caller injects a provider adapter, an MCP tool
// client, and a delta sink; this unit runs the streamed tool loop and
// returns the terminal reply. Unit-provable with FakeProvider plus
// in-memory MCP/sink doubles (see turnRunner.test.ts).
import {
  BudgetTracker,
  fingerprintAction,
  RepetitionTracker,
  type RepeatVerdict,
  type TrippedBudget,
} from './budgets.js'
import { condense, type SummaryArtifact } from './condense.js'
import {
  assembleContext,
  createSnapshot,
  estimateMessagesTokens,
  estimateTokens,
  type ContextSnapshot,
} from './context.js'
import {
  DeltaAccumulator,
  emptyUsage,
  type ChatMessage,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
  type ToolCallRequest,
  type ToolDefinition,
  type Usage,
} from './providers.js'
import { HttpError, defaultFetchFn, postWithDeadline, type McpFetchFn } from './http.js'

export interface McpToolOutcome { content: string; isError?: boolean; recovery?: { operationId: string; reason: string; authorityId?: string } }
export interface RecoveryOperation {
  serializedCall?: string
  authorityId?: string
  operationId: string
  call: ToolCallRequest
  reason: string
}
export class OperationRecoveryError extends Error {
  readonly code = 'operation_uncertain'
  constructor(readonly operations: RecoveryOperation[]) {
    super('A tool operation has an uncertain outcome. Inspect its receipt before resuming; a new operation must not bypass it.')
    this.name = 'OperationRecoveryError'
  }
}
export function toolOperationId(operationKey: string, callId: string): string {
  const identity = `${operationKey}:${callId}`
  return identity.length <= 128 && /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(identity) ? identity : `op:${createHash('sha256').update(identity).digest('hex')}`
}

/** Tool client behind one turn. The Streamable HTTP implementation below
 * speaks MCP over an injected endpoint+token; tests inject a memory double. */
export interface TurnRunnerMcpClient {
  readonly authorityId?: string
  listTools(): Promise<ToolDefinition[]>
  callTool(name: string, args: Record<string, unknown>, operationId?: string): Promise<McpToolOutcome>
}

/** Delta sink: one call per streamed text delta, in stream order. The
 * backend activity wires this to ephemeral outbox frames. */
export interface TurnRunnerSink {
  onDelta(text: string, round: number): void | Promise<void>
  /** Thinking trace deltas (providers that stream reasoning). Optional:
   * runners without a thinking surface omit it and the trace still lands
   * on the terminal result. */
  onReasoning?(text: string, round: number): void | Promise<void>
  /** Emitted when a provider starts a tool call, when its name becomes
   * known, and after MCP settles. Never carries arguments or results. */
  onTool?(id: string, name: string, state: 'running' | 'done' | 'failed', round: number): void | Promise<void>
}

export interface PendingProviderResponse {
  round: number
  response: { text: string; reasoning: string; toolCalls: ToolCallRequest[]; usage: Usage; completion?: ProviderResponse['completion'] }
  metadata?: Record<string, unknown>
}

export interface KarbotTurnOptions {
  operationKey?: string
  maxOutputTokens?: number
  signal?: AbortSignal
  /** Persistence boundaries: inputs contain no transport credentials/signals.
   * Request persistence settles before provider execution; response persistence
   * settles before tool dispatch or another round. */
  onProviderRequest?(round: number, request: Omit<ProviderRequest, 'signal'>): Promise<void>
  onProviderResponse?(round: number, response: PendingProviderResponse['response'], metadata?: Record<string, unknown>): Promise<void>
  onToolResult?(round: number, call: ToolCallRequest, outcome: McpToolOutcome, operationId?: string): Promise<void>
  beforeRound?(round: number, context: { systemPrompt: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<{ systemPrompt?: string; messages?: ChatMessage[] }>
  onCheckpoint?(messages: ChatMessage[], round: number, usage: Usage, toolCalls: number, blockedOperations?: RecoveryOperation[], pendingResponse?: PendingProviderResponse): Promise<void>
  resume?: { round: number; usage: Usage; toolCalls: number; blockedOperations?: RecoveryOperation[]; pendingResponse?: PendingProviderResponse }
  provider: ProviderAdapter
  mcp: TurnRunnerMcpClient
  sink: TurnRunnerSink
  systemPrompt: string
  messages: ChatMessage[]
  toolChoice?: ProviderRequest['toolChoice']
  /** Reasoning depth for providers that accept it. The caller sets this
   * only from a catalog-listed level, never invented. */
  reasoningEffort?: string
  /** Sampling temperature 0..2, forwarded into the provider request.
   * Validated here so an out-of-range value fails before any provider
   * call. Undefined means the provider default. */
  temperature?: number
  /** Model/tool round trips before returning the last text. Default 5. */
  maxTurns?: number
  /** Per-provider-call budget in ms. Default 60_000. */
  timeoutMs?: number
  /** Context harness: budgets, repetition screening, per-round snapshots,
   * and pre-round condensation. All optional; absent means the legacy
   * behavior (round cap and timeout only). */
  harness?: KarbotHarness
}

/** Versions stamped into every context snapshot. Tool versions come from
 * the MCP tool list or skill registry; prompt/policy from the server. */
export interface TurnSnapshotVersions {
  tools: Record<string, string>
  prompt: string
  policy: string
}

export interface CondenseHarness {
  maxSize: number
  keepFirst: number
  /** Estimated-token cap: condense when history exceeds it even when the
   * message count is small (one huge tool result). */
  tokenCap?: number
  summarize: (forgotten: ChatMessage[]) => Promise<string>
  summarizer?: string
  onCondense?: (summary: SummaryArtifact) => void
}

export interface KarbotHarness {
  budgets?: BudgetTracker
  repetition?: RepetitionTracker
  /** Per-million-token prices for computed cost accounting. Absent means
   * tokens are tracked but cost is not. */
  prices?: { inputPricePerMTok: number; outputPricePerMTok: number }
  /** Snapshot versions; providing them enables per-round snapshots. */
  versions?: TurnSnapshotVersions
  onSnapshot?: (snapshot: ContextSnapshot) => void
  condense?: CondenseHarness
}

export interface KarbotTurnResult {
  toolOutcomes: Array<{ id: string; name: string; state: 'done' | 'failed' }>
  text: string
  /** Provider thinking trace, empty when the provider sends none. */
  reasoning: string
  toolCalls: ToolCallRequest[]
  usage: Usage
  turns: number
  /** Set when the turn stopped before exhausting maxTurns on a budget. */
  budgetTripped?: TrippedBudget[]
  /** Set when the turn stopped on a repeat-tool loop. */
  repetitionHalt?: { verdict: Extract<RepeatVerdict, 'replan' | 'blocked'>; fingerprint: string }
  /** Summaries produced by pre-round condensation, oldest first. */
  condensed?: SummaryArtifact[]
  recoveryHalt?: RecoveryOperation[]
}

const DEFAULT_MAX_TURNS = 5
const MAX_MAX_TURNS = 10
const DEFAULT_TIMEOUT_MS = 60_000

/** Timeout-race sentinel: identity-compared, never a real error. */
const TURN_TIMEOUT_MESSAGE = 'Provider round timed out; the request was cancelled.'

function checkedOptions(options: KarbotTurnOptions): Required<Pick<KarbotTurnOptions, 'maxTurns' | 'timeoutMs'>> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_MAX_TURNS) {
    throw new RangeError(`maxTurns must be an integer 1..${MAX_MAX_TURNS}`)
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('timeoutMs must be a positive integer')
  }
  if (typeof options.systemPrompt !== 'string') throw new TypeError('systemPrompt must be a string')
  if (!Array.isArray(options.messages)) throw new TypeError('messages must be an array')
  if (options.temperature !== undefined && !(options.temperature >= 0 && options.temperature <= 2)) {
    throw new RangeError('temperature must be a number 0..2')
  }
  return { maxTurns, timeoutMs }
}

function addUsage(total: Usage, part: Usage): void {
  total.inputTokens += part.inputTokens
  total.outputTokens += part.outputTokens
  total.cacheReadTokens += part.cacheReadTokens
  total.cacheWriteTokens += part.cacheWriteTokens
  total.cacheHitTokens += part.cacheHitTokens
  total.cacheMissTokens += part.cacheMissTokens
}

/** Runs one Karbot turn: stream the model, forward every text delta to the
 * sink, execute tool calls through the MCP client, and repeat until the
 * model replies with no tool calls or maxTurns is exhausted. Tool failures
 * (including MCP transport failures surfaced as error results) become tool
 * messages — never exceptions — so the model sees its own errors. */
export async function runKarbotTurn(options: KarbotTurnOptions): Promise<KarbotTurnResult> {
  const { maxTurns, timeoutMs } = checkedOptions(options)
  let history: ChatMessage[] = [...options.messages]
  let systemPrompt = options.systemPrompt
  const tools = await options.mcp.listTools()
  const toolChoice = options.toolChoice ?? { mode: 'auto' }
  const usage = options.resume ? { ...options.resume.usage } : emptyUsage()
  const executed: ToolCallRequest[] = []
  const toolOutcomes: KarbotTurnResult['toolOutcomes'] = []
  const condensed: SummaryArtifact[] = []
  const harness = options.harness
  let text = ''
  let reasoning = ''
  let turns = 0
  let parentHash: string | undefined
  let budgetTripped: TrippedBudget[] | undefined
  let repetitionHalt: KarbotTurnResult['repetitionHalt']
  let completed = false
  const recoveryHalt: RecoveryOperation[] = []

  if (options.resume && harness?.budgets) {
    for (let index = 0; index < options.resume.round; index++) harness.budgets.noteTurn(true)
    for (let index = 0; index < options.resume.toolCalls; index++) harness.budgets.noteToolCall()
    harness.budgets.noteTokens(usage.inputTokens + usage.outputTokens)
  }
  const preparedOperations = (calls: ToolCallRequest[]): RecoveryOperation[] => options.operationKey ? calls.map((call) => ({ authorityId: options.mcp.authorityId, operationId: toolOperationId(options.operationKey!, call.id), call, serializedCall: JSON.stringify(call), reason: 'Execution was prepared; its result has not yet been durably confirmed.' })) : []
  const dispatchTool = async (call: ToolCallRequest, round: number, replayId?: string) => {
    options.signal?.throwIfAborted()
    let outcome: McpToolOutcome
    try {
      outcome = await options.mcp.callTool(call.name, call.args, replayId ?? (options.operationKey ? toolOperationId(options.operationKey, call.id) : undefined))
    } catch (error) {
      options.signal?.throwIfAborted()
      const operationId = replayId ?? (options.operationKey ? toolOperationId(options.operationKey, call.id) : undefined)
      outcome = { content: error instanceof Error ? error.message.slice(0, 500) : 'mcp tool call failed', isError: true, ...(operationId ? { recovery: { operationId, authorityId: options.mcp.authorityId, reason: 'The tool client failed without confirming whether the operation took effect.' } } : {}) }
    }
    options.signal?.throwIfAborted()
    await options.onToolResult?.(round, call, outcome, replayId ?? (options.operationKey ? toolOperationId(options.operationKey, call.id) : undefined))
    await options.sink.onTool?.(call.id, call.name, outcome.isError ? 'failed' : 'done', round)
    return outcome
  }
  if (options.resume?.pendingResponse) {
    const pending = options.resume.pendingResponse
    await options.onProviderResponse?.(pending.round, structuredClone(pending.response), pending.metadata)
    text = pending.response.text
    reasoning = pending.response.reasoning
    turns = pending.round
    if (!history.some((message) => message.role === 'assistant' && message.text === text && JSON.stringify(message.toolCalls ?? []) === JSON.stringify(pending.response.toolCalls))) history.push({ role: 'assistant', text, ...(pending.response.toolCalls.length ? { toolCalls: pending.response.toolCalls } : {}) })
    if (pending.response.toolCalls.length) await options.onCheckpoint?.(history, pending.round, usage, options.resume.toolCalls, options.resume.blockedOperations)
    if (!pending.response.toolCalls.length) completed = true
  }
  // Recovery is durable metadata, independent of history compaction. Retry only
  // the original call/id before allowing the model to issue another operation.
  for (const original of options.resume?.blockedOperations ?? []) {
    let operation = original
    if (original.serializedCall !== undefined) {
      let restored: ToolCallRequest
      try { restored = JSON.parse(original.serializedCall) as ToolCallRequest } catch { recoveryHalt.push({ ...original, reason: 'The original serialized tool call is invalid. Owner review is required.' }); continue }
      if (!isDeepStrictEqual(restored, original.call)) { recoveryHalt.push({ ...original, reason: 'The original tool-call receipt conflicts with its preserved arguments. Owner review is required.' }); continue }
      operation = { ...original, call: restored }
    }
    if (options.mcp.authorityId !== undefined && operation.authorityId !== options.mcp.authorityId) { recoveryHalt.push({ ...operation, reason: 'The original execution authority is unavailable or changed.' }); continue }
    await options.sink.onTool?.(operation.call.id, operation.call.name, 'running', options.resume?.round ?? 0)
    const result = await dispatchTool(operation.call, options.resume?.round ?? 0, operation.operationId)
    const toolResult = { toolCallId: operation.call.id, toolName: operation.call.name, content: result.content, isError: result.isError ?? false }
    const index = history.findIndex((message) => message.role === 'tool' && message.toolResult?.toolCallId === operation.call.id)
    if (index >= 0) history[index] = { role: 'tool', toolResult }
    else if (history.some((message) => message.role === 'assistant' && message.toolCalls?.some((call) => call.id === operation.call.id))) history.push({ role: 'tool', toolResult })
    else history.push({ role: 'assistant', toolCalls: [operation.call] }, { role: 'tool', toolResult })
    if (result.recovery || result.isError) recoveryHalt.push({ ...operation, reason: result.recovery?.reason ?? 'This retry failed; the original effect is still unconfirmed.' })
  }
  if (options.resume?.blockedOperations?.length) await options.onCheckpoint?.(history, options.resume.round, usage, options.resume.toolCalls, recoveryHalt)
  const pending = history.at(-1)
  const previousToolCalls = Math.max(0, (options.resume?.toolCalls ?? 0) - (pending?.role === 'assistant' ? pending.toolCalls?.length ?? 0 : 0))
  if (recoveryHalt.length === 0 && pending?.role === 'assistant' && pending.toolCalls?.length) {
    await options.onCheckpoint?.(history, options.resume?.round ?? 0, usage, previousToolCalls + pending.toolCalls.length, preparedOperations(pending.toolCalls))
    for (const call of pending.toolCalls) {
      options.signal?.throwIfAborted()
      await options.sink.onTool?.(call.id, call.name, 'running', options.resume?.round ?? 0)
      const result = await dispatchTool(call, options.resume?.round ?? 0)
      history.push({ role: 'tool', toolResult: { toolCallId: call.id, toolName: call.name, content: result.content, isError: result.isError ?? false } })
      executed.push(call)
      if (result.recovery) recoveryHalt.push({ authorityId: result.recovery.authorityId, operationId: result.recovery.operationId, call, serializedCall: JSON.stringify(call), reason: result.recovery.reason })
      toolOutcomes.push({ id: call.id, name: call.name, state: result.isError ? 'failed' : 'done' })
    }
    await options.onCheckpoint?.(history, options.resume?.round ?? 0, usage, previousToolCalls + executed.length, recoveryHalt)
  }
  for (let turn = (options.resume?.round ?? 0) + 1; turn <= maxTurns && recoveryHalt.length === 0 && !completed; turn += 1) {
    options.signal?.throwIfAborted()
    turns = turn
    const refreshed = await options.beforeRound?.(turn, { systemPrompt, messages: history, tools })
    if (refreshed?.systemPrompt !== undefined) systemPrompt = refreshed.systemPrompt
    if (refreshed?.messages !== undefined) history = refreshed.messages
    // Budget gate: a tripped budget halts before any provider call, so a
    // runaway turn cannot spend one more token.
    if (harness?.budgets) {
      const tripped = harness.budgets.tripped()
      if (tripped.length > 0) {
        budgetTripped = tripped
        break
      }
    }
    // Pre-round condensation: forget the middle span before the provider
    // sees it, keeping the pinned head and recent tail plus a linked
    // summary. History is append-only everywhere else; this projection is
    // the single sanctioned rewrite.
    if (harness?.condense) {
      const spec = harness.condense
      const tokenCap = spec.tokenCap
      const overTokens =
        tokenCap !== undefined &&
        estimateTokens(systemPrompt) + estimateMessagesTokens(history) > tokenCap
      if (history.length > spec.maxSize || overTokens) {
        const outcome = await condense({
          messages: history,
          keepFirst: spec.keepFirst,
          maxSize: spec.maxSize,
          tokenCount: estimateTokens(systemPrompt) + estimateMessagesTokens(history),
          tokenCap,
          summarize: spec.summarize,
          summarizer: spec.summarizer,
        })
        if (outcome.needed) {
          history = outcome.view
          condensed.push(outcome.summary)
          await harness.condense.onCondense?.(outcome.summary)
        }
      }
    }
    // Context snapshot: canonical bytes of exactly this round's request,
    // hash-chained to the previous round for lineage and rehydration.
    if (harness?.versions && harness.onSnapshot) {
      const request = assembleContext({
        system: [systemPrompt],
        tools,
        references: [],
        history,
        tail: [],
      })
      const snapshot = createSnapshot(
        request,
        { tools: { ...harness.versions.tools }, prompt: harness.versions.prompt, policy: harness.versions.policy },
        parentHash,
      )
      parentHash = snapshot.hash
      await harness.onSnapshot(snapshot)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const providerRequest: Omit<ProviderRequest, 'signal'> = {
      systemPrompt, messages: structuredClone(history), tools: structuredClone(tools), toolChoice,
      ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    }
    await options.onProviderRequest?.(turn, structuredClone(providerRequest))
    options.signal?.throwIfAborted()
    const roundController = new AbortController()
    const roundSignal = options.signal ? AbortSignal.any([options.signal, roundController.signal]) : roundController.signal
    let streamClosed = false
    let onAbort: (() => void) | undefined
    try {
      const streamed = await Promise.race([
        (async () => {
          let replyText = ''
          let reasoningText = ''
          const calls = new DeltaAccumulator()
          let turnUsage: Usage = emptyUsage()
          let completion: ProviderResponse['completion']
          for await (const event of options.provider.chatStream({
            ...providerRequest,
            signal: roundSignal,
          })) {
            if (streamClosed || roundSignal.aborted) break
            if (event.kind === 'text_delta') {
              replyText += event.text
              await options.sink.onDelta(event.text, turn)
            } else if (event.kind === 'reasoning_delta') {
              reasoningText += event.text
              await options.sink.onReasoning?.(event.text, turn)
            } else if (event.kind === 'toolcall_start') {
              await options.sink.onTool?.(event.key, 'Tool call', 'running', turn)
              calls.push(event)
            } else if (event.kind === 'toolcall_end') {
              await options.sink.onTool?.(event.call.id, event.call.name, 'running', turn)
              calls.push(event)
            } else if (event.kind === 'done') {
              turnUsage = event.usage
              if (event.completion !== undefined && completion !== 'incomplete') completion = event.completion
            } else {
              calls.push(event)
            }
          }
          return { replyText, reasoningText, toolCalls: calls.calls(), turnUsage, completion }
        })(),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(roundSignal.reason)
          roundSignal.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(() => {
            const failure = new Error(TURN_TIMEOUT_MESSAGE)
            streamClosed = true
            roundController.abort(failure)
            reject(failure)
          }, timeoutMs)
        }),
      ])
      streamClosed = true
      if (timer !== undefined) clearTimeout(timer)
      text = streamed.replyText
      reasoning += streamed.reasoningText
      addUsage(usage, streamed.turnUsage)
      history.push({
        role: 'assistant',
        text,
        toolCalls: streamed.toolCalls.length > 0 ? streamed.toolCalls : undefined,
      })
      // Per-round accounting runs for every round including the final
      // reply: the budget gate at the loop top must see the round that
      // just spent, or a trip lands one round late.
      if (harness?.budgets) {
        const progress = text.length > 0 || streamed.toolCalls.length > 0
        harness.budgets.noteTurn(progress)
        for (let index = 0; index < streamed.toolCalls.length; index += 1) {
          harness.budgets.noteToolCall()
        }
        harness.budgets.noteTokens(streamed.turnUsage.inputTokens + streamed.turnUsage.outputTokens)
        if (harness.prices) {
          const cost =
            (streamed.turnUsage.inputTokens / 1_000_000) * harness.prices.inputPricePerMTok +
            (streamed.turnUsage.outputTokens / 1_000_000) * harness.prices.outputPricePerMTok
          harness.budgets.noteCost(cost)
        }
      }
      const pendingResponse: PendingProviderResponse = { round: turn, response: { text: streamed.replyText, reasoning: streamed.reasoningText, toolCalls: structuredClone(streamed.toolCalls), usage: { ...streamed.turnUsage }, ...(streamed.completion === undefined ? {} : { completion: streamed.completion }) } }
      if (options.onProviderResponse) {
        await options.onCheckpoint?.(history, turn, usage, previousToolCalls + executed.length + streamed.toolCalls.length, preparedOperations(streamed.toolCalls), pendingResponse)
        await options.onProviderResponse(turn, pendingResponse.response)
      }
      if (streamed.toolCalls.length === 0) { completed = true; break }
      await options.onCheckpoint?.(history, turn, usage, previousToolCalls + executed.length + streamed.toolCalls.length, preparedOperations(streamed.toolCalls))
      // Independent calls in one round dispatch together: rounds cost a
      // full provider latency each, so serial MCP calls directly extend
      // time-to-answer. History order stays deterministic (call order);
      // completion frames fire as each call lands.
      const outcomes = await Promise.all(streamed.toolCalls.map((call) => dispatchTool(call, turn)))
      options.signal?.throwIfAborted()
      for (const [index, call] of streamed.toolCalls.entries()) {
        const outcome = outcomes[index] as McpToolOutcome
        if (outcome.recovery) recoveryHalt.push({ authorityId: outcome.recovery.authorityId, operationId: outcome.recovery.operationId, call, serializedCall: JSON.stringify(call), reason: outcome.recovery.reason })
        executed.push(call)
        toolOutcomes.push({ id: call.id, name: call.name, state: outcome.isError ? 'failed' : 'done' })
        history.push({
          role: 'tool',
          toolResult: {
            toolCallId: call.id,
            toolName: call.name,
            content: outcome.content,
            isError: outcome.isError ?? false,
          },
        })
      }
      await options.onCheckpoint?.(history, turn, usage, previousToolCalls + executed.length, recoveryHalt)
      // Post-round repetition screen: repeated tool actions escalate
      // warn → replan → blocked. A replan/blocked verdict stops the loop:
      // the model is looping, and another round only spends more.
      if (harness?.repetition) {
        for (const call of streamed.toolCalls) {
          const fingerprint = fingerprintAction(call.name, call.args)
          const verdict = harness.repetition.note(fingerprint)
          if (verdict === 'replan' || verdict === 'blocked') {
            repetitionHalt = { verdict, fingerprint }
            break
          }
        }
        if (repetitionHalt) break
      }
    } finally {
      streamClosed = true
      if (timer !== undefined) clearTimeout(timer)
      if (onAbort) roundSignal.removeEventListener('abort', onAbort)
      roundController.abort()
    }
  }
  if (!completed && recoveryHalt.length === 0 && budgetTripped === undefined && repetitionHalt === undefined) budgetTripped = ['turns']
  return {
    ...(recoveryHalt.length ? { recoveryHalt } : {}),
    toolOutcomes,
    text,
    reasoning,
    toolCalls: executed,
    usage,
    turns,
    ...(budgetTripped === undefined ? {} : { budgetTripped }),
    ...(repetitionHalt === undefined ? {} : { repetitionHalt }),
    ...(condensed.length === 0 ? {} : { condensed }),
  }
}

// Minimal Streamable HTTP MCP client. One stateless JSON-RPC exchange per
// call over an injected endpoint with a Bearer token; the token never
// appears in errors. The fetch function is injectable so the client is
// unit-provable without network.

export interface StreamableMcpClientOptions {
  signal?: AbortSignal
  /** Bounds both response headers and body; defaults to 60 seconds. */
  timeoutMs?: number
  execution?: { threadKey: string; signature: string }
  endpoint: string
  token: string
  fetchFn?: McpFetchFn
  /** Per-request tool allowlist, enforced server-side. The server
   * intersects it with role floors, so a grant can only narrow, never
   * widen. Absent means no narrowing (role floors still apply). */
  grant?: readonly string[]
}

/** Request header carrying the tool grant (see StreamableMcpClientOptions.grant). */
export const MCP_TOOL_GRANT_HEADER = 'x-kardata-tool-grant'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toToolDefinition(raw: unknown): ToolDefinition | undefined {
  if (!isRecord(raw) || typeof raw['name'] !== 'string') return undefined
  const schema = isRecord(raw['inputSchema']) ? raw['inputSchema'] : undefined
  const rawProps = schema !== undefined && isRecord(schema['properties']) ? schema['properties'] : {}
  const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {}
  for (const [key, prop] of Object.entries(rawProps)) {
    if (!isRecord(prop)) continue
    properties[key] = {
      type: typeof prop['type'] === 'string' ? prop['type'] : 'string',
      ...(typeof prop['description'] === 'string' ? { description: prop['description'] } : {}),
      ...(Array.isArray(prop['enum']) && prop['enum'].every((entry) => typeof entry === 'string')
        ? { enum: prop['enum'] as string[] }
        : {}),
    }
  }
  const required =
    schema !== undefined && Array.isArray(schema['required'])
      ? schema['required'].filter((entry): entry is string => typeof entry === 'string')
      : []
  return {
    name: raw['name'],
    description: typeof raw['description'] === 'string' ? raw['description'] : raw['name'],
    parameters: { type: 'object', properties, required, additionalProperties: false },
  }
}

export class StreamableMcpClient implements TurnRunnerMcpClient {
  readonly authorityId: string
  private readonly endpoint: string
  private readonly token: string
  private readonly fetchFn: McpFetchFn
  private readonly grant: readonly string[] | undefined
  private readonly execution: StreamableMcpClientOptions['execution']
  private readonly signal: AbortSignal | undefined
  private readonly timeoutMs: number
  private initialized = false
  private nextId = 1
  private readonly readOnlyTools = new Set<string>()

  constructor(options: StreamableMcpClientOptions) {
    if (typeof options.endpoint !== 'string' || options.endpoint.length === 0) {
      throw new TypeError('endpoint must be a non-empty string')
    }
    if (typeof options.token !== 'string' || options.token.length === 0) {
      throw new TypeError('token must be a non-empty string')
    }
    this.endpoint = options.endpoint
    this.token = options.token
    this.fetchFn = options.fetchFn ?? defaultFetchFn
    this.execution = options.execution
    this.signal = options.signal
    this.timeoutMs = options.timeoutMs ?? 60_000
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TypeError('timeoutMs must be positive and finite')
    const grant = (options.grant ?? []).map((name) => name.trim()).filter((name) => name.length > 0)
    this.grant = grant.length > 0 ? grant : undefined
    this.authorityId = createHash('sha256').update(JSON.stringify({ endpoint: this.endpoint, credential: createHash('sha256').update(this.token).digest('hex'), thread: this.execution?.threadKey ?? null, grant: this.grant ? [...this.grant].sort() : null })).digest('hex')
  }

  private async rpc(method: string, params: Record<string, unknown>, operationId?: string): Promise<unknown> {
    const describe = `mcp request '${method}'`
    let text: string
    try {
      text = await postWithDeadline({
        describe,
        url: this.endpoint,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${this.token}`,
            ...(operationId ? { 'idempotency-key': operationId } : {}),
            ...(this.execution ? { 'x-kardata-thread': this.execution.threadKey, 'x-kardata-execution': this.execution.signature } : {}),
            ...(this.grant ? { [MCP_TOOL_GRANT_HEADER]: this.grant.join(',') } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: operationId ?? this.nextId++, method, params }),
        },
        timeoutMs: this.timeoutMs,
        signal: this.signal,
        fetchFn: this.fetchFn,
      })
    } catch (error) {
      if (error instanceof HttpError) {
        throw Object.assign(new Error(`${describe} failed with HTTP ${error.status}`), { beforeEffect: [400, 401, 403, 404, 429].includes(error.status) })
      }
      throw error
    }
    const payload = firstJsonPayload(text)
    if (!isRecord(payload)) throw new Error(`mcp request '${method}' returned a malformed envelope`)
    if (isRecord(payload['error'])) {
      const message = typeof payload['error']['message'] === 'string' ? payload['error']['message'] : 'unknown mcp error'
      throw new Error(`mcp request '${method}' failed: ${message.slice(0, 300)}`)
    }
    return payload['result']
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    try {
      await this.rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'karbot-turn', version: '3' },
      })
      await this.rpc('notifications/initialized', {})
    } catch {
      // Stateless responders may not implement the handshake: tools/list
      // remains the real probe, so a failed hello never blocks the turn.
    }
    this.initialized = true
  }

  async listTools(): Promise<ToolDefinition[]> {
    await this.ensureInitialized()
    const result = await this.rpc('tools/list', {})
    const raw = isRecord(result) && Array.isArray(result['tools']) ? result['tools'] : []
    this.readOnlyTools.clear()
    for (const entry of raw) if (isRecord(entry) && typeof entry['name'] === 'string' && isRecord(entry['annotations']) && entry['annotations']['readOnlyHint'] === true) this.readOnlyTools.add(entry['name'])
    return raw
      .map((entry) => toToolDefinition(entry))
      .filter((entry): entry is ToolDefinition => entry !== undefined)
  }

  async callTool(name: string, args: Record<string, unknown>, operationId?: string): Promise<McpToolOutcome> {
    await this.ensureInitialized()
    let result: unknown
    try {
      result = await this.rpc('tools/call', { name, arguments: args }, operationId)
    } catch (error) {
      this.signal?.throwIfAborted()
      const content = error instanceof Error ? error.message : 'mcp tool call failed'
      return { content, isError: true, ...(operationId && !this.readOnlyTools.has(name) && !(isRecord(error) && error['beforeEffect'] === true) ? { recovery: { authorityId: this.authorityId, operationId, reason: 'The mutation reply was not confirmed.' } } : {}) }
    }
    if (!isRecord(result) || !Array.isArray(result['content'])) return { content: `tool '${name}' returned a malformed result`, isError: true, ...(operationId && !this.readOnlyTools.has(name) ? { recovery: { authorityId: this.authorityId, operationId, reason: 'The mutation response was malformed.' } } : {}) }
    const blocks = Array.isArray(result['content']) ? result['content'] : []
    const text = blocks
      .filter((block): block is Record<string, unknown> => isRecord(block) && typeof block['text'] === 'string')
      .map((block) => block['text'] as string)
      .join('\n')
    const meta = isRecord(result['_meta']) ? result['_meta'] : {}
    return { content: text, isError: result['isError'] === true, ...(operationId && result['isError'] === true && !this.readOnlyTools.has(name) && meta['kardata/retry-safe-before-effect'] !== true ? { recovery: { authorityId: this.authorityId, operationId, reason: 'The server could not confirm a retry-safe mutation outcome.' } } : {}) }
  }
}

/** First JSON payload of a response body: plain JSON, or the first `data:`
 * line of an SSE stream (skipping comments and the `[DONE]` terminator). */
function firstJsonPayload(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed.startsWith('data:') && !trimmed.startsWith(':')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return undefined
    }
  }
  for (const line of text.split('\n')) {
    const payload = line.startsWith('data:') ? line.slice('data:'.length).trim() : ''
    if (!payload || payload === '[DONE]') continue
    try {
      return JSON.parse(payload)
    } catch {
      continue
    }
  }
  return undefined
}

/** Closed tool client: no tools, every call an error result. The backend
 * activity uses this when no MCP endpoint is configured, so turns still
 * run (model replies, no tool calls) without a tool server. */
export function createClosedMcpClient(reason: string): TurnRunnerMcpClient {
  return {
    async listTools(): Promise<ToolDefinition[]> {
      return []
    },
    async callTool(name: string): Promise<McpToolOutcome> {
      return { content: `${reason}: tool '${name}' unavailable`, isError: true }
    },
  }
}
