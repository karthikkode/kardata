import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Scrollbar rule: every scroll container uses token-matched thin scrollbars
// defined once in index.css (no per-component hex, no unstyled defaults).
const INDEX_CSS = join(import.meta.dirname, '..', '..', 'frontend', 'src', 'index.css')

describe('scrollbar styling', () => {
  it('defines thin token-matched scrollbars for both engines', () => {
    const css = readFileSync(INDEX_CSS, 'utf8')
    expect(css).toContain('scrollbar-width')
    expect(css).toContain('scrollbar-color')
    expect(css).toContain('::-webkit-scrollbar')
    expect(css).toContain('::-webkit-scrollbar-thumb')
  })

  it('uses theme tokens, never hardcoded colors, for scrollbar fills', () => {
    const css = readFileSync(INDEX_CSS, 'utf8')
    expect(css).toContain('scrollbar-color: color-mix(in oklch, var(--muted-foreground)')
    expect(css).toContain('var(--muted-foreground)')
    const scrollbarBlock = css.slice(css.indexOf('::-webkit-scrollbar'))
    expect(scrollbarBlock).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('exposes a scroll-slim utility for dense popovers and tables', () => {
    const css = readFileSync(INDEX_CSS, 'utf8')
    expect(css).toContain('scroll-slim')
  })
})
