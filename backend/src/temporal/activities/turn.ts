import { inheritThreadFileRefs, assertThreadFileContext, ContextFileBlocked } from '../../db/context-files.js'
// Turn-loop activities. B2.2. appendEventActivity persists; runTurnActivity
// and runChildTurnActivity are retired scripted scaffolding (kept exported
// for the B2.2 history, never called from a workflow): real turns run
// through karbotTurnActivity below — the Phase 3 Karbot turn over the B4.1
// provider gateway plus the agents Streamable MCP client, with deltas on
// ephemeral outbox frames.
import { createHash, createHmac } from 'node:crypto'
import { ApplicationFailure, Context } from '@temporalio/activity'
import { z } from 'zod'
import {
  BudgetTracker,
  composeSystemPrompt,
  compactContext,
  ContextBudgetError,
  OperationRecoveryError,
  type PendingProviderResponse,
  type RecoveryOperation,
  createClosedMcpClient,
  modePromptFor,
  RepetitionTracker,
  runKarbotTurn,
  StreamableMcpClient,
  systemClock,
  type ChatMessage,
  type ProviderAdapter,
  type TurnRunnerMcpClient,
  type Usage,
} from '@kardata/agents'
import {
  appendEvent,
  beginThreadTurn, consumeSteering, finishSteering, readThreadContext, saveThreadContext, workspaceReferences,
  readTurnContinuation, saveTurnContinuation, clearTurnContinuation, researchThreadState,
  recordContextMeasurement,
  readActiveExecutionIdentity, recordTurnExecution, workspaceReferenceSnapshot,
  WorkspaceError,
  getSector,
  getSession,
  getSessionModel,
  publishOutboxFrame,
  recordHeartbeat,
  searchKb,
  workerPoolFromEnv,
  type SessionModelSelection,
} from '../../db/index.js'
import { projectNewEvents } from '../../projector.js'
import { localContextMessages } from '../../context.js'
import { findModel } from '../../providers/registry.js'
import {
  resolveAdapter,
  resolveEffectiveSelection,
  resolveSelection,
  type ProviderSelection,
} from '../../providers/gateway.js'
import { archiveResearchOutcome, hydrateResearchSources, persistResearchSource, persistExecutionRecord, resolveArchiveTarget, type ArchivedResearchSource } from '../../archive/targets.js'

export class ResearchPausedError extends Error {}

export interface AppendEventInput {
  idempotencyKey: string
  partition: string
  type: string
  payload: Record<string, unknown>
  redacted?: boolean
}

export async function appendEventActivity(input: AppendEventInput): Promise<number> {
  const pool = workerPoolFromEnv()
  const appended = await appendEvent(pool, input)
  // Project immediately: the live tail learns about rows only through the
  // outbox, and no read is guaranteed to run after this append. Without
  // this, terminal message frames sit invisible until an unrelated read
  // triggers projection and the UI wedges on Replying. Both sides are
  // idempotent (keyed appends, checkpointed projection), so activity
  // retries stay row-exact.
  await projectNewEvents(pool)
  return appended.seq
}

export interface TurnInput {
  sessionId: string
  text: string
}

// Scripted tool window: every turn spends TOOL_MS simulating tool work so
// cancel-during-tool is exercisable. B4.1 replaces this with real turns.
const TOOL_MS = 3_000

/** Karbot beat cadence: the turn lane heartbeat timeout must exceed this
 * severalfold (see timeouts.ts), or beats lose to dispatch lag and every
 * multi-round turn spuriously times out. */
export const TURN_HEARTBEAT_MS = 5_000

/** Sector references cap per turn (~6k tokens): digest first, then units
 * until the budget runs out. Excluded units never reach this list. */

/** Live-turn wall budget: covers measured deep research (160–327 s pilot
 * turns with live provider rounds plus browser reads). */
export const RESEARCH_TURN_WALL_MS = 600_000

export interface TurnOutcome {
  sourceRefs?: ArchivedResearchSource[]
  sources?: Array<{ url: string; text: string }>
  reply: string
  /** Provider thinking trace; absent when the provider sends none. */
  reasoning?: string
  toolCalls: Array<{ name: string; detail: string; state: 'done' | 'failed' }>
  /** Set when the turn halted on a spend guard or repeat loop instead of a
   * model stop. The workflow surfaces it alongside the reply. */
  haltNotice?: string
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    if (signal?.aborted) done()
    else signal?.addEventListener('abort', done, { once: true })
  })
}

export interface ChildTurnInput {
  childId: string
  text: string
}

// Scripted child turn: shorter than a parent turn (CHILD_TOOL_MS) and with a
// distinct reply prefix so tests can prove child intermediates never land in
// the parent partition. B4.1 replaces this with real turns like its parent.
const CHILD_TOOL_MS = 1_000

// Retired scripted scaffolding: no workflow calls this (child turns run
// through karbotTurnActivity). Kept exported for history only.
/** @deprecated Never called from workflows; use karbotTurnActivity. */
export async function runChildTurnActivity(input: ChildTurnInput): Promise<TurnOutcome> {
  const context = Context.current()
  const deadline = Date.now() + CHILD_TOOL_MS
  while (Date.now() < deadline) {
    context.heartbeat({ childId: input.childId, at: Date.now() })
    await Promise.race([sleep(100), context.cancelled])
  }
  return {
    reply: `child-echo: ${input.text}`,
    toolCalls: [{ name: 'domain.scan', detail: 'scripted child scan', state: 'done' }],
  }
}

