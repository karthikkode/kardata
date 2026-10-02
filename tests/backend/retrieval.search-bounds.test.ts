// Exported production search paths over explicit deterministic HTTP doubles.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { webSearch, WEB_FETCH_TIMEOUT_MS } from '../../backend/src/retrieval/web.js'
import { keylessSearch, KEYLESS_MAX_BYTES } from '../../backend/src/retrieval/keyless.js'
const env = { KARDATA_WEB_SEARCH_KEY: 'TEST subscription key' }
afterEach(() => vi.useRealTimers())

describe('search request lifetime and body bounds', () => {
  it('cancels oversized streamed keyed JSON before parsing', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)) }, cancel })
    await expect(webSearch(env, 'TEST sector', { fetchImpl: async () => new Response(body) })).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('retains its deadline while a keyed response body hangs', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const pending = webSearch(env, 'TEST sector', { fetchImpl: async () => new Response(new ReadableStream({ cancel })) })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(WEB_FETCH_TIMEOUT_MS)
    await assertion
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds every hanging keyless engine body and fails instead of waiting forever', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(), fetchImpl = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/html' } }))
    const pending = keylessSearch('TEST sector', { fetchImpl })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(4 * WEB_FETCH_TIMEOUT_MS)
    await assertion
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(cancel).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('never follows a keyed redirect or forwards its credential', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: 'https://other.example.test/' } }))
    await expect(webSearch(env, 'TEST sector', { fetchImpl })).rejects.toMatchObject({ code: 'blocked' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })
  it('does not fetch a private redirect from a keyless engine', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (input) => { urls.push(String(input)); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) }
    await expect(keylessSearch('TEST sector', { fetchImpl })).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(urls).toHaveLength(4)
    expect(urls.some((url) => url.includes('127.0.0.1'))).toBe(false)
  })
  it('rejects oversized declared keyless bodies without a full read', async () => {
    const cancel = vi.fn()
    await expect(keylessSearch('TEST sector', { fetchImpl: async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(KEYLESS_MAX_BYTES + 1) } }) })).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(cancel).toHaveBeenCalledTimes(4)
  })
  it.each(['{bad json', '{"web":{"results":42}}', '{}', '{"web":{}}'])('reports malformed search data without exposing credentials', async (body) => {
    await expect(webSearch(env, 'TEST sector', { fetchImpl: async () => new Response(body) })).rejects.toMatchObject({ code: 'fetch_failed', message: 'Search response is not valid result data' })
  })
})

it.each([{ count: NaN }, { count: 0 }, { count: 21 }, { count: 1.5 }, { page: -1 }, { page: 101 }, { page: Infinity }])('rejects invalid pagination before either search leg contacts the network: %j', async (options) => {
  const fetchImpl = vi.fn<typeof fetch>()
  await expect(webSearch(env, 'TEST sector', { ...options, fetchImpl })).rejects.toMatchObject({ code: 'validation_failed' })
  await expect(keylessSearch('TEST sector', { ...options, fetchImpl })).rejects.toMatchObject({ code: 'validation_failed' })
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('recognizes provider-declared exhausted results with nullable web content', async () => {
  expect(await webSearch(env, 'TEST sector', { fetchImpl: async () => new Response('{"web":null,"query":{"more_results_available":false}}') })).toEqual([])
})
it('rejects keyed pages past the provider window before sending credentials', async () => {
  const fetchImpl = vi.fn<typeof fetch>()
  await expect(webSearch(env, 'TEST sector', { page: 10, fetchImpl })).rejects.toMatchObject({ code: 'blocked' })
  expect(fetchImpl).not.toHaveBeenCalled()
})
it('accepts documented nullable snippets without inventing text', async () => {
  expect(await webSearch(env, 'TEST sector', { fetchImpl: async () => new Response('{"web":{"results":[{"title":"TEST business","url":"https://example.test/","description":null}]}}') })).toEqual([{ title: 'TEST business', url: 'https://example.test/', snippet: '' }])
})
