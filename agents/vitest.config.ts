import { defineConfig } from 'vitest/config'

// Agents tests live under src/; the include is scoped there so compiled
// build output under dist/ is never collected as a duplicate suite
// (stale dist test files resolve fixtures against dist and fail).
export default defineConfig({
  // Explicit root (the config directory): programmatic runners such as
  // Stryker start from the repo root, and include must resolve the same.
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/var/**'],
    // Phase 7 gate: lines >= 85% (ratchet up only). Istanbul provider,
    // like frontend (v8 needs @vitest/browser, not installed).
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 85 },
    },
  },
})
