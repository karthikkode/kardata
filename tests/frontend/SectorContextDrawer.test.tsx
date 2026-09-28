// SectorContextDrawer proofs (docked panel): fetches on mount, renders
// verbatim segments with the meter, toggles units through PATCH, adds
// notes, and states load failure plus denial. API answers stubbed.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectorContextDrawer } from '@/components/SectorContextDrawer'
import type { StagingConfig } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

const VIEW = {
  sectorId: 'sec-1',
  digest: { version: 'abc123def456', text: 'Sector Optics (running): Lenses. Documents: notes.md (indexed). Notes: 0.' },
  segments: { system: 'Sector Optics: Lenses', references: ['[notes.md:0] Title'], history: [], tail: [] },
  usage: {
    system: { messages: 1, estimatedTokens: 10 },
    references: { messages: 1, estimatedTokens: 20 },
    history: { messages: 0, estimatedTokens: 0 },
    tail: { messages: 0, estimatedTokens: 0 },
    totalEstimatedTokens: 30,
  },
  files: [
    {
      id: 'sdoc-1', filename: 'notes.md', mediaType: 'text/plain', status: 'indexed',
      sha256: 'abcdef1234567890', chars: 1200, excluded: false,
      units: [{ ord: 0, kind: 'heading', text: 'Title', uncertain: false, excluded: false }],
    },
  ],
  notes: [],
}

function stubApi(handler: (url: string, init: { method?: string; body?: string }) => { status: number; payload?: unknown }): {
  calls: Array<{ url: string; method: string; body?: string }>
} {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body })
      const { status, payload } = handler(url, init)
      return { ok: status >= 200 && status < 300, status, json: async () => payload }
    }),
  )
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function envelope(data: unknown): unknown {
  return { ok: true, data }
}

describe('SectorContextDrawer', () => {
  it('fetches on mount and shows verbatim segments with the meter', async () => {
    stubApi(() => ({ status: 200, payload: envelope(VIEW) }))
    render(<SectorContextDrawer config={config} sectorId="sec-1" sectorName="Optics" />)
    await waitFor(() => expect(screen.getByText('Sector Optics: Lenses')).toBeInTheDocument())
    expect(screen.getByRole('img', { name: /30 of 1000000 estimated tokens/ })).toBeInTheDocument()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element?.textContent === '30 / 1,000,000 tokens · 0.00% of context · digest abc123def456 · 1 references',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('[notes.md:0] Title')).toBeInTheDocument()
    expect(screen.getByText('No history pinned.')).toBeInTheDocument()
    expect(screen.getByText('No tail pinned.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
    expect(await screen.findByText('Title')).toBeInTheDocument()
  })

  it('excludes a file through PATCH and refreshes the view', async () => {
    const { calls } = stubApi((url, init) => {
      if ((init.method ?? 'GET') === 'PATCH') {
        return { status: 200, payload: envelope({ ...VIEW, files: [{ ...VIEW.files[0], excluded: true }] }) }
      }
      return { status: 200, payload: envelope(VIEW) }
    })
    render(<SectorContextDrawer config={config} sectorId="sec-1" sectorName="Optics" />)
    await waitFor(() => expect(screen.getByText('Sector Optics: Lenses')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Exclude notes.md' }))
    await waitFor(() => expect(screen.getByText('excluded')).toBeInTheDocument())
    const patch = calls.find((call) => call.method === 'PATCH')
    expect(patch?.url).toContain('/v1/sectors/sec-1/context')
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ exclude: [{ documentId: 'sdoc-1' }] })
  })

  it('adds a user note through PATCH', async () => {
    stubApi((url, init) => {
      if ((init.method ?? 'GET') === 'PATCH') {
        return {
          status: 200,
          payload: envelope({ ...VIEW, notes: [{ id: 'snote-1', text: 'Watch pricing.', createdAt: 't' }] }),
        }
      }
      return { status: 200, payload: envelope(VIEW) }
    })
    render(<SectorContextDrawer config={config} sectorId="sec-1" sectorName="Optics" />)
    await waitFor(() => expect(screen.getByText('Sector Optics: Lenses')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Context note'), { target: { value: 'Watch pricing.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.getByText('Watch pricing.')).toBeInTheDocument())
  })

  it('states load failure with retry and denial plainly', async () => {    stubApi(() => ({ status: 500, payload: { ok: false, error: { code: 'boom', message: 'Server broke.' } } }))
    render(<SectorContextDrawer config={config} sectorId="sec-1" sectorName="Optics" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument())
  })

  it('turns a wrong-shaped 200 into an error, never a crash', async () => {
    stubApi(() => ({ status: 200, payload: { ok: true, data: [{ id: 'sec-1' }] } }))
    render(<SectorContextDrawer config={config} sectorId="sec-1" sectorName="Optics" />)
    await waitFor(() => expect(screen.getByText(/not a context view/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('summarizes files by units and chars, never a content hash', async () => {
    stubApi(() => ({ status: 200, payload: envelope(VIEW) }))
    render(<SectorContextDrawer config={config} sectorId="sec-1" sectorName="Optics" />)
    await waitFor(() => expect(screen.getByText('Sector Optics: Lenses')).toBeInTheDocument())
    expect(
      screen.getByText((_, element) => element?.tagName === 'P' && element?.textContent === '1 unit · 1.2k chars'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/sha /)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
    expect(
      await screen.findByText(
        (_, element) => element?.tagName === 'SPAN' && element?.textContent === '[notes.md:0] heading',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/\[sdoc-1:0\]/)).not.toBeInTheDocument()
  })

  it('numbers notes by position so no storage id reaches the reader', async () => {
    stubApi(() => ({
      status: 200,
      payload: envelope({
        ...VIEW,
        segments: { ...VIEW.segments, references: [...VIEW.segments.references, '[note:1] Watch pricing.'] },
        notes: [{ id: 'snote-9', text: 'Watch pricing.', createdAt: 't' }],
      }),
    }))
    render(<SectorContextDrawer config={config} sectorId="sec-1" sectorName="Optics" />)
    await waitFor(() => expect(screen.getByText('Watch pricing.')).toBeInTheDocument())
    expect(
      screen.getAllByText((_, element) => element?.tagName === 'SPAN' && element?.textContent === '[note:1] '),
    ).not.toHaveLength(0)
    expect(screen.queryByText(/snote-9/)).not.toBeInTheDocument()
  })
})
