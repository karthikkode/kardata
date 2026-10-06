// npm run ui:review [-- --changed[=BASE]]: the matrix in screenshot mode.
// Cleans frontend/test-results/ui-review, runs the matrix specs with
// MATRIX_SHOTS=1, assembles manifest.json from the worker-safe .jsonl.
// --changed limits the run to the matrix specs of components touched by
// the branch diff against BASE (default main) plus uncommitted files.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'frontend/test-results/ui-review')
const MATRIX = join(ROOT, 'tests/frontend-e2e/matrix')

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function changedFiles(base) {
  const files = new Set()
  for (const line of gitLines(['status', '--porcelain'])) {
    const renamed = /^R.+-> (.+)$/.exec(line)
    files.add(renamed ? renamed[1] : line.slice(3))
  }
  for (const line of gitLines(['diff', '--name-only', `${base}...HEAD`])) files.add(line)
  return [...files]
}

export function specFor(file) {
  const match = /^frontend\/src\/components\/(.+)\.tsx?$/.exec(file)
  if (!match) return null
  return `${match[1].replace(/\//g, '-')}.spec.ts`
}

// Shared UI files (tokens, lib, data, hooks, styles, component helpers):
// a change here can move every screenshot, so --changed shoots the full
// matrix instead of attributing specs (P6 minor).
export function isSharedUiFile(file) {
  if (!file.startsWith('frontend/src/')) return false
  if (file.startsWith('frontend/src/lib/') || file.startsWith('frontend/src/data/')) return true
  if (file.startsWith('frontend/src/components/') && !file.endsWith('.tsx')) return true
  const base = file.slice(file.lastIndexOf('/') + 1)
  return base.startsWith('use') || base.includes('token') || file.endsWith('.css')
}

function main() {
  const flag = process.argv.slice(2).find((arg) => arg === '--changed' || arg.startsWith('--changed='))
  let filters = ['matrix/']
  if (flag) {
    const base = flag.includes('=') ? flag.slice('--changed='.length) : 'main'
    const specs = []
    const skipped = []
    let shared = null
    for (const file of changedFiles(base)) {
      if (!shared && isSharedUiFile(file)) shared = file
      const spec = specFor(file)
      if (!spec) continue
      if (existsSync(join(MATRIX, spec))) specs.push(`matrix/${spec}`)
      else skipped.push(file)
    }
    if (shared) console.log(`ui:review: --changed found shared UI file ${shared}; shooting full matrix`)
    for (const file of skipped) console.log(`ui:review: no matrix spec for ${file}`)
    if (!shared) {
      if (specs.length === 0) {
        console.log('ui:review: --changed matched no matrix specs; nothing to shoot')
        return
      }
      filters = [...new Set(specs)].sort()
      console.log(`ui:review: --changed shooting ${filters.length} spec(s)`)
    }
  }
  rmSync(SHOTS, { recursive: true, force: true })
  mkdirSync(SHOTS, { recursive: true })
  const run = spawnSync('npx', ['playwright', 'test', ...filters], {
    cwd: join(ROOT, 'frontend'),
    env: { ...process.env, MATRIX_SHOTS: '1' },
    stdio: 'inherit',
  })
  const jsonl = join(SHOTS, 'manifest.jsonl')
  const entries = existsSync(jsonl)
    ? readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  entries.sort((a, b) => String(a.file).localeCompare(String(b.file)))
  writeFileSync(join(SHOTS, 'manifest.json'), `${JSON.stringify(entries, null, 2)}\n`)
  console.log(`ui:review: ${entries.length} screenshots in ${SHOTS}`)
  process.exit(run.status ?? 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
