import { afterEach, describe, expect, it } from 'vitest'
import { OpenAICompatAdapter } from './openai-compat.js'
import { ProviderError, type ProviderRequest } from './providers.js'
import { startStubEndpoint, type StubEndpoint } from './stub.js'

let stub: StubEndpoint | undefined

afterEach(async () => {
  await stub?.close()
  stub = undefined
})

function request(): ProviderRequest {
  return { systemPrompt: 'sys', messages: [{ role: 'user', text: 'go' }], tools: [], toolChoice: { mode: 'auto' } }
}

const chatBody = {
  choices: [{ index: 0, message: { role: 'assistant', content: 'stubbed' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
}

describe('startStubEndpoint', () => {
  it('serves a scripted chat completion over real HTTP', async () => {
    stub = await startStubEndpoint({ '/chat/completions': { kind: 'json', body: chatBody } })
    const adapter = new OpenAICompatAdapter({ apiKey: 'x', model: 'stub', baseUrl: stub.url })
    const response = await adapter.chat(request())
    expect(response.text).toBe('stubbed')
    expect(response.usage.inputTokens).toBe(10)
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0]?.path).toBe('/chat/completions')
  })

  it('streams SSE chunks to toolcall_end', async () => {
    stub = await startStubEndpoint({
      '/chat/completions': {
        kind: 'sse',
        chunks: [
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"s1","type":"function","function":{"name":"ping","arguments":""}}]}}]}',
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}',
        ],
      },
    })
    const adapter = new OpenAICompatAdapter({ apiKey: 'x', model: 'stub', baseUrl: stub.url })
    const kinds: string[] = []
    for await (const event of adapter.chatStream(request())) kinds.push(event.kind)
    expect(kinds).toEqual(['toolcall_start', 'toolcall_delta', 'toolcall_end', 'done'])
  })

  it('fails once then recovers for retry tests', async () => {
    stub = await startStubEndpoint({
      '/chat/completions': { kind: 'flaky', failStatus: 429, body: chatBody },
    })
    const adapter = new OpenAICompatAdapter({ apiKey: 'x', model: 'stub', baseUrl: stub.url })
    const first = await adapter.chat(request()).catch((error) => error)
    expect(first).toBeInstanceOf(ProviderError)
    expect((first as ProviderError).retryable).toBe(true)
    const second = await adapter.chat(request())
    expect(second.text).toBe('stubbed')
  })

  it('returns 404 for unscripted paths', async () => {
    stub = await startStubEndpoint({})
    const adapter = new OpenAICompatAdapter({ apiKey: 'x', model: 'stub', baseUrl: stub.url })
    await expect(adapter.chat(request())).rejects.toMatchObject({ name: 'ProviderError' })
  })
})
