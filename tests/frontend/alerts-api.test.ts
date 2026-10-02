import { afterEach, expect, it, vi } from 'vitest'
import { listSupervisionAlerts } from '@/data/alerts'
const config = { baseUrl: 'https://test.invalid', apiKey: 'TEST scoped owner' }
afterEach(() => vi.unstubAllGlobals())
it('validates bounded alert records and sends an exclusive cursor with existing keyed transport', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { items: [], nextBeforeSeq: null } }), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(listSupervisionAlerts(config, 42)).resolves.toEqual({ items: [], nextBeforeSeq: null })
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://test.invalid/v1/alerts?limit=20&beforeSeq=42')
  expect(new Headers(options.headers).get('Authorization')).toBe('Bearer TEST scoped owner')
})
it('rejects malformed alert state instead of showing it as a current warning', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { items: [{ state: 'current-warning' }], nextBeforeSeq: null } }), { status: 200 })))
  await expect(listSupervisionAlerts(config)).rejects.toMatchObject({ status: 502, code: 'invalid_response' })
})
it('preserves permission denial from the keyed server', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'TEST denied' } }), { status: 403 })))
  await expect(listSupervisionAlerts(config)).rejects.toMatchObject({ status: 403 })
})
