// Phase 7 coverage gate. Runs per-workspace istanbul coverage, then
// enforces the backend per-directory split (db/mcp/temporal >= 85% lines)
// that vitest thresholds cannot express (the 85/80/75 globals live in
// each workspace config). Backend coverage measures the evergreen tiers
// (unit+db+temporal; fault/stress are separate gates) and needs both
// TEST_DATABASE_URL and a Temporal server, like verify:full. Without a
// DB the db tier skips and the numbers are meaningless, so the backend
// step is skipped with a printed note instead of a false pass.
// Usage: node scripts/coverage.mjs [--backend-only] [--print-plan]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND_SUMMARY = join(ROOT, 'coverage', 'coverage-summary.json')
export const CORE_DIRS = ['backend/src/db', 'backend/src/mcp', 'backend/src/temporal']
export const CORE_MIN_LINES_PCT = 85

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT })
}

// Istanbul json-summary keys are absolute paths (backend vitest root is
// the repo root); match the backend-relative directory either way.
function dirLines(summary, dir) {
  let covered = 0
  let total = 0
  for (const [file, data] of Object.entries(summary)) {
    if (file === 'total') continue
    if (!file.startsWith(`${dir}/`) && !file.includes(`/${dir}/`)) continue
    covered += data.lines.covered
    total += data.lines.total
  }
  return { covered, total, pct: total === 0 ? 0 : (covered / total) * 100 }
}

export function checkCoreDirs(summary) {
  return CORE_DIRS.map((dir) => {
    const { covered, total, pct } = dirLines(summary, dir)
    return { dir, covered, total, pct, pass: total > 0 && pct >= CORE_MIN_LINES_PCT }
  })
}

function gateBackendCore() {
  if (!existsSync(BACKEND_SUMMARY)) {
    console.error(`coverage: missing ${BACKEND_SUMMARY}; run backend test:coverage first`)
    process.exitCode = 1
    return
  }
  const summary = JSON.parse(readFileSync(BACKEND_SUMMARY, 'utf8'))
  const results = checkCoreDirs(summary)
  for (const { dir, covered, total, pct, pass } of results) {
    console.log(`coverage: ${dir} lines ${covered}/${total} (${pct.toFixed(1)}%) ${pass ? 'PASS' : `FAIL < ${CORE_MIN_LINES_PCT}%`}`)
  }
  if (results.some((result) => !result.pass)) process.exitCode = 1
}

function printPlan() {
  console.log('coverage plan:')
  console.log('- agents: npm run test:coverage -w @kardata/agents (lines >= 85%, in-config)')
  console.log('- frontend: npm run test:coverage -w frontend (lines >= 75%, in-config)')
  const backend = process.env['TEST_DATABASE_URL']
    ? 'npm run test:coverage -w @kardata/backend + core gate (needs Temporal too)'
    : 'SKIP (needs TEST_DATABASE_URL; runs in verify:full / CI integration)'
  console.log(`- backend: ${backend}`)
  console.log(`- backend core gate: ${CORE_DIRS.join(', ')} lines >= ${CORE_MIN_LINES_PCT}% from coverage/coverage-summary.json`)
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const args = new Set(argv)
  if (args.has('--print-plan')) {
    printPlan()
    return
  }
  if (!args.has('--backend-only')) {
    run('npm', ['run', 'test:coverage', '-w', '@kardata/agents'])
    run('npm', ['run', 'test:coverage', '-w', 'frontend'])
  }
  if (!env['TEST_DATABASE_URL']) {
    console.log('coverage: backend skipped (TEST_DATABASE_URL unset; runs in verify:full / CI integration)')
  } else {
    run('npm', ['run', 'test:coverage', '-w', '@kardata/backend'])
    gateBackendCore()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
