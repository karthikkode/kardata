import { describe, expect, it } from 'vitest'
import {
  ProviderGatewayError,
  resolveAdapter,
  resolveEffectiveSelection,
  resolveSelection,
} from '../../backend/src/providers/provider-gateway.js'
import { executeProviderChat } from '../../backend/src/temporal/activities/providers.js'
import type { LiveProviderConfig } from '@kardata/agents'

const NO_KEY: LiveProviderConfig = {
  metaApiKey: undefined,
  metaModel: 'muse-spark-1.3-contributor',
  metaMode: 'chat',
  metaBaseUrl: 'https://api.meta.ai/v1',
}

describe('Meta-only per-message selection [F:backend.activity.providers.executeProviderChat] [F:backend.activity.providers.PROVIDER_ERROR_EVENT] [F:backend.activity.turn.sleep]', () => {
  it('defaults to Meta Contributor at high effort', () => {
    expect(resolveSelection(undefined)).toBe('meta')
    expect(resolveEffectiveSelection({}, { envValue: undefined, env: {} })).toMatchObject({
      provider: 'meta', model: 'muse-spark-1.3-contributor', reasoning: true, effort: 'high',
    })
  })

  it('rejects removed providers and preserves the fake test path', () => {
    expect(() => resolveSelection('deepseek')).toThrow(/unsupported provider/)
    expect(() => resolveSelection('router')).toThrow(/unsupported provider/)
    expect(() => resolveEffectiveSelection({ provider: 'deepseek' })).toThrow(ProviderGatewayError)
    expect(resolveSelection('fake')).toBe('fake')
    expect(() => resolveEffectiveSelection({ provider: 'fake', model: 'muse-spark-1.3' })).toThrow(/cannot pin/)
  })

  it('uses the stored Meta model and validates effort', () => {
    expect(resolveEffectiveSelection({ provider: 'meta', model: 'muse-spark-1.3', effort: 'low' }).effort).toBe('low')
    expect(() => resolveEffectiveSelection({ provider: 'meta', model: 'muse-spark-1.3', effort: 'ultra' })).toThrow(/unknown effort/)
    expect(() => resolveEffectiveSelection({ provider: 'meta', model: 'future-model' })).toThrow(/unknown model/)
  })

  it('requires the Meta key for runtime selection', () => {
    expect(() => resolveAdapter('meta', { config: NO_KEY })).toThrow(/KARDATA_META_KEY/)
    expect(resolveAdapter('fake', { fakeSteps: [] }).providerName).toBe('fake')
  })

  it('records a rejected model as a typed provider event', async () => {
    const events: unknown[] = []
    const outcome = await executeProviderChat(
      {
        sessionId: 's-sel', idempotencyKey: 'sel:1', provider: 'meta', model: 'future-model',
        request: { systemPrompt: 'Be brief.', messages: [{ role: 'user', text: 'Say hi.' }], tools: [], toolChoice: { mode: 'none' } },
        config: { ...NO_KEY, metaApiKey: 'test' },
      },
      { log: () => undefined, appendErrorEvent: async (event) => { events.push(event) }, publishDelta: async () => undefined },
    )
    expect(outcome).toMatchObject({ ok: false, code: 'provider_unconfigured' })
    expect(events).toHaveLength(1)
  })
})
