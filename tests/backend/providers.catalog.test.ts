import { describe, expect, it } from 'vitest'
import { fetchMetaModels, ModelCatalogUnavailable } from '../../backend/src/providers/catalog.js'

const config = { metaApiKey: 'test-only-key', metaBaseUrl: 'https://meta.test/v1' }

describe('live Meta model catalog', () => {
  it('advertises only verified ids present in the provider response', async () => {
    const fetchFn = (async (_url: string, init: RequestInit) => {
      expect(init.headers).toEqual({ authorization: 'Bearer test-only-key' })
      return new Response(JSON.stringify({ data: [
        { id: 'muse-spark-1.3-contributor' },
        { id: 'muse-spark-1.3' },
        { id: 'muse-voice-transcribe-1.0' },
        { id: 'future-unverified-model' },
      ] }), { status: 200 })
    }) as typeof fetch
    expect((await fetchMetaModels(config, fetchFn)).map((entry) => entry.model)).toEqual([
      'muse-spark-1.3-contributor', 'muse-spark-1.3',
    ])
  })

  it('does not offer a stale hardcoded list when Meta is unavailable', async () => {
    await expect(fetchMetaModels(config, (async () => new Response('', { status: 503 })) as typeof fetch))
      .rejects.toBeInstanceOf(ModelCatalogUnavailable)
    expect(await fetchMetaModels({ metaApiKey: undefined, metaBaseUrl: config.metaBaseUrl })).toEqual([])
  })

  it('requires the requested default to be present in the live list', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ data: [{ id: 'muse-spark-1.3' }] }), { status: 200 })) as typeof fetch
    await expect(fetchMetaModels(config, fetchFn)).rejects.toBeInstanceOf(ModelCatalogUnavailable)
  })
})
