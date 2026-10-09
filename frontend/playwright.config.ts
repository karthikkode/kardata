import { defineConfig, devices } from '@playwright/test'

const testPort = Number(process.env.KARDATA_E2E_PORT ?? 5174)
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid isolated E2E port')
// Scale budgets measure the production build (vite build + preview),
// not dev/StrictMode: KARDATA_E2E_SERVER=preview selects it. Default
// stays `npm run dev` so ordinary runs keep fast startup.
const usePreview = process.env.KARDATA_E2E_SERVER === 'preview'

export default defineConfig({
  testDir: '../tests/frontend-e2e',
  // P6-M5: CI e2e skips the matrix until screenshot baselines are
  // captured at final verification (a baseless first run fails).
  ...(process.env.CI_MATRIX === '0' ? { testIgnore: '**/matrix/**' } : {}),
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: usePreview
      ? `npm run build && npx vite preview --host 127.0.0.1 --port ${testPort} --strictPort`
      : `npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: false,
    env: {
      VITE_STAGING_API: '1',
      // Live walkthrough (KARDATA_LIVE_UI=1) passes the B2 stack through
      // the environment; every other run keeps the isolated defaults.
      VITE_STAGING_URL: process.env.VITE_STAGING_URL ?? 'http://127.0.0.1:3001',
      VITE_STAGING_KEY: process.env.VITE_STAGING_KEY ?? 'e2e-test-key',
    },
  },
})
