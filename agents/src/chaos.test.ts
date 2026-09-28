// Chaos and resume matrix: kill at every phase, resume from transcript
// state, assert exactly-once effects. T10.3. Each case drops all in-memory
// driver state mid-run and continues with a fresh harness over the same
// idempotency log, history, and budgets.
import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { FakeProvider } from './fake.js'
import { createRun, transition } from './loop.js'
import { BudgetTracker, RepetitionTracker, type BudgetLimits } from './budgets.js'
import { IdempotencyLog, pauseRun, resumeRun } from './epochs.js'
import { dispatch, ToolRegistry } from './tools.js'
import { runTurn } from './turn.js'
import type { ChatMessage, ToolResult } from './providers.js'

function limits(): BudgetLimits {
  return {
    maxTurns: 10,
    maxToolCalls: 20,
    maxTokens: 100_000,
    maxCost: 10,
    maxWallMs: 60_000,
    maxStalledTurns: 5,
  }
}

describe('chaos matrix', () => {
  it('kill between turns: resume serves cache, history continues, effects apply once', async () => {
    let writes = 0
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'write', description: 'w', parameters: { type: 'object' } },
      handler: () => {
        writes += 1
        return Promise.resolve({ content: 'written' })
      },
    })
    const step = { text: 'go', toolCalls: [{ id: 'c1', name: 'write', args: {} }] }
    const history: ChatMessage[] = [{ role: 'user', text: 'go' }]
    const executions = new IdempotencyLog()
    const results = new Map<string, ToolResult>()
    const clock = frozenClock(0)
    const run = createRun()
    transition(run, 'RUNNING')

    // Epoch 0: one turn, then the process dies (all driver state dropped).
    {
      const provider = new FakeProvider([step])
      await runTurn({
        run,
        provider,
        registry,
        history,
        systemPrompt: 'sys',
        budgets: new BudgetTracker(limits(), clock),
        repetition: new RepetitionTracker(),
        executions,
        results,
        clock,
      })
    }
    expect(writes).toBe(1)

    // Epoch 1: same run id rehydrated, fresh harness, model re-issues the action.
    {
      pauseRun(run)
      resumeRun(run)
      const provider = new FakeProvider([step, { text: 'final' }])
      const first = await runTurn({
        run,
        provider,
        registry,
        history,
        systemPrompt: 'sys',
        budgets: new BudgetTracker(limits(), clock),
        repetition: new RepetitionTracker(),
        executions,
        results,
        clock,
      })
      expect(first.turn.outcome).toBe('acted')
      const second = await runTurn({
        run,
        provider,
        registry,
        history,
        systemPrompt: 'sys',
        budgets: new BudgetTracker(limits(), clock),
        repetition: new RepetitionTracker(),
        executions,
        results,
        clock,
      })
      expect(second.turn.outcome).toBe('replied')
    }
    expect(writes).toBe(1)
    // The cached result carries the re-issued call id, already present from
    // epoch 0: history holds one tool entry, not a duplicate.
    expect(history.filter((m) => m.role === 'tool')).toHaveLength(1)
    expect(history.filter((m) => m.role === 'assistant')).toHaveLength(3)
  })

  it('kill during tool execution: abort reaches the handler, keyed retry applies once', async () => {
    let starts = 0
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'slow', description: 's', parameters: { type: 'object' } },
      handler: (_args, handlerCtx) =>
        new Promise<{ content: string }>((resolve) => {
          starts += 1
          handlerCtx.signal.addEventListener('abort', () => resolve({ content: 'aborted-write' }))
        }),
    })
    const clock = frozenClock(0)
    const controller = new AbortController()
    const executions = new IdempotencyLog()
    const results = new Map<string, ToolResult>()
    const call = { id: 'c1', name: 'slow', args: {} }
    const pending = dispatch(
      registry,
      call,
      { toolCallId: 'c1', toolName: 'slow', clock, signal: controller.signal },
      { idempotencyKey: 'run-1:slow:{}', executions, results },
    )
    controller.abort()
    const killed = await pending
    expect(killed.content).toBe('aborted-write')
    // Retry under a new epoch with the same key returns the recorded result.
    const retry = await dispatch(
      registry,
      { id: 'c2', name: 'slow', args: {} },
      {
        toolCallId: 'c2',
        toolName: 'slow',
        clock,
        signal: new AbortController().signal,
      },
      { idempotencyKey: 'run-1:slow:{}', executions, results },
    )
    expect(retry.content).toBe('aborted-write')
    expect(starts).toBe(1)
  })

  it('provider failure then retry: the run continues on the next turn', async () => {
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'ping', description: 'p', parameters: { type: 'object' } },
      handler: () => Promise.resolve({ content: 'pong' }),
    })
    const run = createRun()
    transition(run, 'RUNNING')
    const history: ChatMessage[] = [{ role: 'user', text: 'go' }]
    const clock = frozenClock(0)
    const context = {
      run,
      provider: new FakeProvider([
        { error: 'socket hangup', retryable: true },
        { text: 'retry', toolCalls: [{ id: 'c1', name: 'ping', args: {} }] },
      ]),
      registry,
      history,
      systemPrompt: 'sys',
      budgets: new BudgetTracker(limits(), clock),
      repetition: new RepetitionTracker(),
      executions: new IdempotencyLog(),
      results: new Map<string, ToolResult>(),
      clock,
    }
    await expect(runTurn(context)).rejects.toThrow('socket hangup')
    const retry = await runTurn(context)
    expect(retry.turn.outcome).toBe('acted')
  })

  it('budget trip mid-run halts before further provider calls', async () => {
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'ping', description: 'p', parameters: { type: 'object' } },
      handler: () => Promise.resolve({ content: 'pong' }),
    })
    const run = createRun()
    transition(run, 'RUNNING')
    const clock = frozenClock(0)
    const budgets = new BudgetTracker({ ...limits(), maxToolCalls: 1 }, clock)
    const history: ChatMessage[] = [{ role: 'user', text: 'go' }]
    const base = {
      run,
      provider: new FakeProvider([
        { text: 'one', toolCalls: [{ id: 'c1', name: 'ping', args: {} }] },
        { text: 'two', toolCalls: [{ id: 'c2', name: 'ping', args: {} }] },
      ]),
      registry,
      history,
      systemPrompt: 'sys',
      budgets,
      repetition: new RepetitionTracker(),
      executions: new IdempotencyLog(),
      results: new Map<string, ToolResult>(),
      clock,
    }
    const first = await runTurn(base)
    expect(first.turn.outcome).toBe('acted')
    const second = await runTurn(base)
    expect(second.turn.outcome).toBe('budget')
  })
})