/** Answer the conversation first; tools provide evidence only when needed. */
export const KARBOT_SYSTEM_PROMPT =
  'You are Karbot, the Kardata assistant and universal operational driver. Answer the user’s actual question using the conversation. You have full capability to assist operators across the entire Kardata application: creating and managing sessions, managing sectors, starting, pausing, and resuming research sweeps, querying and attaching documents, inspecting and updating research plans, creating session files and artifacts, delegating subagents, searching the web, and recording findings. Use a tool when current Kardata data or actions are needed; do not call tools for greetings or general discussion. Explain tool results in plain words, distinguish facts from guesses, and say when the available data cannot answer the question. Do not invent research, activity, or progress. Keep replies concise. ' +
  'When a tool call fails, that failure is a source gap: say what failed and what remains unknown, retry at most once with a narrower query, and never fill the gap from parametric knowledge. ' +
  'Product knowledge: when asked about what Kardata sells, pricing, the ideal customer, the research method, or outreach, call db.kb_search first and answer from the ranked chunks, citing each fact as [source_path]. Never answer product questions from memory when the corpus has them. ' +
  'Sector evidence: when asked what a sector contains — files, documents, notes, companies, or state — call db.get_sector or db.list_sector_documents first and answer from the results; when asked to inspect or extract sections from a file, prefer calling db.query_document (summary TOC or targeted chunks) to protect context capacity; when asked to quote or show full text, call db.read_sector_document for that document id and quote its text. The list carries record metadata only, never file text; the injected digest is the header, never the whole detail. Never invent digest versions, document lists, document text, or counts from memory or prior turns. ' +
  'Session files: when requested to write, create, or persist reports, summaries, data tables, or output documents for the operator, call db.create_artifact with the sessionId and filename. The file will immediately be indexed and accessible to the operator in the files menu. ' +
  'Standing facts: Kardata sells a managed data layer; the entry wedge is solving one evidenced problem free, then expanding to the data layer. $3k–$6k/month is an internal targeting band, never a quoted price; the only quotable figure is the one-time diagnostic entry. ' +
  'Research discipline: breadth over fixation (record every evidenced problem, never build whole research around one symptom like out-of-stock ads); a problem counts only with mechanism-or-cost evidence from the company’s own domain; every proposal must survive “would they pay $3–6k/mo to fix this, and what evidence says so?”. ' +
  'Response format: GitHub-flavored Markdown rendered as calm chat prose. Write short plain paragraphs. Use bold at most once per reply and never as a label at the start of a line. Use `-` bullets only for real lists and `|` tables only for two or more comparable items. Use `code` only for literal file names, URLs or commands the user should type, never for ids, tool names or citations. Never mention internal tool names, function names or raw ids; describe what you checked in plain words. Do not use em dashes. No raw HTML, no headings in short replies, no invented metrics.'

/** Bounded text history from the thread projection. Tool result payloads are
 * not chat turns and never become free-form instructions in the prompt. */
export function chatHistory(messages: Array<{ kind: string; payload: unknown }>, latestText: string): ChatMessage[] {
  const textTurns: ChatMessage[] = []
  for (const message of messages) {
    if (message.kind !== 'text' || typeof message.payload !== 'object' || message.payload === null) continue
    const payload = message.payload as Record<string, unknown>
    if (payload['role'] !== 'user' && payload['role'] !== 'agent') continue
    if (typeof payload['text'] !== 'string' || payload['failed'] === true) continue
    textTurns.push({ role: payload['role'] === 'user' ? 'user' : 'assistant', text: payload['text'] })
  }
  // The workflow persists this user turn before running the activity. Direct
  // activity callers may not have done so; either way the provider sees it
  // exactly once and receives recent prior turns in their original order.
  if (textTurns.at(-1)?.role === 'user' && textTurns.at(-1)?.text === latestText) textTurns.pop()
  return [...textTurns.slice(-20), { role: 'user', text: latestText }]
}

const FakeToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
})

const FakeStepSchema = z.union([
  z.object({
    text: z.string(),
    toolCalls: FakeToolCallSchema.array().optional(),
    completion: z.enum(['complete', 'incomplete']).nullable().optional(),
    delayMs: z.number().int().min(0).optional(),
  }),
  z.object({ error: z.string().min(1), retryable: z.boolean().optional() }),
])

const OriginalRecoverySchema = z.object({
  runKey: z.string().min(1).max(255), text: z.string().min(1), checkpointHash: z.string().regex(/^[a-f0-9]{64}$/),
  allowedTools: z.array(z.string().min(1).max(80)).max(128),
  originalInput: z.object({ toolAllow: z.array(z.string().min(1).max(80)).max(43).optional(), systemPrepend: z.array(z.string().max(4000)).max(5).optional(), preloadChunks: z.array(z.string().max(8000)).max(10).optional(), mode: z.enum(['brainstorm','plan']).optional(), fakeSteps: z.array(z.unknown()).optional() }).strict(),
  selection: z.object({ provider: z.enum(['meta','fake']), model: z.string().nullable(), reasoningEffort: z.string().optional() }).strict(),
}).strict()

export const KarbotTurnInput = z.object({
  /** Server-validated private checkpoint adoption, never a public request field. */
  recovery: OriginalRecoverySchema.optional(),
  ownerEpoch: z.uuid().optional(),
  ownerFirstExecutionId: z.string().min(1).optional(),
  ownerContinuedFromExecutionId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  threadKey: z.string().min(1),
  runKey: z.string().min(1),
  text: z.string().min(1),
  /** Test/seed path: scripted fake steps. Never set in production. */
  fakeSteps: FakeStepSchema.array().optional(),
  /** MCP endpoint/token overrides so hermetic tests never touch env. The
   * token is scoped by the caller and never logged. */
  mcpEndpoint: z.string().min(1).optional(),
  mcpToken: z.string().min(1).optional(),
  /** Prompt seam (skills/modes/preload): skill prompt blocks prepended
   * after the standing facts, preloaded reference chunks appended last.
   * Bounded so one turn cannot blow the context window. */
  systemPrepend: z.string().min(1).max(4000).array().max(5).optional(),
  preloadChunks: z.string().min(1).max(8000).array().max(10).optional(),
  /** Skill tool grant: only these tool names stay visible/callable. Unknown
   * names match nothing, so a stale grant fails closed. Undefined means the
   * full Karbot palette. */
  toolAllow: z.string().min(1).max(80).array().max(43).optional(),
  /** Turn mode: `brainstorm` adds the open posture, low effort, sampling
   * temperature, and KB preload; `plan` structures roadmaps before action. Absent means precise answering. */
  mode: z.enum(['default', 'brainstorm', 'plan']).optional(),
}).refine((input) => !input.ownerEpoch || Boolean(input.ownerFirstExecutionId), { message: 'Execution epoch requires its original execution identity.' })

export type KarbotTurnInput = z.infer<typeof KarbotTurnInput>

export interface KarbotTurnLogFields {
  op: 'karbot.turn'
  provider: string
  ok: boolean
  latencyMs: number
  turns?: number
  code?: 'provider_failed' | 'provider_unconfigured' | 'budget_tripped' | 'repetition_halt' | 'operation_uncertain'
  /** First-frame timings (ms since turn start): the streaming TTFT budget
   * (send→accept lives in the route; these cover accept→first paint). */
  firstToolMs?: number
  firstReasoningMs?: number
  firstDeltaMs?: number
  /** Context-harness shapes only: snapshot rounds, head hash, and
   * condensation count. Never prompt, reply text, or token material. */
  snapshotRounds?: number
  snapshotHead?: string
  condensedCount?: number
  haltDetail?: string
}

