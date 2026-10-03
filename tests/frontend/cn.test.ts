import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cn } from '../../frontend/src/lib/utils'

describe('cn configured merger', () => {
  it('keeps text colors alongside custom font sizes', () => {
    // Regression: bare `cn` misfiled `text-ui` as a text color and dropped
    // `text-primary-foreground`, rendering dark text on primary buttons.
    expect(cn('bg-primary text-primary-foreground', 'h-8 px-3 text-ui')).toContain(
      'text-primary-foreground',
    )
    expect(cn('text-muted-foreground text-ui')).toBe('text-muted-foreground text-ui')
  })

  it('still resolves real font-size conflicts', () => {
    expect(cn('text-sm', 'text-ui')).toBe('text-ui')
    expect(cn('text-ui', 'text-md')).toBe('text-md')
  })

  it('still resolves real color conflicts', () => {
    expect(cn('text-foreground', 'text-muted-foreground')).toBe('text-muted-foreground')
    expect(cn('bg-card', 'bg-primary')).toBe('bg-primary')
  })

  it('is the only merger feature code imports', () => {
    const root = join(import.meta.dirname, '..', '..', 'frontend', 'src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry)) files.push(full)
      }
    }
    walk(root)
    const offenders = files.filter((file) => {
      if (file.endsWith(join('lib', 'utils.ts'))) return false
      return /from ['"]cn['"]/.test(readFileSync(file, 'utf8'))
    })
    expect(offenders).toEqual([])
  })
})
