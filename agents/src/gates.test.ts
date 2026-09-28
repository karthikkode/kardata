import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { PlanStore } from './planning.js'
import { TaskLedger, taskTools } from './tasks.js'
import { ToolRegistry, dispatch, type ToolContext } from './tools.js'
import {
  assertNoTripwire,
  checkSubmitterScope,
  checkTodosComplete,
  runGateChain,
  runRubric,
  TripwireError,
} from './gates.js'
import { freezeBrief, runPreflight } from './preflight.js'

function ctx(): ToolContext {
  return { toolCallId: 'c1', toolName: 'task.submit', clock: frozenClock(0), signal: new AbortController().signal }
}

describe('runGateChain', () => {
  it('rejects incomplete todos, bad shape, tripped budgets, child submitters', () => {
    expect(
      runGateChain({
        todos: [{ id: 'todo-1', content: 'a', status: 'in_progress' }],
        submission: { summary: 's' },
        trippedBudgets: [],
        submitter: 'parent',
      }),
    ).toHaveLength(1)
    expect(
      runGateChain({
        todos: [{ id: 'todo-1', content: 'a', status: 'completed' }],
        submission: { summary: '  ' },
        trippedBudgets: ['turns'],
        submitter: 'child',
      }),
    ).toHaveLength(3)
    expect(
      runGateChain({
        todos: [{ id: 'todo-1', content: 'a', status: 'completed' }],
        submission: { summary: 's' },
        trippedBudgets: [],
        submitter: 'parent',
      }),
    ).toEqual([])
  })

  it('names open todos and tripped budgets in errors', () => {
    const errors = runGateChain({
      todos: [
        { id: 'todo-1', content: 'a', status: 'pending' },
        { id: 'todo-2', content: 'b', status: 'completed' },
      ],
      submission: { summary: 's' },
      trippedBudgets: ['cost'],
      submitter: 'parent',
    })
    expect(errors.some((error) => error.includes('todo-1'))).toBe(true)
    expect(errors.some((error) => error.includes('cost'))).toBe(true)
  })

  it('wires into task.submit through the acceptance hook', async () => {
    const store = new PlanStore()
    store.create([{ content: 'a', status: 'in_progress' }])
    const ledger = new TaskLedger()
    const registry = new ToolRegistry()
    for (
      const tool of taskTools(ledger, {
        shouldAccept: (submission) =>
          runGateChain({ todos: store.list(), submission, trippedBudgets: [], submitter: 'parent' }),
      })
    ) {
      registry.register(tool)
    }
    const rejected = await dispatch(registry, { id: 'c1', name: 'task.submit', args: { summary: 's' } }, ctx())
    expect(rejected.isError).toBe(true)
    expect(rejected.content).toContain('not completed')
    store.update([{ content: 'a', status: 'completed' }])
    const accepted = await dispatch(registry, { id: 'c2', name: 'task.submit', args: { summary: 's' } }, ctx())
    expect(accepted.isError).toBe(false)
    expect(ledger.submissions).toHaveLength(1)
  })

  it('rejects child submitters as delegation escapes', () => {
    expect(checkSubmitterScope('child')).toHaveLength(1)
    expect(checkSubmitterScope('parent')).toEqual([])
    expect(checkTodosComplete([])).toEqual([])
  })
})

describe('assertNoTripwire', () => {
  it('halts on empty results and open blockers with typed errors', () => {
    expect(() => assertNoTripwire({ summary: '', detail: '' }, 0)).toThrow(TripwireError)
    try {
      assertNoTripwire({ summary: 's' }, 2)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(TripwireError)
      expect((error as TripwireError).violation).toBe('submit-while-blocked')
    }
    expect(() => assertNoTripwire({ summary: 's' }, 0)).not.toThrow()
    expect(() => assertNoTripwire({ summary: '', detail: 'd' }, 0)).not.toThrow()
  })
})

describe('runRubric', () => {
  it('returns satisfied immediately and fails after max iterations', async () => {
    const quick = await runRubric(() => Promise.resolve('satisfied' as const), 3)
    expect(quick).toEqual({ verdict: 'satisfied', iterations: 1 })
    let calls = 0
    const stubborn = await runRubric(
      () => {
        calls += 1
        return Promise.resolve('needs_revision' as const)
      },
      2,
    )
    expect(stubborn).toEqual({ verdict: 'failed', iterations: 2 })
    expect(calls).toBe(2)
  })
})

describe('runPreflight', () => {
  function input() {
    return {
      scope: 'deep research acme',
      estimatedTokens: 1_000,
      tokenBudget: 10_000,
      tokenUsed: 500,
      requiredTools: ['hound.search'],
      reachableTools: ['hound.search', 'documents.get'],
      duplicateRunning: false,
      expectedPolicyVersion: 'pol1',
      actualPolicyVersion: 'pol1',
    }
  }

  it('issues a receipt when every check passes', () => {
    const result = runPreflight(input(), frozenClock(7_000))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected receipt')
    expect(result.receipt.scope).toBe('deep research acme')
    expect(result.receipt.briefHash).toBe(freezeBrief('deep research acme').briefHash)
    expect(result.receipt.checkedAt).toBe(7_000)
  })

  it('blocks with reasons for budget, tools, duplicates, policy', () => {
    const result = runPreflight(
      {
        ...input(),
        estimatedTokens: 50_000,
        requiredTools: ['hound.search', 'missing.tool'],
        duplicateRunning: true,
        actualPolicyVersion: 'pol0',
      },
      frozenClock(0),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected block')
    expect(result.reasons).toHaveLength(4)
  })

  it('freezes briefs deterministically', () => {
    expect(freezeBrief('a').briefHash).toBe(freezeBrief('a').briefHash)
    expect(freezeBrief('a').briefHash).not.toBe(freezeBrief('b').briefHash)
  })
})
