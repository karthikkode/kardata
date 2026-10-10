// Pilot run config: the UI is the already-running pilot preview
// (:25174 via `stack pilot up`), so there is no webServer here.
// Steps run strictly in file order (workers 1, no parallelism): each
// spec resumes from var/pilot/run-<tag>/state.json. Run one step:
// npx playwright test -c <this file> p5-plan.spec.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 3_600_000,
  expect: { timeout: 30000 },
  use: {
    baseURL: 'http://127.0.0.1:25174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
