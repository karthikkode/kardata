// v2 motion videos: every overlay shows enter AND exit, 1280x800 webm
// in frontend/test-results/v2/video/. Stages 2-4 record the shell,
// Researches, landing, workspace, conversation and Karbot IDs; stage 5
// appends plan, files and context; later stages append theirs here.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { pushFrame, serveApi } from '../support/api'

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
  // Settle so the exit animation and the end state land on the recording:
  // closing the page the instant an assertion passes cuts the exit off.
  await page.waitForTimeout(400)
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

// --- Stage 4: workspace, conversation, composer, Karbot --------------------

const WS_SECTOR = 'sector-electrical'
const WS_THREAD = `session-${WS_SECTOR}-research`

async function readyWorkspace(page: Page, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 800 })
  await serveApi(page)
  await page.goto(`/?section=SectorChat&sector=${WS_SECTOR}`)
  await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
  await expect(page.locator('main h1')).toBeVisible()
}

function convo(page: Page) {
  return page.getByRole('log', { name: 'Conversation messages' })
}

async function sendWorkspace(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message this conversation' }).fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
}

test('WS-03-switch', async ({ page }) => {
  await readyWorkspace(page)
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: /^Chats/ }).click()
  await expect(page.getByRole('list', { name: 'Chat sessions' })).toBeVisible()
  await page.waitForTimeout(500)
  await page.getByRole('tab', { name: 'Research' }).click()
  await expect(page.getByRole('list', { name: 'Research sessions' })).toBeVisible()
  await page.waitForTimeout(300)
  await saveVideo(page, 'WS-03-switch')
})

test('WS-01-rail-drawer', async ({ page }) => {
  await readyWorkspace(page, 1440)
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Hide files and context' }).click()
  await expect(page.getByRole('complementary', { name: 'Sector resources' })).toBeHidden()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Show files and context' }).click()
  await expect(page.getByRole('complementary', { name: 'Sector resources' })).toBeVisible()
  await page.waitForTimeout(500)
  await page.setViewportSize({ width: 1279, height: 800 })
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  await expect(page.getByRole('dialog', { name: 'Files and global context' })).toBeVisible()
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Files and global context' })).toBeHidden()
  await saveVideo(page, 'WS-01-rail-drawer')
})

test('CV-05-thinking-to-reply', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await serveApi(page, { stream: 'quiet', data: { messages: [] } })
  await page.goto(`/?section=SectorChat&sector=${WS_SECTOR}`)
  await expect(convo(page).getByText('Ask about this research')).toBeVisible()
  await sendWorkspace(page, 'Motion probe')
  await pushFrame(page, {
    seq: 41, threadKey: WS_THREAD, type: 'message', at: '',
    payload: { seq: 41, kind: 'text', role: 'user', text: 'Motion probe' },
  })
  await expect(convo(page).getByText('Thinking', { exact: true })).toBeVisible()
  await page.waitForTimeout(900)
  await pushFrame(page, {
    seq: 42, threadKey: WS_THREAD, type: 'reasoning', at: '',
    payload: { runKey: 'run-1', text: 'Checking the shortlist and crew rosters before answering.' },
  })
  await expect(convo(page).getByRole('button', { name: 'Show live reasoning' })).toBeVisible()
  await page.waitForTimeout(700)
  await pushFrame(page, {
    seq: 43, threadKey: WS_THREAD, type: 'message', at: '',
    payload: { seq: 43, kind: 'text', role: 'agent', text: 'The shortlist holds: two Parramatta crews confirmed.' },
  })
  await expect(convo(page).getByText('The shortlist holds: two Parramatta crews confirmed.')).toBeVisible()
  await expect(convo(page).getByText('Thinking', { exact: true })).toBeHidden()
  await page.waitForTimeout(400)
  await saveVideo(page, 'CV-05-thinking-to-reply')
})

test('CV-06-expand', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await serveApi(page, { stream: 'quiet', data: { messages: [] } })
  await page.goto(`/?section=SectorChat&sector=${WS_SECTOR}`)
  await expect(convo(page).getByText('Ask about this research')).toBeVisible()
  await sendWorkspace(page, 'Motion probe')
  await pushFrame(page, {
    seq: 41, threadKey: WS_THREAD, type: 'message', at: '',
    payload: { seq: 41, kind: 'text', role: 'user', text: 'Motion probe' },
  })
  await pushFrame(page, {
    seq: 42, threadKey: WS_THREAD, type: 'reasoning', at: '',
    payload: { runKey: 'run-1', text: 'Checking the shortlist and crew rosters before answering.' },
  })
  await convo(page).getByRole('button', { name: 'Show live reasoning' }).click()
  await expect(convo(page).getByText('Checking the shortlist and crew rosters before answering.')).toBeVisible()
  await page.waitForTimeout(500)
  await pushFrame(page, {
    seq: 43, threadKey: WS_THREAD, type: 'message', at: '',
    // The settled disclosure renders the message's own reasoning (live
    // pending text clears on land); the real backend attaches it.
    payload: { seq: 43, kind: 'text', role: 'agent', text: 'The shortlist holds: two Parramatta crews confirmed.', reasoning: 'Checking the shortlist and crew rosters before answering.' },
  })
  // Expanded during the stream stays expanded after settle (CV-06 AC).
  await expect(convo(page).getByText('Checking the shortlist and crew rosters before answering.')).toBeVisible()
  await page.waitForTimeout(500)
  await convo(page).getByRole('button', { name: 'Hide reasoning' }).click()
  await expect(convo(page).getByText('Checking the shortlist and crew rosters before answering.')).toBeHidden()
  await saveVideo(page, 'CV-06-expand')
})

