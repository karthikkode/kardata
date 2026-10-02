import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { webFetch, WEB_FETCH_MAX_BYTES, WEB_FETCH_TIMEOUT_MS } from '../../backend/src/retrieval/web.js'

afterEach(() => vi.useRealTimers())
describe('public source fetch full-response boundaries', () => {
  it('expires a body that stalls after successful headers', async () => {
    vi.useFakeTimers()
    let finish: (() => void) | undefined
    let ended = false
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { finish = () => { if (!ended) { ended = true; controller.close() } } },
      cancel() { ended = true },
    }), { headers: { 'content-type': 'text/plain' } })
    const result = webFetch('https://company.example/source', vi.fn(async () => response) as typeof fetch).then(() => 'success', (error: unknown) => (error as { code?: string }).code)
    try {
      await vi.advanceTimersByTimeAsync(WEB_FETCH_TIMEOUT_MS + 1)
      expect(await Promise.race([result, Promise.resolve('stalled')])).toBe('fetch_failed')
    } finally { finish?.(); await result }
  })
  it('cancels as soon as streamed bytes exceed the cap without reading the remainder', async () => {
    const cancel = vi.fn()
    let pulls = 0
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; if (pulls === 1) controller.enqueue(new Uint8Array(WEB_FETCH_MAX_BYTES + 1)); else controller.close() },
      cancel,
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/plain' } })
    await expect(webFetch('https://company.example/source', vi.fn(async () => response) as typeof fetch)).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(pulls).toBe(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('checks redirect destinations before a second network request', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))
    await expect(webFetch('https://company.example/source', fetcher as typeof fetch)).rejects.toMatchObject({ code: 'blocked' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('records the actual final public source after a relative redirect', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/about' } }))
      .mockResolvedValueOnce(new Response('TEST public source', { headers: { 'content-type': 'text/plain' } }))
    expect(await webFetch('https://company.example/start', fetcher as typeof fetch)).toMatchObject({ url: 'https://company.example/about', text: 'TEST public source' })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://company.example/start','https://company.example/about'])
  })
  it('bounds looping redirects and cancels an oversized declared body before reading', async () => {
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }))
    await expect(webFetch('https://company.example/start', loop as typeof fetch)).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(loop).toHaveBeenCalledTimes(6)
    const cancel = vi.fn(), pull = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), { headers: { 'content-length': String(WEB_FETCH_MAX_BYTES + 1) } })
    await expect(webFetch('https://company.example/large', vi.fn(async () => response) as typeof fetch)).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('cancels a late header response when the transport ignored its abort signal', async () => {
    vi.useFakeTimers()
    let resolve: ((response: Response) => void) | undefined
    const headers = new Promise<Response>((done) => { resolve = done })
    const result = webFetch('https://company.example/late', vi.fn(async () => headers) as typeof fetch).then(() => 'success', (error: unknown) => (error as { code?: string }).code)
    await vi.advanceTimersByTimeAsync(WEB_FETCH_TIMEOUT_MS + 1)
    expect(await result).toBe('fetch_failed')
    const cancel = vi.fn()
    resolve?.(new Response(new ReadableStream({ cancel })))
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('closes a real isolated HTTP socket when its body never finishes', async () => {
    let bodyStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { bodyStarted = resolve })
    let socketClosed: () => void = () => undefined
    const closed = new Promise<void>((resolve) => { socketClosed = resolve })
    const server = createServer((_request, response) => {
      _request.socket.once('close', socketClosed)
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.flushHeaders()
      response.write('TEST controlled public-source fixture')
      bodyStarted()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('TEST listener has no port')
    // Explicit test transport routes only this fixture URL to its own server;
    // this proves real HTTP/body cancellation, not public-DNS admission.
    const transport = ((_url, options) => fetch(`http://127.0.0.1:${address.port}/fixture`, options)) as typeof fetch
    const result = webFetch('https://TEST-company.example/fixture', transport)
    const rejected = expect(result).rejects.toMatchObject({ code: 'fetch_failed' })
    try {
      await started
      await rejected
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([closed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('TEST socket did not close before teardown')), 2000) })])
      } finally { clearTimeout(timer) }
    }
    finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }, WEB_FETCH_TIMEOUT_MS + 10_000)
  it('discards unterminated script/style and attribute text instead of exposing it as source evidence', async () => {
    for (const tag of ['script', 'style']) {
      const result = await webFetch('https://company.example/source', vi.fn(async () => new Response(`<${tag}>`.repeat(1000) + 'TEST not visible source text', { headers: { 'content-type': 'text/html' } })) as typeof fetch)
      expect(result.text).toBe('')
    }
    const result = await webFetch('https://company.example/source', vi.fn(async () => new Response(`<div title="TEST attribute > hidden">Visible company</div>`, { headers: { 'content-type': 'text/html' } })) as typeof fetch)
    expect(result.text).toBe('Visible company')
  })
})
