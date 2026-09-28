import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '../tests/frontend-e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    env: {
      VITE_STAGING_API: '1',
      VITE_STAGING_URL: 'http://127.0.0.1:3001',
      VITE_STAGING_KEY: 'e2e-test-key',
    },
  },
})
