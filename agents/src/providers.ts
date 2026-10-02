// Canonical provider shapes. T2.1. Every adapter (Meta, generic,
// fake) speaks these in memory; wire projection is per-adapter. Adopted
// shapes: Pi normalized core (Tool/ToolCall/ToolResultMessage) plus the
// index-keyed delta accumulator all inspected donors converge on.
export interface JsonSchemaProperty {
  type: string
  description?: string
  enum?: string[]
}

export interface JsonSchema {
  type: 'object'
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
}

export interface ToolCallRequest {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  content: string
  isError: boolean
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

/** One image riding a message: base64 bytes plus media type. The wire
 * layer sends these as data-URL parts; raw bytes never serialize. */
export interface ChatImage {
  mediaType: string
  base64: string
}

export interface ChatMessage {
  /** Internal durable transcript provenance; adapters never send this field. */
  contextSeq?: number
  role: MessageRole
  text?: string
  toolCalls?: ToolCallRequest[]
  toolResult?: ToolResult
  images?: ChatImage[]
}

export type ToolChoice =
  | { mode: 'auto' }
  | { mode: 'required' }
  | { mode: 'none' }
  | { mode: 'named'; name: string }

export interface ProviderRequest {
  signal?: AbortSignal
  maxOutputTokens?: number
  systemPrompt: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  toolChoice: ToolChoice
  /** Reasoning depth (e.g. Meta reasoning_effort). Only set when the
   * model catalog lists the level: the loop never invents one, and
   * adapters pass it to providers that accept the wire field. */
  reasoningEffort?: string
  /** Sampling temperature 0..2 for chat-completions adapters. Responses
   * (reasoning) adapters ignore it: those models manage their own
   * sampling and reject the field. */
  temperature?: number
}

// Normalized usage across providers. Adapters map native counters here;
// fields a provider lacks stay zero. Cost is computed by Karbot metering,
// never trusted from a vendor field.
export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
}

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  }
}

export interface ProviderResponse {
  text: string
  toolCalls: ToolCallRequest[]
  usage: Usage
  /** Visible reasoning passthrough when a provider exposes it. */
  reasoning?: string
  /** Only explicit provider terminal metadata proves completion. */
  completion?: 'complete' | 'incomplete'
}

export type StreamEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'reasoning_delta'; text: string }
  | { kind: 'toolcall_start'; index: number; key: string }
  | { kind: 'toolcall_delta'; index: number; textAppend: string }
  | { kind: 'toolcall_end'; index: number; call: ToolCallRequest }
  | { kind: 'done'; usage: Usage; completion?: ProviderResponse['completion'] }

export interface ProviderAdapter {
  countInputTokens?(request: ProviderRequest): Promise<number>
  readonly providerName: string
  chat(request: ProviderRequest): Promise<ProviderResponse>
  chatStream(request: ProviderRequest): AsyncIterable<StreamEvent>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
/** Only the input-count endpoint can assert this narrow availability signal. */
export class TokenCountUnavailableError extends ProviderError {
  readonly code = 'token_count_unavailable'
  constructor(readonly reason: 'unsupported' | 'billing_not_configured', readonly status: number) {
    super('Provider input-token counting is unavailable.', false)
    this.name = 'TokenCountUnavailableError'
  }
}

// Index-keyed streaming accumulator: string-append deltas per index assemble
// into whole calls. This is the parallel-safe pattern Pi, Pi Responses, and
// SmolAgents converge on; every adapter reuses it.
export class DeltaAccumulator {
  private readonly buffers = new Map<number, { key: string; text: string }>()
  private readonly finished = new Map<number, ToolCallRequest>()

  push(event: StreamEvent): void {
    if (event.kind === 'toolcall_start') {
      this.buffers.set(event.index, { key: event.key, text: '' })
    } else if (event.kind === 'toolcall_delta') {
      const buffer = this.buffers.get(event.index)
      if (buffer) buffer.text += event.textAppend
    } else if (event.kind === 'toolcall_end') {
      this.buffers.delete(event.index)
      this.finished.set(event.index, event.call)
    }
  }

  calls(): ToolCallRequest[] {
    return [...this.finished.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call)
  }
}
