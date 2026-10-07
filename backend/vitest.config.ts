import { defineConfig } from 'vitest/config'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Backend tests mirror the area they cover at the repo root
// (tests/backend/...); the vite root is the repo root so those files are
// servable, and include is scoped to backend tests only. The root is
// config-relative (not cwd-relative '..') so programmatic runners such as
// Stryker, which start from the repo root or a sandbox, resolve the same.
export default defineConfig({
  root: join(dirname(fileURLToPath(import.meta.url)), '..'),
  test: {
    include: ['tests/backend/**/*.test.ts', 'tests/registry/**/*.test.ts', 'tests/stress/**/*.test.ts', 'tests/fault/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/var/**'],
    // Bound integration-file fan-out against the established 100-connection
    // Postgres budget. Explicit within-file contention/stress remains unchanged.
    ...(process.env['TEST_DATABASE_URL'] ? {
      maxWorkers: 2,
      env: { KARDATA_TEST_DB_RUN_ID: randomUUID().replaceAll('-', '') },
      globalSetup: ['tests/backend/db-setup.ts'],
    } : {}),
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
