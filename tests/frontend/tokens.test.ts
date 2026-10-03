import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Foundation tokens (plan 2.1): every colour token exists in both themes
// and every new token gets a Tailwind mapping. Hardcoded palette
// utilities are banned from feature components.
const SRC = join(import.meta.dirname, '..', '..', 'frontend', 'src')
const INDEX_CSS = join(SRC, 'index.css')

const DEFINED_IN_BOTH = [
  'background', 'foreground',
  'card', 'card-foreground', 'popover', 'popover-foreground',
  'surface-raised', 'surface-sunken', 'secondary', 'secondary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'surface-active', 'foreground-subtle', 'foreground-disabled',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-active',
  'sidebar-border', 'sidebar-ring', 'overlay',
  'border-subtle', 'border', 'border-strong', 'input',
  'primary', 'primary-foreground', 'primary-hover', 'primary-text',
  'primary-soft', 'primary-border', 'ring',
  'success', 'success-soft', 'success-border',
  'warning', 'warning-soft', 'warning-border',
  'danger', 'danger-soft', 'danger-border',
  'info', 'info-soft', 'info-border',
  'destructive', 'destructive-foreground',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
]

// surface-hover has no --var of its own: --color-surface-hover aliases --muted.
const MAPPED = [...DEFINED_IN_BOTH, 'surface-hover']

function block(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, ''))
  if (!match) throw new Error(`missing ${selector} block`)
  return match[1]
}

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return componentFiles(full)
    return /\.(tsx?|css)$/.test(entry) ? [full] : []
  })
}

describe('v2 colour tokens (plan 2.1)', () => {
  it('defines every token in both themes', () => {
    const css = readFileSync(INDEX_CSS, 'utf8')
    const light = block(css, ':root')
    const dark = block(css, '\\.dark')
    for (const name of DEFINED_IN_BOTH) {
      expect(light, `--${name} in :root`).toMatch(new RegExp(`--${name}:\\s*oklch\\(`))
      expect(dark, `--${name} in .dark`).toMatch(new RegExp(`--${name}:\\s*oklch\\(`))
    }
  })

  it('maps every token to a Tailwind colour utility', () => {
    const css = readFileSync(INDEX_CSS, 'utf8')
    const theme = block(css, '@theme inline')
    for (const name of MAPPED) {
      expect(theme, `--color-${name}`).toContain(`--color-${name}:`)
    }
  })

  it('uses the class-driven dark variant with matching color schemes', () => {
    const css = readFileSync(INDEX_CSS, 'utf8')
    expect(css).toContain('@custom-variant dark (&:where(.dark, .dark *));')
    expect(css).toContain('color-scheme: light;')
    expect(css).toContain('color-scheme: dark;')
  })

  it('keeps hardcoded palette utilities out of feature components', () => {
    const offenders = componentFiles(join(SRC, 'components')).filter((file) =>
      /emerald-|amber-|sky-|red-[0-9]/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
