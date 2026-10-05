import { act, renderHook } from '@testing-library/react'
import { useWorkReview } from '../../frontend/src/data/useWorkReview'
import type { ResearchProgress } from '../../frontend/src/data/api/progress'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewResearchWork } from '../../frontend/src/data/api/progress'
const config = { baseUrl: 'https://api.example.test', apiKey: 'TEST key' }
const item = { id: 'TEST:v1:intake:a', kind: 'discovery', title: 'TEST candidate', state: 'excluded', attempts: 3, childId: null, evidence: [], detail: 'TEST original reason', receiptVersion: 'b'.repeat(64) }
afterEach(() => vi.unstubAllGlobals())
describe('work-review client contract', () => {
  it('sends exact reviewed version/decision/reason and validates excluded as distinct work', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: item }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    expect(await reviewResearchWork(config, 'TEST sector', item.id, 1, 'a'.repeat(64), 'exclude', 'TEST owner reason', 'TEST exact retry key')).toEqual(item)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.example.test/v1/sectors/TEST%20sector/work/TEST%3Av1%3Aintake%3Aa/review')
    expect(init.headers['idempotency-key']).toBe('TEST exact retry key')
    expect(JSON.parse(init.body)).toEqual({ planVersion: 1, receiptVersion: 'a'.repeat(64), decision: 'exclude', reason: 'TEST owner reason' })
  })
  it('rejects an invented accepted-work response or malformed receipt digest', async () => {
    for (const invalid of [{ ...item, state: 'accepted' }, { ...item, receiptVersion: 'invalid' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: invalid }), { status: 200 })))
      await expect(reviewResearchWork(config, 'TEST', item.id, 1, 'a'.repeat(64), 'exclude', 'TEST reason')).rejects.toMatchObject({ code: 'invalid_response' })
    }
  })
  it('keeps the original idempotency key across an exact failed UI submission retry', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('TEST lost reply')).mockResolvedValue(new Response(JSON.stringify({ ok: true, data: item }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const data: ResearchProgress = { sectorId: 'TEST', state: 'paused', planVersion: 1, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
    const refresh = vi.fn(), { result } = renderHook(() => useWorkReview(config, { status: 'ready', data, refresh }))
    await act(async () => { expect(await result.current.decide(item.id, 1, 'a'.repeat(64), 'exclude', 'TEST owner reason')).toBe(false) })
    expect(result.current.error).toContain('TEST lost reply')
    await act(async () => { expect(await result.current.decide(item.id, 1, 'a'.repeat(64), 'exclude', 'TEST owner reason')).toBe(true) })
    const originalKey = fetcher.mock.calls[0]![1].headers['idempotency-key']
    expect(originalKey).toMatch(/^[a-f0-9-]{36}$/)
    expect(fetcher.mock.calls[1]![1].headers['idempotency-key']).toBe(originalKey)
    expect(refresh).toHaveBeenCalledOnce()
  })

})
