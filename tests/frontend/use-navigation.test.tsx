// Navigation view param: the landing Review-plan link deep-links the
// workspace Plan tab through ?view=plan (SectorChat only).
import { describe, expect, it } from 'vitest'
import { parseNavigation, serializeNavigation } from '@/lib/useNavigation'

describe('workspace view param', () => {
  it('parses the plan deep link', () => {
    expect(parseNavigation('?section=SectorChat&sector=s1&view=plan').view).toBe('plan')
  })

  it('leaves the view absent by default', () => {
    expect(parseNavigation('?section=SectorChat&sector=s1').view).toBeUndefined()
    expect(parseNavigation('?section=Researches').view).toBeUndefined()
  })

  it('serializes the view only for the workspace', () => {
    window.history.replaceState(null, '', '/')
    expect(serializeNavigation({ section: 'SectorChat', sectorId: 's1', researchTab: 'sectors', view: 'plan' })).toBe(
      '/?section=SectorChat&sector=s1&view=plan',
    )
    expect(serializeNavigation({ section: 'SectorDetail', sectorId: 's1', researchTab: 'sectors', view: 'plan' })).toBe(
      '/?section=SectorDetail&sector=s1',
    )
  })
})
