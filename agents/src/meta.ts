// Meta Model API adapter. T2.3. Chat wire by default; Responses wire when
// mode is 'responses'. Prefix caching is automatic server-side (no flags or
// breakpoints; dev.meta.ai/docs/prompt-caching), so the stable-first
// request shape is the whole client story. cached_tokens (including the
// prompt_tokens_details nesting) maps to cacheReadTokens in transport.ts.
import { chatCompletions, chatCompletionsStream, type ChatTransportConfig } from './transport.js'
import { responsesCall, responsesInputTokens, responsesStream, type ResponsesTransportConfig } from './responses.js'
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  StreamEvent,
} from './providers.js'

export type MetaMode = 'chat' | 'responses'

export interface MetaConfig {
  apiKey: string
  model: string
  mode?: MetaMode
  baseUrl?: string
  fetchFn?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1'

export class MetaAdapter implements ProviderAdapter {
  readonly countInputTokens?: (request: ProviderRequest) => Promise<number>
  readonly providerName = 'meta'
  readonly mode: MetaMode
  private readonly chatTransport: ChatTransportConfig
  private readonly responsesTransport: ResponsesTransportConfig

  constructor(config: MetaConfig) {
    this.mode = config.mode ?? 'chat'
    const shared = {
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      model: config.model,
      ...(config.fetchFn ? { fetchFn: config.fetchFn } : {}),
    }
    this.chatTransport = shared
    this.responsesTransport = shared
    if (this.mode === 'responses') this.countInputTokens = (request) => responsesInputTokens(this.responsesTransport, request)
  }

  chat(request: ProviderRequest): Promise<ProviderResponse> {
    if (this.mode === 'responses') return responsesCall(this.responsesTransport, { ...request, toolChoice: { mode: 'auto' } })
    // Meta Chat wire supports only tool_choice "auto" (live-verified 400 on
    // required/none/named): clamp here so callers keep one canonical shape.
    return chatCompletions(this.chatTransport, { ...request, toolChoice: { mode: 'auto' } })
  }

  chatStream(request: ProviderRequest): AsyncIterable<StreamEvent> {
    if (this.mode === 'responses') return responsesStream(this.responsesTransport, { ...request, toolChoice: { mode: 'auto' } })
    return chatCompletionsStream(this.chatTransport, { ...request, toolChoice: { mode: 'auto' } })
  }
}