export interface KarbotTurnDeps {
  persistExecution?(round: number, kind: 'request' | 'response' | 'tool-result', record: Record<string, unknown>): Promise<void>
  measureContext?(usage: { inputTokens: number; budget: number; window: number; method: 'exact' | 'estimated' }): Promise<void>
  signal?: AbortSignal
  loadContinuation?(): Promise<{ messages: ChatMessage[]; runKey: string; sources: Array<{ url: string; text: string }>; meta: { round: number; usage: Usage; toolCalls: number; elapsedMs: number; blockedOperations?: RecoveryOperation[]; pendingResponse?: PendingProviderResponse } } | undefined>
  checkpoint?(messages: ChatMessage[], round: number, usage: Usage, toolCalls: number, sources: Array<{ url: string; text: string }>, blockedOperations?: RecoveryOperation[], pendingResponse?: PendingProviderResponse): Promise<void>
  refreshContext?(round: number): Promise<{ references: string[]; notes: string; steering: string[]; paused?: boolean; contextVersion?: number; planVersion?: number | null; localVersion?: number }>
  persistSummary?(summary: string, coveredSeq: number): Promise<void>
  loadSessionModel(sessionId: string): Promise<SessionModelSelection | undefined>
  /** Owning sector for sector chats; absent for general Karbot sessions. */
  loadSessionSector?(sessionId: string): Promise<string | undefined>
  /** Sector context references (digest first) for sector chats. Absent
   * means no sector context rides the turn. */
  loadSectorRefs?(sectorId: string): Promise<string[]>
  /** Sector display name for the identity preload; absent means the
   * sector id stands in for the name. */
  loadSectorName?(sectorId: string): Promise<string | undefined>
  loadHistory(threadKey: string): Promise<ChatMessage[]>
  /** KB preload for brainstorm mode: reference chunks matching the turn.
   * Absent means no preload. Never logged; chunks ride the prompt seam. */
  loadPreload?(text: string): Promise<string[]>
  resolveTurnAdapter(
    selection: ProviderSelection,
    options: { fakeSteps?: KarbotTurnInput['fakeSteps']; model?: string },
  ): ProviderAdapter
  mcp: TurnRunnerMcpClient
  publishDelta(input: { threadKey: string; runKey: string; text: string }): Promise<void>
  publishReasoning(input: { threadKey: string; runKey: string; text: string }): Promise<void>
  publishTool(input: { threadKey: string; runKey: string; id: string; name: string; state: 'running' | 'done' | 'failed' }): Promise<void>
  log(fields: KarbotTurnLogFields): void
}

/** Pure core: per-session model → adapter, streamed turn with the MCP
 * client, deltas to the injected sink. Logs shapes/counters only — prompt,
 * reply text, and token material never reach the log sink. */
