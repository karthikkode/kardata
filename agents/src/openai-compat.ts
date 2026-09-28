// Generic OpenAI-compatible adapter (Chat wire). T2.4. Future providers bind
// here with config only: base URL plus model plus key.
import { chatCompletions, chatCompletionsStream, type ChatTransportConfig } from './transport.js'
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  StreamEvent,
} from './providers.js'

export interface OpenAICompatConfig {
  apiKey: string
  model: string
  baseUrl: string
  fetchFn?: typeof fetch
}

export class OpenAICompatAdapter implements ProviderAdapter {
  readonly providerName = 'openai-compat'
  private readonly transport: ChatTransportConfig

  constructor(config: OpenAICompatConfig) {
    this.transport = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      ...(config.fetchFn ? { fetchFn: config.fetchFn } : {}),
    }
  }

  chat(request: ProviderRequest): Promise<ProviderResponse> {
    return chatCompletions(this.transport, request)
  }

  chatStream(request: ProviderRequest): AsyncIterable<StreamEvent> {
    return chatCompletionsStream(this.transport, request)
  }
}
