// Unary request timeout (P6.4): every requestEnvelope call fails at 30s with
// a retryable 408; caller cancels and network failures pass through
// untouched. The 30s firing itself is proven by the e2e timeout faults
// (tests/frontend-e2e/failures/endpoints.spec.ts), not fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LONG_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, StagingApiError, requestEnvelope } from '@/data/api/client'
import { createArtifact } from '@/data/api/artifacts'
import { compactLocalContext } from '@/data/api/context'
import { attachSectorDocument } from '@/data/api/files'
import { compactSession, renameSession, spawnSessionSubagent } from '@/data/api/sessions'

const config = { baseUrl: 'https://test.invalid', apiKey: 'TEST key' }

afterEach(() => vi.unstubAllGlobals())

describe('request timeout', () => {
  it('locks the unary budget at 30s', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000)
  })

  it('locks the long-mutation budget at 10 min', () => {
    expect(LONG_REQUEST_TIMEOUT_MS).toBe(600_000)
  })

  it('drives the abort from the per-call budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const failure = await requestEnvelope(config, 'GET', '/v1/sectors', undefined, undefined, undefined, 50).then(
      () => undefined,
      (error: unknown) => error as StagingApiError,
    )
    expect(failure).toBeInstanceOf(StagingApiError)
    expect(failure?.status).toBe(408)
    expect(failure?.code).toBe('timeout')
  })

  it('passes caller cancels through untouched (no 408 lie)', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn(async () => { throw abortError }))
    controller.abort()
    await expect(requestEnvelope(config, 'GET', '/v1/sectors', undefined, controller.signal)).rejects.toBe(abortError)
  })

  it('passes network failures through untouched (no 408 lie)', async () => {
    const networkError = new TypeError('fetch failed')
    vi.stubGlobal('fetch', vi.fn(async () => { throw networkError }))
    await expect(requestEnvelope(config, 'GET', '/v1/sectors')).rejects.toBe(networkError)
  })

  it('still resolves fast responses with the combined signal attached', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(requestEnvelope(config, 'GET', '/v1/sectors')).resolves.toEqual({ data: [] })
    const [, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.signal?.aborted).toBe(false)
  })

  // Per-site budgets (pilot item 2): uploads and synchronous long
  // mutations must request the 10 min budget, while ordinary mutations
  // stay on 30s. Spying the timeout the site requests pins the wiring
  // without waiting out either budget.
  describe('per-call budgets', () => {
    beforeEach(() => {
      vi.spyOn(AbortSignal, 'timeout')
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    function okFetch(data: unknown) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data }), { status: 200 })))
    }

    it.each([
      ['subagent spawn (server polls acceptance up to 30s)', () => spawnSessionSubagent(config, 's-1', { goal: 'Scout the sector' })],
      ['session artifact upload', () => createArtifact(config, 's-1', { name: 'notes.md', content: 'hello' })],
      ['document attach', () => attachSectorDocument(config, 'sec-1', { filename: 'doc.pdf', contentBase64: 'aGk=' })],
      ['session compaction', () => compactSession(config, 's-1')],
    ])('runs %s on the long budget', async (_label, call) => {
      okFetch({})
      await call()
      expect(AbortSignal.timeout).toHaveBeenCalledWith(LONG_REQUEST_TIMEOUT_MS)
    })

    it('runs thread compaction on the long budget', async () => {
      okFetch({ compacted: true, context: { threadKey: 's-1', notes: '', summary: '', coveredSeq: 0, version: 1 } })
      await compactLocalContext(config, 's-1')
      expect(AbortSignal.timeout).toHaveBeenCalledWith(LONG_REQUEST_TIMEOUT_MS)
    })

    it('keeps ordinary mutations on the 30s budget', async () => {
      okFetch({ id: 's-1', title: 'Renamed' })
      await renameSession(config, 's-1', 'Renamed')
      expect(AbortSignal.timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS)
      expect(AbortSignal.timeout).not.toHaveBeenCalledWith(LONG_REQUEST_TIMEOUT_MS)
    })
  })
})
