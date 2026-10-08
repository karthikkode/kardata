import { defineConfig } from 'vitest/config'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Backend tests mirror the area they cover at the repo root
// (tests/backend/...); the vite root is the repo root so those files are
// servable, and include is scoped to backend tests only. The root is
// config-relative (not cwd-relative '..') so programmatic runners such as
// Stryker, which start from the repo root or a sandbox, resolve the same.
// Workers never see --coverage (no argv flag, no __coverage__ global,
// no COV env under the istanbul provider), so the config — which loads
// in the main process with full argv — stamps the signal into worker
// env. Consumers: the fleet thousand-leg ceiling (slow only when
// instrumented). Programmatic runners (Stryker) bypass argv and read
// 26 min; the mutation config excludes the thousand leg instead.
const coverageActive =
  process.argv.includes('--coverage') || process.argv.includes('--coverage.enabled')
const coverageEnv = coverageActive ? { KARDATA_COVERAGE_ACTIVE: '1' } : {}

export default defineConfig({
  root: join(dirname(fileURLToPath(import.meta.url)), '..'),
  test: {
    include: ['tests/backend/**/*.test.ts', 'tests/registry/**/*.test.ts', 'tests/stress/**/*.test.ts', 'tests/fault/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/var/**'],
    // Bound integration-file fan-out against the established 100-connection
    // Postgres budget. Explicit within-file contention/stress remains unchanged.
    // DB-suite default budgets: vitest's 5s test / 10s hook defaults
    // starve ~1s DB tests under parallel coverage load (9 instances in
    // fv4 01: epochs, soak, limiter, records, template hook, file-jobs,
    // threads x2, inspection hook — all solo-green). 15s/30s keeps 15x+
    // headroom; explicit per-test budgets and timing assertions override
    // and are untouched. Unit tiers keep the vitest defaults.
    ...(process.env['TEST_DATABASE_URL'] ? {
      maxWorkers: 2,
      testTimeout: 15_000,
      hookTimeout: 30_000,
      env: { KARDATA_TEST_DB_RUN_ID: randomUUID().replaceAll('-', ''), ...coverageEnv },
      globalSetup: ['tests/backend/db-setup.ts'],
    } : { env: { ...coverageEnv } }),
    // DB-touching files each own a separate database (see the gated suites),
    // so files stay parallel-safe and order-independent by construction.
    // Phase 7 gate: lines >= 80% overall (db/mcp/temporal need >= 85%,
    // enforced per-directory by scripts/coverage.mjs). Root is the repo
    // root, so include is backend-scoped. Istanbul provider, like frontend.
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary'],
      include: ['backend/src/**/*.ts'],
      // Workflow files run inside Temporal's bundled workflow isolate, so
      // istanbul can never attribute their lines (measured 8/1111). They
      // stay covered functionally by the temporal tier (replay, CAN,
      // children-1000, fault drills), not by the line gate.
      exclude: ['backend/src/temporal/workflows/**'],
      thresholds: { lines: 80 },
    },
  },
})
