// One turn of the loop: budget check, provider call, repetition screen,
// dispatch, record. T3.2. The driver (later phases) repeats runTurn until a
// terminal outcome; this unit stays single-turn and fully deterministic.
import {
  BudgetTracker,
  fingerprintAction,
  RepetitionTracker,
  type TrippedBudget,
} from './budgets.js'
import { IdempotencyLog } from './epochs.js'
import { dispatch, ToolRegistry, type ApprovalGate } from './tools.js'
import type {
  ChatMessage,
  ProviderAdapter,
  ProviderResponse,
  ToolResult,
} from './providers.js'
import type { Run } from './loop.js'
import type { Clock } from './clock.js'

export type TurnOutcome =
  | { outcome: 'acted'; results: ToolResult[] }
  | { outcome: 'replied' }
  | { outcome: 'budget'; tripped: TrippedBudget[] }
  | { outcome: 'replan'; callIds: string[] }
  | { outcome: 'blocked'; callIds: string[] }

export interface TurnContext {
  run: Run
  provider: ProviderAdapter
  registry: ToolRegistry
  history: ChatMessage[]
  systemPrompt: string
  budgets: BudgetTracker
  repetition: RepetitionTracker
  executions: IdempotencyLog
  results: Map<string, ToolResult>
  clock: Clock
  gate?: ApprovalGate
  timeoutMs?: number
  estimateProgress?: (response: ProviderResponse) => boolean
  /** Map of call id to suppression reason; suppressed calls become error results. */
  suppressCalls?: (calls: Array<{ id: string; name: string }>) => Map<string, string>
}

export async function runTurn(ctx: TurnContext): Promise<{ response: ProviderResponse; turn: TurnOutcome }> {
  if (ctx.run.state !== 'RUNNING') {
    throw new Error(`runTurn needs a RUNNING run, found ${ctx.run.state}`)
  }
  const tripped = ctx.budgets.tripped()
  if (tripped.length > 0) return { response: emptyResponse(), turn: { outcome: 'budget', tripped } }

  const response = await ctx.provider.chat({
    systemPrompt: ctx.systemPrompt,
    messages: ctx.history,
    tools: ctx.registry.listDefinitions(),
    toolChoice: { mode: 'auto' },
  })
  ctx.budgets.noteTurn((ctx.estimateProgress ?? (() => true))(response))
  ctx.budgets.noteTokens(response.usage.inputTokens + response.usage.outputTokens)

  ctx.history.push({
    role: 'assistant',
    text: response.text,
    toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
  })

  if (response.toolCalls.length === 0) {
    return { response, turn: { outcome: 'replied' } }
  }

  const suppressed = ctx.suppressCalls?.(response.toolCalls) ?? new Map<string, string>()
  const results: ToolResult[] = []
  const replanned: string[] = []
  const blocked: string[] = []
  const runnable: typeof response.toolCalls = []
  for (const call of response.toolCalls) {
    const reason = suppressed.get(call.id)
    if (reason !== undefined) {
      results.push({ toolCallId: call.id, toolName: call.name, content: reason, isError: true })
      continue
    }
    const verdict = ctx.repetition.note(fingerprintAction(call.name, call.args))
    if (verdict === 'replan') {
      replanned.push(call.id)
      results.push({
        toolCallId: call.id,
        toolName: call.name,
        content: 'repeated action: replan before retrying',
        isError: true,
      })
    } else if (verdict === 'blocked') {
      blocked.push(call.id)
      results.push({
        toolCallId: call.id,
        toolName: call.name,
        content: 'repeated action: run suspended as blocked',
        isError: true,
      })
    } else {
      runnable.push(call)
    }
  }

  const controller = new AbortController()
  const fresh: typeof response.toolCalls = []
  for (const call of runnable) {
    // Cross-epoch resume: an action completed under an older epoch is served
    // from cache, never re-executed. Same-epoch repeats reach dispatch and
    // the repetition tracker above governs them.
    const key = `${ctx.run.id}:${call.name}:${JSON.stringify(call.args)}`
    if (ctx.executions.recordedBefore(key, ctx.run.epoch)) {
      const cached = ctx.results.get(key)
      results.push(
        cached ?? {
          toolCallId: call.id,
          toolName: call.name,
          content: `duplicate execution of '${call.name}' from epoch ${ctx.run.epoch} blocked`,
          isError: true,
        },
      )
      continue
    }
    fresh.push(call)
    ctx.executions.record(key, ctx.run.epoch)
  }
  const dispatched = await Promise.all(
    fresh.map((call) => {
      ctx.budgets.noteToolCall()
      return dispatch(
        ctx.registry,
        call,
        { toolCallId: call.id, toolName: call.name, clock: ctx.clock, signal: controller.signal },
        { gate: ctx.gate, timeoutMs: ctx.timeoutMs },
      )
    }),
  )
  for (const result of dispatched) {
    results.push(result)
    const call = fresh.find((c) => c.id === result.toolCallId)
    if (call) {
      ctx.results.set(`${ctx.run.id}:${call.name}:${JSON.stringify(call.args)}`, result)
    }
  }
  for (const result of results) {
    const present = ctx.history.some((m) => m.toolResult?.toolCallId === result.toolCallId)
    if (!present) ctx.history.push({ role: 'tool', toolResult: result })
  }

  if (blocked.length > 0) return { response, turn: { outcome: 'blocked', callIds: blocked } }
  if (replanned.length > 0) return { response, turn: { outcome: 'replan', callIds: replanned } }
  return { response, turn: { outcome: 'acted', results } }
}

function emptyResponse(): ProviderResponse {
  return {
    text: '',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
    },
  }
}
