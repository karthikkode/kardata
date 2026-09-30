// SectorDetailPage proofs. Detail rows are backend-shaped fixtures for
// rendering only: every behavior under test (states, filters, restart,
// navigation) runs against the component contract, never a mock origin.
import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SectorDetailPage } from '@/components/SectorDetailPage'
import type { ResearchStatus, SectorDetail } from '@/data/research'
import type { StagingConfig } from '@/data/staging-api'

const noop = () => {}
const asyncNoop = async () => {}
const staging: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

/** Minimal session list so the chat panel renders past its backend guard. */
function stubSessions() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/v1/sessions')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) }
      }
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'nope' } }) }
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})
const petCare: SectorDetail = {
  id: 'seed-pet-care',
  name: 'Pet care',
  topic: 'D2C pet brands',
  companiesFound: 1,
  state: 'running',
  companies: [
    {
      id: 'seed-west',
      sectorId: 'seed-pet-care',
      sectorName: 'Pet care',
      name: 'West Paw',
      stage: 'Final validation',
      state: 'running',
    },
  ],
  companiesTotal: 1,
  activity: [{ seq: 1, text: 'Research started for D2C pet brands.' }],
  activityTotal: 1,
}
const quiet: SectorDetail = {
  id: 'seed-quiet',
  name: 'Quiet sector',
  topic: 'Nothing yet',
  companiesFound: 0,
  state: 'queued',
  companies: [],
  companiesTotal: 0,
  activity: [],
  activityTotal: 0,
}
const draftSector: SectorDetail = {
  id: 'seed-draft',
  name: 'Speciality foods',
  topic: 'Artisanal packaged foods',
  companiesFound: 0,
  state: 'draft',
  companies: [],
  companiesTotal: 0,
  activity: [],
  activityTotal: 0,
}

/** Stubbed server for the company section: filters + pages like the
 * backend (query/state params in, {companies, total} out) so the tests
 * prove the component sends filters and renders server totals. Real
 * server filtering rides on the backend live suites. */
function stubCompanyServer(rows: Array<{ id: string; name: string; state: string }>): void {
  const full = rows.map((row) => ({
    sectorId: 'seed-pet-care',
    sectorName: 'Pet care',
    stage: 'Filter',
    ...row,
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const text = String(url)
      if (text.includes('/v1/sessions')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) }
      }
      if (text.includes('/v1/companies')) {
        const query = new URL(text, 'https://stub.test')
        const needle = (query.searchParams.get('query') ?? '').toLowerCase()
        const state = query.searchParams.get('state')
        const limit = Number(query.searchParams.get('limit') ?? '100')
        const offset = Number(query.searchParams.get('offset') ?? '0')
        const filtered = full.filter(
          (row) =>
            (needle === '' || row.name.toLowerCase().includes(needle)) &&
            (state === null || row.state === state),
        )
        const window = filtered.slice(offset, offset + limit)
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { companies: window, total: filtered.length } }) }
      }
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
    }),
  )
}

function renderPage(
  props: {
    detail?: SectorDetail | undefined
    status?: ResearchStatus
    onBack?: () => void
    onPauseResearch?: () => Promise<void>
    onResumeResearch?: () => Promise<void>
    onStartResearch?: () => Promise<void>
    onRestartResearch?: () => Promise<void>
    onPlanResearch?: () => Promise<void>
    onApproveResearch?: (version: number) => Promise<void>
    onEditResearchPlan?: (markdown: string) => Promise<void>
    onAttach?: (file: File) => void
    onRetry?: () => void
    researchError?: string | null
    staging?: StagingConfig | null
    documents?: Array<{ id: string; filename: string; status: 'indexed' | 'needs-ocr'; chars: number }>
    attaching?: boolean
    attachingName?: string | null
  } = {},
) {
  const {
    status = 'ready',
    onBack = noop,
    onPauseResearch = asyncNoop,
    onResumeResearch = asyncNoop,
    onStartResearch = asyncNoop,
    onRestartResearch = asyncNoop,
    onPlanResearch = asyncNoop,
    onApproveResearch = asyncNoop,
    onEditResearchPlan = asyncNoop,
    onAttach = noop,
    onRetry = noop,
    researchError = null,
    staging: stagingOverride = null,
    documents = [],
    attaching = false,
    attachingName = null,
  } = props
  const detail = 'detail' in props ? props.detail : petCare
  return render(
    <SectorDetailPage
      detail={detail}
      status={status}
      documents={documents.map((doc) => ({
        sectorId: 'sec-pet-care',
        mediaType: 'text/markdown',
        sha256: 'abc',
        createdAt: '2026-09-27T00:00:00.000Z',
        ...doc,
      }))}
      documentsFailed={false}
      attaching={attaching}
      attachingName={attachingName}
      attachError={null}
      researchBusy={false}
      researchError={researchError}
      staging={stagingOverride}
      onRetry={onRetry}
      onPauseResearch={onPauseResearch}
      onResumeResearch={onResumeResearch}
      onStartResearch={onStartResearch}
      onRestartResearch={onRestartResearch}
      onPlanResearch={onPlanResearch}
      onApproveResearch={onApproveResearch}
      onEditResearchPlan={onEditResearchPlan}
      onAttach={onAttach}
      onBack={onBack}
    />,
  )
}

