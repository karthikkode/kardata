import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor, parseOklab, parseOklch, parseRgb, relativeLuminance } from '../frontend-e2e/support/color'

describe('audit colour math', () => {
  it('parses rgb() with and without alpha', () => {
    expect(parseRgb('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, alpha: 1 })
    expect(parseRgb('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, alpha: 0.5 })
    expect(parseRgb('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, alpha: 0 })
    expect(parseRgb('oklch(0.5 0.1 200)')).toBeNull()
  })

  it('parses oklch() the way Chromium serializes it', () => {
    expect(parseOklch('oklch(1 0 0)')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
    expect(parseOklch('oklch(0 0 0)')).toEqual({ r: 0, g: 0, b: 0, alpha: 1 })
    expect(parseOklch('oklch(0.988 0.002 264)')).toMatchObject({ alpha: 1 })
    const background = parseOklch('oklch(0.988 0.002 264)')
    expect(background?.r).toBeGreaterThan(240)
    expect(parseOklch('oklch(0.2 0.01 264 / 0.32)')?.alpha).toBeCloseTo(0.32, 5)
    expect(parseOklch('oklch(0.2 0.01 264 / 32%)')?.alpha).toBeCloseTo(0.32, 5)
    expect(parseOklch('rgb(1, 2, 3)')).toBeNull()
    expect(parseOklch('color-mix(in srgb, red 50%, blue)')).toBeNull()
  })

  it('parses oklab() from color-mix fallout', () => {
    expect(parseOklab('oklab(1 0 0)')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
    expect(parseOklab('oklab(0 0 0)')).toEqual({ r: 0, g: 0, b: 0, alpha: 1 })
    // Same grey in both spaces converts to the same sRGB.
    expect(parseOklab('oklab(0.5 0 0)')).toEqual(parseOklch('oklch(0.5 0 0)'))
    expect(parseOklab('oklab(0.5 0.01 -0.02 / 0.5)')?.alpha).toBeCloseTo(0.5, 5)
    expect(parseOklab('rgb(1, 2, 3)')).toBeNull()
  })

  it('routes all serializations through one parser', () => {
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, alpha: 1 })
    expect(parseCssColor('oklch(1 0 0)')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
    expect(parseCssColor('oklab(1 0 0)')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
    expect(parseCssColor('color-mix(in srgb, red 50%, blue)')).toBeNull()
  })

  it('computes WCAG luminance and ratios', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255, alpha: 1 })).toBeCloseTo(1, 5)
    expect(relativeLuminance({ r: 0, g: 0, b: 0, alpha: 1 })).toBeCloseTo(0, 5)
    expect(
      contrastRatio({ r: 255, g: 255, b: 255, alpha: 1 }, { r: 0, g: 0, b: 0, alpha: 1 }),
    ).toBeCloseTo(21, 5)
  })

  it('agrees with the token suite on a foundation pair', () => {
    // Light foreground on card must clear the 12:1 bar with margin.
    const foreground = parseCssColor('oklch(0.21 0.006 264)')
    const card = parseCssColor('oklch(1 0 0)')
    expect(foreground).not.toBeNull()
    expect(card).not.toBeNull()
    expect(contrastRatio(foreground!, card!)).toBeGreaterThan(15)
  })
})
