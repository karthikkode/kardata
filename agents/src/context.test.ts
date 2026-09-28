import { describe, expect, it } from 'vitest'
import {
  assembleContext,
  assembleReferences,
  canonicalRequestBytes,
  createSnapshot,
  describeCachePolicy,
  describeSegments,
  estimateMessagesTokens,
  estimateTokens,
  partitionHistory,
  type AssembleInput,
} from './context.js'
import { condense, UnitLedger } from './condense.js'
import { emptyUsage, type ChatMessage } from './providers.js'

function input(): AssembleInput {
  return {
    system: ['You are Karbot.'],
    tools: [
      {
        name: 'b',
        description: 'second',
        parameters: { type: 'object' },
      },
      {
        name: 'a',
        description: 'first',
        parameters: { type: 'object' },
      },
    ],
    references: ['Ref doc.'],
    history: [{ role: 'user', text: 'hello' }],
    tail: [{ role: 'user', text: 'now?' }],
  }
}

describe('assembleContext', () => {
  it('orders stable prefix first and volatile tail last', () => {
    const request = assembleContext(input())
    expect(request.systemPrompt).toContain('You are Karbot.')
    expect(request.systemPrompt).toContain('Ref doc.')
    expect(request.messages.map((m) => m.text)).toEqual(['hello', 'now?'])
  })

  it('serializes deterministically: same input, same bytes', () => {
    expect(canonicalRequestBytes(assembleContext(input()))).toBe(
      canonicalRequestBytes(assembleContext(input())),
    )
  })
})

describe('describeCachePolicy', () => {
  it('states documented rules, Meta automatic', () => {
    expect(describeCachePolicy('anthropic')).toMatchObject({
      known: true,
      maxBreakpoints: 4,
      lookbackBlocks: 20,
    })
    expect(describeCachePolicy('openai')).toMatchObject({ known: true, minCacheableTokens: 1024 })
    expect(describeCachePolicy('meta')).toMatchObject({ known: true, automatic: true })
  })
})

describe('partitionHistory', () => {
  it('splits stable prefix from volatile tail', () => {
    const messages: ChatMessage[] = [
      { role: 'user', text: 'a' },
      { role: 'user', text: 'b' },
      { role: 'user', text: 'c' },
    ]
    const { stable, volatile } = partitionHistory(messages, 1)
    expect(stable.map((m) => m.text)).toEqual(['a', 'b'])
    expect(volatile.map((m) => m.text)).toEqual(['c'])
  })
})

describe('createSnapshot', () => {
  it('hashes identically for identical requests and differs on change', () => {
    const versions = { tools: { b: '1', a: '1' }, prompt: 'p1', policy: 'pol1' }
    const first = createSnapshot(assembleContext(input()), versions)
    const second = createSnapshot(assembleContext(input()), versions)
    expect(first.hash).toBe(second.hash)
    const changed = assembleContext({ ...input(), tail: [{ role: 'user', text: 'other' }] })
    expect(createSnapshot(changed, versions).hash).not.toBe(first.hash)
    expect(first.messageCount).toBe(2)
    expect(first.toolCount).toBe(2)
  })

  it('links parent snapshots', () => {
    const versions = { tools: {}, prompt: 'p1', policy: 'pol1' }
    const parent = createSnapshot(assembleContext(input()), versions)
    const child = createSnapshot(assembleContext(input()), versions, parent.hash)
    expect(child.parentHash).toBe(parent.hash)
  })
})

