import { describe, expect, it } from 'vitest'
import { formatCount, formatDurationMs, formatFullDate, formatShortDate, humanizeKey, relativeAge } from '@/lib/format'

describe('humanizeKey', () => {
  it.each([
    ['sectorId', 'Sector ID'],
    ['companies_found', 'Companies found'],
    ['direction shards', 'Direction shards'],
    ['id', 'ID'],
    ['sourceUrl', 'Source URL'],
    ['needs_ocr', 'Needs OCR'],
    ['dbName', 'DB name'],
    ['Total', 'Total'],
  ])('humanizes %s as %s', (key, label) => {
    expect(humanizeKey(key)).toBe(label)
  })
})

describe('relativeAge', () => {
  const NOW = new Date('2026-10-02T12:00:00Z').getTime()

  it.each([
    ['2026-10-02T11:59:30Z', 'Just now'],
    ['2026-10-02T11:45:00Z', '15m ago'],
    ['2026-10-02T10:00:00Z', '2h ago'],
    ['2026-09-29T12:00:00Z', '3d ago'],
    ['2026-08-02T12:00:00Z', '2mo ago'],
    ['2024-10-02T12:00:00Z', '2y ago'],
  ])('renders %s as %s', (at, label) => {
    expect(relativeAge(at, NOW)).toBe(label)
  })

  it('stays honest on garbage input', () => {
    expect(relativeAge('not a date', NOW)).toBe('Unknown')
  })
})

describe('formatDurationMs', () => {
  it.each([
    [30_000, 'Under a minute'],
    [5 * 60_000, '5m'],
    [(3 * 60 + 12) * 60_000, '3h 12m'],
    [2 * 3_600_000, '2h'],
  ])('renders %dms as %s', (ms, label) => {
    expect(formatDurationMs(ms)).toBe(label)
  })

  it('stays honest on garbage input', () => {
    expect(formatDurationMs(Number.NaN)).toBe('Unknown')
    expect(formatDurationMs(-1)).toBe('Unknown')
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(2005)).toBe('2,005')
    expect(formatCount(32)).toBe('32')
  })
})

describe('formatFullDate', () => {
  it('renders a full local timestamp', () => {
    // No timezone suffix: parsed as local time, so the expectation is stable.
    expect(formatFullDate('2026-09-03T14:05:00')).toBe('3 Sep 2026, 14:05')
  })

  it('stays honest on garbage input', () => {
    expect(formatFullDate('not a date')).toBe('Unknown')
  })
})

describe('formatShortDate', () => {
  it('renders a short local calendar date', () => {
    expect(formatShortDate('2026-09-03T14:05:00')).toBe('3 Sep 2026')
  })

  it('stays honest on garbage input', () => {
    expect(formatShortDate('not a date')).toBe('Unknown')
  })
})
