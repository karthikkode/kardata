// URL-driven navigation. Section, open sector, and research tab live in
// query params (this hook owns only these three keys; any others pass
// through untouched), so refresh, deep links, and Back/Forward restore the
// view instead of dropping to home.
import { useCallback, useEffect, useState } from 'react'
import type { ResearchList } from '../components/Dashboard'

export interface Navigation {
  section: string
  sectorId: string | null
  researchTab: ResearchList
}

const DEFAULT_NAVIGATION: Navigation = {
  section: 'Overview',
  sectorId: null,
  researchTab: 'sectors',
}

function pickTab(value: string | null): ResearchList {
  return value === 'companies' ? 'companies' : 'sectors'
}

/** Parse a search string; unknown sections pass through (Sidebar owns the
 * placeholder branches), a detail view without a sector falls back to the
 * list it came from. Exported for tests. */
export function parseNavigation(search: string): Navigation {
  const params = new URLSearchParams(search)
  const section = params.get('section')?.trim() || DEFAULT_NAVIGATION.section
  const sectorId = params.get('sector')?.trim() || null
  if (section === 'SectorDetail' && !sectorId) {
    return { section: 'Researches', sectorId: null, researchTab: pickTab(params.get('tab')) }
  }
  return { section, sectorId, researchTab: pickTab(params.get('tab')) }
}

function serialize(nav: Navigation): string {
  const params = new URLSearchParams(window.location.search)
  if (nav.section === DEFAULT_NAVIGATION.section) params.delete('section')
  else params.set('section', nav.section)
  if (nav.sectorId) params.set('sector', nav.sectorId)
  else params.delete('sector')
  if (nav.researchTab === DEFAULT_NAVIGATION.researchTab) params.delete('tab')
  else params.set('tab', nav.researchTab)
  const query = params.toString()
  return `${window.location.pathname}${query ? `?${query}` : ''}`
}

/** View state synced both ways with the URL. Updates push a history entry
 * (Back/Forward work); popstate re-parses so the back button restores the
 * view. Scenario params are preserved verbatim. */
export function useNavigation(): [Navigation, (next: Partial<Navigation>) => void] {
  const [nav, setNavState] = useState<Navigation>(() => parseNavigation(window.location.search))
  useEffect(() => {
    const onPopState = (): void => {
      setNavState(parseNavigation(window.location.search))
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])
  const setNav = useCallback((next: Partial<Navigation>) => {
    setNavState((current) => {
      const merged = { ...current, ...next }
      window.history.pushState(null, '', serialize(merged))
      return merged
    })
  }, [])
  return [nav, setNav]
}
