import { describe, expect, it } from 'vitest'
import { DeltaAccumulator, ProviderError, type StreamEvent } from './providers.js'
import { FakeProvider } from './fake.js'
import type { ProviderRequest } from './providers.js'

function request(): ProviderRequest {
  return { systemPrompt: 'sys', messages: [], tools: [], toolChoice: { mode: 'auto' } }
}

describe('DeltaAccumulator', () => {
  it('assembles parallel calls by index in order', () => {
    const accumulator = new DeltaAccumulator()
    const events: StreamEvent[] = [
      { kind: 'toolcall_start', index: 1, key: 'b' },
      { kind: 'toolcall_start', index: 0, key: 'a' },
      { kind: 'toolcall_delta', index: 0, textAppend: '{"x":' },
      { kind: 'toolcall_delta', index: 1, textAppend: '{"y":2}' },
      { kind: 'toolcall_delta', index: 0, textAppend: '1}' },
      {
        kind: 'toolcall_end',
        index: 0,
        call: { id: 'a', name: 'read', args: { x: 1 } },
      },
      {
        kind: 'toolcall_end',
        index: 1,
        call: { id: 'b', name: 'read', args: { y: 2 } },
      },
    ]
    for (const event of events) accumulator.push(event)
    expect(accumulator.calls().map((call) => call.id)).toEqual(['a', 'b'])
  })

  it('ignores deltas for unknown indexes', () => {
    const accumulator = new DeltaAccumulator()
    accumulator.push({ kind: 'toolcall_delta', index: 7, textAppend: 'zzz' })
    expect(accumulator.calls()).toEqual([])
  })
})

describe('FakeProvider', () => {
  it('replays scripted text plus tool calls and records requests', async () => {
    const fake = new FakeProvider([
      {
        text: 'reading first',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.ts' } }],
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      { text: 'done' },
    ])
    const first = await fake.chat(request())
    expect(first.text).toBe('reading first')
    expect(first.toolCalls).toHaveLength(1)
    expect(first.usage.inputTokens).toBe(100)
    const second = await fake.chat(request())
    expect(second.toolCalls).toEqual([])
    expect(fake.calls).toHaveLength(2)
    expect(fake.remaining).toBe(0)
  })

  it('throws scripted errors and exhausts loudly', async () => {
    const fake = new FakeProvider([{ error: 'boom', retryable: true }])
    await expect(fake.chat(request())).rejects.toMatchObject({ name: 'ProviderError' })
    await expect(fake.chat(request())).rejects.toThrow('ran out of scripted steps')
  })

  it('streams start, deltas, end, done in order', async () => {
    const fake = new FakeProvider([
      {
        text: 'hi',
        toolCalls: [{ id: 'c1', name: 'edit', args: { path: 'b' } }],
      },
    ])
    const kinds: string[] = []
    for await (const event of fake.chatStream(request())) {
      kinds.push(event.kind)
    }
    expect(kinds).toEqual([
      'text_delta',
      'toolcall_start',
      'toolcall_delta',
      'toolcall_end',
      'done',
    ])
  })

  it('marks errors retryable only when scripted so', async () => {
    const retryable = new FakeProvider([{ error: 'x', retryable: true }])
    const fatal = new FakeProvider([{ error: 'x' }])
    const retryableError = await retryable.chat(request()).catch((error) => error)
    const fatalError = await fatal.chat(request()).catch((error) => error)
    expect(retryableError).toBeInstanceOf(ProviderError)
    expect((retryableError as ProviderError).retryable).toBe(true)
    expect((fatalError as ProviderError).retryable).toBe(false)
  })
})
