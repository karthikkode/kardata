// Deterministic fake provider. T2.1. Scripted scenarios drive the loop in
// unit, integration, scale, and chaos tests with zero network. Steps are
// consumed in order; running out of steps is a test bug, not a fallback.
import {
  emptyUsage,
  ProviderError,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
  type StreamEvent,
  type ToolCallRequest,
  type Usage,
} from './providers.js'

export type FakeStep =
  | {
      text: string
      /** Scripted thinking trace, streamed as reasoning deltas. */
      reasoning?: string
      toolCalls?: ToolCallRequest[]
      usage?: Partial<Usage>
      /** Optional dwell before the step resolves, so cancellation tests
       * can land mid-turn against a deterministic tool window. */
      delayMs?: number
    }
  | { error: string; retryable?: boolean }

export function isFakeError(step: FakeStep): step is { error: string; retryable?: boolean } {
  return 'error' in step
}

function dwell(delayMs: number | undefined): Promise<void> {
  if (delayMs === undefined || delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export class FakeProvider implements ProviderAdapter {
  readonly providerName = 'fake'
  readonly calls: ProviderRequest[] = []

  constructor(private readonly steps: FakeStep[]) {}

  get remaining(): number {
    return this.steps.length
  }

  private next(): FakeStep {
    const step = this.steps.shift()
    if (!step) {
      throw new ProviderError('FakeProvider ran out of scripted steps', false)
    }
    return step
  }

  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request)
    const step = this.next()
    if (isFakeError(step)) {
      throw new ProviderError(step.error, step.retryable ?? false)
    }
    await dwell(step.delayMs)
    return {
      text: step.text,
      reasoning: step.reasoning ?? '',
      toolCalls: step.toolCalls ?? [],
      usage: { ...emptyUsage(), ...step.usage },
    }
  }

  async *chatStream(request: ProviderRequest): AsyncIterable<StreamEvent> {
    this.calls.push(request)
    const step = this.next()
    if (isFakeError(step)) {
      throw new ProviderError(step.error, step.retryable ?? false)
    }
    await dwell(step.delayMs)
    if (step.reasoning) {
      yield { kind: 'reasoning_delta', text: step.reasoning }
    }
    if (step.text) {
      yield { kind: 'text_delta', text: step.text }
    }
    for (const [index, call] of (step.toolCalls ?? []).entries()) {
      yield { kind: 'toolcall_start', index, key: call.id }
      yield { kind: 'toolcall_delta', index, textAppend: JSON.stringify(call.args) }
      yield { kind: 'toolcall_end', index, call }
    }
    yield { kind: 'done', usage: { ...emptyUsage(), ...step.usage } }
  }
}