test('CP-03-menu', async ({ page }) => {
  await readyWorkspace(page)
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Choose a model' }).click()
  await expect(page.getByRole('textbox', { name: 'Search models' })).toBeVisible()
  await page.waitForTimeout(400)
  // Bottom-docked composer: the menu opens above the trigger.
  await page.getByRole('menuitem', { name: 'Muse Spark 1.3 Thinking', exact: true }).hover()
  await expect(page.getByRole('menuitemradio', { name: 'high', exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  // First Escape closes the effort submenu, the second the menu itself.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitemradio', { name: 'high', exact: true })).toBeHidden()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Search models' })).toBeHidden()
  await saveVideo(page, 'CP-03-menu')
})

test('KB-01-open-close', async ({ page }) => {
  await ready(page)
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
  await page.waitForTimeout(700)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeHidden()
  await saveVideo(page, 'KB-01-open-close')
})

test('KB-01-reduced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await ready(page)
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeHidden()
  await saveVideo(page, 'KB-01-reduced')
})

/** 1280px sits below the 1281px rail breakpoint, so the files and
 * global-context rail always opens as a drawer in these videos. */
async function openResources(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  await expect(page.getByRole('dialog', { name: 'Files and global context' })).toBeVisible()
}

test('PL-03-steps-enter', async ({ page }) => {
  await readyWorkspace(page)
  await page.waitForTimeout(300)
  await page.getByRole('tab', { name: /^Plan/ }).click()
  await expect(page.getByRole('heading', { name: 'Research plan' })).toBeVisible()
  await page.waitForTimeout(900)
  await page.locator('[data-plan-step="direction-3"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  await page.getByRole('tab', { name: 'Chat', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toBeVisible()
  await saveVideo(page, 'PL-03-steps-enter')
})

test('PL-07-edit-discard', async ({ page }) => {
  // sector-hvac carries the approved editable plan (mirrors plan.spec).
  await page.setViewportSize({ width: 1280, height: 800 })
  await serveApi(page)
  await page.goto('/?section=SectorChat&sector=sector-hvac')
  await expect(page.locator('main h1')).toBeVisible()
  await page.getByRole('tab', { name: /^Plan/ }).click()
  await expect(page.getByRole('heading', { name: 'Research plan' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(500)
  await page.getByRole('textbox', { name: 'Plan text' }).press('End')
  await page.getByRole('textbox', { name: 'Plan text' }).type(' with owner edits')
  await page.getByRole('button', { name: 'Cancel' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Discard changes?' })
  await expect(confirm).toBeVisible()
  await page.waitForTimeout(500)
  await confirm.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(dialog).toBeHidden()
  await saveVideo(page, 'PL-07-edit-discard')
})

test('FL-01-drag-over', async ({ page }) => {
  await readyWorkspace(page)
  await openResources(page)
  const region = page.getByRole('dialog', { name: 'Files and global context' }).getByRole('region', { name: 'Sector files' })
  await region.dispatchEvent('dragenter')
  await expect(page.locator('.border-dashed')).toBeVisible()
  await page.waitForTimeout(700)
  await region.dispatchEvent('dragleave')
  await expect(page.locator('.border-dashed')).toBeHidden()
  await saveVideo(page, 'FL-01-drag-over')
})

test('FL-06-preview', async ({ page }) => {
  await readyWorkspace(page)
  await openResources(page)
  await page.getByRole('dialog', { name: 'Files and global context' }).getByRole('button', { name: 'parramatta-crew-notes.md', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'File preview' })
  await expect(preview).toBeVisible()
  await page.waitForTimeout(700)
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await saveVideo(page, 'FL-06-preview')
})

test('GC-06-review', async ({ page }) => {
  await readyWorkspace(page)
  await openResources(page)
  await page.getByRole('dialog', { name: 'Files and global context' }).getByRole('button', { name: 'Review Shared context update' }).click()
  const review = page.getByRole('dialog', { name: 'Review context update' })
  await expect(review).toBeVisible()
  await page.waitForTimeout(700)
  await page.keyboard.press('Escape')
  await expect(review).toBeHidden()
  await saveVideo(page, 'GC-06-review')
})
