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
    // F7: the UI-only gate accepts the CORS list (both spellings);
    // baseURL stays localhost, either spelling passes the gate now.
    baseURL: 'http://localhost:25174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
