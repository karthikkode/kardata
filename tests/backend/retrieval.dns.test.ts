import { gzipSync, gunzipSync, deflateSync, brotliCompressSync } from 'node:zlib'
import { Readable } from 'node:stream'
import type { IncomingMessage, RequestOptions } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
const dns = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }))
vi.mock('node:https', async (original) => ({ ...await original<typeof import('node:https')>(), request: dns.request }))
import { webFetch, WEB_FETCH_MAX_BYTES, WEB_FETCH_TIMEOUT_MS } from '../../backend/src/retrieval/web.js'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); dns.lookup.mockReset(); dns.request.mockReset() })
function respond(body: Buffer, headers: Record<string, string> = { 'content-type': 'text/plain' }, statusCode = 200) {
  dns.request.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const request = { on: () => request, end: () => callback(Object.assign(Readable.from([body]), { statusCode, headers }) as unknown as IncomingMessage) }
    return request
  })
}
describe('production source DNS admission', () => {
  it.each([
    [{ address: '10.0.0.1', family: 4 }],
    [{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }],
    [{ address: 'fc00::1', family: 6 }],
    [],
  ])('denies private, mixed or empty DNS answers before transport', async (...records) => {
    dns.lookup.mockResolvedValue(records)
    const unsafeFallback = vi.fn().mockResolvedValue(new Response('private source content'))
    vi.stubGlobal('fetch', unsafeFallback)
    await expect(webFetch('https://source.example/')).rejects.toMatchObject({ code: 'blocked' })
    expect(unsafeFallback).not.toHaveBeenCalled()
    expect(dns.request).not.toHaveBeenCalled()
  })
  it('pins repeated transport lookups to the checked address while retaining the HTTPS hostname', async () => {
    dns.lookup.mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    let requestedUrl = ''
    const seen: unknown[] = []
    dns.request.mockImplementation((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      requestedUrl = url.toString()
      for (let i = 0; i < 2; i++) options.lookup!('source.example', {}, (error, address, family) => { seen.push({ error, address, family }) })
      const request = { on: () => request, end: () => {
        const response = Object.assign(Readable.from([Buffer.from('Verified public business source')]), { statusCode: 200, headers: { 'content-type': 'text/plain' } })
        callback(response as unknown as IncomingMessage)
      } }
      return request
    })
    const result = await webFetch('https://source.example/company')
    expect(result.text).toBe('Verified public business source')
    expect(requestedUrl).toBe('https://source.example/company')
    expect(seen).toEqual(Array(2).fill({ error: null, address: '93.184.215.14', family: 4 }))
    expect(dns.lookup).toHaveBeenCalledTimes(1)
  })

  it('rechecks the resolved destination of a redirect before connecting', async () => {
    dns.lookup.mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }]).mockResolvedValueOnce([{ address: '192.168.1.4', family: 4 }])
    respond(Buffer.alloc(0), { location: 'https://internal-alias.example/' }, 302)
    await expect(webFetch('https://source.example/')).rejects.toMatchObject({ code: 'blocked' })
    expect(dns.request).toHaveBeenCalledTimes(1)
  })
  it('does not connect after DNS settles beyond the whole-request deadline', async () => {
    vi.useFakeTimers()
    let finish!: (value: Array<{ address: string; family: number }>) => void
    dns.lookup.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const failure = expect(webFetch('https://source.example/')).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(WEB_FETCH_TIMEOUT_MS + 1)
    await failure
    finish([{ address: '93.184.215.14', family: 4 }])
    await vi.advanceTimersByTimeAsync(0)
    expect(dns.request).not.toHaveBeenCalled()
  })
  it.each([['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const)('preserves %s response decoding through the pinned transport', async (encoding, compress) => {
    dns.lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }])
    respond(compress(Buffer.from('Public source evidence')), { 'content-type': 'text/plain', 'content-encoding': encoding })
    expect((await webFetch('https://source.example/')).text).toBe('Public source evidence')
  })
  it('limits expanded compressed bodies and rejects broken compressed streams', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }])
    respond(gzipSync(Buffer.from('x'.repeat(WEB_FETCH_MAX_BYTES + 1))), { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
    await expect(webFetch('https://source.example/')).rejects.toMatchObject({ code: 'fetch_failed' })
    respond(Buffer.from('invalid gzip'), { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
    await expect(webFetch('https://source.example/')).rejects.toMatchObject({ code: 'fetch_failed' })
  })

  it('limits a valid large gzip comment even when decoded output is tiny', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }])
    const gzip = gzipSync(Buffer.from('tiny'))
    const header = Buffer.from(gzip.subarray(0, 10))
    header[3] = header[3]! | 16 // RFC1952 FCOMMENT; the comment is not decoded output.
    const encoded = Buffer.concat([header, Buffer.alloc(WEB_FETCH_MAX_BYTES + 1, 97), Buffer.from([0]), gzip.subarray(10)])
    expect(gunzipSync(encoded).toString()).toBe('tiny')
    respond(encoded, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
    await expect(webFetch('https://source.example/')).rejects.toMatchObject({ code: 'fetch_failed', message: 'Encoded source exceeds byte limit' })
  })

})
