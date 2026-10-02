import { describe, expect, it } from 'vitest'
import { focusRing, focusRingInset, focusRingInput, pressable, pressRow } from '@/lib/interaction'

describe('interaction recipes (plan 2.5)', () => {
  it('rings standalone focusables with a 2px offset outline', () => {
    expect(focusRing).toContain('focus-visible:outline-2')
    expect(focusRing).toContain('focus-visible:outline-offset-2')
    expect(focusRing).toContain('focus-visible:outline-ring')
  })

  it('rings in-container focusables with a negative offset', () => {
    expect(focusRingInset).toContain('focus-visible:-outline-offset-2')
    expect(focusRingInset).toContain('focus-visible:outline-ring')
  })

  it('shifts input borders plus a soft ring on focus', () => {
    expect(focusRingInput).toContain('focus-visible:border-ring')
    expect(focusRingInput).toContain('focus-visible:outline-ring/30')
  })

  it('presses buttons with scale and rows with fill, both fast', () => {
    for (const recipe of [pressable, pressRow]) {
      expect(recipe).toContain('cursor-pointer')
      expect(recipe).toContain('duration-120')
    }
    expect(pressable).toContain('active:scale-[0.98]')
    expect(pressRow).toContain('active:bg-surface-active')
    expect(pressRow).not.toContain('scale-')
  })
})
