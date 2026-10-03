// Stage 2 shell (SH-01..06): page frame, sidebar, top bar, theme menu,
// palette and toaster in light+dark at 1440+390 (768 where the plan
// names it). SH-07 lands in Stage 6, SH-08 in motion.spec.ts.
import { spawn, type ChildProcess } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'
import { capture } from '../support/capture'
import { shot } from '../support/shot'

async function gotoOverview(page: Page): Promise<void> {
  await serveApi(page)
  await page.goto('/')
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Research totals' })).toBeVisible()
}

test('SH-01-overview', async ({ page }) => {
  await gotoOverview(page)
  await shot(page, 'SH-01-overview', 'default', { anchors: ['h1:has-text("Overview")'] })
})

test('SH-01-researches', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Researches')
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await shot(page, 'SH-01-researches', 'default', { anchors: ['h1:has-text("Researches")'] })
})

test('SH-01-sector-detail', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorDetail&sector=sector-electrical')
  await expect(page.locator('h1:has-text("Australian electrical contractors")')).toBeVisible()
  await shot(page, 'SH-01-sector-detail', 'default', { anchors: ['h1'] })
})

test('SH-01-agents', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Agents')
  await expect(page.locator('h1:has-text("Agents")')).toBeVisible()
  await shot(page, 'SH-01-agents', 'default', { anchors: ['h1:has-text("Agents")'] })
})

test('SH-01-models', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Models')
  await expect(page.locator('h1:has-text("Models")')).toBeVisible()
  await shot(page, 'SH-01-models', 'default', { anchors: ['h1:has-text("Models")'] })
})

test('SH-02-expanded', async ({ page }) => {
  await capture(page, 'SH-02', 'expanded', () => gotoOverview(page))
})

test('SH-02-collapsed', async ({ page }) => {
  // Idempotent: capture() replays prepare per theme and the collapse
  // persists in localStorage, so later replays start collapsed.
  const collapse = async () => {
    await gotoOverview(page)
    if ((await page.getByRole('button', { name: 'Expand sidebar' }).count()) === 0) {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    }
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  }
  await capture(page, 'SH-02', 'collapsed', collapse, undefined, { widths: [1440] })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
})

test('SH-02-hover', async ({ page }) => {
  await capture(
    page, 'SH-02', 'hover',
    () => gotoOverview(page),
    () => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).hover(),
    { widths: [1440] },
  )
})

test('SH-02-focus', async ({ page }) => {
  await capture(
    page, 'SH-02', 'focus',
    () => gotoOverview(page),
    () => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).focus(),
    { widths: [1440] },
  )
})

test('SH-02-mobile', async ({ page }) => {
  await capture(page, 'SH-02', 'mobile', () => gotoOverview(page), undefined, { widths: [390] })
})

test('SH-03-default', async ({ page }) => {
  await gotoOverview(page)
  await shot(page, 'SH-03', 'default', { widths: [1440, 768, 390], anchors: ['h1:has-text("Overview")'] })
})

test('SH-04-open', async ({ page }) => {
  await capture(page, 'SH-04', 'open', async () => {
    await gotoOverview(page)
    await page.getByRole('button', { name: 'Theme' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeVisible()
  })
})

test('SH-04-behavior', async ({ page }) => {
  await gotoOverview(page)
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html.dark')).toBeAttached()
  expect(await page.evaluate(() => window.localStorage.getItem('kardata-theme'))).toBe('dark')
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'System' }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html.dark')).toHaveCount(0)
})

async function openPalette(page: Page): Promise<void> {
  await gotoOverview(page)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
}

test('SH-05-open', async ({ page }) => {
  await capture(page, 'SH-05', 'open', () => openPalette(page))
})

test('SH-05-filtered', async ({ page }) => {
  await capture(page, 'SH-05', 'filtered', () => openPalette(page), () =>
    page.getByPlaceholder('Search commands and sectors...').fill('Sydney').then(() => undefined),
  )
})

test('SH-05-empty', async ({ page }) => {
  await capture(page, 'SH-05', 'empty', () => openPalette(page), () =>
    page.getByPlaceholder('Search commands and sectors...').fill('zzz-no-such-thing').then(() => undefined),
  )
})

test('SH-06-success', async ({ page }) => {
  await capture(
    page, 'SH-06', 'success',
    () => gotoOverview(page),
    async () => {
      await page.evaluate(`import('/src/lib/toast.ts').then((m) => m.notify.success('Sector created'))`)
      await expect(page.getByText('Sector created')).toBeVisible()
    },
  )
})

test('SH-06-error', async ({ page }) => {
  await capture(
    page, 'SH-06', 'error',
    () => gotoOverview(page),
    async () => {
      await page.evaluate(`import('/src/lib/toast.ts').then((m) => m.notify.error('Upload failed', { label: 'Retry', onClick: () => undefined }))`)
      await expect(page.getByText('Upload failed')).toBeVisible()
    },
  )
})

// SH-07-not-connected boots its own flag-off vite on 15175: the shared
// webServer always sets VITE_STAGING_API and import.meta.env is baked at
// serve time, so no route can simulate the unconfigured state. The app
// fetches nothing before the empty state, so no API mock is needed.
const NOSTAGING_PORT = 15175
let nostaging: ChildProcess | null = null

async function startNostaging(): Promise<void> {
  if (nostaging) return
  // Empty, not deleted: a local frontend/.env would otherwise resupply
  // the flag (shell env wins over .env files in Vite).
  const env = { ...process.env, VITE_STAGING_API: '', VITE_STAGING_URL: '', VITE_STAGING_KEY: '' }
  nostaging = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(NOSTAGING_PORT), '--strictPort'], {
    cwd: new URL('../../../frontend', import.meta.url).pathname,
    env,
    stdio: 'pipe',
    detached: true,
  })
  // Drain without storing: an unread pipe can stall the server.
  nostaging.stdout?.resume()
  nostaging.stderr?.resume()
  const deadline = Date.now() + 60000
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${NOSTAGING_PORT}/`)
      if (response.ok) return
    } catch {
      // Server still starting.
    }
    if (Date.now() > deadline) throw new Error(`flag-off vite on ${NOSTAGING_PORT} never came up`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

test.afterAll(async () => {
  // Group kill: npm spawns vite as a child, and killing npm alone
  // orphans the server on the port.
  if (nostaging?.pid) {
    try { process.kill(-nostaging.pid, 'SIGTERM') } catch { nostaging.kill() }
  }
  nostaging = null
})

test('SH-07-not-connected', async ({ page }) => {
  test.setTimeout(120_000)
  await startNostaging()
  await capture(page, 'SH-07', 'not-connected', async () => {
    await page.goto(`http://127.0.0.1:${NOSTAGING_PORT}/`)
    await expect(page.getByText('Connect the backend')).toBeVisible()
  }, async () => {
    await expect(page.getByText('Set the staging API URL and key in the frontend environment, then reload.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
  })
})

test('SH-07-sector-not-found', async ({ page }) => {
  await capture(page, 'SH-07', 'sector-not-found', async () => {
    await serveApi(page)
    await page.goto('/?section=SectorDetail&sector=sector-removed')
    await expect(page.getByRole('button', { name: 'Back to researches' })).toBeVisible()
  })
})
