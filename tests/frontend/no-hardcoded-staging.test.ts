// No hardcoded staging values in frontend source. The API URL, key, and
// browser origins resolve from environment (frontend/.env local,
// KARDATA_* in compose); localhost ports and demo key names must never be
// baked into product code, or a staging build silently points at dev.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..', 'frontend', 'src')
const STAGING_LITERAL = /localhost|127\.0\.0\.1|demo-operator|demo-viewer|:3001|:5173/

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? textFiles(full) : [full]
  })
}

describe('no hardcoded staging values in frontend source', () => {
  it('fails on localhost, dev ports, or demo key names under frontend/src', () => {
    const offenders = textFiles(SRC).filter((file) =>
      STAGING_LITERAL.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})

// The mock era is over: no fixture imports, no scenario system, no
// Mock-prefixed types anywhere in product source.
const MOCK_PATTERN = /from\s+['"][^'"]*mock\/|useScenario|Mock[A-Z]\w*/

describe('no mock remnants in frontend source', () => {
  it('fails on mock imports, scenario hooks, or Mock types under frontend/src', () => {
    const offenders = textFiles(SRC).filter((file) =>
      MOCK_PATTERN.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
