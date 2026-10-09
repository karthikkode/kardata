import { describe, expect, it, vi } from 'vitest'
import { defaultFetchFn, HttpError, postWithDeadline } from './http.js'

describe('HttpError [F:agents.http.HttpError]', () => {
  it('carries status only, never body echoes', () => {
    const error = new HttpError('TEST fetch widgets', 503)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('HttpError')
    expect(error.status).toBe(503)
    expect(error.message).toBe('TEST fetch widgets failed with HTTP 503')
  })
})

describe('postWithDeadline [F:agents.http.postWithDeadline]', () => {
  const init = { method: 'POST', headers: {}, body: '{}' }

  it('returns body text on ok', async () => {
    const seen: Array<{ url: string; signal?: AbortSignal }> = []
    await expect(
      postWithDeadline({
        describe: 'TEST fetch widgets',
        url: 'https://TEST.invalid/mcp',
        init,
        timeoutMs: 1000,
        fetchFn: async (url, request) => {
          seen.push({ url, signal: request.signal })
          return { ok: true, status: 200, text: async () => 'TEST body' }
        },
      }),
    ).resolves.toBe('TEST body')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://TEST.invalid/mcp')
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws HttpError on non-2xx without echoing the body', async () => {
    const error = await postWithDeadline({
      describe: 'TEST fetch widgets',
      url: 'https://TEST.invalid/mcp',
      init,
      timeoutMs: 1000,
      fetchFn: async () => ({ ok: false, status: 500, text: async () => 'TEST secret body' }),
    }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(500)
    expect((error as Error).message).not.toContain('TEST secret body')
  })

  it('rejects past the deadline', async () => {
    await expect(
      postWithDeadline({
        describe: 'TEST slow widgets',
        url: 'https://TEST.invalid/mcp',
        init,
        timeoutMs: 5,
        fetchFn: () => new Promise(() => undefined),
      }),
    ).rejects.toThrow('TEST slow widgets aborted or exceeded its deadline')
  })

  it('propagates a parent abort', async () => {
    const controller = new AbortController()
    const pending = postWithDeadline({
      describe: 'TEST aborted widgets',
      url: 'https://TEST.invalid/mcp',
      init,
      timeoutMs: 1000,
      signal: controller.signal,
      fetchFn: () => new Promise(() => undefined),
    })
    controller.abort()
    await expect(pending).rejects.toThrow('TEST aborted widgets aborted or exceeded its deadline')
  })

  it('fails fast when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      postWithDeadline({
        describe: 'TEST dead widgets',
        url: 'https://TEST.invalid/mcp',
        init,
        timeoutMs: 1000,
        signal: controller.signal,
        fetchFn: async () => ({ ok: true, status: 200, text: async () => 'TEST unreachable' }),
      }),
    ).rejects.toThrow('TEST dead widgets cancelled before dispatch')
  })
})

describe('defaultFetchFn [F:agents.http.defaultFetchFn]', () => {
  it('delegates to the global fetch', async () => {
    const fetch = vi.fn(async () => new Response('TEST body'))
    vi.stubGlobal('fetch', fetch)
    try {
      const response = await defaultFetchFn('https://TEST.invalid/mcp', { method: 'POST', headers: {}, body: '{}' })
      expect(fetch).toHaveBeenCalledTimes(1)
      await expect(response.text()).resolves.toBe('TEST body')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
