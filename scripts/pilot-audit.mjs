#!/usr/bin/env node
// Phase 8 B5 UI-only audit (P8-B1): npm run pilot:audit -- --worktree <path> --tag <tag> --since <ISO>
// The pilot database holds one run: audits the whole run window (no
// sector lookup, no state.json). Prints the (a) counts table + (b) the
// violation count, exits 1 naming every violation (0 when clean).
// PILOT_AUDIT_URL overrides the RO connection (tests only).
import { readFileSync } from 'node:fs'
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
  const { ok, counts, violations } = await runPilotAudit(pool, { since })
  console.log(`pilot:audit events since ${since}:`)
  for (const [client, n] of Object.entries(counts.eventsByClient)) console.log(`  client ${client}: ${n}`)
  console.log(`pilot:audit ui_only_violation alerts: ${counts.violationAlerts}`)
  console.log('pilot:audit CANCELLING by client (owner ui, supervision system, Karbot agent-mcp):')
  for (const [client, n] of Object.entries(counts.cancellingByClient)) console.log(`  client ${client}: ${n}`)
  console.log('pilot:audit limit: the gate binds key+origin+header; a key holder can fake the header+origin')
  if (ok) {
    console.log(`pilot:audit clean: tag ${tag} since ${since}`)
  } else {
    for (const violation of violations) console.log(`pilot:audit VIOLATION: ${violation}`)
    process.exit(1)
  }
} finally {
  await pool.end()
}
