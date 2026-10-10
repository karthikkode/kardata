// Phase 8 B1: every requestEnvelope call carries the X-Kardata-Client
// marker the pilot UI-only gate requires. Stubbed fetch; the header
// value is the whole assertion.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestEnvelope } from '@/data/api/client'

const config = { baseUrl: 'https://test.invalid', apiKey: 'TEST key' }

afterEach(() => vi.unstubAllGlobals())

describe('UI client marker', () => {
  it('sends X-Kardata-Client: ui on GET and POST', async () => {
    const seen: Array<Record<string, string>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { headers?: Record<string, string> } = {}) => {
        seen.push(init.headers ?? {})
        return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) }
      }),
    )
    await requestEnvelope(config, 'GET', '/v1/sectors')
    await requestEnvelope(config, 'POST', '/v1/sectors', { name: 'x' })
    expect(seen).toHaveLength(2)
    for (const headers of seen) expect(headers['X-Kardata-Client']).toBe('ui')
  })
})
