// B4 live browser walkthrough (real Meta, B2 stack on 3101 + Vite 15174).
// Gated by KARDATA_LIVE_UI=1. No route interception: every row renders
// from the live backend. Screenshots land uncommitted under
// tests/evidence/sector-backend-v1/ and each is opened by hand.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 120_000 })

const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'evidence', 'sector-backend-v1')
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'live', 'fixtures')
const IDLE_MS = 480_000
const READY_MS = 480_000

test('sector backend v1 walkthrough', async ({ page }) => {
  test.skip(process.env.KARDATA_LIVE_UI !== '1', 'needs the B2 live stack')
  test.setTimeout(3_600_000)
  const shot = (name: string) => page.screenshot({ path: join(EVIDENCE, name), animations: 'disabled' })
  const sendButton = page.getByRole('button', { name: 'Send message' })
  const composer = page.getByRole('textbox', { name: 'Message this conversation' })
  const resources = page.getByRole('complementary', { name: 'Sector resources' })
  const contextSection = page.getByRole('region', { name: 'Global context' }).or(page.locator('section[aria-label="Global context"]'))

  async function sendChat(text: string): Promise<void> {
    await composer.fill(text)
    await sendButton.click()
    await expect(sendButton).toBeVisible({ timeout: IDLE_MS })
  }

  // 1. Create a sector.
  await page.goto('/')
  await page.getByRole('button', { name: 'New sector' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New sector' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Live walkthrough')
  await dialog.getByRole('textbox', { name: 'Topic (optional)' }).fill('electrical contractors')
  const created = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/v1/sectors'))
  await dialog.getByRole('button', { name: 'Create sector' }).click()
  const sectorId = (await (await created).json() as { data: { id: string } }).data.id
  expect(sectorId).toBeTruthy()
  await shot('b4-01-sector-created.png')

  // 2. Open the workspace.
  await page.goto(`/?section=SectorChat&sector=${sectorId}`)
  await expect(page.getByRole('log', { name: 'Conversation messages' })).toBeVisible()
  await shot('b4-02-workspace.png')

  // 3. Upload md and pdf.
  const mdBytes = readFileSync(join(FIXTURES, 'market-notes.md'))
  const pdfBytes = readFileSync(join(FIXTURES, 'report.pdf'))
  const uploadTrigger = resources.getByRole('button', { name: 'Upload file', exact: true }).first()
  for (const file of [{ name: 'market-notes.md', mimeType: 'text/markdown', buffer: mdBytes }, { name: 'report.pdf', mimeType: 'application/pdf', buffer: pdfBytes }]) {
    const chooser = page.waitForEvent('filechooser')
    await uploadTrigger.click()
    await (await chooser).setFiles(file)
  }
  await expect(resources.getByRole('button', { name: 'Add market-notes.md to global context' })).toBeVisible({ timeout: READY_MS })
  await expect(resources.getByRole('button', { name: 'Add report.pdf to global context' })).toBeVisible({ timeout: READY_MS })
  await shot('b4-03-files.png')

  // 4. Add the md to context; watch Summarizing turn ready.
  await resources.getByRole('button', { name: 'market-notes.md', exact: true }).hover()
  await resources.getByRole('button', { name: 'Add market-notes.md to global context' }).click()
  const blockRow = contextSection.locator('li', { hasText: 'market-notes.md' })
  await expect(blockRow.getByText('Summarizing')).toBeVisible({ timeout: 60_000 })
  await expect(blockRow.getByText('Summarizing')).toBeHidden({ timeout: READY_MS })
  await expect(blockRow.getByText(/\d[\d,]* tokens/)).toBeVisible()
  await shot('b4-04-block-ready.png')

  // 5. Check the token bar.
  await expect(contextSection.getByRole('button', { name: /Global context token usage/ })).toBeVisible()
  await shot('b4-05-usage.png')

  // 6. Open the full viewer, light plus dark.
  await contextSection.getByRole('button', { name: 'Edit global context' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit global context' })
  for (const [label, text] of [['Scope', 'Electrical contractors on the coast.'], ['Instructions', 'Weigh commercial work equally.'], ['Decisions', 'Target mid-size firms first.'], ['Findings', 'Coastal firms buy bigger jobs.'], ['Open questions', 'Which firms are hiring?']] as const) {
    await editor.getByRole('textbox', { name: label }).fill(text)
  }
  await editor.getByRole('button', { name: 'Save context' }).click()
  await expect(editor).toBeHidden({ timeout: 60_000 })
  await contextSection.getByRole('button', { name: 'Open full view' }).click()
  const viewer = page.getByRole('dialog', { name: 'Global context' })
  for (const heading of ['Scope', 'Instructions', 'Decisions', 'Findings', 'Open questions', 'Files']) {
    await expect(viewer.getByRole('heading', { name: heading })).toBeVisible()
  }
  await shot('b4-06-viewer-light.png')
  // The viewer is modal and aria-hides the page behind it: theme switches
  // happen with the viewer closed, then it reopens for the dark shot.
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await contextSection.getByRole('button', { name: 'Open full view' }).click()
  await expect(viewer.getByRole('heading', { name: 'Scope' })).toBeVisible({ timeout: 30_000 })
  await shot('b4-06-viewer-dark.png')
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Light' }).click()

  // 7. Remove the block.
  await contextSection.getByRole('button', { name: 'Remove market-notes.md from global context' }).click()
  await expect(contextSection.locator('li', { hasText: 'market-notes.md' })).toHaveCount(0)
  await shot('b4-07-removed.png')

  // 8. Send a chat message and see the reply.
  await sendChat('What should a service contract cover? Answer in two sentences.')
  await shot('b4-08-reply.png')

  // 9. Create the Instructions proposal and approve it.
  for (const wording of [
    'From now on focus only on companies with more than 50 staff; remember this for all chats.',
    'This is a durable direction for the whole sector: focus only on companies with more than 50 staff. Propose it to the global context now.',
    'Call db.propose_global_context to add "Focus only on companies with more than 50 staff" to the Instructions section, then tell me the proposal is waiting.',
  ]) {
    await sendChat(wording)
    if (await contextSection.getByText(/waiting for review/).isVisible()) break
  }
  await expect(contextSection.getByText(/waiting for review/)).toBeVisible({ timeout: 60_000 })
  await contextSection.getByRole('button', { name: /Review/ }).first().click()
  const review = page.getByRole('dialog', { name: 'Review context update' })
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(contextSection.getByText(/waiting for review/)).toBeHidden({ timeout: 60_000 })
  await shot('b4-09-approved.png')

  // 10. Toggle the switch off and see the chip.
  await page.getByRole('button', { name: 'Conversation options' }).click()
  await page.getByRole('switch', { name: 'Use global context' }).click()
  await expect(page.getByRole('button', { name: 'Global context off. Turn it back on.' })).toBeVisible()
  await shot('b4-10-chip.png')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Global context off. Turn it back on.' }).click()
  await expect(page.getByRole('button', { name: 'Global context off. Turn it back on.' })).toBeHidden({ timeout: 60_000 })

  // 11. Start a rewrite with a direction and land in the new chat.
  await contextSection.getByRole('button', { name: 'Global context options' }).click()
  await page.getByRole('menuitem', { name: 'Rewrite with a direction…' }).click()
  const rewrite = page.getByRole('dialog', { name: 'Rewrite with a direction' })
  await rewrite.getByRole('textbox').fill('Give more weight to commercial customers.')
  await rewrite.getByRole('button', { name: 'Start rewrite' }).click()
  await expect(page.getByRole('button', { name: /Open Context rewrite/ })).toBeVisible({ timeout: 120_000 })
  await shot('b4-11-rewrite.png')

  // 12. Use @chat in the research chat.
  await page.getByRole('tab', { name: 'Research' }).click()
  await page.getByRole('button', { name: 'Open Research' }).click()
  await composer.pressSequentially('@', { delay: 50 })
  const mentions = page.getByRole('listbox', { name: 'Mention a chat' })
  await expect(mentions).toBeVisible({ timeout: 30_000 })
  await mentions.getByRole('option').first().click()
  await sendButton.click()
  await expect(sendButton).toBeVisible({ timeout: IDLE_MS })
  await shot('b4-12-mention.png')

  // 13. Spawn a subagent from the UI, pause it, resume it.
  await page.getByRole('tab', { name: /Chats/ }).click()
  await page.getByRole('button', { name: /Open Context rewrite/ }).click()
  await page.getByRole('button', { name: 'New subagent' }).first().click()
  const spawn = page.getByRole('dialog', { name: 'New subagent' })
  await spawn.getByRole('textbox', { name: 'Goal' }).fill('Write a detailed ten-paragraph guide to pricing service contracts, one paragraph per pricing model.')
  await spawn.getByRole('button', { name: 'Start subagent' }).click()
  const pauseButton = page.getByRole('button', { name: /Pause / }).first()
  await expect(pauseButton).toBeVisible({ timeout: 120_000 })
  const pauseName = (await pauseButton.getAttribute('aria-label')) ?? ''
  const childName = pauseName.replace(/^Pause /, '')
  await pauseButton.click()
  await expect(page.getByText('Paused').first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: `Resume ${childName}` }).click()
  await expect(page.getByRole('button', { name: `Pause ${childName}` })).toBeVisible({ timeout: 120_000 })
  await shot('b4-13-subagent.png')

  // 14. Open the queue disclosure while busy, remove an item.
  // Steps 14-15 need a normal chat: the rewrite chat answers every
  // message with a short context note, so nothing stays busy there.
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await expect(page.getByRole('log', { name: 'Conversation messages' })).toBeVisible()
  const longGuide = 'Write a detailed ten-paragraph guide to pricing service contracts, one paragraph per pricing model.'
  async function queueShort(text: string): Promise<void> {
    await expect(async () => {
      await composer.fill(text)
      const queue = page.getByRole('button', { name: 'Queue' })
      if (await queue.isVisible()) {
        await queue.click()
        return
      }
      // Idled mid-step: restart a long turn, queue on the next poll.
      if (await sendButton.isVisible()) {
        await composer.fill(longGuide)
        await sendButton.click()
      }
      expect(await queue.isVisible()).toBe(true)
    }).toPass({ timeout: 480_000 })
  }
  await queueShort('Reply only with APPLE')
  await queueShort('Reply only with PEAR')
  const queued = page.getByRole('button', { name: /Queued \(\d+\)/ })
  await expect(queued).toBeVisible({ timeout: 60_000 })
  await queued.click()
  const queueList = page.getByRole('list', { name: 'Queued messages' })
  const firstRemove = queueList.getByRole('button', { name: /^Remove / }).first()
  const removedText = ((await firstRemove.getAttribute('aria-label')) ?? '').replace(/^Remove /, '')
  expect(removedText.length).toBeGreaterThan(0)
  await firstRemove.click()
  await expect(queueList.getByText(removedText)).toBeHidden({ timeout: 60_000 })
  await shot('b4-14-queue.png')

  // 15. Stop a running chat. Whatever step 14 left running may drain
  // mid-step, so keep a long turn in flight until the header Stop holds.
  const headerStop = page.getByRole('main').getByRole('button', { name: 'Stop agent' }).first()
  await expect(async () => {
    if (await headerStop.isVisible()) return
    if (await sendButton.isVisible()) {
      await composer.fill('Write another detailed ten-paragraph guide to hiring electricians, one paragraph per hiring channel.')
      await sendButton.click()
    }
    expect(await headerStop.isVisible()).toBe(true)
  }).toPass({ timeout: 480_000 })
  await headerStop.click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByText('Stop this agent?')).toBeVisible()
  await confirm.getByRole('button', { name: 'Stop agent' }).click()
  await expect(page.getByText('Stopped')).toBeVisible({ timeout: 30_000 })
  await shot('b4-15-stopped.png')
})
