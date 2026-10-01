import { describe, expect, it } from 'vitest'
import { FakeProvider } from './fake.js'
import { assembledTokens, compactContext, contextInputBudget, ContextBudgetError } from './compaction.js'
import type { ChatMessage, ProviderAdapter } from './providers.js'

describe('independent compaction', () => {
  it('parks summarizer and post-summary measurement failures without losing their cause', async () => {
    const failure = new Error('provider unavailable')
    const messages: ChatMessage[] = Array.from({ length: 8 }, (_, i) => ({ role: 'user', text: `objective ${i}` }))
    const fake = new FakeProvider([{ text: 'Durable summary' }])
    const summarizeFailure: ProviderAdapter = { providerName: 'test', chat: async () => { throw failure }, chatStream: (request) => fake.chatStream(request) }
    await expect(compactContext({ provider: summarizeFailure, system: '', messages, tools: [], force: true })).rejects.toMatchObject({ constructor: ContextBudgetError, cause: failure })
    let counts = 0
    const countFailure: ProviderAdapter = { providerName: 'test', chat: (request) => fake.chat(request), chatStream: (request) => fake.chatStream(request), countInputTokens: async () => { if (++counts === 2) throw failure; return 90000 } }
    await expect(compactContext({ provider: countFailure, system: '', messages, tools: [], force: true })).rejects.toMatchObject({ constructor: ContextBudgetError, cause: failure })
  })
  it('counts system, history and complete tool schemas together', () => {
    const messages: ChatMessage[] = [{ role: 'user', text: 'task' }]
    const plain = assembledTokens('instructions', messages, [])
    expect(assembledTokens('instructions', messages, [{ name: 'lookup', description: 'x'.repeat(8000), parameters: { type: 'object' } }])).toBeGreaterThan(plain + 1500)
    expect(contextInputBudget(48000)).toBe(48000 - 16384)
    expect(contextInputBudget(1_048_576)).toBe(100000)
    expect(() => contextInputBudget(1000)).toThrow(/insufficient/)
  })
  it('uses native counting and keeps provenance across repeated compaction', async () => {
    const fake = new FakeProvider([{ text: 'Objective, decisions, sources and unresolved work.' }])
    let counts = 0
    const provider: ProviderAdapter = { providerName: 'test', chat: (request) => fake.chat(request), chatStream: (request) => fake.chatStream(request), countInputTokens: async (request) => { expect(request.systemPrompt).toBe('system'); counts++; return counts === 1 ? 90000 : 20000 } }
    const original: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `message ${index}`, contextSeq: index + 10 }))
    const before = JSON.stringify(original)
    const outcome = await compactContext({ provider, system: 'system', messages: original, tools: [] })
    expect(outcome.needed).toBe(true)
    if (!outcome.needed) throw new Error('Expected a summary')
    expect(outcome.summary.coveredSeq).toBe(Math.max(...original.slice(outcome.summary.forgetStart, outcome.summary.forgetEnd).map((message) => message.contextSeq ?? 0)))
    expect(outcome.view[0]?.contextSeq).toBe(outcome.summary.coveredSeq)
    expect(JSON.stringify(original)).toBe(before)
    expect(counts).toBe(2)
  })
  it('does not split assistant tool calls from their results', async () => {
    const provider = new FakeProvider([{ text: 'Retained tool findings.' }])
    const messages: ChatMessage[] = [
      { role: 'user', text: 'objective', contextSeq: 1 },
      { role: 'assistant', toolCalls: [{ id: 'call', name: 'fetch', args: {} }], contextSeq: 2 },
      { role: 'tool', toolResult: { toolCallId: 'call', toolName: 'fetch', content: 'evidence', isError: false }, contextSeq: 3 },
      { role: 'assistant', text: 'finding', contextSeq: 4 }, { role: 'user', text: 'next', contextSeq: 5 }, { role: 'assistant', text: 'recent', contextSeq: 6 },
    ]
    const outcome = await compactContext({ provider, system: '', messages, tools: [], force: true })
    if (!outcome.needed) throw new Error('Expected a summary')
    expect(outcome.view.some((message) => message.role === 'tool')).toBe(false)
    expect(outcome.summary.coveredSeq).toBeGreaterThanOrEqual(3)
  })
  it('preserves originals and fails visibly when summary or budget cannot fit', async () => {
    const messages: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({ role: 'user', text: `decision ${i}` }))
    await expect(compactContext({ provider: new FakeProvider([{ text: '' }]), system: '', messages, tools: [], force: true })).rejects.toThrow(/empty summary/)
    await expect(compactContext({ provider: new FakeProvider([]), system: 'p'.repeat(240000), messages, tools: [], force: true })).rejects.toThrow(/Pinned context/)
    expect(messages.map((message) => message.text)).toEqual(Array.from({ length: 6 }, (_, i) => `decision ${i}`))
  })
})
