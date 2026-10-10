#!/usr/bin/env node
// Phase 8 B5: npm run pilot:audit -- --worktree <path> --tag <tag> --since <ISO>
// Reads the run's sector from state.json, connects as the RO role, and
// exits 1 naming the first violation (0 when the run is clean).
// PILOT_AUDIT_URL overrides the RO connection (tests only).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runPilotAudit } from './pilot-audit-lib.mjs'

function arg(name) {
  const flag = process.argv.indexOf(`--${name}`)
  return flag >= 0 ? process.argv[flag + 1] : null
}

const worktree = arg('worktree')
const tag = arg('tag')
const since = arg('since')
if (!worktree || !tag || !since) {
  console.error('usage: npm run pilot:audit -- --worktree <path> --tag <tag> --since <ISO>')
  process.exit(2)
}
if (Number.isNaN(Date.parse(since))) {
  console.error(`pilot:audit: --since is not a date: ${since}`)
  process.exit(2)
}

const stateFile = join(worktree, 'var', 'pilot', `run-${tag}`, 'state.json')
if (!existsSync(stateFile)) {
  console.error(`pilot:audit: no state at ${stateFile}`)
  process.exit(2)
}
const sectorName = JSON.parse(readFileSync(stateFile, 'utf8')).sectorName
if (!sectorName) {
  console.error('pilot:audit: state.json has no sectorName (P1 must run first)')
  process.exit(2)
}

let connectionString = process.env['PILOT_AUDIT_URL']
if (!connectionString) {
  const envText = readFileSync(join(worktree, 'agents', '.env'), 'utf8')
  const password = envText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('KARDATA_PILOT_RO_PASSWORD='))
    ?.slice('KARDATA_PILOT_RO_PASSWORD='.length)
    .trim()
  if (!password) {
    console.error('pilot:audit: worktree agents/.env is missing KARDATA_PILOT_RO_PASSWORD')
    process.exit(2)
  }
  connectionString = `postgresql://kardata_pilot_ro:${encodeURIComponent(password)}@127.0.0.1:5433/kardata_pilot`
}

const { Pool } = createRequire(import.meta.url)('pg')
const pool = new Pool({ connectionString })
try {
  const sectors = await pool.query('SELECT id FROM sectors WHERE name = $1', [sectorName])
  const sectorId = sectors.rows[0]?.id
  if (!sectorId) {
    console.error(`pilot:audit: sector not found: ${sectorName}`)
    process.exit(2)
  }
  const { ok, violations } = await runPilotAudit(pool, { sectorId, since })
  if (ok) {
    console.log(`pilot:audit clean: sector ${sectorName} since ${since}`)
  } else {
    for (const violation of violations) console.log(`pilot:audit VIOLATION: ${violation}`)
    process.exit(1)
  }
} finally {
  await pool.end()
}
