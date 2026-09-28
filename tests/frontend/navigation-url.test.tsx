// URL-driven navigation proofs. View state lives in query params, so a
// cold load (refresh, deep link) restores the view and Back/Forward moves
// through views instead of dropping to home. Staging stubs: the app reads
// the backend, so navigation runs against stubbed API rows.
import { fireEvent, render, screen } from '@testing-library/react'
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
})

describe('app navigation sync', () => {
  it('cold-loads a sector detail from the URL without clicking', async () => {
    setUrl('?section=SectorDetail&sector=seed-pet-care')
    const { default: App } = await import('@/App')
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Sector chat for Pet care' })).toBeInTheDocument()
  })

  it('writes navigation clicks into the URL', async () => {
    const { default: App } = await import('@/App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Pet care' }))
    expect(await screen.findByRole('region', { name: 'Sector chat for Pet care' })).toBeInTheDocument()
    expect(window.location.search).toContain('section=SectorDetail')
    expect(window.location.search).toContain('sector=seed-pet-care')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Researches' }))
    expect(await screen.findByRole('region', { name: 'All sector researches' })).toBeInTheDocument()
    expect(window.location.search).toContain('section=Researches')
    expect(window.location.search).not.toContain('sector=')
  })

  it('keeps the research tab in the URL', async () => {
    const { default: App } = await import('@/App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'View all 1 sector researches' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Companies' }))
    expect(await screen.findByRole('region', { name: 'All company researches' })).toBeInTheDocument()
    expect(window.location.search).toContain('tab=companies')
  })

  it('restores the previous view on Back', async () => {
    const { default: App } = await import('@/App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Pet care' }))
    expect(await screen.findByRole('region', { name: 'Sector chat for Pet care' })).toBeInTheDocument()
    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
  })
})
