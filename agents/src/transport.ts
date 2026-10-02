// Shared Chat-Completions wire transport. T2.3-T2.4. Meta Chat
// mode, and generic OpenAI-compatible endpoints all speak this wire; only
// base URL, key, model, and usage dialects differ.
import {
  emptyUsage,
  ProviderError,
  type ChatMessage,
  type ProviderRequest,
  type ProviderResponse,
  type StreamEvent,
  type ToolCallRequest,
  type ToolChoice,
  type Usage,
} from './providers.js'

export interface ChatTransportConfig {
  baseUrl: string
  apiKey: string
  model: string
  fetchFn?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toWireMessages(systemPrompt: string, messages: ChatMessage[]): unknown[] {
  // Providers reject a content-less system message (Meta 400s on a missing
  // messages[0].content, live-verified): only send the system line when it
  // carries a prompt.
  const out: unknown[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
  for (const message of messages) {
    if (message.role === 'tool' && message.toolResult) {
      out.push({
        role: 'tool',
        tool_call_id: message.toolResult.toolCallId,
        content: message.toolResult.content,
      })
    } else if (message.role === 'assistant' && message.toolCalls) {
      out.push({
        role: 'assistant',
        content: message.text ?? null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      })
    } else if (message.images !== undefined && message.images.length > 0) {
      out.push({
        role: message.role,
        content: [
          ...(message.text ? [{ type: 'text', text: message.text }] : []),
          ...message.images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
          })),
        ],
      })
    } else {
      out.push({ role: message.role, content: message.text ?? '' })
    }
  }
  return out
}

function toWireToolChoice(choice: ToolChoice): unknown {
  switch (choice.mode) {
    case 'auto':
      return 'auto'
    case 'required':
      return 'required'
    case 'none':
      return 'none'
    case 'named':
      return { type: 'function', function: { name: choice.name } }
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

/** Split one SSE buffer segment into its `data:` payloads. */
function sseDataLines(segment: string): string[] {
  const out: string[] = []
  for (const line of segment.split(/\r?\n/)) {
    if (line.startsWith('data:')) out.push(line.slice('data:'.length).trim())
  }
  return out
}

/** Incremental SSE reader: yields each `data:` payload as body chunks
 * arrive instead of buffering the whole response, so token deltas stream
 * live instead of flushing when the provider finishes. A frame split
 * across chunks waits in the carry buffer until its blank-line terminator
 * arrives; multibyte characters split across chunks survive via streaming
 * decode. Bodies without a stream (non-streaming stubs) fall back to one
 * buffered read with identical parsing. */
export async function* readSseData(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    for (const data of sseDataLines(await response.text())) yield data
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const end = /\r?\n\r?\n/.exec(buffer)
      if (!end) break
      const part = buffer.slice(0, end.index)
      buffer = buffer.slice(end.index + end[0].length)
      for (const data of sseDataLines(part)) yield data
    }
  }
  buffer += decoder.decode()
  for (const data of sseDataLines(buffer)) yield data
}

function parseUsage(raw: unknown): Usage {
  const usage = emptyUsage()
  if (!isRecord(raw)) return usage
  const pick = (key: string): number => (typeof raw[key] === 'number' ? raw[key] : 0)
  usage.inputTokens = pick('prompt_tokens')
  usage.outputTokens = pick('completion_tokens')
  usage.cacheHitTokens = pick('prompt_cache_hit_tokens')
  usage.cacheMissTokens = pick('prompt_cache_miss_tokens')
  usage.cacheReadTokens = pick('cached_tokens')
  // Meta nests cached tokens under prompt_tokens_details (live-verified).
  const details = raw['prompt_tokens_details']
  if (isRecord(details) && typeof details['cached_tokens'] === 'number') {
    usage.cacheReadTokens = details['cached_tokens']
  }
  return usage
}
function completionOf(reason: unknown): ProviderResponse['completion'] {
  if (reason === 'stop' || reason === 'tool_calls' || reason === 'function_call') return 'complete'
  if (reason === 'length' || reason === 'content_filter') return 'incomplete'
  return undefined
}

