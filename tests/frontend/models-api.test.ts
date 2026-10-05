import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/data/api/sessions'
import { listProviders, setSessionModel } from '@/data/api/models'
import { type StagingConfig } from '@/data/api/client'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }
const catalog = { defaultProvider: 'meta', providers: [{
  name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor',
  models: [
    { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
    { provider: 'meta', model: 'muse-spark-1.3', displayName: 'muse-spark-1.3', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  ],
}] }

afterEach(() => vi.unstubAllGlobals())

describe('Meta models client', () => {
  it('reads a Meta-only catalog and rejects removed providers', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => ({ ok: true, data: catalog }) }
    }))
    expect(await listProviders(config)).toMatchObject({ defaultProvider: 'meta', providers: [{ name: 'meta' }] })
    expect(calls).toEqual(['https://staging.test/v1/providers'])
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: {
      defaultProvider: 'meta', providers: [{ ...catalog.providers[0], name: 'deepseek' }],
    } }) })))
    await expect(listProviders(config)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('saves Contributor with high effort through PATCH', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const selection = { provider: 'meta' as const, model: 'muse-spark-1.3-contributor', reasoning: true, effort: 'high' }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined })
      return { ok: true, status: 200, json: async () => ({ ok: true, data: selection }) }
    }))
    expect(await setSessionModel(config, 's-1', selection)).toEqual(selection)
    expect(calls).toEqual([{ url: 'https://staging.test/v1/sessions/s-1/model', method: 'PATCH', body: selection }])
  })

  it('rejects DeepSeek before sending a request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const removed = { provider: 'deepseek', model: 'deepseek-chat' } as unknown as Parameters<typeof setSessionModel>[2]
    await expect(setSessionModel(config, 's-1', removed)).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads a stored Meta binding and rejects an old DeepSeek binding', async () => {
    const base = { id: 's-1', title: 'Server chat', createdAt: '', updatedAt: '' }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: {
      ...base, model: { provider: 'meta', model: 'muse-spark-1.3-contributor', reasoning: true, effort: 'high' },
    } }) })))
    expect((await getSession(config, 's-1')).model?.effort).toBe('high')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: {
      ...base, model: { provider: 'deepseek', model: 'deepseek-chat', reasoning: false },
    } }) })))
    await expect(getSession(config, 's-1')).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