describe('SectorDetailPage', () => {
  it('embeds the sector chat section below the companies', () => {
    renderPage()
    expect(
      screen.getByRole('region', { name: 'Sector chat for Pet care' }),
    ).toBeInTheDocument()
  })

  it('shows no summary card and no activity timeline', () => {
    renderPage()
    expect(screen.queryByRole('region', { name: 'Pet care summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pet care activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start research' })).not.toBeInTheDocument()
    expect(screen.queryByText('Research started for D2C pet brands.')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sector chat for Pet care' })).toBeInTheDocument()
  })

  it('shows loading and error states', () => {
    const onRetry = vi.fn()
    const view = renderPage({ status: 'loading' })
    expect(
      screen.getByRole('status', { name: 'Pet care is loading' }),
    ).toBeInTheDocument()
    view.unmount()
    renderPage({ status: 'error', onRetry })
    expect(screen.getByText('Pet care did not load.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('explains a missing sector', () => {
    renderPage({ detail: undefined, status: 'ready' })
    expect(screen.getByText(/not found/)).toBeInTheDocument()
  })

  it('goes back', () => {
    const onBack = vi.fn()
    renderPage({ onBack })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Researches' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('SectorDetailPage body', () => {
  it('lists the sector companies with filters', async () => {
    stubCompanyServer([{ id: 'seed-west', name: 'West Paw', state: 'running' }])
    renderPage({ staging })
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter companies'), {
      target: { value: 'no-such-company' },
    })
    expect(await screen.findByText(/No companies match these filters/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
  })

  it('states the company filter outcome', async () => {
    stubCompanyServer([{ id: 'seed-west', name: 'West Paw', state: 'running' }])
    renderPage({ staging })
    fireEvent.change(screen.getByLabelText('Filter companies'), {
      target: { value: 'west' },
    })
    expect(await screen.findByText(/Showing 1 of 1 companies/)).toBeInTheDocument()
  })

  it('caps a 120-company section with a truthful total', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: `bulk-${index + 1}`,
      name: `Bulk company ${index + 1}`,
      state: 'running',
    }))
    stubCompanyServer(rows)
    renderPage({ detail: { ...petCare, companiesFound: 120 }, staging })
    // The overflow list caps visible rows but keeps the true total and
    // every row reachable through the server filter.
    expect(await screen.findByText('total')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter companies'), {
      target: { value: 'Bulk company 119' },
    })
    expect(await screen.findByText('Bulk company 119')).toBeInTheDocument()
  })

  it('pages the section with Show more until the total is reached', async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: `bulk-${index + 1}`,
      name: `Bulk company ${index + 1}`,
      state: 'running',
    }))
    stubCompanyServer(rows)
    renderPage({ detail: { ...petCare, companiesFound: 250 }, staging })
    expect(await screen.findByText('Bulk company 100')).toBeInTheDocument()
    expect(screen.getByText('Showing 100 of 250 companies')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(await screen.findByText('Bulk company 200')).toBeInTheDocument()
    expect(screen.getByText('Showing 200 of 250 companies')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(await screen.findByText('Bulk company 250')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument()
  })

  it('pauses a running research from the chat window', async () => {
    stubSessions()
    const onPauseResearch = vi.fn(async () => {})
    renderPage({ onPauseResearch, staging })
    const chat = screen.getByRole('region', { name: 'Sector chat for Pet care' })
    expect(await within(chat).findByLabelText('Research state: In progress')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause research' }))
    expect(onPauseResearch).toHaveBeenCalledTimes(1)
  })

  it('resumes a paused research from the chat window', async () => {
    stubSessions()
    const onResumeResearch = vi.fn(async () => {})
    renderPage({ detail: { ...quiet, state: 'paused' }, onResumeResearch, staging })
    expect(await screen.findByLabelText('Research state: Paused')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume research' }))
    expect(onResumeResearch).toHaveBeenCalledTimes(1)
  })

  it('shows research errors in the chat window', async () => {
    stubSessions()
    renderPage({ researchError: 'Pause failed.', staging })
    expect(await screen.findByRole('alert')).toHaveTextContent('Pause failed.')
  })

  it('toggles a file in context from the Files list', async () => {
    const calls: Array<{ method?: string; body?: string }> = []
    let excluded = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
        calls.push({ method: init.method, body: init.body })
        if (String(url).includes('/v1/sessions')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) }
        }
        if (String(url).endsWith('/context')) {
          if (init.method === 'PATCH') {
            const body = JSON.parse(init.body ?? '{}') as { exclude?: unknown[] }
            excluded = (body.exclude?.length ?? 0) > 0
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                sectorId: 'sec-pet-care',
                digest: { version: 'v2', text: 'd' },
                segments: { system: 's', references: [], history: [], tail: [] },
                usage: {
                  system: { messages: 0, estimatedTokens: 0 },
                  references: { messages: 0, estimatedTokens: 0 },
                  history: { messages: 0, estimatedTokens: 0 },
                  tail: { messages: 0, estimatedTokens: 0 },
                  totalEstimatedTokens: 0,
                },
                files: [{ id: 'doc-1', filename: 'notes.md', mediaType: 'text/markdown', status: 'indexed', sha256: 'abc', chars: 2400, excluded, units: [] }],
                notes: [],
              },
            }),
          }
        }
        return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'nope' } }) }
      }),
    )
    renderPage({
      staging,
      documents: [{ id: 'doc-1', filename: 'notes.md', status: 'indexed', chars: 2400 }],
    })
    const files = await screen.findByRole('region', { name: 'Context documents for Pet care' })
    fireEvent.click(await within(files).findByRole('button', { name: 'Exclude notes.md' }))
    await waitFor(() => expect(within(files).getByText(/excluded from context/)).toBeInTheDocument())
    expect(calls.some((call) => call.method === 'PATCH' && (call.body ?? '').includes('doc-1'))).toBe(true)
    fireEvent.click(within(files).getByRole('button', { name: 'Include notes.md' }))
    await waitFor(() => expect(within(files).queryByText(/excluded from context/)).not.toBeInTheDocument())
  })

  it('hides context toggles when the context view carries no files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/v1/sessions')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) }
        }
        if (String(url).endsWith('/context')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: { sectorId: 'sec-pet-care' } }) }
        }
        return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'nope' } }) }
      }),
    )
    renderPage({
      staging,
      documents: [{ id: 'doc-1', filename: 'notes.md', status: 'indexed', chars: 2400 }],
    })
    const files = await screen.findByRole('region', { name: 'Context documents for Pet care' })
    await waitFor(() =>
      expect(within(files).queryByRole('button', { name: 'Exclude notes.md' })).not.toBeInTheDocument(),
    )
    expect(within(files).queryByRole('button', { name: 'Include notes.md' })).not.toBeInTheDocument()
  })

  it('shows a processing row with the filename while attaching', async () => {
    stubSessions()
    renderPage({ staging, attaching: true, attachingName: 'dump.md' })
    const files = await screen.findByRole('region', { name: 'Context documents for Pet care' })
    expect(within(files).getByRole('status')).toHaveTextContent('Processing…')
    expect(screen.getByText('dump.md')).toBeInTheDocument()
  })

  it('shows the context section and attaches files', async () => {
    const onAttach = vi.fn()
    renderPage({ detail: draftSector, onAttach })
    expect(
      screen.getByRole('region', { name: 'Context documents for Speciality foods' }),
    ).toBeInTheDocument()
    expect(screen.getByText('No context attached yet.')).toBeInTheDocument()
    const file = new File(['# dump'], 'gemini-dump.md', { type: 'text/markdown' })
    fireEvent.click(screen.getByRole('button', { name: 'Attach a context file' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(onAttach).toHaveBeenCalledTimes(1)
    expect((onAttach.mock.calls[0]?.[0] as File).name).toBe('gemini-dump.md')
  })

  it('lays out chat beside files and context regions', () => {
    renderPage({})
    expect(screen.getByRole('region', { name: 'Sector chat for Pet care' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Context documents for Pet care' })).toBeInTheDocument()
  })

  it('never links out to the global chat', () => {
    renderPage({})
    expect(screen.queryByRole('button', { name: /open .* chat/i })).not.toBeInTheDocument()
  })

  it('attaches through the icon button', async () => {
    const onAttach = vi.fn()
    renderPage({ onAttach })
    fireEvent.click(screen.getByRole('button', { name: 'Attach a context file' }))
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(picker).toBeTruthy()
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })
    fireEvent.change(picker, { target: { files: [file] } })
    await waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1))
    expect(onAttach.mock.calls[0]?.[0]).toBe(file)
  })

  it('surfaces a failed pause with its reason instead of staying silent', async () => {
    stubSessions()
    renderPage({ researchError: 'conflict: sector sec-1 is draft, not running', staging })
    expect(screen.queryByRole('button', { name: 'Start research' })).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('conflict: sector sec-1 is draft, not running')
  })
})

