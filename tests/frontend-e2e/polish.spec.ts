// Polish proofs: the small-interaction contracts every component must hold.
// The context drawer keeps its meter and add-note pinned while scrolling,
// nested unit lists hand scroll chaining to the drawer (never trap the
// wheel), hover/focus states never spill onto neighbors, and no surface
// introduces page-level sideways scroll. PNGs land in test-results/visual
// (gitignored); rows live in docs/frontend-verification.md.
import { expect, test, type Locator, type Page } from '@playwright/test'

const AT = '2026-09-27T00:00:00.000Z'

const UNITS = Array.from({ length: 30 }, (_, i) => ({
  ord: i, kind: 'paragraph', text: `Unit ${i + 1} of the long file, with enough words to wrap a line or two.`,
  uncertain: false, excluded: false,
}))

const CONTEXT = {
  sectorId: 'sec-polish',
  digest: { version: 'abc123def456', text: 'Sector Polish sector (draft): open. Documents: long-file.md (indexed). Notes: 2.' },
  segments: {
    system: 'Sector Polish sector',
    references: ['Sector Polish sector (draft): open. Documents: long-file.md (indexed). Notes: 2.'],
    history: [],
    tail: [],
  },
  usage: {
    system: { messages: 1, estimatedTokens: 10 },
    references: { messages: 1, estimatedTokens: 200 },
    history: { messages: 0, estimatedTokens: 0 },
    tail: { messages: 0, estimatedTokens: 0 },
    totalEstimatedTokens: 210,
  },
  files: [
    {
      id: 'sdoc-long', filename: 'long-file.md', mediaType: 'text/plain', status: 'indexed',
      sha256: 'abcdef1234567890abcdef1234567890', chars: 30000, excluded: false, units: UNITS,
    },
    {
      id: 'sdoc-short', filename: 'short.md', mediaType: 'text/plain', status: 'indexed',
      sha256: '1234567890abcdef1234567890abcdef', chars: 400, excluded: false,
      units: [{ ord: 0, kind: 'text', text: 'Short file body.', uncertain: false, excluded: false }],
    },
  ],
  notes: [
    { id: 'snote-9', text: 'First owner note.', createdAt: AT },
    { id: 'snote-10', text: 'Second owner note.', createdAt: AT },
  ],
}

const SECTOR = {
  id: 'sec-polish', name: 'Polish sector', topic: '', state: 'draft',
  companiesFound: 0, companies: [], activity: [], createdAt: AT, updatedAt: AT,
}

async function servePolishApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/events?')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
      return
    }
    let data: unknown = []
    if (url.endsWith('/v1/sectors') && method === 'GET') data = [SECTOR]
    else if (url.endsWith('/v1/sectors/sec-polish')) data = SECTOR
    else if (url.includes('/v1/sectors/sec-polish/documents')) data = []
    else if (url.includes('/v1/sectors/sec-polish/context')) data = CONTEXT
    else if (url.includes('/v1/runs')) data = []
    else if (url.endsWith('/v1/sessions')) data = []
    else if (url.includes('/v1/providers')) {
      data = { defaultProvider: 'meta', providers: [] }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  for (const anchor of anchors) await expect(anchor).toBeVisible()
  await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
}

async function openDrawer(page: Page) {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await page.getByRole('button', { name: 'Open Polish sector', exact: true }).click()
  const drawer = page.getByRole('region', { name: 'Context for Polish sector' })
  await expect(drawer).toBeVisible()
  return drawer
}

async function expandLongFile(drawer: Locator): Promise<void> {
  await drawer.getByRole('button', { name: 'long-file.md', exact: true }).click()
  await expect(drawer.getByText('Unit 30 of the long file')).toBeVisible()
}

async function columnOf(drawer: Locator) {
  return drawer.locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]')
}

interface Box { x: number; y: number; width: number; height: number }

function intersectsPort(box: Box, port: Box): boolean {
  return box.y < port.y + port.height && box.y + box.height > port.y
}

test('polish: drawer keeps meter and add-note pinned while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await servePolishApi(page)
  const drawer = await openDrawer(page)
  await expandLongFile(drawer)
  const column = await columnOf(drawer)
  await column.evaluate((el) => {
    el.scrollTop = 400
  })
  const port = (await column.boundingBox()) as unknown as Box
  expect(port).not.toBeNull()
  const meterBox = (await drawer.getByRole('img', { name: /Context meter/ }).boundingBox()) as unknown as Box
  const noteBox = (await drawer.getByRole('region', { name: 'Add a context note' }).boundingBox()) as unknown as Box
  const sysBox = (await drawer.getByRole('heading', { name: 'System' }).boundingBox()) as unknown as Box
  expect(meterBox).not.toBeNull()
  expect(noteBox).not.toBeNull()
  expect(sysBox).not.toBeNull()
  expect(intersectsPort(meterBox, port)).toBe(true)
  expect(intersectsPort(noteBox, port)).toBe(true)
  expect(intersectsPort(sysBox, port)).toBe(false)
  await shot(page, 'polish-drawer-sticky', [
    drawer.getByRole('img', { name: /Context meter/ }),
    drawer.getByRole('region', { name: 'Add a context note' }),
  ])
})

test('polish: unit list hands scroll chaining to the drawer at its end', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await servePolishApi(page)
  const drawer = await openDrawer(page)
  await expandLongFile(drawer)
  await page.evaluate(() => window.scrollTo(0, 0))
  const units = drawer.locator('ul.max-h-64').first()
  await units.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  const column = await columnOf(drawer)
  await column.evaluate((el) => {
    el.scrollTop = 0
  })
  await units.scrollIntoViewIfNeeded()
  const box = await units.boundingBox()
  expect(box).not.toBeNull()
  const viewport = page.viewportSize() ?? { width: 1440, height: 600 }
  const x = box!.x + box!.width / 2
  const y = Math.min(Math.max(box!.y + box!.height / 2, 100), viewport.height - 100)
  await page.mouse.move(x, y)
  const before = await column.evaluate((el) => el.scrollTop)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(before)
})

test('polish: hover and focus states stay inside their rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await servePolishApi(page)
  const drawer = await openDrawer(page)
  const eye = drawer.getByRole('button', { name: 'Exclude long-file.md' })
  await eye.hover()
  await expect(eye).toBeVisible()
  const note = drawer.getByRole('textbox', { name: 'Context note' })
  await note.focus()
  await expect(note).toBeFocused()
  const spill = await page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
  expect(spill).toBeLessThanOrEqual(1)
  await shot(page, 'polish-drawer-hover-focus', [eye, note])
})

test('polish: dark drawer keeps pins and hover without spill', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await servePolishApi(page)
  const drawer = await openDrawer(page)
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
  await expandLongFile(drawer)
  const column = await columnOf(drawer)
  await column.evaluate((el) => {
    el.scrollTop = 400
  })
  const port = (await column.boundingBox()) as unknown as Box
  const meter = drawer.getByRole('img', { name: /Context meter/ })
  const addNote = drawer.getByRole('region', { name: 'Add a context note' })
  const sys = drawer.getByRole('heading', { name: 'System' })
  expect(port).not.toBeNull()
  expect(intersectsPort((await meter.boundingBox()) as unknown as Box, port)).toBe(true)
  expect(intersectsPort((await addNote.boundingBox()) as unknown as Box, port)).toBe(true)
  expect(intersectsPort((await sys.boundingBox()) as unknown as Box, port)).toBe(false)
  await drawer.getByRole('button', { name: 'Exclude short.md' }).hover()
  await shot(page, 'polish-drawer-dark', [meter, addNote])
})
