import { defineConfig } from 'vitest/config'

// Backend tests mirror the area they cover at the repo root
// (tests/backend/...); the vite root is the repo root so those files are
// servable, and include is scoped to backend tests only.
export default defineConfig({
  root: '..',
  test: {
    include: ['tests/backend/**/*.test.ts'],
    // DB-touching files each own a separate database (see the gated suites),
    // so files stay parallel-safe and order-independent by construction.
  },
})
