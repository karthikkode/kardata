import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { FakeProvider } from './fake.js'
import { createRun, transition } from './loop.js'
import { BudgetTracker, RepetitionTracker, type BudgetLimits } from './budgets.js'
import { IdempotencyLog } from './epochs.js'
import { PlanStore, planTools, suppressDuplicatePlanWrites } from './planning.js'
import { TaskLedger, taskTools } from './tasks.js'
import { ToolRegistry, dispatch, type ToolContext } from './tools.js'
import { runTurn } from './turn.js'
import type { ChatMessage, ToolResult } from './providers.js'

function limits(): BudgetLimits {
  return {
    maxTurns: 10,
    maxToolCalls: 20,
    maxTokens: 100_000,
    maxCost: 10,
    maxWallMs: 60_000,
    maxStalledTurns: 3,
  }
}

function ctx(): ToolContext {
  return {
    toolCallId: 'c1',
    toolName: 'plan.create',
    clock: frozenClock(0),
    signal: new AbortController().signal,
  }
}

describe('PlanStore', () => {
  it('creates with exactly one in progress, rejects zero or two', () => {
    const store = new PlanStore()
    expect(store.create([{ content: 'a', status: 'pending' }]).ok).toBe(false)
    expect(
      store.create([
        { content: 'a', status: 'in_progress' },
        { content: 'b', status: 'in_progress' },
      ]).ok,
    ).toBe(false)
    const created = store.create([
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'pending' },
    ])
    expect(created.ok).toBe(true)
  })

  it('replaces the whole list on update and appends on add', () => {
    const store = new PlanStore()
    store.create([{ content: 'a', status: 'in_progress' }])
    const updated = store.update([{ content: 'b', status: 'completed' }])
    expect(updated.ok).toBe(true)
    if (updated.ok) expect(updated.todos.map((todo) => todo.content)).toEqual(['b'])
    const added = store.add('c')
    expect(added.ok).toBe(true)
    if (added.ok) expect(added.todos.map((todo) => todo.status)).toEqual(['completed', 'pending'])
  })

  it('keeps blocked items in progress and records the blocker pending', () => {
    const store = new PlanStore()
    const created = store.create([{ content: 'a', status: 'in_progress' }])
    if (!created.ok) throw new Error('fixture failed')
    const id = created.todos[0]?.id ?? ''
    const blocked = store.block(id, 'waiting on docs')
    expect(blocked.ok).toBe(true)
    if (blocked.ok) {
      expect(blocked.todos.map((todo) => todo.status)).toEqual(['in_progress', 'pending'])
      expect(blocked.todos[1]?.content).toContain('waiting on docs')
    }
    expect(store.block('missing', 'x').ok).toBe(false)
  })
})

describe('plan tools', () => {
  it('enforce discipline through the registry', async () => {
    const registry = new ToolRegistry()
    for (const tool of planTools(new PlanStore())) registry.register(tool)
    const ok = await dispatch(
      registry,
      { id: 'c1', name: 'plan.create', args: { todos: [{ content: 'a', status: 'in_progress' }] } },
      ctx(),
    )
    expect(ok.isError).toBe(false)
    const bad = await dispatch(
      registry,
      { id: 'c2', name: 'plan.create', args: { todos: [{ content: 'a', status: 'pending' }] } },
      ctx(),
    )
    expect(bad.isError).toBe(true)
    expect(bad.content).toContain('exactly one in_progress')
  })

  it('suppresses parallel plan writes in one turn, keeping the first', () => {
    const suppressed = suppressDuplicatePlanWrites([
      { id: 'c1', name: 'plan.create' },
      { id: 'c2', name: 'plan.update' },
      { id: 'c3', name: 'plan.list' },
    ])
    expect([...suppressed.keys()]).toEqual(['c2'])
  })
})

describe('task tools', () => {
  it('records lifecycle entries and gates submit through the hook', async () => {
    const ledger = new TaskLedger()
    const registry = new ToolRegistry()
    for (const tool of taskTools(ledger, { shouldAccept: () => ['todos incomplete'] })) {
      registry.register(tool)
    }
    const submit = await dispatch(registry, { id: 'c1', name: 'task.submit', args: { summary: 's' } }, ctx())
    expect(submit.isError).toBe(true)
    expect(submit.content).toContain('todos incomplete')
    expect(ledger.submissions).toHaveLength(0)

    const open = new TaskLedger()
    const openRegistry = new ToolRegistry()
    for (const tool of taskTools(open)) openRegistry.register(tool)
    const accepted = await dispatch(
      openRegistry,
      { id: 'c2', name: 'task.submit', args: { summary: 's', detail: 'd' } },
      ctx(),
    )
    expect(accepted.isError).toBe(false)
    expect(open.submissions).toHaveLength(1)
    await dispatch(openRegistry, { id: 'c3', name: 'task.report_blocker', args: { reason: 'r' } }, ctx())
    await dispatch(openRegistry, { id: 'c4', name: 'task.fail', args: { reason: 'f' } }, ctx())
    expect(open.blockers).toHaveLength(1)
    expect(open.failures).toHaveLength(1)
  })
})

