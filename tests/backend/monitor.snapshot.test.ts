// P5 minor: a sector monitor snapshot reports only its own sector.
import { describe, expect, it } from 'vitest'
import { relevantAlerts } from '../../backend/src/temporal/activities/monitor.js'

describe('monitor sector snapshot alerts [F:backend.activity.monitor.relevantAlerts]', () => {
  it('keeps only the watched sector, even for current warnings', () => {
    const items = [
      { sectorId: 'sector-a', state: 'current-warning', subject: 'A warning' },
      { sectorId: 'sector-b', state: 'current-warning', subject: 'B warning' },
      { sectorId: null, state: 'current-warning', subject: 'unscoped warning' },
      { sectorId: 'sector-a', state: 'historical', subject: 'A old' },
    ]
    expect(relevantAlerts(items, 'sector-a').map((item) => item.subject)).toEqual(['A warning', 'A old'])
  })

  it('caps at five', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ sectorId: 'sector-a', state: 'current-warning', subject: `w${i}` }))
    expect(relevantAlerts(items, 'sector-a')).toHaveLength(5)
  })
})
