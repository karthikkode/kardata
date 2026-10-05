import { describe, expect, it } from 'vitest'
import { FakeProvider } from './fake.js'
import { assembledTokens, compactContext, contextInputBudget, ContextBudgetError, measureInputTokens } from './compaction.js'
import { TokenCountUnavailableError, ProviderError, type ChatMessage, type ProviderAdapter } from './providers.js'
import { MetaAdapter } from './meta.js'

describe('independent compaction', () => {
  it('uses a caller conservative whole-request estimate only for typed counting unavailability', async () => {
    const fake = new FakeProvider([]), request = { systemPrompt: 'TEST', messages: [], tools: [], toolChoice: { mode: 'none' as const } }
    const provider = { ...fake, providerName: 'TEST', chat: fake.chat.bind(fake), chatStream: fake.chatStream.bind(fake), countInputTokens: async () => { throw new TokenCountUnavailableError('billing_not_configured', 402) } }
    expect(await measureInputTokens(provider, request, () => 4321)).toEqual({ inputTokens: 4321, method: 'estimated' })
    const failure = new ProviderError('TEST unrelated counter failure', true)
    await expect(measureInputTokens({ ...provider, countInputTokens: async () => { throw failure } }, request, () => 0)).rejects.toBe(failure)
    expect(fake.calls).toEqual([])
  })
  it.each([NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid native count %s rather than estimating or using zero', async (count) => {
    const fake = new FakeProvider([]), provider = { providerName: 'TEST', chat: fake.chat.bind(fake), chatStream: fake.chatStream.bind(fake), countInputTokens: async () => count }
    await expect(measureInputTokens(provider, { systemPrompt: 'TEST', messages: [], tools: [], toolChoice: { mode: 'auto' } }, () => 0)).rejects.toBeInstanceOf(ContextBudgetError)
  })
  it('records exact then estimated when only the post-summary count endpoint becomes unavailable', async () => {
    const fake = new FakeProvider([{ text: 'TEST retained objectives and source identifiers.' }]), methods: string[] = []
    let counts = 0
    const provider = { providerName: 'TEST', chat: fake.chat.bind(fake), chatStream: fake.chatStream.bind(fake), countInputTokens: async () => { if (++counts === 1) return 90000; throw new TokenCountUnavailableError('unsupported', 404) } }
    const messages: ChatMessage[] = Array.from({ length: 8 }, (_, index) => ({ role: 'user', text: `TEST original ${index}`, contextSeq: index + 1 }))
    const original = JSON.stringify(messages)
    expect((await compactContext({ provider, system: 'TEST', messages, tools: [], onMeasurement: async (value) => { methods.push(value.method) } })).needed).toBe(true)
    expect(methods).toEqual(['exact', 'estimated']); expect(JSON.stringify(messages)).toBe(original)
    expect(fake.calls).toHaveLength(1)
  })
  it('uses a labeled whole-request estimate for exact count-endpoint unavailability without a generation call', async () => {
    const calls: string[] = []
    const provider = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: async (url) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ error: { code: 'billing_not_configured', message: 'TEST count endpoint only' } }), { status: 402 })
    } })
    const system = 'TEST instructions\n\nTEST source references', messages: ChatMessage[] = [{ role: 'user', text: 'TEST task', images: [{ mediaType: 'image/png', base64: 'TEST image' }] }]
    const tools = [{ name: 'TEST lookup', description: 'TEST full schema ' + 'A'.repeat(2000), parameters: { type: 'object' as const, properties: { TESTfield: { type: 'string' } } } }]
    const measurements: Array<{ inputTokens: number; method: string }> = []
    expect(await compactContext({ provider, system, messages, tools, onMeasurement: async (value) => { measurements.push(value) } })).toEqual({ needed: false })
    expect(measurements).toHaveLength(1)
    expect(measurements[0]).toMatchObject({ inputTokens: assembledTokens(system, messages, tools), method: 'estimated' })
    expect(measurements[0]!.inputTokens).toBeGreaterThan(1500)
    expect(calls.every((url) => url.endsWith('/responses/input_tokens'))).toBe(true)
  })
  it('keeps unrelated count503 failures parked with originals and no generation', async () => {
    const provider = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: async () => new Response('{}', { status: 503 }) })
    await expect(compactContext({ provider, system: 'TEST', messages: [{ role: 'user', text: 'TEST retained' }], tools: [] })).rejects.toBeInstanceOf(ContextBudgetError)
  })
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
  it('refuses short over-budget histories instead of compacting them unsafely', async () => {
    const fake = new FakeProvider([])
    const provider: ProviderAdapter = { providerName: 'test', chat: (request) => fake.chat(request), chatStream: (request) => fake.chatStream(request), countInputTokens: async () => 90000 }
    const messages: ChatMessage[] = [{ role: 'user', text: 'TEST huge pasted notes' }, { role: 'assistant', text: 'TEST ack' }, { role: 'user', text: 'TEST more pasted notes' }]
    await expect(compactContext({ provider, system: 'TEST', messages, tools: [] })).rejects.toThrow('Context cannot be compacted safely. Reduce the current input.')
    expect(fake.calls).toHaveLength(0)
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
  it.each(['incomplete', 'tool-call'] as const)('preserves original history when the summary is %s', async (failure) => {
    const messages: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({ role: 'user', text: `required decision ${i}`, contextSeq: i + 1 }))
    const original = structuredClone(messages)
    const provider = new FakeProvider([{ text: 'Partial working memory', ...(failure === 'incomplete' ? { completion: 'incomplete' as const } : { toolCalls: [{ id: 'unexpected', name: 'mutate', args: {} }] }) }])
    await expect(compactContext({ provider, system: '', messages, tools: [], force: true })).rejects.toBeInstanceOf(ContextBudgetError)
    expect(messages).toEqual(original)
    expect(provider.calls).toHaveLength(1)
  })
  it('preserves originals and fails visibly when summary or budget cannot fit', async () => {
    const messages: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({ role: 'user', text: `decision ${i}` }))
    await expect(compactContext({ provider: new FakeProvider([{ text: '' }]), system: '', messages, tools: [], force: true })).rejects.toThrow(/empty summary/)
    await expect(compactContext({ provider: new FakeProvider([]), system: 'p'.repeat(240000), messages, tools: [], force: true })).rejects.toThrow(/Pinned context/)
    expect(messages.map((message) => message.text)).toEqual(Array.from({ length: 6 }, (_, i) => `decision ${i}`))
  })
})
