// Phase 7 coverage-gate unit tests (fixtures only; the gate script runs
// at final verification). No [F:] tag: scripts/ are not registry surfaces.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkCoreDirs, CORE_DIRS, CORE_MIN_LINES_PCT, main } from '../../scripts/coverage.mjs'

type SummaryFile = [file: string, covered: number, total: number]

function summary(lines: SummaryFile[]): Record<string, { lines: { covered: number; total: number } }> {
  const entries: Record<string, { lines: { covered: number; total: number } }> = {
    total: { lines: { covered: 0, total: 0 } },
  }
  for (const [file, covered, total] of lines) {
    entries[file] = { lines: { covered, total } }
  }
  return entries
}

describe('coverage core gate', () => {
  it('pins the gated directories and threshold', () => {
    expect(CORE_DIRS).toEqual(['backend/src/db', 'backend/src/mcp', 'backend/src/temporal'])
    expect(CORE_MIN_LINES_PCT).toBe(85)
  })

  it('passes when every core dir is at or above the threshold', () => {
    const result = checkCoreDirs(summary([
      ['/repo/backend/src/db/a.ts', 90, 100],
      ['/repo/backend/src/mcp/b.ts', 85, 100],
      ['/repo/backend/src/temporal/c.ts', 100, 100],
      ['/repo/backend/src/routes/d.ts', 0, 100],
    ]))
    expect(result.every((entry) => entry.pass)).toBe(true)
  })

  it('fails the dir below the threshold and names it', () => {
    const result = checkCoreDirs(summary([
      ['/repo/backend/src/db/a.ts', 90, 100],
      ['/repo/backend/src/mcp/b.ts', 90, 100],
      ['/repo/backend/src/temporal/c.ts', 84, 100],
    ]))
    expect(result.find((entry) => entry.dir === 'backend/src/temporal')?.pass).toBe(false)
  })

  it('fails a core dir with no files in the summary', () => {
    const result = checkCoreDirs(summary([
      ['/repo/backend/src/db/a.ts', 90, 100],
    ]))
    expect(result.find((entry) => entry.dir === 'backend/src/mcp')?.pass).toBe(false)
  })

  it('matches repo-relative keys as well as absolute ones', () => {
    const result = checkCoreDirs(summary([
      ['backend/src/db/a.ts', 90, 100],
      ['backend/src/mcp/b.ts', 90, 100],
      ['backend/src/temporal/c.ts', 90, 100],
    ]))
    expect(result.every((entry) => entry.pass)).toBe(true)
  })

  it('backend without DB fails unless explicitly skipped (P7-M3)', () => {
    const prev = process.exitCode
    try {
      process.exitCode = 0
      main(['--backend-only'], {})
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = prev
    }
  })

  it('COVERAGE_SKIP_BACKEND=1 skips backend with a note (P7-M3)', () => {
    const prev = process.exitCode
    try {
      process.exitCode = 0
      main(['--backend-only'], { COVERAGE_SKIP_BACKEND: '1' })
      expect(process.exitCode ?? 0).toBe(0)
    } finally {
      process.exitCode = prev
    }
  })

  it('importing the script does not run the gate (main guard)', () => {
    const script = fileURLToPath(new URL('../../scripts/coverage.mjs', import.meta.url))
    const out = execFileSync(
      process.execPath,
      ['-e', `import(${JSON.stringify(script)}).then(() => console.log('import-ok'))`],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, TEST_DATABASE_URL: 'postgresql://127.0.0.1:1/none' },
      },
    )
    expect(out).toContain('import-ok')
    expect(out).not.toContain('test:coverage')
  })
})
