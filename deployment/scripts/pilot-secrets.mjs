// Shared pilot service secrets (P8-B2). Run worktrees come and go (r1,
// r2, Phase 9 final-rc) but the pilot database keeps the FIRST run's key
// hashes (ON CONFLICT DO NOTHING), so the four service secrets live in
// ONE file in this checkout — generated once, never rotated — and every
// `pilot up` reads it. The per-worktree agents/.env keeps provider keys
// copied from staging plus a synced copy of the shared values (the pilot
// CLIs read the RO password from there).
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnvFile } from './stack-lib.mjs'

export const PILOT_SERVICE_KEYS = [
  'KARDATA_MCP_TOKEN',
  'KARDATA_UI_KEY',
  'KARDATA_PILOT_VIEWER_KEY',
  'KARDATA_PILOT_RO_PASSWORD',
]

export function sharedPilotSecretsFile(checkoutDir) {
  return join(checkoutDir, 'var', 'pilot', 'secrets.env')
}

/** Generate-once (0600) shared secrets; returns the parsed values. Never rewrites. */
export function ensureSharedPilotSecrets(checkoutDir) {
  const file = sharedPilotSecretsFile(checkoutDir)
  if (!existsSync(file)) {
    const lines = PILOT_SERVICE_KEYS.map((key) => `${key}=${randomBytes(24).toString('hex')}`)
    mkdirSync(join(checkoutDir, 'var', 'pilot'), { recursive: true })
    writeFileSync(file, `${lines.join('\n')}\n`)
    chmodSync(file, 0o600)
  }
  const parsed = parseEnvFile(readFileSync(file, 'utf8'))
  for (const key of PILOT_SERVICE_KEYS) {
    if (!parsed[key]) {
      throw new Error(`stack: pilot ${file} is missing ${key}; add it explicitly (pilot up never rewrites secrets)`)
    }
  }
  return parsed
}

/** Worktree agents/.env: provider keys from staging, service lines synced
 * from the shared values (a stale pre-shared file heals on next up). */
export function ensureWorktreeEnv({ worktreeDir, stagingEnvText, shared }) {
  const file = join(worktreeDir, 'agents', '.env')
  const wanted = new Map(PILOT_SERVICE_KEYS.map((key) => [key, shared[key]]))
  if (existsSync(file)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    let changed = false
    const out = lines.map((line) => {
      const key = line.slice(0, line.indexOf('=')).trim()
      if (wanted.has(key) && line !== `${key}=${wanted.get(key)}`) {
        changed = true
        return `${key}=${wanted.get(key)}`
      }
      return line
    })
    for (const [key, value] of wanted) {
      if (!out.some((line) => line.startsWith(`${key}=`))) {
        out.push(`${key}=${value}`)
        changed = true
      }
    }
    if (changed) writeFileSync(file, `${out.join('\n').replace(/\n+$/, '\n')}`)
    return parseEnvFile(readFileSync(file, 'utf8'))
  }
  const lines = []
  for (const [key, value] of Object.entries(parseEnvFile(stagingEnvText))) {
    if (PILOT_SERVICE_KEYS.includes(key)) continue
    lines.push(`${key}=${value}`)
  }
  for (const [key, value] of wanted) lines.push(`${key}=${value}`)
  mkdirSync(join(worktreeDir, 'agents'), { recursive: true })
  writeFileSync(file, `${lines.join('\n')}\n`)
  chmodSync(file, 0o600)
  return parseEnvFile(readFileSync(file, 'utf8'))
}

/** Full load for `pilot up`: shared secrets first, then the worktree env. */
export function loadPilotSecrets({ checkoutDir, worktreeDir, stagingEnvText }) {
  const shared = ensureSharedPilotSecrets(checkoutDir)
  return ensureWorktreeEnv({ worktreeDir, stagingEnvText, shared })
}
