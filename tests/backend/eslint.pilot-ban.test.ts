// Phase 8 B4: the pilot UI-only lint ban, pinned. Each banned form
// has one fixture that must fail with the ban message; the clean
// fixture and every real pilot spec + helper must pass. Runs the
// repo's own eslint binary with cwd=tests/frontend-e2e/pilot so the
// pilot override applies.
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const PILOT = join(HERE, '..', 'frontend-e2e', 'pilot')
const ESLINT = join(HERE, '..', '..', 'node_modules', '.bin', 'eslint')

async function lint(target: string, extraConfig = false): Promise<{ code: number; out: string }> {
  const args = extraConfig ? ['--no-config-lookup', '--config', './ban-test.config.js', target] : [target]
  try {
    const { stdout } = await run(ESLINT, args, { cwd: PILOT, timeout: 120000 })
    return { code: 0, out: stdout }
  } catch (error) {
    const err = error as { stdout?: string; code?: number }
    return { code: typeof err.code === 'number' ? err.code : 1, out: String(err.stdout ?? err) }
  }
}

describe('pilot UI-only lint ban', () => {
  const cases: Array<[string, string]> = [
    ['__ban-fixtures__/bad-page-request.ts', 'never use page.request'],
    ['__ban-fixtures__/bad-request-fixture.ts', 'never use the request fixture'],
    ['__ban-fixtures__/bad-context.ts', 'never use APIRequestContext'],
    ['__ban-fixtures__/bad-fetch.ts', 'never call fetch'],
    ['__ban-fixtures__/bad-evaluate.ts', 'never fetch inside page.evaluate'],
  ]

  it.each(cases)('%s fails with the ban message', async (file, message) => {
    const result = await lint(file, true)
    expect(result.code).toBe(1)
    expect(result.out).toContain(message)
  }, 180000)

  it('clean fixture and all real pilot specs pass', async () => {
    expect((await lint('__ban-fixtures__/clean.ts')).code).toBe(0)
    const files = readdirSync(PILOT).filter(
      (name) => name.endsWith('.spec.ts') || ['state.ts', 'record.ts', 'ro.ts'].includes(name),
    )
    expect(files.length).toBeGreaterThanOrEqual(16)
    for (const file of files) {
      const result = await lint(file)
      expect(`${file}: ${result.out}`).toBe(`${file}: `)
      expect(result.code).toBe(0)
    }
  }, 300000)
})
