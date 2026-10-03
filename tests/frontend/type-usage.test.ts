import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Type discipline (plan 2.2.2 + F3): 600/700 live only in the text
// primitives, the owned ui/* wrappers, and Markdown strong. Negative
// tracking lives only in text.tsx (Display/PageTitle/Stat).
const SRC = join(import.meta.dirname, '..', '..', 'frontend', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx?)$/.test(entry) ? [full] : []
  })
}

describe('type usage (plan 2.2.2)', () => {
  it('keeps 600/700 weights out of feature code', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      if (file.includes('/ui/') || file.endsWith('/text.tsx')) return false
      if (file.endsWith('Markdown.tsx')) return false
      return /font-(semibold|bold)/.test(readFileSync(file, 'utf8'))
    })
    expect(offenders).toEqual([])
  })

  it('keeps negative tracking inside text.tsx', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      if (file.endsWith('/text.tsx')) return false
      return /tracking-tight/.test(readFileSync(file, 'utf8'))
    })
    expect(offenders).toEqual([])
  })
})
