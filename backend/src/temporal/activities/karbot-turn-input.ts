// Karbot turn input: the validated turn schema, log fields, and the
// injected-dependency seam executeKarbotTurn runs against.
import { z } from 'zod'
import type {
  ChatMessage,
  PendingProviderResponse,
  ProviderAdapter,
  RecoveryOperation,
  TurnRunnerMcpClient,
  Usage,
} from '@kardata/agents'
import type { SessionModelSelection } from '../../db/index.js'
import type { ProviderRoundInput, ToolCallInput } from '../../db/execution-rounds.js'
import type { ProviderRoundLogFields, ProviderSelection } from '../../providers/provider-gateway.js'

const FakeToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
})

const FakeStepSchema = z.union([
  z.object({
    text: z.string(),
    toolCalls: FakeToolCallSchema.array().optional(),
    usage: z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), cacheReadTokens: z.number().int().nonnegative().optional(), cacheWriteTokens: z.number().int().nonnegative().optional(), cacheHitTokens: z.number().int().nonnegative().optional(), cacheMissTokens: z.number().int().nonnegative().optional() }).optional(),
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
  /** The send/steer signal's W3C traceparent: the turn runs under its own
   * message trace instead of inheriting the workflow-start trace. */
  traceparent: z.string().regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/).optional(),
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
  /** Failed turns only: the underlying error message (sliced, never a
   * stack), so log readers see why without replaying the workflow. */
  errorDetail?: string
}

export interface KarbotTurnDeps {
  persistExecution?(round: number, kind: 'request' | 'response' | 'tool-result', record: Record<string, unknown>): Promise<void>
  /** Round/tool-call journal for execution_rounds/tool_calls. Never throws:
   * the execution journal stays the fail-closed store; a failed round
   * append is a warn-logged gap, never a turn failure. Refs are filled by
   * the activity from its persist stash. */
  recordRound?(round: ProviderRoundInput): Promise<void>
  recordToolCall?(call: ToolCallInput): Promise<void>
  /** Activity attempt for round attribution; absent means 1. */
  attempt?: number
  measureContext?(usage: { inputTokens: number; budget: number; window: number; method: 'exact' | 'estimated' }): Promise<void>
  signal?: AbortSignal
  loadContinuation?(): Promise<{ messages: ChatMessage[]; runKey: string; sources: Array<{ url: string; text: string }>; meta: { round: number; usage: Usage; toolCalls: number; elapsedMs: number; blockedOperations?: RecoveryOperation[]; pendingResponse?: PendingProviderResponse } } | undefined>
  checkpoint?(messages: ChatMessage[], round: number, usage: Usage, toolCalls: number, sources: Array<{ url: string; text: string }>, blockedOperations?: RecoveryOperation[], pendingResponse?: PendingProviderResponse): Promise<void>
  refreshContext?(round: number): Promise<{ references: string[]; notes: string; steering: string[]; paused?: boolean; contextVersion?: number | null; planVersion?: number | null; localVersion?: number }>
  persistSummary?(summary: string, coveredSeq: number): Promise<void>
  loadSessionModel(sessionId: string): Promise<SessionModelSelection | undefined>
  /** Owning sector for sector chats; absent for general Karbot sessions. */
  loadSessionSector?(sessionId: string): Promise<string | undefined>
  /** Chat purpose (chat or context-rewrite); absent means chat. */
  loadSessionPurpose?(sessionId: string): Promise<string | undefined>
  /** Session kind (research or normal); absent means chat budget. */
  loadSessionKind?(sessionId: string): Promise<string | undefined>
  /** Sector context references (digest first) for sector chats. Absent
   * means no sector context rides the turn. */
  loadSectorRefs?(sectorId: string): Promise<string[]>
  /** Sector display name for the identity preload; absent means the
   * sector id stands in for the name. */
  loadSectorName?(sectorId: string): Promise<string | undefined>
  /** Spawn-time parent brief for subagent threads; absent or empty means
   * no inheritance rides the turn. Pinned across rounds like the sector
   * id line. */
  loadInheritedContext?(threadKey: string): Promise<string[]>
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
  log(fields: KarbotTurnLogFields | ProviderRoundLogFields): void
}
