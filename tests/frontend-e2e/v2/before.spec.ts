// BEFORE captures on the current UI (Stage 0). Same fixtures as the v2
// specs; legacy theme toggle instead of the v2 system preference.
// Output: frontend/test-results/v2/BEFORE-*.png (copied to evidence).

import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'
import { shot, type ShotTheme } from '../support/shot'

async function legacyTheme(page: Page, theme: ShotTheme): Promise<void> {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  if ((theme === 'dark') === isDark) return
  const toggle = page.getByRole('button', { name: /Switch to .* theme|Use .* theme/ }).first()
  if ((await toggle.count()) > 0) {
    try { await toggle.click({ timeout: 3000 }) } catch { await page.evaluate(() => document.documentElement.classList.toggle('dark')) }
  } else await page.evaluate(() => document.documentElement.classList.toggle('dark'))
}

const legacy = { applyTheme: legacyTheme }

// Stage-0 BEFORE captures: the v2 shell replaced every legacy anchor
// (Open chat, Back to Overview, theme toggle), so re-running these
// against the new UI proves nothing. BEFORE evidence is kept in
// tests/evidence/ui-revamp-v2/before/.
test.skip(true, 'Stage-0 BEFORE captures; v2 UI replaced the legacy anchors')

test('BEFORE-overview', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await shot(page, 'BEFORE-overview', 'default', { ...legacy, anchors: ['h1:has-text("Overview")'] })
})

test('BEFORE-researches-sectors', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Researches')
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await shot(page, 'BEFORE-researches-sectors', 'default', { ...legacy, anchors: ['h1:has-text("Researches")'] })
})

test('BEFORE-researches-companies', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Researches&tab=companies')
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await shot(page, 'BEFORE-researches-companies', 'default', { ...legacy, anchors: ['h1:has-text("Researches")'] })
})

test('BEFORE-landing', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorDetail&sector=sector-electrical')
  await expect(page.locator('h1:has-text("Australian electrical contractors")')).toBeVisible()
  await shot(page, 'BEFORE-landing', 'default', { ...legacy, anchors: ['h1'] })
})

test('BEFORE-workspace-chat', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorChat&sector=sector-electrical')
  await expect(page.locator('h1:has-text("Research")').first()).toBeVisible()
  await shot(page, 'BEFORE-workspace-chat', 'default', { ...legacy, anchors: ['h1'] })
})

test('BEFORE-workspace-plan', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorChat&sector=sector-electrical')
  const planTab = page.getByRole('tab', { name: 'Plan' })
  if ((await planTab.count()) === 0) test.skip(true, 'no Plan tab in current UI')
  await planTab.click()
  await shot(page, 'BEFORE-workspace-plan', 'default', { ...legacy, anchors: ['h1'] })
})

test('BEFORE-karbot', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open chat' }).click()
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
  await shot(page, 'BEFORE-karbot', 'default', { ...legacy, anchors: ['[aria-label="Assistant chat"]'] })
})

test('BEFORE-agents', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Agents')
  await expect(page.locator('h1:has-text("Agents")')).toBeVisible()
  await shot(page, 'BEFORE-agents', 'default', { ...legacy, anchors: ['h1:has-text("Agents")'] })
})

test('BEFORE-models', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Models')
  await expect(page.locator('h1:has-text("Models")')).toBeVisible()
  await shot(page, 'BEFORE-models', 'default', { ...legacy, anchors: ['h1:has-text("Models")'] })
})

test('BEFORE-emails', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Emails')
  await expect(page.locator('h1:has-text("Emails")')).toBeVisible()
  await shot(page, 'BEFORE-emails', 'default', { ...legacy, anchors: ['h1:has-text("Emails")'] })
})

test('BEFORE-new-sector-dialog', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Researches')
  const trigger = page.getByRole('button', { name: /New sector/ }).first()
  if ((await trigger.count()) === 0) test.skip(true, 'no New sector trigger in current UI')
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot(page, 'BEFORE-new-sector-dialog', 'default', { ...legacy, anchors: ['[role="dialog"]'] })
})
