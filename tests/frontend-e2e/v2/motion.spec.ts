// v2 motion videos: every overlay shows enter AND exit, 1280x800 webm
// in frontend/test-results/v2/video/. Stages 2-3 record the shell,
// Researches and landing IDs; later stages append theirs in this file.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'

const supportDir = dirname(fileURLToPath(import.meta.url))
const VIDEO_OUT = resolve(supportDir, '../../../frontend/test-results/v2/video')

test.use({ video: 'on' })

async function ready(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await serveApi(page)
  await page.goto('/')
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Research totals' })).toBeVisible()
}

/** The recording finalizes on close; keep it under its plan ID. */
async function saveVideo(page: Page, name: string): Promise<void> {
  const video = page.video()
  expect(video, 'video recording must be attached').not.toBeNull()
  await page.close()
  const src = await (video as NonNullable<typeof video>).path()
  mkdirSync(VIDEO_OUT, { recursive: true })
  copyFileSync(src, resolve(VIDEO_OUT, `${name}.webm`))
}

test('SH-05-palette-open-close', async ({ page }) => {
  await ready(page)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await page.getByPlaceholder('Search commands and sectors...').fill('Syd')
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden()
  await saveVideo(page, 'SH-05-open-close')
})

test('SH-06-toast', async ({ page }) => {
  await ready(page)
  await page.evaluate(`import('/src/lib/toast.ts').then((m) => m.notify.success('Sector created'))`)
  await expect(page.getByText('Sector created')).toBeVisible()
  await page.waitForTimeout(4800)
  await expect(page.getByText('Sector created')).toBeHidden()
  await saveVideo(page, 'SH-06-toast')
})

test('SH-08-page-transition', async ({ page }) => {
  await ready(page)
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await page.getByRole('table', { name: 'Sectors' }).getByRole('link', { name: /Australian electrical contractors/ }).click()
  await expect(page.locator('h1')).toContainText('Australian electrical contractors')
  await page.waitForTimeout(400)
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Overview' }).click()
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await saveVideo(page, 'SH-08-page-transition')
})

test('SH-08-page-transition-reduced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await ready(page)
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Overview' }).click()
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await saveVideo(page, 'SH-08-page-transition-reduced')
})

test('SH-02-sidebar-collapse', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  await page.waitForTimeout(200)
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).click()
  await expect(page.locator('h1:has-text("Agents")')).toBeVisible()
  await page.waitForTimeout(300)
  await saveVideo(page, 'SH-02-collapse')
})

test('RS-02-tab-switch', async ({ page }) => {
  await ready(page)
  await page.goto('/?section=Researches')
  await expect(page.getByRole('table', { name: 'Sectors' })).toBeVisible()
  await page.getByRole('tab', { name: 'Companies' }).click()
  await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.getByRole('tab', { name: 'Sectors' }).click()
  await expect(page.getByRole('table', { name: 'Sectors' })).toBeVisible()
  await saveVideo(page, 'RS-02-tab-switch')
})

test('RS-06-submit', async ({ page }) => {
  await ready(page)
  await page.goto('/?section=Researches')
  await expect(page.getByRole('table', { name: 'Sectors' })).toBeVisible()
  await page.getByRole('button', { name: 'New sector' }).first().click()
  await expect(page.getByRole('dialog', { name: 'New sector' })).toBeVisible()
  await page.getByLabel('Name').fill('Adelaide fencing contractors')
  await page.getByLabel('Topic (optional)').fill('Fencing contractors across Adelaide')
  await page.getByRole('button', { name: 'Create sector' }).click()
  await expect(page.getByText('Sector created')).toBeVisible()
  await expect(page.locator('h1:has-text("Adelaide fencing contractors")')).toBeVisible()
  await saveVideo(page, 'RS-06-submit')
})

test('SL-03-open-close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await serveApi(page)
  await page.goto('/?section=SectorDetail&sector=sector-electrical')
  await expect(page.getByRole('region', { name: 'Research status' })).toBeVisible()
  await page.getByRole('button', { name: 'View progress' }).click()
  await expect(page.getByRole('dialog', { name: 'Research progress' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Show plan details' }).click()
  await expect(page.getByRole('button', { name: 'Hide plan details' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Research progress' })).toBeHidden()
  await saveVideo(page, 'SL-03-open-close')
})