describe('Sector open navigation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_STAGING_API', '1')
    vi.stubEnv('VITE_STAGING_URL', 'https://staging.test')
    vi.stubEnv('VITE_STAGING_KEY', 'key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const urlText = String(url)
        const payload = urlText.endsWith('/v1/sectors')
          ? { ok: true, data: [petCare] }
          : urlText.includes('/v1/companies')
            ? { ok: true, data: { companies: petCare.companies, total: petCare.companies.length } }
            : urlText.includes('/v1/sectors/')
              ? { ok: true, data: { ...petCare, companiesTotal: petCare.companies.length, activityTotal: petCare.activity.length } }
              : { ok: true, data: [] }
        return { ok: true, status: 200, json: async () => payload }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('opens a sector row from the landing', async () => {
    const { default: App } = await import('@/App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Pet care' }))
    // The row opens the summary landing; Open enters the chat workspace.
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('group', { name: 'Session types' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to sector summary' }))
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
  })

  it('follows a running sweep: detail and companies re-read on an interval', async () => {
    // Fake timers from the start (advancing with real time) so the
    // component's interval is fake-timer owned and findBy still resolves.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onRetry = vi.fn()
      let companyCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          const text = String(url)
          if (text.includes('/v1/sessions')) {
            return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) }
          }
          if (text.includes('/v1/companies')) {
            companyCalls += 1
            return { ok: true, status: 200, json: async () => ({ ok: true, data: { companies: [], total: 0 } }) }
          }
          return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
        }),
      )
      renderPage({
        detail: { ...petCare, state: 'running' },
        onRetry,
        staging: { baseUrl: 'https://staging.test', apiKey: 'key' },
      })
      await screen.findByRole('region', { name: 'Sector chat for Pet care' })
      const base = companyCalls
      expect(base).toBeGreaterThan(0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })
      expect(onRetry).toHaveBeenCalled()
      expect(companyCalls).toBeGreaterThan(base)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet on terminal states', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onRetry = vi.fn()
      let companyCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          const text = String(url)
          if (text.includes('/v1/sessions')) {
            return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) }
          }
          if (text.includes('/v1/companies')) {
            companyCalls += 1
            return { ok: true, status: 200, json: async () => ({ ok: true, data: { companies: [], total: 0 } }) }
          }
          return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
        }),
      )
      renderPage({
        detail: { ...petCare, state: 'complete' },
        onRetry,
        staging: { baseUrl: 'https://staging.test', apiKey: 'key' },
      })
      await screen.findByRole('region', { name: 'Sector chat for Pet care' })
      const base = companyCalls
      await vi.advanceTimersByTimeAsync(30000)
      expect(onRetry).not.toHaveBeenCalled()
      expect(companyCalls).toBe(base)
    } finally {
      vi.useRealTimers()
    }
  })

  it('switches between 4-pillar workbench views', async () => {
    stubSessions()
    renderPage({ detail: petCare, staging })
    expect(screen.getByRole('tab', { name: 'Workbench (All)' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Sector Chat' }))
    expect(screen.getByRole('tab', { name: 'Sector Chat' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Sector chat for Pet care' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Context Studio' }))
    expect(screen.getByRole('tab', { name: 'Context Studio' })).toHaveAttribute('aria-selected', 'true')
  })
})