describe('runTurn', () => {
  function harness(provider: FakeProvider, registry: ToolRegistry) {
    const run = createRun()
    transition(run, 'RUNNING')
    const history: ChatMessage[] = [{ role: 'user', text: 'go' }]
    const context = {
      run,
      provider,
      registry,
      history,
      systemPrompt: 'sys',
      budgets: new BudgetTracker(limits(), frozenClock(0)),
      repetition: new RepetitionTracker(),
      executions: new IdempotencyLog(),
      results: new Map<string, ToolResult>(),
      clock: frozenClock(0),
    }
    return { run, history, context }
  }

  it('runs a full plan-write plus submit script end to end', async () => {
    const registry = new ToolRegistry()
    const store = new PlanStore()
    const ledger = new TaskLedger()
    for (const tool of [...planTools(store), ...taskTools(ledger)]) registry.register(tool)
    const provider = new FakeProvider([
      {
        text: 'planning',
        toolCalls: [
          { id: 'c1', name: 'plan.create', args: { todos: [{ content: 'a', status: 'in_progress' }] } },
        ],
      },
      {
        text: 'submitting',
        toolCalls: [{ id: 'c2', name: 'task.submit', args: { summary: 'done' } }],
      },
      { text: 'final answer' },
    ])
    const first = harness(provider, registry)
    const turn1 = await runTurn(first.context)
    expect(turn1.turn.outcome).toBe('acted')
    expect(store.list()).toHaveLength(1)
    const turn2 = await runTurn(first.context)
    expect(turn2.turn.outcome).toBe('acted')
    expect(ledger.submissions).toHaveLength(1)
    const turn3 = await runTurn(first.context)
    expect(turn3.turn.outcome).toBe('replied')
    expect(first.history.filter((m) => m.role === 'tool')).toHaveLength(2)
  })

  it('suppresses the second parallel plan write (donor-ported discipline)', async () => {
    const registry = new ToolRegistry()
    for (const tool of planTools(new PlanStore())) registry.register(tool)
    const provider = new FakeProvider([
      {
        text: 'two writes',
        toolCalls: [
          { id: 'c1', name: 'plan.create', args: { todos: [{ content: 'a', status: 'in_progress' }] } },
          { id: 'c2', name: 'plan.update', args: { todos: [{ content: 'b', status: 'completed' }] } },
        ],
      },
    ])
    const { context } = harness(provider, registry)
    const { turn } = await runTurn({ ...context, suppressCalls: suppressDuplicatePlanWrites })
    expect(turn.outcome).toBe('acted')
    if (turn.outcome === 'acted') {
      const byId = new Map(turn.results.map((result) => [result.toolCallId, result]))
      expect(byId.get('c1')?.isError).toBe(false)
      expect(byId.get('c2')?.isError).toBe(true)
      expect(byId.get('c2')?.content).toContain('one plan mutation per turn')
    }
  })

  it('halts on tripped budgets before calling the provider', async () => {
    const registry = new ToolRegistry()
    const provider = new FakeProvider([{ text: 'never' }])
    const { context } = harness(provider, registry)
    context.budgets.noteTurn(true)
    for (let i = 0; i < 10; i++) context.budgets.noteTurn(true)
    const { turn } = await runTurn(context)
    expect(turn.outcome).toBe('budget')
    expect(provider.calls).toHaveLength(0)
  })

  it('suspends on the third repeat without dispatching', async () => {
    const registry = new ToolRegistry()
    let calls = 0
    registry.register({
      definition: { name: 'poll', description: 'p', parameters: { type: 'object' } },
      handler: () => {
        calls += 1
        return Promise.resolve({ content: 'same' })
      },
    })
    const step = { text: 'again', toolCalls: [{ id: 'c1', name: 'poll', args: {} }] }
    const provider = new FakeProvider([step, step, step, step])
    const { context } = harness(provider, registry)
    await runTurn(context)
    await runTurn(context)
    const third = await runTurn(context)
    expect(third.turn.outcome).toBe('replan')
    const fourth = await runTurn(context)
    expect(fourth.turn.outcome).toBe('blocked')
    expect(calls).toBe(2)
  })

  it('serves cross-epoch repeats from cache instead of re-executing', async () => {
    let calls = 0
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'write', description: 'w', parameters: { type: 'object' } },
      handler: () => {
        calls += 1
        return Promise.resolve({ content: 'written' })
      },
    })
    const step = { text: 'again', toolCalls: [{ id: 'c1', name: 'write', args: {} }] }
    const provider = new FakeProvider([step, step])
    const { context, run } = harness(provider, registry)
    const first = await runTurn(context)
    expect(first.turn.outcome).toBe('acted')
    expect(calls).toBe(1)
    // Simulate kill plus resume: new epoch, same logical action re-issued.
    run.epoch += 1
    const second = await runTurn(context)
    expect(second.turn.outcome).toBe('acted')
    expect(calls).toBe(1)
    if (second.turn.outcome === 'acted') {
      expect(second.turn.results[0]?.content).toBe('written')
    }
  })

  it('requires a RUNNING run', async () => {
    const registry = new ToolRegistry()
    const { context, run } = harness(new FakeProvider([]), registry)
    run.state = 'PAUSED'
    await expect(runTurn(context)).rejects.toThrow('RUNNING')
  })
})
