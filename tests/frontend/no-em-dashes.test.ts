import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Hard rule (documentation/frontend.md): no static frontend string may
// contain an em dash. AI and runtime-dynamic content is exempt because it
// never lives in these files.
const SRC = join(import.meta.dirname, '..', '..', 'frontend', 'src')
const EM_DASH = '—'

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? textFiles(full) : [full]
  })
}

describe('no em dashes in frontend source', () => {
  it('fails on the first em dash found under frontend/src', () => {
    const offenders = textFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes(EM_DASH),
    )
    expect(offenders).toEqual([])
  })
})