export async function executeKarbotTurn(input: KarbotTurnInput, deps: KarbotTurnDeps): Promise<TurnOutcome> {
  const parsed = KarbotTurnInput.parse(input)
  const started = Date.now()
  const stored = await deps.loadSessionModel(parsed.sessionId)
  let adapter: ProviderAdapter
  let providerName: string
  let model: string | null = null
  let turnEffort: string | undefined
  try {
    if (parsed.recovery) {
      const selection = parsed.recovery.selection
      if (selection.provider === 'meta' && (!selection.model || !findModel('meta', selection.model))) throw new Error('Original model profile is unavailable.')
      if (selection.provider === 'meta' && selection.model && selection.reasoningEffort && !findModel('meta', selection.model)?.efforts.includes(selection.reasoningEffort)) throw new Error('Original reasoning profile is unavailable.')
      providerName = selection.provider; model = selection.model; turnEffort = selection.reasoningEffort
      adapter = deps.resolveTurnAdapter(selection.provider, { ...(selection.model ? { model: selection.model } : {}), ...(selection.provider === 'fake' ? { fakeSteps: parsed.fakeSteps } : {}) })
    } else if (stored) {
      const effective = resolveEffectiveSelection({
        provider: stored.provider,
        model: stored.model,
        reasoning: stored.reasoning,
        ...(stored.effort === undefined ? {} : { effort: stored.effort }),
      })
      providerName = effective.provider
      model = effective.model ?? null
      adapter = deps.resolveTurnAdapter(effective.provider, { model: effective.model })
      if (effective.effort !== undefined) {
        turnEffort = effective.effort
      }
    } else {
      const selection = resolveSelection(process.env['KARDATA_PROVIDER'])
      providerName = selection
      if (selection === 'meta') {
        const effective = resolveEffectiveSelection({ provider: 'meta' })
        model = effective.model ?? null
        adapter = deps.resolveTurnAdapter('meta', { model: effective.model })
        turnEffort = effective.effort
      } else {
        adapter = deps.resolveTurnAdapter('fake', { fakeSteps: parsed.fakeSteps })
      }
    }
  } catch (error) {
    const latencyMs = Date.now() - started
    deps.log({ op: 'karbot.turn', provider: 'unknown', ok: false, latencyMs, code: 'provider_unconfigured' })
    throw new Error(
      `karbot turn unconfigured: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown provider error'}`,
      { cause: error },
    )
  }
  try {
    const continuation = await deps.loadContinuation?.()
    const history = continuation?.messages ?? await deps.loadHistory(parsed.threadKey)
    const currentMessage = !continuation && history.at(-1)?.role === 'user' && history.at(-1)?.text === parsed.text ? history.pop() : undefined
    // Brainstorm sampling (starting values, tuned from live feel): low
    // effort for fast divergent replies, 0.9 temperature on chat models.
    // An explicitly stored effort always wins over the mode default.
    const brainstorm = (parsed.mode ?? 'default') === 'brainstorm'
    if (brainstorm && turnEffort === undefined) turnEffort = 'low'
    const preload = brainstorm ? ((await deps.loadPreload?.(parsed.text)) ?? []) : []
    // Sector chats ride the same turn: the sector's digest + included file
    // units join the prompt seam after KB preload, capped so one turn
    // cannot blow the context window. General sessions skip this entirely.
    const sectorId = await deps.loadSessionSector?.(parsed.sessionId)
    const sectorRefs: string[] = []
    if (sectorId) {
      // The model must never derive an id from the name: state the exact
      // id up front, first in the preload.
      const sectorName = (await deps.loadSectorName?.(sectorId)) ?? sectorId
      sectorRefs.push(`Current sector: "${sectorName}" (sector id: ${sectorId}). Use exactly this sector id for every sector tool call; never derive an id from the name.`)
      if (deps.loadSectorRefs) sectorRefs.push(...await deps.loadSectorRefs(sectorId))
    }
    const firstFrame: { tool?: number; reasoning?: number; delta?: number } = {}
    const stamp = (slot: 'tool' | 'reasoning' | 'delta'): number | undefined => {
      firstFrame[slot] ??= Date.now() - started
      return firstFrame[slot]
    }
    const systemPrompt = composeSystemPrompt(KARBOT_SYSTEM_PROMPT, {
      prepend: parsed.systemPrepend,
      modePrompt: parsed.mode ? modePromptFor(parsed.mode) : undefined,
      preload: [...preload, ...(parsed.preloadChunks ?? []), ...sectorRefs],
    })
    // Spend guards for the live turn. Cost stays untracked until a price
    // table lands (no price source exists yet), so maxCost never trips;
    // turns, tool calls, tokens, wall-clock, and stall budgets all do.
    // Wall clock covers measured deep research (160–327 s pilot turns):
    // cutting at 5 minutes killed the tail. Empty replies on oversized
    // briefs stay an open output-budget question (brief discipline —
    // one company, terse reply — is the proven recipe); this budget
    // only decides how long a turn may work, not how it writes.
    const budgets = new BudgetTracker(
      {
        maxTurns: 10,
        maxToolCalls: 25,
        maxTokens: 200_000,
        maxCost: Number.POSITIVE_INFINITY,
        maxWallMs: Math.max(0, RESEARCH_TURN_WALL_MS - (continuation?.meta.elapsedMs ?? 0)),
        maxStalledTurns: 3,
      },
      systemClock(),
    )
    const snapshotHashes: string[] = []
    let compactedCount = 0
    const sources: Array<{ url: string; text: string }> = continuation?.sources ?? []
    let boundary: Record<string, unknown> = {}
    const persist = async (round: number, kind: 'request' | 'response' | 'tool-result', data: unknown, original?: Record<string, unknown>) => {
      try { const record = original && typeof original['serializedRecord'] === 'string' ? { ...JSON.parse(original['serializedRecord']) as Record<string, unknown>, preserveProducer: true } : original ? { ...original, data } : { version: 1, provider: providerName, model, round, boundary, data }; await deps.persistExecution?.(round, kind, record) }
      catch (error) { throw new ContextBudgetError('Execution content could not be durably recorded. Retry after storage recovers.', { cause: error }) }
    }
    const result = await runKarbotTurn({
      maxTurns: 10,
      maxOutputTokens: 16_384,
      operationKey: continuation?.runKey ?? parsed.runKey,
      resume: continuation?.meta,
      signal: deps.signal,
      ...(deps.persistExecution ? { onProviderRequest: (round: number, request: Omit<import('@kardata/agents').ProviderRequest, 'signal'>) => persist(round, 'request', request), onProviderResponse: (round: number, response: PendingProviderResponse['response'], original?: Record<string, unknown>) => persist(round, 'response', response, original) } : {}),
      onToolResult: (round, call, outcome, operationId) => persist(round, 'tool-result', { call, outcome, ...(operationId ? { operationId } : {}) }),
      onCheckpoint: (messages, round, usage, toolCalls, blockedOperations, pendingResponse) => deps.checkpoint?.(messages, round, usage, toolCalls, sources, blockedOperations, pendingResponse ? { ...pendingResponse, metadata: pendingResponse.metadata ?? { version: 1, provider: providerName, model, round, boundary } } : undefined) ?? Promise.resolve(),
      beforeRound: async (round, current) => {
        const refreshed = await deps.refreshContext?.(round)
        boundary = refreshed ? { contextVersion: refreshed.contextVersion, planVersion: refreshed.planVersion, localVersion: refreshed.localVersion } : {}
        if (refreshed?.paused) throw new ResearchPausedError('Research paused at a safe provider boundary.')
        const prompt = refreshed ? composeSystemPrompt(KARBOT_SYSTEM_PROMPT, { prepend: parsed.systemPrepend, modePrompt: parsed.mode ? modePromptFor(parsed.mode) : undefined, preload: [...(parsed.preloadChunks ?? []), ...refreshed.references, ...(refreshed.notes ? [`Local notes:\n${refreshed.notes}`] : [])] }) : current.systemPrompt
        const messages = [...current.messages, ...(refreshed?.steering ?? []).map((text) => ({ role: 'user' as const, text: `Owner steering:\n${text}` }))]
        const profile = parsed.recovery?.selection.provider === 'meta' && parsed.recovery.selection.model ? findModel('meta', parsed.recovery.selection.model) : stored ? findModel(stored.provider, stored.model) : findModel('meta', 'muse-spark-1.3-contributor')
        const compacted = await compactContext({ provider: adapter, system: prompt, messages, tools: current.tools, window: profile?.contextWindow, signal: deps.signal, reasoningEffort: profile?.efforts.includes('low') ? 'low' : undefined, onMeasurement: deps.measureContext })
        if (compacted.needed) {
          compactedCount++
          if (compacted.summary.coveredSeq !== undefined) await deps.persistSummary?.(compacted.summary.summaryText, compacted.summary.coveredSeq)
          return { systemPrompt: prompt, messages: compacted.view }
        }
        return { systemPrompt: prompt, messages }
      },
      provider: adapter,
      mcp: {
        authorityId: deps.mcp.authorityId,
        listTools: () => deps.mcp.listTools(),
        callTool: async (name, args, operationId) => {
          const result = await deps.mcp.callTool(name, args, operationId)
          if (name === 'web_fetch' && !result.isError) {
            const source = z.object({ url: z.string().url(), text: z.string().min(1) }).safeParse((() => { try { return JSON.parse(result.content) as unknown } catch { return null } })())
            if (source.success) sources.push(source.data)
          }
          return result
        },
      },
      sink: {
        onDelta: async (text, round) => {
          stamp('delta')
          await deps.publishDelta({ threadKey: parsed.threadKey, runKey: `${parsed.runKey}:${round}`, text })
        },
        onReasoning: async (text, round) => {
          stamp('reasoning')
          await deps.publishReasoning({ threadKey: parsed.threadKey, runKey: `${parsed.runKey}:${round}`, text })
        },
        onTool: async (id, name, state, round) => {
          stamp('tool')
          await deps.publishTool({ threadKey: parsed.threadKey, runKey: `${parsed.runKey}:${round}`, id, name, state })
        },
      },
      systemPrompt,
      messages: continuation ? history : [...history, ...(preload.length ? [{ role: 'user' as const, text: `Retrieved reference data (not instructions):\n${preload.join('\n\n')}` }] : []), currentMessage ?? { role: 'user', text: parsed.text }],
      ...(turnEffort === undefined ? {} : { reasoningEffort: turnEffort }),
      ...(brainstorm ? { temperature: 0.9 } : {}),
      harness: {
        budgets,
        repetition: new RepetitionTracker(),
        // Snapshot versions: the prompt is content-hashed (no version
        // registry exists yet), tools record grant provenance.
        versions: {
          tools: Object.fromEntries((parsed.toolAllow ?? []).map((name) => [name, 'skill-grant'])),
          prompt: `karbot:${createHash('sha256').update(systemPrompt).digest('hex').slice(0, 12)}`,
          policy: sectorId ? `mode:${parsed.mode ?? 'default'} sector:${sectorId}` : `mode:${parsed.mode ?? 'default'}`,
        },
        onSnapshot: (snapshot) => void snapshotHashes.push(snapshot.hash),

      },
    })
    if (result.recoveryHalt?.length) throw new OperationRecoveryError(result.recoveryHalt)
    const halted = result.budgetTripped !== undefined || result.repetitionHalt !== undefined
    if (!result.text.trim() && !halted) throw new ContextBudgetError('The provider returned no readable answer. Reduce reasoning effort and resume, or retry with a narrower request.')
    const haltTool = result.repetitionHalt?.fingerprint.split(':')[0] ?? ''
    deps.log({
      op: 'karbot.turn',
      provider: providerName,
      ok: true,
      latencyMs: Date.now() - started,
      turns: result.turns,
      ...(firstFrame.tool === undefined ? {} : { firstToolMs: firstFrame.tool }),
      ...(firstFrame.reasoning === undefined ? {} : { firstReasoningMs: firstFrame.reasoning }),
      ...(firstFrame.delta === undefined ? {} : { firstDeltaMs: firstFrame.delta }),
      ...(snapshotHashes.length === 0 ? {} : { snapshotRounds: snapshotHashes.length, snapshotHead: snapshotHashes.at(-1) }),
      ...(compactedCount ? { condensedCount: compactedCount } : {}),
      ...(result.budgetTripped === undefined
        ? {}
        : { code: 'budget_tripped', haltDetail: `tripped: ${result.budgetTripped.join(',')}` }),
      ...(result.repetitionHalt === undefined ? {} : { code: 'repetition_halt', haltDetail: `${result.repetitionHalt.verdict}:${haltTool}` }),
    })
    const haltNotice = halted
      ? result.budgetTripped !== undefined
        ? `Stopped early: the ${result.budgetTripped.join(', ')} budget tripped. Narrow the request and try again.`
        : `Stopped early: the assistant repeated the '${haltTool}' call instead of progressing. Rephrase and try again.`
      : undefined
    return {
      ...(sources.length ? { sources } : {}),
      reply: result.text || haltNotice || 'The provider returned no readable answer. Please try a narrower request.',
      reasoning: result.reasoning,
      toolCalls: result.toolOutcomes.map((call) => ({ name: call.name, detail: `mcp:${call.name}`, state: call.state })),
      ...(haltNotice === undefined ? {} : { haltNotice }),
    }
  } catch (error) {
    const latencyMs = Date.now() - started
    deps.log({ op: 'karbot.turn', provider: providerName, ok: false, latencyMs, code: error instanceof OperationRecoveryError ? 'operation_uncertain' : 'provider_failed' })
    if (error instanceof ContextFileBlocked || error instanceof ResearchPausedError || error instanceof ContextBudgetError || error instanceof OperationRecoveryError) throw error
    throw new Error(
      `karbot turn failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown provider error'}`,
      { cause: error },
    )
  }
}

