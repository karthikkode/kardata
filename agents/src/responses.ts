// Responses-API wire transport (Meta mode). T2.3. Flat function tools,
// function_call / function_call_output items, previous_response_id chaining
// left to the caller: Karbot re-sends full history (own ledger first).
import {
  emptyUsage,
  ProviderError,
  type ProviderRequest,
  type ProviderResponse,
  type StreamEvent,
  type ToolCallRequest,
  type ToolChoice,
  type Usage,
} from './providers.js'
import { readSseData } from './transport.js'

export interface ResponsesTransportConfig {
  baseUrl: string
  apiKey: string
  model: string
  fetchFn?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toInputItems(systemPrompt: string, request: ProviderRequest): unknown[] {
  const out: unknown[] = [{ type: 'message', role: 'system', content: systemPrompt }]
  for (const message of request.messages) {
    if (message.role === 'tool' && message.toolResult) {
      out.push({
        type: 'function_call_output',
        call_id: message.toolResult.toolCallId,
        output: message.toolResult.content,
      })
    } else if (message.role === 'assistant' && message.toolCalls) {
      if (message.text) out.push({ type: 'message', role: 'assistant', content: message.text })
      for (const call of message.toolCalls) {
        out.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args),
        })
      }
    } else if (message.images !== undefined && message.images.length > 0) {
      out.push({
        type: 'message',
        role: message.role,
        content: [
          ...(message.text ? [{ type: 'input_text', text: message.text }] : []),
          ...message.images.map((image) => ({
            type: 'input_image',
            image_url: `data:${image.mediaType};base64,${image.base64}`,
          })),
        ],
      })
    } else {
      out.push({ type: 'message', role: message.role, content: message.text ?? '' })
    }
  }
  return out
}
export async function responsesInputTokens(config: ResponsesTransportConfig, request: ProviderRequest): Promise<number> {
  const response = await (config.fetchFn ?? fetch)(`${config.baseUrl}/responses/input_tokens`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    body: JSON.stringify({ model: config.model, input: toInputItems(request.systemPrompt, request), tools: request.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })) }),
  })
  if (!response.ok) throw new ProviderError(`Input token count failed with HTTP ${response.status}`, response.status >= 500)
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body['input_tokens'] !== 'number' || !Number.isInteger(body['input_tokens']) || body['input_tokens'] < 0) throw new ProviderError('Invalid input token count', false)
  return body['input_tokens']
}

function toToolChoice(choice: ToolChoice): unknown {
  switch (choice.mode) {
    case 'auto':
      return 'auto'
    case 'required':
      return 'required'
    case 'none':
      return 'none'
    case 'named':
      return { type: 'function', name: choice.name }
  }
}

