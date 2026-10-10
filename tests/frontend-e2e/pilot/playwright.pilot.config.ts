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
    // r0: actions default to NO timeout (0) — a missing control burns the
    // whole hour. 60s fails fast; long live waits use explicit ceilings.
    actionTimeout: 60000,
    // localhost, not 127.0.0.1: the UI-only gate pins KARDATA_UI_ORIGIN
    // exactly (http.ts authorize), and the pilot value is the localhost
    // spelling. r0 found the 127.0.0.1 spelling 403s every mutation.
    baseURL: 'http://localhost:25174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
