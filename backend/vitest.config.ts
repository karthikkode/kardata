import { defineConfig } from 'vitest/config'
import { randomUUID } from 'node:crypto'

// Backend tests mirror the area they cover at the repo root
// (tests/backend/...); the vite root is the repo root so those files are
// servable, and include is scoped to backend tests only.
export default defineConfig({
  root: '..',
  test: {
    include: ['tests/backend/**/*.test.ts'],
    // Bound integration-file fan-out against the established 100-connection
    // Postgres budget. Explicit within-file contention/stress remains unchanged.
    ...(process.env['TEST_DATABASE_URL'] ? {
      maxWorkers: 2,
      env: { KARDATA_TEST_DB_RUN_ID: randomUUID().replaceAll('-', '') },
      globalSetup: ['tests/backend/db-setup.ts'],
    } : {}),
    // DB-touching files each own a separate database (see the gated suites),
    // so files stay parallel-safe and order-independent by construction.
  },
})
