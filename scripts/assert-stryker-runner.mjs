// Guard for `npm run test:mutation`: the committed separator patch
// (patches/@stryker-mutator+vitest-runner+10.0.0.patch) must be applied,
// or mutant runs silently skip every describe-nested test: vitest 5
// matches testNamePattern against ' > '-joined fullTestName while the
// runner builds space-joined filters, so all such mutants falsely
// survive (upstream https://github.com/stryker-mutator/stryker-js/issues/6210).
// Fails loud so the gate can never regress to phantom survivors.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Stryker resolves a bare `configFile` (no ./ prefix) through node
// resolution first: `frontend/vite.config.ts` matches the `frontend`
// workspace self-link in node_modules, so mutant runs silently execute
// the REAL tree (no mutants: false survivals). All configs must use an
// explicit ./ prefix (CWD-relative = sandbox).
for (const file of readdirSync(root).filter((entry) => /^stryker\..*\.json$/.test(entry))) {
  const configFile = JSON.parse(readFileSync(join(root, file), 'utf8'))?.vitest?.configFile
  if (typeof configFile !== 'string' || !configFile.startsWith('./')) {
    console.error(
      `test:mutation guard: ${file} vitest.configFile must start with './' ` +
        '(bare paths can resolve outside the sandbox via workspace self-links).',
    )
    process.exit(1)
  }
}
const runnerDir = join(root, 'node_modules', '@stryker-mutator', 'vitest-runner', 'dist', 'src')
const files = ['test-helpers.js', 'stryker-setup.js']
const marker = "join(' > ')"
const missing = files.filter((file) => {
  const path = join(runnerDir, file)
  return !existsSync(path) || !readFileSync(path, 'utf8').includes(marker)
})
if (missing.length > 0) {
  console.error(
    `test:mutation guard: vitest-runner separator patch missing in ${missing.join(', ')}. ` +
      'Run `npx patch-package` (or reinstall so postinstall applies patches/). ' +
      'Upstream: https://github.com/stryker-mutator/stryker-js/pull/6214',
  )
  process.exit(1)
}
console.log('test:mutation guard: vitest-runner separator patch applied.')
