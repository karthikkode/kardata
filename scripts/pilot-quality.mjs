#!/usr/bin/env node
// Phase 8 B8: npm run pilot:quality -- --worktree <path> --tag <tag> --since <ISO> [--min-accepted N]
// Prints the quality counts and writes the 30-company sample to
// var/pilot/run-<tag>/quality-sample.json. Exit 1 on any violation.
// --min-accepted sizes the accepted-count gate to the tier (default 100).
// PILOT_QUALITY_URL overrides the RO connection (tests only).
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runPilotQuality } from './pilot-quality-lib.mjs'

function arg(name) {
  const flag = process.argv.indexOf(`--${name}`)
  return flag >= 0 ? process.argv[flag + 1] : null
}

const worktree = arg('worktree')
const tag = arg('tag')
const since = arg('since')
const minAccepted = Number(arg('min-accepted') ?? '100')
if (!worktree || !tag || !since) {
  console.error('usage: npm run pilot:quality -- --worktree <path> --tag <tag> --since <ISO> [--min-accepted N]')
  process.exit(2)
}
if (Number.isNaN(Date.parse(since))) {
  console.error(`pilot:quality: --since is not a date: ${since}`)
  process.exit(2)
}
if (!Number.isInteger(minAccepted) || minAccepted < 1) {
  console.error(`pilot:quality: --min-accepted must be a positive integer: ${arg('min-accepted')}`)
  process.exit(2)
}

const runDir = join(worktree, 'var', 'pilot', `run-${tag}`)
const stateFile = join(runDir, 'state.json')
if (!existsSync(stateFile)) {
  console.error(`pilot:quality: no state at ${stateFile}`)
  process.exit(2)
}
const sectorName = JSON.parse(readFileSync(stateFile, 'utf8')).sectorName
if (!sectorName) {
  console.error('pilot:quality: state.json has no sectorName (P1 must run first)')
  process.exit(2)
}

let connectionString = process.env['PILOT_QUALITY_URL']
if (!connectionString) {
  const envText = readFileSync(join(worktree, 'agents', '.env'), 'utf8')
  const password = envText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('KARDATA_PILOT_RO_PASSWORD='))
    ?.slice('KARDATA_PILOT_RO_PASSWORD='.length)
    .trim()
  if (!password) {
    console.error('pilot:quality: worktree agents/.env is missing KARDATA_PILOT_RO_PASSWORD')
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
    console.error(`pilot:quality: sector not found: ${sectorName}`)
    process.exit(2)
  }
  const { ok, counts, sample, violations } = await runPilotQuality(pool, { sectorId, since, minAccepted })
  console.log(`pilot:quality counts: ${JSON.stringify(counts)}`)
  writeFileSync(join(runDir, 'quality-sample.json'), JSON.stringify(sample, null, 2))
  console.log(`pilot:quality sample: ${sample.length} companies -> run-${tag}/quality-sample.json`)
  if (!ok) {
    for (const violation of violations) console.log(`pilot:quality VIOLATION: ${violation}`)
    process.exit(1)
  }
} finally {
  await pool.end()
}