async function post(
  config: ChatTransportConfig,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const fetchFn = config.fetchFn ?? fetch
  let response: Response
  try {
    response = await fetchFn(`${config.baseUrl}${path}`, {
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

export async function chatCompletions(
  config: ChatTransportConfig,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const response = await post(
    config,
    '/chat/completions',
    {
      model: config.model,
      messages: toWireMessages(request.systemPrompt, request.messages),
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: toWireToolChoice(request.toolChoice),
      ...(request.reasoningEffort === undefined ? {} : { reasoning_effort: request.reasoningEffort }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { max_completion_tokens: request.maxOutputTokens }),
    },
    request.signal,
  )
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new ProviderError('Malformed chat response envelope', false)
  const choices = body['choices']
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError('Chat response has no choices', false)
  }
  const message = choices[0]
  if (!isRecord(message) || !isRecord(message['message'])) {
    throw new ProviderError('Chat response choice has no message', false)
  }
  const wire = message['message']
  const rawCalls: unknown = wire['tool_calls']
  const toolCalls: ToolCallRequest[] = []
  if (Array.isArray(rawCalls)) {
    for (const raw of rawCalls) {
      if (!isRecord(raw) || !isRecord(raw['function'])) continue
      const id = raw['id']
      const name = raw['function']['name']
      const args = raw['function']['arguments']
      if (typeof id !== 'string' || typeof name !== 'string' || typeof args !== 'string') continue
      toolCalls.push({ id, name, args: parseArgs(id, args) })
    }
  }
  const reasoning = wire['reasoning_content']
  const completion = completionOf(message['finish_reason'])
  return {
    text: typeof wire['content'] === 'string' ? wire['content'] : '',
    toolCalls,
    usage: parseUsage(body['usage']),
    ...(typeof reasoning === 'string' ? { reasoning } : {}),
    ...(completion === undefined ? {} : { completion }),
  }
}

// Minimal SSE parser: blank-line separated events, `data:` payloads,
// `[DONE]` terminator. Emits canonical events; toolcall_end fires per index
// at DONE with fully parsed arguments.
export async function* chatCompletionsStream(
  config: ChatTransportConfig,
  request: ProviderRequest,
): AsyncIterable<StreamEvent> {
  const response = await post(
    config,
    '/chat/completions',
    {
      model: config.model,
      stream: true,
      messages: toWireMessages(request.systemPrompt, request.messages),
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: toWireToolChoice(request.toolChoice),
      ...(request.reasoningEffort === undefined ? {} : { reasoning_effort: request.reasoningEffort }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { max_completion_tokens: request.maxOutputTokens }),
    },
    request.signal,
  )
  const pending = new Map<number, { id: string; name: string; argsText: string; started: boolean }>()
  let usage = emptyUsage()
  let completion: ProviderResponse['completion']
  const flush = function* (): Generator<StreamEvent> {
    for (const [index, call] of [...pending.entries()].sort(([a], [b]) => a - b)) {
      yield {
        kind: 'toolcall_end',
        index,
        call: { id: call.id, name: call.name, args: parseArgs(call.id, call.argsText) },
      }
    }
    pending.clear()
  }
  for await (const data of readSseData(response)) {
    if (data === '[DONE]') {
      yield* flush()
      yield { kind: 'done', usage, ...(completion === undefined ? {} : { completion }) }
      return
    }
    let event: unknown
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }
    if (!isRecord(event)) continue
    if (event['usage'] !== undefined) usage = parseUsage(event['usage'])
    const choices = event['choices']
    if (!Array.isArray(choices) || !isRecord(choices[0])) {
      continue
    }
    const terminal = completionOf(choices[0]['finish_reason'])
    if (terminal !== undefined && completion !== 'incomplete') completion = terminal
    if (!isRecord(choices[0]['delta'])) continue
    const delta = choices[0]['delta']
    if (typeof delta['content'] === 'string' && delta['content']) {
      yield { kind: 'text_delta', text: delta['content'] }
    }
    // Provider-visible reasoning_content: surfaced as its own
    // events so callers can render thinking blocks separately from the
    // reply. Providers without reasoning deltas (Meta) simply never
    // emit these; nothing is invented.
    if (typeof delta['reasoning_content'] === 'string' && delta['reasoning_content']) {
      yield { kind: 'reasoning_delta', text: delta['reasoning_content'] }
    }
    const rawCalls = delta['tool_calls']
    if (!Array.isArray(rawCalls)) continue
    for (const raw of rawCalls) {
      if (!isRecord(raw) || typeof raw['index'] !== 'number') continue
      const index = raw['index']
      let slot = pending.get(index)
      if (!slot) {
        slot = { id: '', name: '', argsText: '', started: false }
        pending.set(index, slot)
      }
      if (typeof raw['id'] === 'string' && raw['id']) slot.id = raw['id']
      const fn = raw['function']
      if (isRecord(fn)) {
        if (typeof fn['name'] === 'string' && fn['name']) slot.name = fn['name']
        if (typeof fn['arguments'] === 'string') slot.argsText += fn['arguments']
      }
      if (!slot.started && slot.id) {
        slot.started = true
        yield { kind: 'toolcall_start', index, key: slot.id }
      }
      const appended = isRecord(fn) && typeof fn['arguments'] === 'string' ? fn['arguments'] : ''
      if (appended) yield { kind: 'toolcall_delta', index, textAppend: appended }
    }
  }
  yield* flush()
  yield { kind: 'done', usage, ...(completion === undefined ? {} : { completion }) }
}
