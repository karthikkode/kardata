// Turn-loop activities. B2.2. appendEventActivity persists; runTurnActivity
// and runChildTurnActivity are retired scripted scaffolding (kept exported
// for the B2.2 history, never called from a workflow): real turns run
// through karbotTurnActivity below — the Phase 3 Karbot turn over the B4.1
// provider gateway plus the agents Streamable MCP client, with deltas on
// ephemeral outbox frames.
import { createHash } from 'node:crypto'
import { Context } from '@temporalio/activity'
import { z } from 'zod'
import {
  BudgetTracker,
  composeSystemPrompt,
  createClosedMcpClient,
  modePromptFor,
  RepetitionTracker,
  runKarbotTurn,
  StreamableMcpClient,
  systemClock,
  type ChatMessage,
  type ProviderAdapter,
  type TurnRunnerMcpClient,
} from '@kardata/agents'
import {
  appendEvent,
  getSectorContext,
  getSession,
  getThread,
  getSessionModel,
  publishOutboxFrame,
  recordHeartbeat,
  searchKb,
  workerPoolFromEnv,
  type SessionModelSelection,
} from '../../db/index.js'
import { projectNewEvents } from '../../projector.js'
import {
  resolveAdapter,
  resolveEffectiveSelection,
  resolveSelection,
  type ProviderSelection,
} from '../../providers/gateway.js'

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
export const SECTOR_REFS_CHAR_BUDGET = 24_000

/** Live-turn wall budget: covers measured deep research (160–327 s pilot
 * turns with live provider rounds plus browser reads). */
export const RESEARCH_TURN_WALL_MS = 600_000

export interface TurnOutcome {
  reply: string
  /** Provider thinking trace; absent when the provider sends none. */
  reasoning?: string
  toolCalls: Array<{ name: string; detail: string; state: 'done' }>
  /** Set when the turn halted on a spend guard or repeat loop instead of a
   * model stop. The workflow surfaces it alongside the reply. */
  haltNotice?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  'You are Karbot, the Kardata assistant. Answer the user’s actual question using the conversation. Use a tool only when current Kardata data is needed; do not call tools for greetings or general discussion. Explain tool results in plain words, distinguish facts from guesses, and say when the available data cannot answer the question. Do not invent research, activity, or progress. Keep replies concise. ' +
  'When a tool call fails, that failure is a source gap: say what failed and what remains unknown, retry at most once with a narrower query, and never fill the gap from parametric knowledge. ' +
  'Product knowledge: when asked about what Kardata sells, pricing, the ideal customer, the research method, or outreach, call db.kb_search first and answer from the ranked chunks, citing each fact as [source_path]. Never answer product questions from memory when the corpus has them. ' +
  'Sector evidence: when asked what a sector contains — files, documents, notes, companies, or state — call db.get_sector or db.list_sector_documents first and answer from the results; when asked to quote or show what is inside a file, call db.read_sector_document for that document id and quote its text. The list carries record metadata only, never file text; the injected digest is the header, never the whole detail. Never invent digest versions, document lists, document text, or counts from memory or prior turns. ' +
  'Standing facts: Kardata sells a managed data layer; the entry wedge is solving one evidenced problem free, then expanding to the data layer. $3k–$6k/month is an internal targeting band, never a quoted price; the only quotable figure is the one-time diagnostic entry. ' +
  'Research discipline: breadth over fixation (record every evidenced problem, never build whole research around one symptom like out-of-stock ads); a problem counts only with mechanism-or-cost evidence from the company’s own domain; every proposal must survive “would they pay $3–6k/mo to fix this, and what evidence says so?”. ' +
  'Response format: GitHub-flavored Markdown, rendered as rich chat. Short paragraphs; **bold** lead-ins; `-` bullets for lists; `|` tables for two or more counts or comparisons; `` `code` `` for paths, ids, and source citations (citations stay literal bracket text, never links). No raw HTML, no headings in short replies, no invented metrics.'

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
    delayMs: z.number().int().min(0).optional(),
  }),
  z.object({ error: z.string().min(1), retryable: z.boolean().optional() }),
])

export const KarbotTurnInput = z.object({
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
   * temperature, and KB preload. Absent means precise answering. */
  mode: z.enum(['default', 'brainstorm']).optional(),
})

export type KarbotTurnInput = z.infer<typeof KarbotTurnInput>

