// Existing production deployment, isolated by its owner. No route interception,
// direct business-data writes, provider calls, or company population.
import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const target = process.env.KARDATA_RUNTIME_PREFLIGHT_URL
const enabled = Boolean(target)
test.use({ video: 'on' })
test('matching isolated runtime preserves owner-created sessions, context and exact file bytes', async ({ page }, testInfo) => {
  test.skip(!enabled, 'requires an existing isolated matching deployment with its dedicated UI credential')
  test.setTimeout(90_000)
  const url = new URL(target!)
  // This gate must never target the shared app or an external deployment.
  expect(['localhost', '127.0.0.1']).toContain(url.hostname)
  expect(url.port).not.toBe('5173')
  const name = `TEST Runtime acceptance ${randomUUID()}`
  const directory = await mkdtemp(join(tmpdir(), 'kardata-runtime-file-'))
  const file = join(directory, 'runtime-acceptance-source.txt')
  const bytes = Buffer.from('TEST isolated runtime file. No real companies or research evidence.\nExact UTF-8 bytes: café — 日本語.\n')
  await writeFile(file, bytes)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${url.origin}/?section=Researches`)
  const form = page.getByRole('form', { name: 'Create a sector draft' })
  await form.getByLabel('Name', { exact: true }).fill(name)
  await form.getByLabel('Topic (optional)').fill('TEST isolated deployment only; do not start company research.')
  await form.getByRole('button', { name: 'Create draft', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View progress', exact: true }).click()
  await expect(page.getByText('Work items appear when the approved research starts.')).toBeVisible()
  await page.getByRole('button', { name: 'Close Research progress', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  const chooserPending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload file', exact: true }).click()
  await (await chooserPending).setFiles(file)
  await page.getByRole('button', { name: 'runtime-acceptance-source.txt', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Extracted file content' })).toContainText('Exact UTF-8 bytes: café — 日本語.')
  const downloadPending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download original file', exact: true }).click()
  const download = await downloadPending
  const downloaded = await download.path()
  expect(downloaded).not.toBeNull()
  expect(await readFile(downloaded!)).toEqual(bytes)
  await page.getByRole('button', { name: 'Close File preview', exact: true }).click()
  await page.getByRole('button', { name: 'Hide runtime-acceptance-source.txt', exact: true }).click()
  await expect(page.getByRole('button', { name: 'runtime-acceptance-source.txt', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show hidden files', exact: true }).click()
  await page.getByRole('button', { name: 'Reveal runtime-acceptance-source.txt', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Hide runtime-acceptance-source.txt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit global context', exact: true }).click()
  const decision = 'TEST owner decision: preserve preflight records; no research dispatch.'
  await page.getByRole('textbox', { name: 'Decisions', exact: true }).fill(decision)
  await page.getByRole('button', { name: 'Save context', exact: true }).click()
  await expect(page.getByText(decision, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText(decision, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Chats', exact: true }).click()
  await page.getByRole('button', { name: 'New conversation', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'New conversation', exact: true })).toBeVisible()
  await expect(page.getByText('This conversation is not available in this sector.')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Message this conversation', exact: true }).fill('TEST retained unsent draft')
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.getByRole('button', { name: 'Open Research', exact: true }).click()
  await page.getByRole('button', { name: 'Chats', exact: true }).click()
  await page.getByRole('button', { name: 'Open New conversation', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message this conversation', exact: true })).toHaveValue('TEST retained unsent draft')
  await page.screenshot({ path: testInfo.outputPath('runtime-workspace.png'), fullPage: true })
  await testInfo.attach('retained-ui-record', { body: Buffer.from(JSON.stringify({ sectorName: name, url: page.url(), providerJourney: false })), contentType: 'application/json' })
  expect(errors).toEqual([])
})
