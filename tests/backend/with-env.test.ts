// scripts/with-env.mjs runs a command with agents/.env merged in. Values
// may hold shell-special characters (|, spaces, quotes) that break
// `set -a; . agents/.env`; this loader passes them through byte-exact.
// No network, no secrets printed: assertions only compare child output.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../scripts/with-env.mjs', import.meta.url))
const PRINT_CHILD = ['-p', 'JSON.stringify({a:process.env.KX_A,b:process.env.KX_B,c:process.env.KX_C})']

function fixture(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'with-env-'))
  const path = join(dir, 'test.env')
  writeFileSync(path, body)
  return path
}

function run(envFile: string, extraEnv: Record<string, string> = {}): Record<string, string | undefined> {
  const out = execFileSync(process.execPath, [script, '--file', envFile, '--', process.execPath, ...PRINT_CHILD], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...extraEnv },
  })
  return JSON.parse(out.trim()) as Record<string, string | undefined>
}

describe('scripts/with-env.mjs', () => {
  it('passes pipe/space/quote values through byte-exact (the `set -a` breakage)', () => {
    const envFile = fixture('KX_A=left|middle|right\nKX_B=hello world\nKX_C="quoted value"\n')
    expect(run(envFile)).toEqual({ a: 'left|middle|right', b: 'hello world', c: 'quoted value' })
  })

  it('lets explicit environment win over the file', () => {
    const envFile = fixture('KX_A=from-file\n')
    expect(run(envFile, { KX_A: 'explicit' }).a).toBe('explicit')
  })

  it('fails closed on a missing explicit file without printing values', () => {
    const missing = join(tmpdir(), 'with-env-nope', 'missing.env')
    let stderr = ''
    try {
      execFileSync(process.execPath, [script, '--file', missing, '--', process.execPath, '-p', '1'], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      expect.unreachable('missing env file must fail')
    } catch (error) {
      stderr = String((error as { stderr?: unknown }).stderr ?? '')
    }
    expect(stderr).toContain('with-env: env file not found')
    expect(stderr).toContain('missing.env')
  })
})