export interface McpAuthProbe {
  endpoint: string
  fetchFn: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number }>
}

/** Boot self-check: verifies the worker's MCP credential resolves before
 * polling, so a rotated-but-not-recreated token fails loudly here instead
 * of as cryptic per-turn 403s. Pure outcome, never throws, never carries
 * the token anywhere except the request header. Workers keep polling on a
 * negative result (tool-less turns still answer from digests); the log line
 * is the signal, and it names the remediation. */
export async function checkWorkerMcpAuth(input: {
  mcpEndpoint?: string
  mcpToken?: string
  threadKey?: string
  fetchFn?: McpAuthProbe['fetchFn']
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const endpoint = input.mcpEndpoint ?? process.env['KARDATA_MCP_URL']
  const token = input.mcpToken ?? process.env['KARDATA_MCP_TOKEN']
  if (!endpoint || !token) {
    return { ok: false, reason: 'mcp unconfigured (KARDATA_MCP_URL/TOKEN absent): turns run without tools' }
  }
  const fetchFn = input.fetchFn ?? fetch
  let status: number
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'karbot-turn', version: '3' } },
      }),
    })
    status = response.status
    if (response.ok) return { ok: true }
  } catch {
    return { ok: false, reason: `mcp unreachable at the worker endpoint: turns run without tools` }
  }
  if (status === 403) {
    return {
      ok: false,
      reason:
        'mcp credential rejected (HTTP 403): the worker token does not resolve. ' +
        'Recreate the worker after rotating agents/.env (docker compose up -d --force-recreate worker); ' +
        'a restart alone keeps the stale credential. Tool-requiring turns will fail until then.',
    }
  }
  return { ok: false, reason: `mcp healthcheck failed (HTTP ${status}): turns run without tools` }
}

function karbotMcpClient(input: {
  signal?: AbortSignal
  threadKey?: string
  mcpEndpoint?: string
  mcpToken?: string
  toolAllow?: string[]
  /** Sector chats narrow to the sector palette on top of everything else. */
  sectorScoped?: boolean
}): TurnRunnerMcpClient {
  const endpoint = input.mcpEndpoint ?? process.env['KARDATA_MCP_URL']
  const token = input.mcpToken ?? process.env['KARDATA_MCP_TOKEN']
  if (!endpoint || !token) return createClosedMcpClient('mcp unconfigured')
  // Effective palette, narrowest first: the grant travels to the server on
  // x-kardata-tool-grant, where role floors still apply per call — so the
  // server enforces exactly what the turn prompt was shaped with.
  const grant = [...PRODUCT_TOOLS].filter(
    (name) =>
      (input.sectorScoped !== true || SECTOR_TOOLS.has(name)) &&
      (input.toolAllow === undefined || input.toolAllow.includes(name)),
  )
  const execution = input.threadKey ? { threadKey: input.threadKey, signature: createHmac('sha256', token).update(input.threadKey).digest('hex') } : undefined
  const client = productMcpClient(new StreamableMcpClient({ endpoint, token, grant, execution, signal: input.signal }))
  const scoped = input.sectorScoped === true ? sectorMcpClient(client) : client
  if (input.toolAllow === undefined) return scoped
  // Skill-scoped grant: intersect the palette with the skill's declared
  // tools. The server re-enforces the same grant from the header, so the
  // local filter shapes the prompt while the boundary holds server-side.
  const allow = new Set(input.toolAllow)
  return {
    authorityId: scoped.authorityId,
    async listTools() {
      return (await scoped.listTools()).filter((tool) => allow.has(tool.name))
    },
    async callTool(name, args, operationId) {
      if (!allow.has(name)) return { content: `tool '${name}' is outside this skill's grant`, isError: true }
      return scoped.callTool(name, args, operationId)
    },
  }
}