describe('condense', () => {
  function messages(): ChatMessage[] {
    return [
      { role: 'system', text: 'sys' },
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1', toolCalls: [{ id: 'c1', name: 't', args: {} }] },
      { role: 'tool', toolResult: { toolCallId: 'c1', toolName: 't', content: 'r1', isError: false } },
      { role: 'user', text: 'q2' },
      { role: 'assistant', text: 'a2' },
      { role: 'user', text: 'q3' },
      { role: 'assistant', text: 'a3' },
    ]
  }

  it('returns not needed under budget', async () => {
    const result = await condense({
      messages: messages(),
      keepFirst: 1,
      maxSize: 20,
      summarize: () => Promise.resolve('s'),
    })
    expect(result).toEqual({ needed: false })
  })

  it('projects head plus linked summary plus tail without splitting pairs', async () => {
    const seen: ChatMessage[][] = []
    const result = await condense({
      messages: messages(),
      keepFirst: 1,
      maxSize: 4,
      minimumProgress: 0,
      summarize: (forgotten) => {
        seen.push(forgotten)
        return Promise.resolve('middle stuff')
      },
    })
    expect(result.needed).toBe(true)
    if (!result.needed) throw new Error('expected condensation')
    // Pinned head intact.
    expect(result.view[0]).toEqual({ role: 'system', text: 'sys' })
    // Edges snap to group boundaries: keepFirst plus a two-message tail.
    expect(result.summary.forgetStart).toBe(1)
    expect(result.summary.forgetEnd).toBe(6)
    expect(seen).toHaveLength(1)
    const forgotten = seen[0] ?? []
    expect(forgotten).toHaveLength(5)
    // The assistant call and its tool result travel together.
    const texts = forgotten.map((message) => message.text ?? message.toolResult?.content)
    expect(texts).toContain('a1')
    expect(texts).toContain('r1')
    // Original input untouched.
    expect(messages()).toHaveLength(8)
  })

  it('refuses trivial forget ranges', async () => {
    await expect(
      condense({
        messages: [{ role: 'user', text: 'a' }],
        keepFirst: 0,
        maxSize: 0,
        force: true,
        summarize: () => Promise.resolve('s'),
      }),
    ).rejects.toThrow('no progress')
  })
})

describe('UnitLedger', () => {
  it('attributes per-unit cost and rolls up run totals', () => {
    const ledger = new UnitLedger()
    ledger.record(
      'compaction',
      { ...emptyUsage(), inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 200_000 },
      { inputPricePerMTok: 1, outputPricePerMTok: 4 },
    )
    ledger.record(
      'research',
      { ...emptyUsage(), inputTokens: 2_000_000, outputTokens: 0, cacheReadTokens: 0 },
      { inputPricePerMTok: 10, outputPricePerMTok: 40 },
    )
    expect(ledger.forUnit('compaction')?.cost).toBeCloseTo(3)
    expect(ledger.runTotal()).toMatchObject({ inputTokens: 3_000_000, cacheReadTokens: 200_000 })
    expect(ledger.runTotal().cost).toBeCloseTo(23)
  })
})

describe('estimateTokens', () => {
  it('estimates roughly four characters per token and zero for empty text', () => {
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('sums text and tool payloads across messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', text: 'abcd' },
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: { q: 'abcdefgh' } }] },
    ]
    const expected = estimateTokens('abcd') + estimateTokens(JSON.stringify([{ id: 'c1', name: 'db.list_sessions', args: { q: 'abcdefgh' } }]))
    expect(estimateMessagesTokens(messages)).toBe(expected)
  })
})

describe('describeSegments', () => {
  it('reports per-segment message counts and estimated tokens', () => {
    const usage = describeSegments(input())
    expect(usage.history.messages).toBe(1)
    expect(usage.tail.messages).toBe(1)
    expect(usage.system.estimatedTokens).toBe(estimateTokens('You are Karbot.'))
    expect(usage.references.estimatedTokens).toBe(estimateTokens('Ref doc.'))
    expect(usage.totalEstimatedTokens).toBe(
      usage.system.estimatedTokens +
        usage.references.estimatedTokens +
        usage.history.estimatedTokens +
        usage.tail.estimatedTokens,
    )
  })
})

describe('assembleReferences', () => {
  it('sorts by document then ord and drops exact duplicates', () => {
    const refs = assembleReferences([
      { documentId: 'b', ord: 1, text: 'two' },
      { documentId: 'a', ord: 1, text: 'one-b' },
      { documentId: 'a', ord: 0, text: 'one-a' },
      { documentId: 'a', ord: 0, text: 'one-a' },
    ])
    expect(refs).toEqual(['[a:0] one-a', '[a:1] one-b', '[b:1] two'])
  })
})
