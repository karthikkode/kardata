import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Standard rule (documentation/frontend.md): exactly two font families,
// Geist Variable for UI and Geist Mono Variable for code, both declared as
// tokens in index.css and nowhere else.
const SRC = join(import.meta.dirname, '..', '..', 'frontend', 'src')
const INDEX_CSS = join(SRC, 'index.css')

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? textFiles(full) : [full]
  })
}

describe('typography tokens', () => {
  it('declares the sans and mono families in index.css', () => {
    const css = readFileSync(INDEX_CSS, 'utf8')
    expect(css).toContain('--font-sans')
    expect(css).toContain('Geist Variable')
    expect(css).toContain('--font-mono')
    expect(css).toContain('Geist Mono Variable')
  })

  it('imports no other font package in frontend/src', () => {
    const offenders = textFiles(SRC).filter((file) => {
      const content = readFileSync(file, 'utf8')
      return (
        /@fontsource\//.test(content) &&
        !/@fontsource-variable\/geist(-mono)?/.test(content)
      )
    })
    expect(offenders).toEqual([])
  })

  it('declares no font-family outside index.css', () => {
    const offenders = textFiles(SRC)
      .filter((file) => file !== INDEX_CSS)
      .filter((file) => readFileSync(file, 'utf8').includes('font-family'))
    expect(offenders).toEqual([])
  })

  it('uses no raw text-[ sizes in feature code (shared text primitives own the scale)', () => {
    // Exempt: owned primitive internals (ui/), the text primitives
    // themselves, and the relative em code size in Markdown.tsx.
    const offenders = textFiles(SRC).filter((file) => {
      if (file.includes('/ui/') || file.endsWith('/text.tsx')) return false
      if (file.endsWith('Markdown.tsx')) return false
      return /text-\[/.test(readFileSync(file, 'utf8'))
    })
    expect(offenders).toEqual([])
  })
})
