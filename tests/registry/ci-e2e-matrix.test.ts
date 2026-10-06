// P6-M5: CI e2e excludes the baseless matrix (a first run without
// screenshot baselines fails) and carries a timeout.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
const e2e = ci.slice(ci.indexOf('\n  e2e:'), ci.indexOf('\n  integration:'))
const playwright = readFileSync(join(ROOT, 'frontend', 'playwright.config.ts'), 'utf8')

describe('CI e2e matrix exclusion', () => {
  it('e2e job has a timeout', () => {
    expect(e2e).toMatch(/timeout-minutes: 45/)
  })

  it('CI sets the matrix exclusion flag', () => {
    expect(e2e).toContain('CI_MATRIX')
  })

  it('playwright honors the flag by ignoring matrix/', () => {
    expect(playwright).toContain('CI_MATRIX')
    expect(playwright).toContain('testIgnore')
    expect(playwright).toContain('matrix')
  })
})
