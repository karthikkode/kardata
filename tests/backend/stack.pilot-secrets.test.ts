// P8-B2: pilot service secrets are shared across run worktrees, and the
// archive lives in this checkout — never per-worktree. Unit tests for
// deployment/scripts/pilot-secrets.mjs plus static wiring on stack.mjs.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('pilot up wiring (static)', () => {
  it('reads service secrets from the shared checkout file, not per-worktree', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync('deployment/scripts/stack.mjs', 'utf8')
    const section = text.slice(text.indexOf('function pilotSecrets'), text.indexOf('async function cmdPilotUp'))
    expect(section.length).toBeGreaterThan(200)
    expect(section).toContain('loadPilotSecrets')
    expect(section).toContain('checkoutDir: ROOT')
    expect(section).not.toContain("join(worktree, 'agents', '.env')")
    expect(section).not.toContain('randomBytes')
  })

  it('pilot down waits for real exit (down→up never sees a taken port)', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync('deployment/scripts/stack.mjs', 'utf8')
    const section = text.slice(text.indexOf('async function cmdPilotDown'), text.indexOf('async function cmdPilotStatus'))
    expect(section).toContain('SIGTERM')
    expect(section).toContain('SIGKILL')
    expect(section).toContain('pidMatches(entry.pid, entry.marker)')
  })

  it('keeps the archive in this checkout, not per-worktree', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync('deployment/scripts/stack.mjs', 'utf8')
    const section = text.slice(text.indexOf('async function cmdPilotUp'), text.indexOf('async function cmdPilotDown'))
    expect(section).toContain("join(ROOT, 'var', 'pilot', 'archive')")
    expect(section).not.toContain("join(worktree, 'var', 'pilot', 'archive')")
    // The checkout-archive move must not drop the per-worktree log dir:
    // migrate.log and the proc logs land there (crashed ups left the DB behind).
    expect(section).toContain("mkdirSync(join(worktree, 'var', 'pilot')")
  })
})

describe('ensureSharedPilotSecrets', () => {
  const staging = 'KARDATA_META_KEY=meta-1\nKARDATA_MCP_TOKEN=staging-token\n'

  it('returns identical service keys for two worktrees (A→B)', async () => {
    const { loadPilotSecrets } = await import('../../deployment/scripts/pilot-secrets.mjs')
    const checkout = mkdtempSync(join(tmpdir(), 'pilot-secrets-'))
    const a = loadPilotSecrets({ checkoutDir: checkout, worktreeDir: join(checkout, 'A'), stagingEnvText: staging })
    const b = loadPilotSecrets({ checkoutDir: checkout, worktreeDir: join(checkout, 'B'), stagingEnvText: staging })
    for (const key of ['KARDATA_MCP_TOKEN', 'KARDATA_UI_KEY', 'KARDATA_PILOT_VIEWER_KEY', 'KARDATA_PILOT_RO_PASSWORD']) {
      expect(a[key]).toMatch(/^[0-9a-f]{48}$/)
      expect(b[key]).toBe(a[key])
    }
    // Provider keys are copied from staging; staging's service keys are not.
    expect(a['KARDATA_META_KEY']).toBe('meta-1')
    expect(a['KARDATA_MCP_TOKEN']).not.toBe('staging-token')
  })

  it('generates once (0600) and never rewrites the shared file', async () => {
    const { statSync, readFileSync } = await import('node:fs')
    const { ensureSharedPilotSecrets, sharedPilotSecretsFile } = await import('../../deployment/scripts/pilot-secrets.mjs')
    const checkout = mkdtempSync(join(tmpdir(), 'pilot-secrets-'))
    const first = ensureSharedPilotSecrets(checkout)
    const file = sharedPilotSecretsFile(checkout)
    expect(file).toBe(join(checkout, 'var', 'pilot', 'secrets.env'))
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(ensureSharedPilotSecrets(checkout)).toEqual(first)
    expect(readFileSync(file, 'utf8')).toContain(`KARDATA_UI_KEY=${first['KARDATA_UI_KEY']}`)
  })

  it('fails loudly when a shared key is missing', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { ensureSharedPilotSecrets } = await import('../../deployment/scripts/pilot-secrets.mjs')
    const checkout = mkdtempSync(join(tmpdir(), 'pilot-secrets-'))
    mkdirSync(join(checkout, 'var', 'pilot'), { recursive: true })
    writeFileSync(join(checkout, 'var', 'pilot', 'secrets.env'), 'KARDATA_UI_KEY=abc\n')
    expect(() => ensureSharedPilotSecrets(checkout)).toThrow(/missing KARDATA_MCP_TOKEN/)
  })

  it('heals a stale worktree file by syncing shared service lines', async () => {
    const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs')
    const { loadPilotSecrets } = await import('../../deployment/scripts/pilot-secrets.mjs')
    const checkout = mkdtempSync(join(tmpdir(), 'pilot-secrets-'))
    const worktree = join(checkout, 'A')
    mkdirSync(join(worktree, 'agents'), { recursive: true })
    writeFileSync(join(worktree, 'agents', '.env'), 'KARDATA_META_KEY=meta-1\nKARDATA_UI_KEY=stale\n')
    const loaded = loadPilotSecrets({ checkoutDir: checkout, worktreeDir: worktree, stagingEnvText: staging })
    expect(loaded['KARDATA_UI_KEY']).toMatch(/^[0-9a-f]{48}$/)
    const text = readFileSync(join(worktree, 'agents', '.env'), 'utf8')
    expect(text).toContain('KARDATA_META_KEY=meta-1')
    expect(text).toContain(`KARDATA_UI_KEY=${loaded['KARDATA_UI_KEY']}`)
    expect(text).toContain('KARDATA_PILOT_RO_PASSWORD=')
  })
})