function parseArgs(callId: string, raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (!isRecord(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw new ProviderError(`Unparseable tool arguments in call ${callId}`, false)
  }
}

function parseUsage(raw: unknown): Usage {
  const usage = emptyUsage()
  if (!isRecord(raw)) return usage
  if (typeof raw['input_tokens'] === 'number') usage.inputTokens = raw['input_tokens']
  if (typeof raw['output_tokens'] === 'number') usage.outputTokens = raw['output_tokens']
  const details = raw['input_tokens_details']
  if (isRecord(details) && typeof details['cached_tokens'] === 'number') { usage.cacheReadTokens = details['cached_tokens']; usage.cacheHitTokens = details['cached_tokens'] }
  if (isRecord(details) && typeof details['cached_tokens'] === 'number') usage.cacheMissTokens = Math.max(0, usage.inputTokens - usage.cacheReadTokens)
  return usage
}

function parseOutputItems(output: unknown): { text: string; reasoning: string; toolCalls: ToolCallRequest[] } {
  let text = ''
  let reasoning = ''
  const toolCalls: ToolCallRequest[] = []
  if (!Array.isArray(output)) return { text, reasoning, toolCalls }
  for (const item of output) {
    if (!isRecord(item)) continue
    if (item['type'] === 'reasoning' && Array.isArray(item['summary'])) {
      for (const part of item['summary']) {
        if (isRecord(part) && typeof part['text'] === 'string') reasoning += part['text']
      }
    } else if (item['type'] === 'function_call') {
      const callId = item['call_id']
      const name = item['name']
      const args = item['arguments']
      if (typeof callId !== 'string' || typeof name !== 'string' || typeof args !== 'string') {
        continue
      }
      toolCalls.push({ id: callId, name, args: parseArgs(callId, args) })
    } else if (item['type'] === 'message') {
      const content = item['content']
      if (Array.isArray(content)) {
        for (const block of content) {
          if (isRecord(block) && typeof block['text'] === 'string') text += block['text']
        }
      }
    }
  }
  return { text, reasoning, toolCalls }
}

async function post(
  config: ResponsesTransportConfig,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const fetchFn = config.fetchFn ?? fetch
  let response: Response
  try {
    response = await fetchFn(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    throw new ProviderError(`Transport failure: ${String(error)}`, true)
  }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    throw new ProviderError(`HTTP ${response.status} from provider`, retryable)
  }
  return response
}

export async function responsesCall(
  config: ResponsesTransportConfig,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const response = await post(config, {
    model: config.model,
    input: toInputItems(request.systemPrompt, request),
    tools: request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    tool_choice: toToolChoice(request.toolChoice),
    ...(request.reasoningEffort === undefined ? {} : { reasoning: { effort: request.reasoningEffort, summary: 'auto' } }),
    ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
  }, request.signal)
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new ProviderError('Malformed responses envelope', false)
  const { text, reasoning, toolCalls } = parseOutputItems(body['output'])
  return { text, toolCalls, usage: parseUsage(body['usage']), ...(reasoning ? { reasoning } : {}) }
}

// Semantic streaming: output_item.added opens the slot, argument deltas
// append, function_call.completed closes it with parsed arguments.
export async function* responsesStream(
  config: ResponsesTransportConfig,
  request: ProviderRequest,
): AsyncIterable<StreamEvent> {
  const response = await post(config, {
    model: config.model,
    stream: true,
    input: toInputItems(request.systemPrompt, request),
    tools: request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    tool_choice: toToolChoice(request.toolChoice),
    ...(request.reasoningEffort === undefined ? {} : { reasoning: { effort: request.reasoningEffort, summary: 'auto' } }),
    ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
  }, request.signal)
  const pending = new Map<number, { callId: string; name: string; argsText: string; started: boolean }>()
  const summaryDeltaIndexes = new Set<string>()
  let usage = emptyUsage()
  for await (const data of readSseData(response)) {
      if (data === '[DONE]') {
        yield { kind: 'done', usage }
        return
      }
      let event: unknown
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }
      if (!isRecord(event) || typeof event['type'] !== 'string') continue
      const kind = event['type']
      if (kind === 'response.completed' && isRecord(event['response'])) {
        usage = parseUsage(event['response']['usage'])
      } else if (kind === 'response.failed') {
        const failed = isRecord(event['response']) ? event['response'] : {}
        const error = isRecord(failed['error']) ? failed['error'] : {}
        const code = typeof error['code'] === 'string' ? error['code'] : 'unknown'
        throw new ProviderError(`Responses stream failed: ${code}`, code === 'server_error')
      }
      if (kind === 'response.output_item.added') {
        const item = event['item']
        const index = event['output_index']
        if (!isRecord(item) || typeof index !== 'number') continue
        if (item['type'] === 'function_call' && typeof item['call_id'] === 'string') {
          pending.set(index, {
            callId: item['call_id'],
            name: typeof item['name'] === 'string' ? item['name'] : '',
            argsText: '',
            started: true,
          })
          yield { kind: 'toolcall_start', index, key: item['call_id'] }
        }
      } else if (kind === 'response.function_call_arguments.delta') {
        const index = event['output_index']
        const delta = event['delta']
        if (typeof index !== 'number' || typeof delta !== 'string') continue
        const slot = pending.get(index)
        if (!slot) continue
        slot.argsText += delta
        yield { kind: 'toolcall_delta', index, textAppend: delta }
      } else if (kind === 'response.output_item.done') {
        const item = event['item']
        const index = event['output_index']
        if (!isRecord(item) || typeof index !== 'number') continue
        if (item['type'] === 'function_call') {
          const slot = pending.get(index)
          const callId =
            typeof item['call_id'] === 'string' ? item['call_id'] : (slot?.callId ?? '')
          const name = typeof item['name'] === 'string' ? item['name'] : (slot?.name ?? '')
          const argsText =
            typeof item['arguments'] === 'string' ? item['arguments'] : (slot?.argsText ?? '')
          pending.delete(index)
          yield {
            kind: 'toolcall_end',
            index,
            call: { id: callId, name, args: parseArgs(callId, argsText) },
          }
        }
      } else if (kind === 'response.output_text.delta') {
        if (typeof event['delta'] === 'string' && event['delta']) {
          yield { kind: 'text_delta', text: event['delta'] }
        }
      } else if (kind === 'response.reasoning_summary_text.delta') {
        if (typeof event['delta'] === 'string' && event['delta']) {
          summaryDeltaIndexes.add(`${event['output_index']}:${event['summary_index']}`)
          yield { kind: 'reasoning_delta', text: event['delta'] }
        }
      } else if (kind === 'response.reasoning_summary_text.done') {
        const index = `${event['output_index']}:${event['summary_index']}`
        if (!summaryDeltaIndexes.has(index) && typeof event['text'] === 'string' && event['text']) {
          yield { kind: 'reasoning_delta', text: event['text'] }
        }
      }
  }
  yield { kind: 'done', usage }
}