// The MCP server also exposes projector, auth, quota, and event-log plumbing.
// Those are operational APIs, not useful conversational tools. Keep Karbot's
// advertised palette small while preserving the full keyed MCP boundary for
// operators and other clients.
export const PRODUCT_TOOLS: ReadonlySet<string> = new Set([
  'db.commit_child_context',
  'db.get_global_context', 'db.propose_global_context', 'db.list_sector_files', 'db.propose_file_context', 'db.get_local_context',
  'db.create_session',
  'db.list_sessions', 'db.get_session', 'db.get_thread', 'db.send_message', 'db.steer_thread', 'db.research_health',
  'db.pause_run', 'db.resume_run', 'db.cancel_run',
  'db.rename_session', 'db.delete_session',
  'db.list_sectors', 'db.get_sector', 'db.sector_activity',
  'db.list_companies', 'db.list_sector_companies',
  'db.create_sector', 'db.set_sector_state', 'db.start_sector_research', 'db.pause_sector_research', 'db.resume_sector_research', 'db.mark_company_found',
  'db.set_company_stage', 'db.set_company_state',
  'db.attach_sector_document', 'db.list_sector_documents', 'db.read_sector_document', 'db.query_document',
  'db.list_artifacts', 'db.create_artifact', 'db.list_tenant_artifacts', 'db.reference_artifact',
  'db.kb_search',
  'db.update_sector_plan',
  'db.ledger_upsert_company', 'db.ledger_get_company', 'db.ledger_list_companies',
  'db.ledger_record_problem', 'db.ledger_list_problems',
  // Hound at fullest: live web search (keyed, else keyless pool), page
  // fetch with caps and SSRF guards, and the browser leg (sidecar CDP,
  // task-scoped sessions) when automated search is blocked. Keyed search
  // fails closed without KARDATA_WEB_SEARCH_KEY; every leg fails loudly,
  // never an empty list pretending to be exhaustive.
  'web_search', 'web_fetch',
  'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_close', 'browser_screenshot',
  // Delegation door (Karbot-only, operator): the main agent launches leaf
  // researchers by instruction. Steering launched children stays
  // approver-gated (send/steer), and pilot children never delegate
  // further (depth 0, maxDepth 0 at the gateway).
  'db.delegate_subagent',
])

export function productMcpClient(client: TurnRunnerMcpClient): TurnRunnerMcpClient {
  return {
    authorityId: client.authorityId,
    async listTools() {
      return (await client.listTools()).filter((tool) => PRODUCT_TOOLS.has(tool.name))
    },
    async callTool(name, args, operationId) {
      if (!PRODUCT_TOOLS.has(name)) return { content: `tool '${name}' is unavailable to Karbot`, isError: true }
      return client.callTool(name, args, operationId)
    },
  }
}

// Sector-chat palette: the same MCP, not all the access. Sector chats read
// their sector (plus session/thread/artifact context and the KB) and may
// attach context documents; cross-sector writes, tenant-wide reads, and
// ledger mutations stay Karbot-only. This is visibility at the worker edge:
// the keyed MCP boundary still enforces role floors per call.
export const SECTOR_TOOLS: ReadonlySet<string> = new Set([
  'db.commit_child_context',
  'db.delegate_subagent',
  'db.get_global_context', 'db.propose_global_context', 'db.list_sector_files', 'db.propose_file_context', 'db.get_local_context',
  'db.get_session',
  'db.get_thread',
  'db.get_sector',
  'db.list_sectors',
  'db.sector_activity',
  'db.list_companies',
  'db.list_sector_companies',
  'db.attach_sector_document',
  'db.list_sector_documents',
  'db.read_sector_document',
  'db.query_document',
  'db.list_artifacts',
  'db.create_artifact',
  'db.reference_artifact',
  'db.kb_search',
  'db.update_sector_plan',
  // Web retrieval reads the public web, not our database: search and
  // fetch stay readable in sector scope so sector research skills can
  // discover companies from chat. Browser action stays Karbot-only
  // (sessions are task-scoped there; sector turns never drive pages).
  'web_search',
  'web_fetch',
  // Own-sector monitoring stays readable here; steering other sessions is
  // Karbot-only (send/steer need approver + confirmation anyway).
  'db.research_health',
])

export function sectorMcpClient(client: TurnRunnerMcpClient): TurnRunnerMcpClient {
  return {
    authorityId: client.authorityId,
    async listTools() {
      return (await client.listTools()).filter((tool) => SECTOR_TOOLS.has(tool.name))
    },
    async callTool(name, args, operationId) {
      if (!SECTOR_TOOLS.has(name)) return { content: `tool '${name}' is unavailable in sector chats`, isError: true }
      return client.callTool(name, args, operationId)
    },
  }
}

/** Keep the original transport identity; effective names can only narrow. */
export function freezeOriginalPalette(client: TurnRunnerMcpClient, names: string[]): TurnRunnerMcpClient {
  const allowed = new Set(z.array(z.string().min(1).max(80)).max(128).parse(names))
  return { authorityId: client.authorityId, listTools: async () => (await client.listTools()).filter((tool) => allowed.has(tool.name)), callTool: (name, args, operationId) => allowed.has(name) ? client.callTool(name, args, operationId) : Promise.resolve({ content: 'This tool was not in the original execution contract.', isError: true }) }
}

/** Retry/resume belongs to the durable operation, never just matching prompt text. */
export function selectTurnContinuation(saved: Awaited<ReturnType<typeof readTurnContinuation>>, input: Pick<KarbotTurnInput, 'runKey' | 'text'>) {
  return saved?.runKey === input.runKey && saved.user === input.text ? saved : undefined
}

