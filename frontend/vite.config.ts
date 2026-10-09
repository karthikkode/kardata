import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const rootDir = import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  // Explicit root (the config directory): programmatic runners such as
  // Stryker start from the repo root, and include must resolve the same.
  root: rootDir,
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // Test files live in the repo-root tests/ mirror (see README.md map).
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['../tests/frontend/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/var/**'],
    // Coverage uses the istanbul provider (the v8 provider needs
    // @vitest/browser, which this workspace does not install); reports
    // land in coverage/ (gitignored). Run with `npm run test:coverage`.
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      // Phase 7 gate: lines >= 75% (ratchet up only).
      thresholds: { lines: 75 },
    },
  },
})
