// Live-state truth (P6.3.2): running indicators derive from server state.
// [F:frontend.src.components.ChatPanel] [F:frontend.src.components.chat.ChatLog] [F:frontend.src.components.SectorWorkspace] [F:frontend.src.components.chat.ThinkingRow]
import { expect, test, type Page } from '@playwright/test'
import { dropStream, pushFrame, serveApi, streamCount } from './support/api'

const SECTOR = 'sector-electrical'
const THREAD = `session-${SECTOR}-research`

function convo(page: Page) {
  return page.getByRole('log', { name: 'Conversation messages' })
}

function dock(page: Page) {
  return page.getByRole('complementary', { name: 'Assistant chat' })
}

async function gotoWorkspaceQuiet(page: Page): Promise<void> {
  await serveApi(page, { stream: 'quiet', data: { messages: [] } })
  await page.goto(`/?section=SectorChat&sector=${SECTOR}`)
  await expect(convo(page)).toBeVisible()
}

async function gotoDockQuiet(page: Page): Promise<void> {
  await serveApi(page, { stream: 'quiet', data: { messages: [] } })
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  await expect(dock(page)).toBeVisible()
}

test('sector orphan shows the stopped notice and clears thinking', async ({ page }) => {
  await gotoWorkspaceQuiet(page)
  await page.getByRole('textbox', { name: 'Message this conversation' }).fill('Orphan probe')
  await page.getByRole('button', { name: 'Send message' }).click()
  await pushFrame(page, {
    seq: 41, threadKey: THREAD, type: 'message', at: '',
    payload: { seq: 41, kind: 'text', role: 'user', text: 'Orphan probe' },
  })
  await expect(convo(page).getByText('Thinking', { exact: true })).toBeVisible()
  await pushFrame(page, {
    seq: 42, threadKey: THREAD, type: 'state', at: '',
    payload: { status: 'ERROR', stateReason: 'closed-owner' },
  })
  await expect(convo(page).getByText('Stopped unexpectedly')).toBeVisible()
  await expect(convo(page).getByText('Thinking', { exact: true })).toHaveCount(0)
})

test('karbot orphan shows the stopped notice and clears thinking', async ({ page }) => {
  await gotoDockQuiet(page)
  const chat = dock(page)
  await chat.getByRole('textbox', { name: 'Message the agent' }).fill('Orphan probe')
  await chat.getByRole('button', { name: 'Send message' }).click()
  await pushFrame(page, {
    seq: 1, threadKey: 'dock-thread', type: 'message', at: '',
    payload: { seq: 1, kind: 'text', role: 'user', text: 'Orphan probe' },
  })
  await expect(chat.getByText('Thinking', { exact: true })).toBeVisible()
  await pushFrame(page, {
    seq: 2, threadKey: 'dock-thread', type: 'state', at: '',
    payload: { status: 'ERROR', stateReason: 'closed-owner' },
  })
  await expect(chat.getByText('Stopped unexpectedly')).toBeVisible()
  await expect(chat.getByText('Thinking', { exact: true })).toHaveCount(0)
})

test('sector reconnect stops the indicator when the server finished mid-outage', async ({ page }) => {
  await gotoWorkspaceQuiet(page)
  await page.getByRole('textbox', { name: 'Message this conversation' }).fill('Reconnect probe')
  await page.getByRole('button', { name: 'Send message' }).click()
  await pushFrame(page, {
    seq: 41, threadKey: THREAD, type: 'message', at: '',
    payload: { seq: 41, kind: 'text', role: 'user', text: 'Reconnect probe' },
  })
  await expect(convo(page).getByText('Thinking', { exact: true })).toBeVisible()
  const before = await streamCount(page)
  await dropStream(page)
  await expect.poll(() => streamCount(page), { timeout: 10000 }).toBeGreaterThan(before)
  await pushFrame(page, {
    seq: 42, threadKey: THREAD, type: 'message', at: '',
    payload: { seq: 42, kind: 'text', role: 'agent', text: 'Back online.' },
  })
  await pushFrame(page, {
    seq: 43, threadKey: THREAD, type: 'state', at: '',
    payload: { status: 'FINISHED' },
  })
  await expect(convo(page).getByText('Back online.')).toBeVisible({ timeout: 5000 })
  await expect(convo(page).getByText('Thinking', { exact: true })).toHaveCount(0, { timeout: 5000 })
})

test('karbot reconnect stops the indicator when the server finished mid-outage', async ({ page }) => {
  await gotoDockQuiet(page)
  const chat = dock(page)
  await chat.getByRole('textbox', { name: 'Message the agent' }).fill('Reconnect probe')
  await chat.getByRole('button', { name: 'Send message' }).click()
  await pushFrame(page, {
    seq: 1, threadKey: 'dock-thread', type: 'message', at: '',
    payload: { seq: 1, kind: 'text', role: 'user', text: 'Reconnect probe' },
  })
  await expect(chat.getByText('Thinking', { exact: true })).toBeVisible()
  const before = await streamCount(page)
  await dropStream(page)
  await expect.poll(() => streamCount(page), { timeout: 10000 }).toBeGreaterThan(before)
  await pushFrame(page, {
    seq: 2, threadKey: 'dock-thread', type: 'message', at: '',
    payload: { seq: 2, kind: 'text', role: 'agent', text: 'Back online.' },
  })
  await pushFrame(page, {
    seq: 3, threadKey: 'dock-thread', type: 'state', at: '',
    payload: { status: 'FINISHED' },
  })
  await expect(chat.getByText('Back online.')).toBeVisible({ timeout: 5000 })
  await expect(chat.getByText('Thinking', { exact: true })).toHaveCount(0, { timeout: 5000 })
})
