// URL-driven navigation proofs. View state lives in query params, so a
// cold load (refresh, deep link) restores the view and Back/Forward moves
// through views instead of dropping to home. Staging stubs: the app reads
// the backend, so navigation runs against stubbed API rows.
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseNavigation } from '@/lib/useNavigation'

const SECTOR = {
  id: 'seed-pet-care',
  name: 'Pet care',
  topic: 'D2C pet brands',
  companiesFound: 1,
  state: 'running',
  companies: [],
  companiesTotal: 0,
  activity: [],
  activityTotal: 0,
}

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`)
}

beforeEach(() => {
  vi.stubEnv('VITE_STAGING_API', '1')
  vi.stubEnv('VITE_STAGING_URL', 'https://staging.test')
  vi.stubEnv('VITE_STAGING_KEY', 'key')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const urlText = String(url)
      const payload = urlText.endsWith('/v1/sectors')
        ? { ok: true, data: [SECTOR] }
        : urlText.includes('/v1/companies')
          ? { ok: true, data: { companies: [], total: 0 } }
          : urlText.includes('/v1/sectors/')
            ? { ok: true, data: SECTOR }
            : { ok: true, data: [] }
      return { ok: true, status: 200, json: async () => payload }
    }),
  )
})

afterEach(() => {
  setUrl('')
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('parseNavigation', () => {
  it('defaults to home', () => {
    expect(parseNavigation('')).toEqual({ section: 'Overview', sectorId: null, researchTab: 'sectors' })
  })

  it('reads section, sector, and tab', () => {
    expect(parseNavigation('?section=SectorDetail&sector=s1&tab=companies')).toEqual({
      section: 'SectorDetail',
      sectorId: 's1',
      researchTab: 'companies',
    })
  })

  it('falls back to the list for a detail view without a sector', () => {
    expect(parseNavigation('?section=SectorDetail')).toEqual({
      section: 'Researches',
      sectorId: null,
      researchTab: 'sectors',
    })
  })

  it('rejects unknown tabs', () => {
    expect(parseNavigation('?section=Researches&tab=archived').researchTab).toBe('sectors')
  })

  it('reads the research filters when present and omits them otherwise', () => {
    expect(parseNavigation('?section=Researches')).not.toHaveProperty('filterQuery')
    expect(parseNavigation('?section=Researches')).not.toHaveProperty('stateFilter')
    expect(parseNavigation('?section=Researches&q=solar&state=failed')).toMatchObject({
      filterQuery: 'solar',
      stateFilter: 'failed',
    })
  })
})

describe('app navigation sync', () => {
  it('cold-loads a sector landing from the URL without clicking', async () => {
    setUrl('?section=SectorDetail&sector=seed-pet-care')
    const { default: App } = await import('@/App')
    render(<App />)
    // The sector route lands on the summary page; chat lives one Open deeper.
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
  })

  it('writes navigation clicks into the URL', async () => {
    const user = userEvent.setup()
    const { default: App } = await import('@/App')
    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: (name) => name.startsWith('Pet care D2C') }),
    )
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
    expect(window.location.search).toContain('section=SectorDetail')
    expect(window.location.search).toContain('sector=seed-pet-care')
    // Open workspace enters the chat workspace; the summary back button is scoped by
    // its region because the sidebar carries its own Researches entry.
    await user.click(await screen.findByRole('button', { name: 'Open workspace' }))
    expect(await screen.findByRole('group', { name: 'Session types' })).toBeInTheDocument()
    expect(window.location.search).toContain('section=SectorChat')
    await user.click(screen.getByRole('button', { name: 'Back to sector summary' }))
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name: 'Researches' }))
    expect(await screen.findByRole('table', { name: 'Sectors' })).toBeInTheDocument()
    expect(window.location.search).toContain('section=Researches')
    expect(window.location.search).not.toContain('sector=')
  })

  it('keeps the research tab in the URL', async () => {
    const { default: App } = await import('@/App')
    render(<App />)
    const sectorsPanel = await screen.findByRole('region', { name: 'Recent sectors' })
    fireEvent.click(within(sectorsPanel).getByRole('button', { name: 'View all' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Companies 0' }))
    expect(await screen.findByText('No companies yet')).toBeInTheDocument()
    expect(window.location.search).toContain('tab=companies')
  })

  it('restores the previous view on Back', async () => {
    const user = userEvent.setup()
    const { default: App } = await import('@/App')
    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: (name) => name.startsWith('Pet care D2C') }),
    )
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Open workspace' }))
    expect(await screen.findByRole('group', { name: 'Session types' })).toBeInTheDocument()
    window.history.back()
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
  })
})
