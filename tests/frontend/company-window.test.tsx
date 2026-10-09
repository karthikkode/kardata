import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStagingCompanies } from '@/data/research'
import type { CompanyResearch } from '@/data/api/sectors'

const config = { baseUrl: 'https://test.invalid', apiKey: 'TEST key' }
const rows: CompanyResearch[] = Array.from({ length: 1000 }, (_, index) => ({ id: `TEST-${index}`, name: `TEST company ${index}`, sectorId: 'TEST sector', sectorName: 'TEST sector', state: 'running', stage: 'Filter' }))
afterEach(() => { vi.unstubAllGlobals() })
function pages(failMore = false) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input), offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 100)
    if (failMore && offset > 0) throw new Error('TEST next page failed')
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { companies: rows.slice(offset, offset + limit), total: rows.length } }) }
  }))
}
describe('company pagination and refresh', () => {
  it('retains a loaded window during polling and resets it only for a different filter', async () => {
    pages()
    const view = renderHook(({ query }) => useStagingCompanies(config, { query }), { initialProps: { query: '' } })
    await waitFor(() => expect(view.result.current.items).toHaveLength(100))
    act(() => view.result.current.showMore())
    await waitFor(() => expect(view.result.current.items).toHaveLength(200))
    act(() => view.result.current.retry())
    await waitFor(() => expect(view.result.current.status).toBe('ready'))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(4))
    expect(view.result.current.items).toHaveLength(200)
    view.rerender({ query: 'different' })
    await waitFor(() => expect(view.result.current.items).toHaveLength(100))
  })
  it('keeps loaded rows and reports a failed next page', async () => {
    pages(true)
    const view = renderHook(() => useStagingCompanies(config))
    await waitFor(() => expect(view.result.current.items).toHaveLength(100))
    act(() => view.result.current.showMore())
    await waitFor(() => expect(view.result.current.moreError).toBe('TEST next page failed'))
    expect(view.result.current.items).toHaveLength(100)
    expect(view.result.current.loadingMore).toBe(false)
  })
  it('deduplicates overlapping refresh pages without inflating the server total', async () => {
    pages()
    const view = renderHook(() => useStagingCompanies(config))
    await waitFor(() => expect(view.result.current.items).toHaveLength(100))
    act(() => view.result.current.showMore())
    await waitFor(() => expect(view.result.current.items).toHaveLength(200))
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const offset = Number(new URL(input).searchParams.get('offset') ?? 0)
      const companies = offset === 0 ? [{ ...rows[0]!, id: 'TEST new', name: 'TEST new company' }, ...rows.slice(0, 99)] : rows.slice(98, 198)
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { companies, total: 1001 } }) }
    }))
    act(() => view.result.current.retry())
    await waitFor(() => expect(view.result.current.total).toBe(1001))
    expect(new Set(view.result.current.items.map((item) => item.id)).size).toBe(view.result.current.items.length)
    expect(view.result.current.items).toHaveLength(199)
    act(() => view.result.current.showMore())
    await waitFor(() => expect(view.result.current.loadingMore).toBe(false))
    expect(new URL(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).searchParams.get('offset')).toBe('200')
  })
})
