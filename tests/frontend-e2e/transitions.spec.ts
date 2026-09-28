// Transition clips (revamp verification). Short videos proving motion pairs:
// dock open/close, section switch, model menu open/Esc. Videos land in
// test-results/visual/video (gitignored); rows live in
// docs/frontend-verification.md.
import { expect, test } from '@playwright/test'

test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } } })

async function serveClipsApi(page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/events?')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
      return
    }
    let data: unknown = []
    if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
    else if (url.includes('/v1/providers')) {
      data = {
        defaultProvider: 'meta',
        providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
          { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
        ] }],
      }
    } else if (url.endsWith('/v1/sessions')) {
      data = [{ id: 's-1', title: 'Browser chat', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T01:00:00.000Z' }]
    } else if (url.endsWith('/v1/sessions/s-1')) {
      data = { id: 's-1', title: 'Browser chat', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T01:00:00.000Z' }
    } else if (url.endsWith('/v1/sessions/s-1/threads')) {
      data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: '2026-09-27T01:00:00.000Z' }]
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

test('clip: dock open then close', async ({ page }) => {
  await serveClipsApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open chat' }).click()
  const dock = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(dock).toBeVisible()
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await expect(dock).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Open chat' })).toBeFocused()
  await page.waitForTimeout(300)
})

test('clip: section switch crossfade with heading focus', async ({ page }) => {
  await serveClipsApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await expect(page.getByRole('heading', { name: 'Researches' })).toBeFocused()
  await page.waitForTimeout(300)
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).click()
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeFocused()
  await page.waitForTimeout(300)
})

test('clip: chat model menu open then Esc refocus', async ({ page }) => {
  await serveClipsApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open chat' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat).toBeVisible()
  await chat.getByRole('button', { name: 'Choose a model' }).click()
  await expect(chat.getByRole('menu', { name: 'Models' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await expect(chat.getByRole('menu', { name: 'Models' })).not.toBeVisible()
  await expect(chat.getByRole('button', { name: 'Choose a model' })).toBeFocused()
})