export interface KarbotTurnLogFields {
  op: 'karbot.turn'
  provider: string
  ok: boolean
  latencyMs: number
  turns?: number
  code?: 'provider_failed' | 'provider_unconfigured' | 'budget_tripped' | 'repetition_halt'
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
  loadSessionModel(sessionId: string): Promise<SessionModelSelection | undefined>
  /** Owning sector for sector chats; absent for general Karbot sessions. */
  loadSessionSector?(sessionId: string): Promise<string | undefined>
  /** Sector context references (digest first) for sector chats. Absent
   * means no sector context rides the turn. */
  loadSectorRefs?(sectorId: string): Promise<string[]>
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
  let turnEffort: string | undefined
  try {
    if (stored) {
      const effective = resolveEffectiveSelection({
        provider: stored.provider,
        model: stored.model,
        reasoning: stored.reasoning,
        ...(stored.effort === undefined ? {} : { effort: stored.effort }),
      })
      providerName = effective.provider
      adapter = deps.resolveTurnAdapter(effective.provider, { model: effective.model })
      if (effective.effort !== undefined) {
        turnEffort = effective.effort
      }
    } else {
      const selection = resolveSelection(process.env['KARDATA_PROVIDER'])
      providerName = selection
      if (selection === 'meta') {
        const effective = resolveEffectiveSelection({ provider: 'meta' })
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
    const history = await deps.loadHistory(parsed.threadKey)
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
    if (sectorId && deps.loadSectorRefs) {
      const all = await deps.loadSectorRefs(sectorId)
      let budget = SECTOR_REFS_CHAR_BUDGET
      for (const ref of all) {
        if (ref.length > budget) break
        sectorRefs.push(ref)
        budget -= ref.length
      }
    }
    const firstFrame: { tool?: number; reasoning?: number; delta?: number } = {}
    const stamp = (slot: 'tool' | 'reasoning' | 'delta'): number | undefined => {
      firstFrame[slot] ??= Date.now() - started
      return firstFrame[slot]
    }
    const systemPrompt = composeSystemPrompt(KARBOT_SYSTEM_PROMPT, {
      prepend: parsed.systemPrepend,
      modePrompt: brainstorm ? modePromptFor('brainstorm') : undefined,
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
        maxWallMs: RESEARCH_TURN_WALL_MS,
        maxStalledTurns: 3,
      },
      systemClock(),
    )
    const snapshotHashes: string[] = []
    const result = await runKarbotTurn({
      provider: adapter,
      mcp: deps.mcp,
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
      messages: [...history, { role: 'user', text: parsed.text }],
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
        // In-turn safety net only: history arrives capped at 20 turns, so
        // this fires on huge tool payloads. Cross-turn compaction still
        // needs workflow write-back of the summary (deferred).
        condense: {
          maxSize: 30,
          keepFirst: 1,
          tokenCap: 100_000,
          summarizer: 'karbot:compaction',
          summarize: async (forgotten) => {
            const excerpt = forgotten
              .map((message) => `${message.role}: ${(message.text ?? '').slice(0, 500)}`)
              .join('\n')
              .slice(0, 6000)
            try {
              const summary = await adapter.chat({
                systemPrompt:
                  'Summarize this earlier conversation excerpt in two sentences. Keep tool names, ids, and open questions; drop pleasantries.',
                messages: [{ role: 'user', text: excerpt }],
                tools: [],
                toolChoice: { mode: 'none' },
              })
              return summary.text.slice(0, 2000)
            } catch {
              return `${forgotten.length} earlier messages (summary unavailable)`
            }
          },
        },
      },
    })
    const halted = result.budgetTripped !== undefined || result.repetitionHalt !== undefined
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
      ...(result.condensed === undefined ? {} : { condensedCount: result.condensed.length }),
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
      reply: result.text,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls.map((call) => ({ name: call.name, detail: `mcp:${call.name}`, state: 'done' as const })),
      ...(haltNotice === undefined ? {} : { haltNotice }),
    }
  } catch (error) {
    const latencyMs = Date.now() - started
    deps.log({ op: 'karbot.turn', provider: providerName, ok: false, latencyMs, code: 'provider_failed' })
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
  const client = productMcpClient(new StreamableMcpClient({ endpoint, token, grant }))
  const scoped = input.sectorScoped === true ? sectorMcpClient(client) : client
  if (input.toolAllow === undefined) return scoped
  // Skill-scoped grant: intersect the palette with the skill's declared
  // tools. The server re-enforces the same grant from the header, so the
  // local filter shapes the prompt while the boundary holds server-side.
  const allow = new Set(input.toolAllow)
  return {
    async listTools() {
      return (await scoped.listTools()).filter((tool) => allow.has(tool.name))
    },
    async callTool(name, args) {
      if (!allow.has(name)) return { content: `tool '${name}' is outside this skill's grant`, isError: true }
      return scoped.callTool(name, args)
    },
  }
}

// The MCP server also exposes projector, auth, quota, and event-log plumbing.
// Those are operational APIs, not useful conversational tools. Keep Karbot's
// advertised palette small while preserving the full keyed MCP boundary for
// operators and other clients.
const PRODUCT_TOOLS = new Set([
  'db.list_sessions', 'db.get_session', 'db.get_thread', 'db.send_message', 'db.steer_thread', 'db.research_health',
  'db.pause_run', 'db.resume_run', 'db.cancel_run',
  'db.rename_session', 'db.delete_session',
  'db.list_sectors', 'db.get_sector', 'db.sector_activity',
  'db.list_companies', 'db.list_sector_companies',
  'db.create_sector', 'db.set_sector_state', 'db.mark_company_found',
  'db.set_company_stage', 'db.set_company_state',
  'db.attach_sector_document', 'db.list_sector_documents', 'db.read_sector_document',
  'db.list_artifacts', 'db.list_tenant_artifacts', 'db.reference_artifact',
  'db.kb_search',
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
    async listTools() {
      return (await client.listTools()).filter((tool) => PRODUCT_TOOLS.has(tool.name))
    },
    async callTool(name, args) {
      if (!PRODUCT_TOOLS.has(name)) return { content: `tool '${name}' is unavailable to Karbot`, isError: true }
      return client.callTool(name, args)
    },
  }
}

// Sector-chat palette: the same MCP, not all the access. Sector chats read
// their sector (plus session/thread/artifact context and the KB) and may
// attach context documents; cross-sector writes, tenant-wide reads, and
// ledger mutations stay Karbot-only. This is visibility at the worker edge:
// the keyed MCP boundary still enforces role floors per call.
export const SECTOR_TOOLS: ReadonlySet<string> = new Set([
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
  'db.list_artifacts',
  'db.reference_artifact',
  'db.kb_search',
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
    async listTools() {
      return (await client.listTools()).filter((tool) => SECTOR_TOOLS.has(tool.name))
    },
    async callTool(name, args) {
      if (!SECTOR_TOOLS.has(name)) return { content: `tool '${name}' is unavailable in sector chats`, isError: true }
      return client.callTool(name, args)
    },
  }
}

export async function karbotTurnActivity(input: KarbotTurnInput): Promise<TurnOutcome> {
  const context = Context.current()
  const pool = workerPoolFromEnv()
  let settled = false
  const beating = (async () => {
    try {
      while (!settled) {
        await Promise.race([sleep(TURN_HEARTBEAT_MS), context.cancelled])
        if (settled) break
        context.heartbeat({ sessionId: input.sessionId, at: Date.now() })
        await recordHeartbeat(pool, `session-run-${input.sessionId}`, 'karbot.turn', true)
      }
    } catch {
      // Cancellation races the beat; the chat race below owns the outcome.
    }
  })()
  try {
    // Cancellation surfaces as a rejected promise (turn.ts pattern): the
    // workflow sees CancelledFailure instead of an orphaned provider call.
    return await Promise.race([
      executeKarbotTurn(input, {
        loadSessionModel: (sessionId) => getSessionModel(pool, sessionId),
        loadSessionSector: async (sessionId) => (await getSession(pool, sessionId))?.sectorId,
        loadSectorRefs: async (sectorId) => {
          try {
            return (await getSectorContext(pool, sectorId)).segments.references
          } catch {
            // Sector reads fail closed: the turn runs without sector
            // context rather than failing the chat.
            return []
          }
        },
        loadHistory: async (threadKey) => {
          const thread = await getThread(pool, threadKey)
          return chatHistory(thread?.messages ?? [], input.text).slice(0, -1)
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
        // worker pool; a miss runs unscoped rather than failing the chat.
        mcp: await (async () => {
          try {
            const linked = (await getSession(pool, input.sessionId))?.sectorId
            return karbotMcpClient({ ...input, sectorScoped: linked !== undefined && linked !== null })
          } catch {
            return karbotMcpClient(input)
          }
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
      }),
      context.cancelled,
    ])
  } finally {
    settled = true
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
