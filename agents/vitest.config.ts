import { defineConfig } from 'vitest/config'

// Agents tests live under src/; the include is scoped there so compiled
// build output under dist/ is never collected as a duplicate suite
// (stale dist test files resolve fixtures against dist and fail).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
