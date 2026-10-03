import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Contrast targets (plan 2.1.7): every claimed ratio recomputed from the
// token values in index.css, so a token edit that breaks AA fails here.
// Oklch -> linear sRGB uses the standard Oklab matrices; out-of-gamut
// channels clamp at zero the way browsers clip them.
const INDEX_CSS = join(import.meta.dirname, '..', '..', 'frontend', 'src', 'index.css')

type Oklch = [number, number, number]

function themeTokens(css: string, selector: string): Record<string, Oklch> {
  const block = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, ''))?.[1] ?? ''
  const tokens: Record<string, Oklch> = {}
  for (const match of block.matchAll(/--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)/g)) {
    tokens[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])]
  }
  return tokens
}

function luminance([l, c, hDeg]: Oklch): number {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const lms1 = l + 0.3963377774 * a + 0.2158037573 * b
  const lms2 = l - 0.1055613458 * a - 0.0638541728 * b
  const lms3 = l - 0.0894841775 * a - 1.2914855480 * b
  const r = 4.0767416621 * lms1 ** 3 - 3.3077115913 * lms2 ** 3 + 0.2309699292 * lms3 ** 3
  const g = -1.2684380046 * lms1 ** 3 + 2.6097574011 * lms2 ** 3 - 0.3413193965 * lms3 ** 3
  const bl = -0.0041960863 * lms1 ** 3 - 0.7034186147 * lms2 ** 3 + 1.7076147010 * lms3 ** 3
  return 0.2126 * Math.max(0, r) + 0.7152 * Math.max(0, g) + 0.0722 * Math.max(0, bl)
}

function ratio(fg: Oklch, bg: Oklch): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const SURFACES = [
  'background', 'card', 'popover', 'surface-sunken', 'muted',
  'surface-active', 'sidebar', 'sidebar-accent', 'sidebar-active',
]
const STATUSES = ['success', 'warning', 'danger', 'info']

describe('token contrast (plan 2.1.7)', () => {
  const css = readFileSync(INDEX_CSS, 'utf8')
  for (const [theme, selector] of [['light', ':root'], ['dark', '\\.dark']] as const) {
    const tokens = themeTokens(css, selector)
    describe(`${theme} theme`, () => {
      it('keeps primary text at 12:1 on every surface', () => {
        for (const surface of SURFACES) {
          expect(ratio(tokens.foreground, tokens[surface]), `foreground on ${surface}`).toBeGreaterThanOrEqual(12)
        }
      })

      it('keeps secondary text at 6:1 on card', () => {
        expect(ratio(tokens['muted-foreground'], tokens.card)).toBeGreaterThanOrEqual(6)
      })

      it('keeps tertiary text at 4.5:1 on every surface', () => {
        for (const surface of SURFACES) {
          expect(ratio(tokens['foreground-subtle'], tokens[surface]), `subtle on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('keeps disabled text at 2.5:1 on card', () => {
        expect(ratio(tokens['foreground-disabled'], tokens.card)).toBeGreaterThanOrEqual(2.5)
      })

      it('keeps primary fill text and links at 4.5:1', () => {
        expect(ratio(tokens['primary-foreground'], tokens.primary)).toBeGreaterThanOrEqual(4.5)
        expect(ratio(tokens['primary-text'], tokens.card)).toBeGreaterThanOrEqual(4.5)
        expect(ratio(tokens['primary-text'], tokens['primary-soft'])).toBeGreaterThanOrEqual(4.5)
      })

      it('keeps the focus ring at 3:1 against card', () => {
        expect(ratio(tokens.ring, tokens.card)).toBeGreaterThanOrEqual(3)
      })

      it('keeps status tones at 4.5:1 on soft and card', () => {
        for (const status of STATUSES) {
          expect(ratio(tokens[status], tokens[`${status}-soft`]), `${status} on soft`).toBeGreaterThanOrEqual(4.5)
          expect(ratio(tokens[status], tokens.card), `${status} on card`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('keeps chart tones at 3:1 against card', () => {
        for (let index = 1; index <= 5; index += 1) {
          expect(ratio(tokens[`chart-${index}`], tokens.card), `chart-${index}`).toBeGreaterThanOrEqual(3)
        }
      })
    })
  }
})