export async function karbotTurnActivity(input: KarbotTurnInput): Promise<TurnOutcome> {
  const context = Context.current()
  input = KarbotTurnInput.parse(input)
  if (input.recovery) input = KarbotTurnInput.parse({ ...input, toolAllow: input.recovery.originalInput.toolAllow, systemPrepend: input.recovery.originalInput.systemPrepend, preloadChunks: input.recovery.originalInput.preloadChunks, mode: input.recovery.originalInput.mode, fakeSteps: input.recovery.originalInput.fakeSteps, runKey: input.recovery.runKey, text: input.recovery.text })
  const pool = workerPoolFromEnv()
  const actual = context.info.workflowExecution
  const owner = input.ownerEpoch && actual ? { epoch: input.ownerEpoch, firstExecutionId: input.ownerFirstExecutionId!, ...(input.ownerContinuedFromExecutionId ? { continuedFromExecutionId: input.ownerContinuedFromExecutionId } : {}), workflowId: actual.workflowId, executionId: actual.runId, threadKey: input.threadKey, sessionId: input.sessionId } : undefined
  if (input.ownerEpoch && !owner) throw ApplicationFailure.nonRetryable('Actual workflow identity is required for execution epoch ownership.', 'ExecutionOwnershipDenied')
  const lease = await beginThreadTurn(pool, input.threadKey, input.runKey, owner, input.recovery ? { runKey: input.recovery.runKey, user: input.recovery.text, checkpointHash: input.recovery.checkpointHash } : undefined)
  const abort = new AbortController()
  void context.cancelled.catch(() => abort.abort())
  const activityStarted = Date.now()
  let settled = false
  const beating = (async () => {
    try {
      while (!settled) {
        await Promise.race([sleep(TURN_HEARTBEAT_MS, abort.signal), context.cancelled])
        if (settled) break
        context.heartbeat({ sessionId: input.sessionId, at: Date.now() })
        await recordHeartbeat(pool, context.info.workflowExecution?.workflowId ?? input.runKey, 'karbot.turn', true)
      }
    } catch (error) {
      if (abort.signal.aborted || settled) return
      context.log.error('karbot.heartbeat.error', { code: 'heartbeat_failed', threadKey: input.threadKey, runKey: input.runKey })
      abort.abort()
      throw error
    }
  })()
  try {
    // Cancellation surfaces as a rejected promise (turn.ts pattern): the
    // workflow sees CancelledFailure instead of an orphaned provider call.
    return await Promise.race([
      (async () => {
        const identity = await readActiveExecutionIdentity(pool, input.threadKey, lease).catch((error: unknown) => {
          context.log.error('karbot.identity.error', { code: 'identity_read_failed', threadKey: input.threadKey, runKey: input.runKey })
          throw error
        })
        const producer = { attemptLease: lease, activityId: context.info.activityId, activityAttempt: context.info.attempt, ...(identity.workflowId ?? actual?.workflowId ? { workflowId: identity.workflowId ?? actual?.workflowId } : {}), ...(identity.executionId ?? actual?.runId ? { executionId: identity.executionId ?? actual?.runId } : {}), ...(identity.ownerEpoch ? { ownerEpoch: identity.ownerEpoch } : {}) }
        abort.signal.throwIfAborted()
        const archive = resolveArchiveTarget()
        await projectNewEvents(pool)
        abort.signal.throwIfAborted()
        await inheritThreadFileRefs(pool, input.threadKey)
        abort.signal.throwIfAborted()
        await assertThreadFileContext(pool, input.threadKey)
        abort.signal.throwIfAborted()
        const existing = await readTurnContinuation(pool, input.threadKey)
        if (existing?.meta.pendingResponse && (existing.runKey !== input.runKey || existing.user !== input.text)) throw new ContextBudgetError('A paid response is waiting for durable recording. Resume the original turn before replacing its assignment.')
        if (existing?.meta.blockedOperations?.length && (existing.runKey !== input.runKey || existing.user !== input.text)) throw new OperationRecoveryError(existing.meta.blockedOperations)
        const continuation = selectTurnContinuation(existing, input)
        const sourceRefs = new Map((continuation?.sources ?? []).map((source) => [source.hash, source]))
        abort.signal.throwIfAborted()
        const outcome = await executeKarbotTurn(input, {
          persistExecution: async (round, kind, record) => {
            abort.signal.throwIfAborted()
            const { data, preserveProducer, ...envelope } = record
            const original = preserveProducer ? { ...envelope, data } : { ...producer, ...envelope, data }
            const ref = await persistExecutionRecord(archive, input.sessionId, original, abort.signal)
            abort.signal.throwIfAborted()
            await recordTurnExecution(pool, { sessionId: input.sessionId, threadKey: input.threadKey, runKey: continuation?.runKey ?? input.runKey, lease, round, kind, ref, ...(actual ? { workflowId: actual.workflowId, executionId: actual.runId } : {}) })
          },
          measureContext: (usage) => recordContextMeasurement(pool, input.threadKey, usage),
          signal: abort.signal,
          loadContinuation: async () => {
            if (!continuation) return undefined
            const hydrated = await hydrateResearchSources(archive, input.sessionId, { sourceRefs: continuation.sources }, abort.signal)
            return { ...continuation, sources: hydrated.sources }
          },
          checkpoint: async (messages, round, usage, toolCalls, sources, blockedOperations, pendingResponse) => {
            for (const source of sources) {
              const hash = createHash('sha256').update(`${source.url}\n${source.text}`).digest('hex')
              abort.signal.throwIfAborted()
              if (!sourceRefs.has(hash)) {
                sourceRefs.set(hash, await persistResearchSource(archive, input.sessionId, source, abort.signal))
                abort.signal.throwIfAborted()
              }
            }
            abort.signal.throwIfAborted()
            await saveTurnContinuation(pool, input.threadKey, { user: input.text, messages, runKey: continuation?.runKey ?? input.runKey, sources: [...sourceRefs.values()], meta: { round, usage, toolCalls, elapsedMs: (continuation?.meta.elapsedMs ?? 0) + Date.now() - activityStarted, ...(blockedOperations?.length ? { blockedOperations } : {}), ...(pendingResponse ? { pendingResponse: typeof pendingResponse.metadata?.['serializedRecord'] === 'string' ? pendingResponse : { ...pendingResponse, metadata: { ...producer, ...pendingResponse.metadata, serializedRecord: JSON.stringify({ ...producer, ...pendingResponse.metadata, data: pendingResponse.response }) } } } : {}) } }, lease)
          },
          loadSessionModel: (sessionId) => getSessionModel(pool, sessionId),
          loadSessionSector: async (sessionId) => (await getSession(pool, sessionId))?.sectorId,
          loadSectorRefs: (sectorId) => workspaceReferences(pool, sectorId, undefined, input.threadKey),
          loadSectorName: async (sectorId) => (await getSector(pool, sectorId))?.name,
          loadHistory: async (threadKey) => {
            const loaded = await localContextMessages(pool, threadKey)
            return loaded.messages
          },
          refreshContext: async (round) => {
            await projectNewEvents(pool)
            await assertThreadFileContext(pool, input.threadKey)
            const session = await getSession(pool, input.sessionId)
            const local = await readThreadContext(pool, input.threadKey)
            const snapshot = await (async () => {
              try { return session?.sectorId ? await workspaceReferenceSnapshot(pool, session.sectorId, input.threadKey) : { references: [] } }
              catch (error) {
                if (error instanceof WorkspaceError && error.code === 'conflict') throw new ContextBudgetError('Shared context could not settle at this provider boundary. Retry after the edits settle.', { cause: error })
                throw error
              }
            })()
            const researchState = await researchThreadState(pool, input.threadKey)
            return { ...snapshot, localVersion: local.version, notes: local.notes, steering: await consumeSteering(pool, input.threadKey, continuation?.runKey ?? input.runKey, round, lease), paused: researchState === 'paused' || researchState === 'planning' || researchState === 'planned' }
          },
          persistSummary: async (summary, coveredSeq) => {
            abort.signal.throwIfAborted()
            const local = await readThreadContext(pool, input.threadKey)
            abort.signal.throwIfAborted()
            await saveThreadContext(pool, input.threadKey, { version: local.version, summary, coveredSeq }, undefined, lease)
          },
          // Brainstorm preload: top corpus chunks matching the turn text,
          // cited by source path. A search miss preloads nothing — the turn
          // still runs on the skill prompt plus on-demand kb_search.
          loadPreload: async (text) => {
            try {
              const hits = await searchKb(pool, text, 3)
              return hits.map((hit) => `[${hit.sourcePath}] ${hit.text}`)
            } catch {
              return []
            }
          },
          resolveTurnAdapter: (selection, options) =>
            resolveAdapter(selection, { fakeSteps: options.fakeSteps, model: options.model }),
          // Sector-linked sessions get the sector palette on top of the
          // Karbot palette (and any skill grant): the same MCP, not all the
          // access. The narrowed palette travels to the server on the grant
          // header, so the boundary holds server-side. The lookup rides the
          // worker pool; a failed lookup never widens the palette.
          mcp: await (async () => {
            await projectNewEvents(pool)
            const session = await getSession(pool, input.sessionId)
            if (!session) throw new Error('Turn session is unavailable')
            const original = karbotMcpClient({ ...input, signal: abort.signal, sectorScoped: session.sectorId !== undefined && session.sectorId !== null })
            if (!input.recovery) return original
            return freezeOriginalPalette(original, input.recovery.allowedTools)

      })(),
        publishDelta: async (delta) => {
          await publishOutboxFrame(pool, delta.threadKey, 'delta', {
            runKey: delta.runKey,
            text: delta.text,
          })
        },
        publishReasoning: async (delta) => {
          await publishOutboxFrame(pool, delta.threadKey, 'reasoning', {
            runKey: delta.runKey,
            text: delta.text,
          })
        },
        publishTool: async (frame) => {
          await publishOutboxFrame(pool, frame.threadKey, 'tool', {
            runKey: frame.runKey,
            id: frame.id,
            name: frame.name,
            state: frame.state,
          })
        },
        // Key-free by construction: shapes and counters only, never prompt,
        // reply text, or token material.
        log: (fields) => context.log.info('karbot.turn', { ...fields }),
      })
      abort.signal.throwIfAborted()
      const archived = await archiveResearchOutcome(archive, input.sessionId, outcome, abort.signal)
      abort.signal.throwIfAborted()
      await appendEvent(pool, { idempotencyKey: `turn-sources:${input.runKey}:${lease}`, partition: input.threadKey.startsWith('agent:') ? `child:${input.threadKey.slice(6)}` : `session:${input.sessionId}`, type: 't.turn.sources_archived', payload: { sessionId: input.sessionId, threadKey: input.threadKey, runKey: input.runKey, attemptLease: lease, attempt: context.info.attempt, activityId: context.info.activityId, workflowRunId: context.info.workflowExecution?.runId, sources: archived.sourceRefs } })
      abort.signal.throwIfAborted()
      await clearTurnContinuation(pool, input.threadKey, lease)
      return archived
      })(),
      context.cancelled,
      beating.then(() => new Promise<never>(() => undefined)),
    ]).catch((error: unknown) => {
      if (error instanceof ResearchPausedError) throw ApplicationFailure.nonRetryable(error.message, 'ResearchPaused')
      if (error instanceof OperationRecoveryError) throw ApplicationFailure.nonRetryable(error.message, 'OperationBlocked', error.operations)
      if (error instanceof ContextFileBlocked || error instanceof ContextBudgetError) throw ApplicationFailure.nonRetryable(error.message, 'ContextBlocked')
      throw error
    })
  } finally {
    settled = true
    abort.abort()
    await finishSteering(pool, input.threadKey, input.runKey, lease)
    void beating
  }
}

// Retired scripted scaffolding: no workflow calls this (session turns run
// through karbotTurnActivity). Kept exported for history only.
/** @deprecated Never called from workflows; use karbotTurnActivity. */
export async function runTurnActivity(input: TurnInput): Promise<TurnOutcome> {
  const context = Context.current()
  const pool = workerPoolFromEnv()
  const runId = `session-run-${input.sessionId}`
  const deadline = Date.now() + TOOL_MS
  let beats = 0
  while (Date.now() < deadline) {
    context.heartbeat({ sessionId: input.sessionId, at: Date.now() })
    // Operation heartbeat for the stall sweeper (B5.3): the store helper
    // throttles to one write per 5 s, so the 100 ms Temporal cadence costs
    // nothing extra.
    beats += 1
    if (beats % 50 === 1) {
      await recordHeartbeat(pool, runId, 'turn', true)
    }
    // Cancellation surfaces here as a rejected promise: let it propagate so
    // the workflow sees CancelledFailure instead of an orphaned tool.
    await Promise.race([sleep(100), context.cancelled])
  }
  return {
    reply: `echo: ${input.text}`,
    toolCalls: [{ name: 'domain.scan', detail: 'scripted scan', state: 'done' }],
  }
}
