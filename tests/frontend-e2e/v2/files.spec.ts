// Stage 5b files rail (FL-01..08): header, rows, processing, upload,
// empty, preview dialog, retry dialog, paging. Below 1281px the rail
// lives in the "Files and global context" drawer, so every test scopes
// element queries through filesScope().
import { expect, test, type Locator, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'
import { FILE_MARKDOWN, libraryFiles } from '../support/fixtures'

const SECTOR = 'sector-electrical'

async function gotoFiles(page: Page, api: ApiOptions = {}): Promise<void> {
  await serveApi(page, api)
  await page.goto(`/?section=SectorChat&sector=${SECTOR}`)
  const width = page.viewportSize()?.width ?? 1440
  if (width >= 768) {
    await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
  } else {
    await expect(page.getByRole('button', { name: 'Open sessions' })).toBeVisible()
  }
  await expect(page.locator('main h1')).toBeVisible()
}

/** Files rail scope: the drawer dialog below 1281px, the page above. */
async function filesScope(page: Page): Promise<Page | Locator> {
  const width = page.viewportSize()?.width ?? 1440
  if (width < 1281) {
    await page.getByRole('button', { name: 'Open files and global context' }).click()
    const dialog = page.getByRole('dialog', { name: 'Files and global context' })
    await expect(dialog).toBeVisible()
    return dialog
  }
  await expect(page.getByRole('region', { name: 'Sector files' })).toBeVisible()
  return page
}

/** The list item wrapping the row for one filename. */
function fileRow(scope: Page | Locator, filename: string): Locator {
  return scope.locator('li', { hasText: filename })
}

test('FL-01-default', async ({ page }) => {
  await capture(page, 'FL-01', 'default', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await expect(scope.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
    await expect(scope.getByRole('button', { name: 'Upload file' })).toBeVisible()
  })
})

test('FL-01-dragover', async ({ page }) => {
  await capture(page, 'FL-01', 'dragover', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await scope.getByRole('region', { name: 'Sector files' }).dispatchEvent('dragenter')
    // The overlay is aria-hidden by design (the only dashed border in the
    // app, pinned by the Stage 8 sweep), so the class is the assertion.
    await expect(scope.locator('.border-dashed')).toBeVisible()
  })
})

test('FL-02-default', async ({ page }) => {
  await capture(page, 'FL-02', 'default', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await expect(scope.getByRole('button', { name: 'parramatta-crew-notes.md', exact: true })).toBeVisible()
  })
})

test('FL-02-hover', async ({ page }) => {
  await capture(page, 'FL-02', 'hover', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await scope.getByRole('button', { name: 'parramatta-crew-notes.md', exact: true }).hover()
    await expect(scope.getByRole('button', { name: 'Hide parramatta-crew-notes.md from agents' })).toBeVisible()
  })
})

test('FL-02-included', async ({ page }) => {
  await capture(page, 'FL-02', 'included', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await expect(scope.getByText('In global context')).toBeVisible()
  })
})

test('FL-02-hidden', async ({ page }) => {
  await capture(page, 'FL-02', 'hidden', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await scope.getByRole('button', { name: 'Show hidden files' }).click()
    await scope.getByRole('button', { name: 'draft-exclusions.md', exact: true }).scrollIntoViewIfNeeded()
    await expect(scope.getByRole('button', { name: 'draft-exclusions.md', exact: true })).toBeVisible()
    await expect(scope.getByText('Hidden', { exact: true })).toBeVisible()
  })
})

test('FL-02-long-name', async ({ page }) => {
  await capture(page, 'FL-02', 'long-name', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    const row = scope.getByRole('button', { name: /^western sydney/ })
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeVisible()
  })
})

test('FL-02-types', async ({ page }) => {
  await capture(page, 'FL-02', 'types', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    for (const name of ['site-audit-2026.pdf', 'contractor-rates.csv', 'licence-register.json', 'scope-brief.docx', 'switchboard-photo.png', 'parramatta-crew-notes.md']) {
      await expect(scope.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await scope.getByRole('button', { name: 'licence-register.json', exact: true }).scrollIntoViewIfNeeded()
  })
})

test('FL-03-processing', async ({ page }) => {
  await capture(page, 'FL-03', 'processing', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await scope.getByRole('button', { name: 'site-audit-2026.pdf', exact: true }).scrollIntoViewIfNeeded()
    await expect(scope.getByText('Analysing images 4 of 9')).toBeVisible()
  })
})

test('FL-03-failed', async ({ page }) => {
  await capture(page, 'FL-03', 'failed', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    const row = fileRow(scope, 'ryde-roster-scan.pdf')
    await row.scrollIntoViewIfNeeded()
    await expect(row.getByText('2 of 6 image analyses saved')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Review retry' })).toBeVisible()
  })
})

test('FL-03-list-below-search-390', async ({ page }) => {
  // Layout pin: the scrollable list box always starts at or below the
  // search field, so rows can only ever be cut by the list's own clip
  // edge, never painted under the search. (A scrolled row's layout box
  // legitimately extends above the clip; that is normal scrolling.)
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoFiles(page)
  const scope = await filesScope(page)
  const row = fileRow(scope, 'ryde-roster-scan.pdf')
  await row.scrollIntoViewIfNeeded()
  const geometry = await scope.getByRole('list', { name: 'Files' }).evaluate((list) => {
    const search = list.closest('section')?.querySelector('input[type="text"]')?.getBoundingClientRect()
    const box = (list.parentElement as HTMLElement).getBoundingClientRect()
    return { searchBottom: search?.bottom, listTop: box.top }
  })
  expect(geometry.searchBottom).toBeDefined()
  expect(geometry.listTop).toBeGreaterThanOrEqual((geometry.searchBottom as number) - 1)
})

test('FL-03-needs-review', async ({ page }) => {
  await capture(page, 'FL-03', 'needs-review', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    const row = fileRow(scope, 'coverage-map.pdf')
    await row.scrollIntoViewIfNeeded()
    await expect(row.getByText('Processing paused')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Review retry' })).toBeVisible()
  })
})

test('FL-04-uploading', async ({ page }) => {
  await capture(page, 'FL-04', 'uploading', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    // Hold the upload in flight past the shutter; the delayed fulfill
    // lands harmlessly after the shot.
    await page.route(`**/v1/sectors/${SECTOR}/documents`, async (route) => {
      if (route.request().method() !== 'POST') { await route.fallback(); return }
      await new Promise((resolve) => setTimeout(resolve, 15000))
      await route.fallback()
    }, { times: 1 })
    await scope.locator('input[type="file"]').setInputFiles({ name: 'field-report.md', mimeType: 'text/markdown', buffer: Buffer.from('# Field report\n') })
    await expect(scope.getByText('Uploading…')).toBeVisible()
  })
})

test('FL-05-empty', async ({ page }) => {
  await capture(page, 'FL-05', 'empty', () => gotoFiles(page, { modes: { files: 'empty' } }), async () => {
    const scope = await filesScope(page)
    await expect(scope.getByText('Upload PDFs, documents or data')).toBeVisible()
    await expect(scope.getByRole('button', { name: 'Upload file' })).toHaveCount(2)
  })
})

test('FL-06-markdown', async ({ page }) => {
  await capture(page, 'FL-06', 'markdown', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await scope.getByRole('button', { name: 'parramatta-crew-notes.md', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'File preview' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Parramatta crew notes' })).toBeVisible()
  })
})

test('FL-06-no-text', async ({ page }) => {
  await capture(page, 'FL-06', 'no-text', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await scope.getByRole('button', { name: 'switchboard-photo.png', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'File preview' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No extracted text' })).toBeVisible()
  })
})

/** Truncated-body override: the api router always serves complete bodies. */
async function truncatedBody(page: Page): Promise<void> {
  await page.route(`**/v1/sectors/${SECTOR}/files/file-md-1/body`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {
      filename: 'parramatta-crew-notes.md', mediaType: 'text/markdown', text: FILE_MARKDOWN,
      originalAvailable: true, contentBase64: Buffer.from('TEST original bytes').toString('base64'),
      fullChars: 90000, textTruncated: true,
    } }) })
  }, { times: 1 })
}

test('FL-06-truncated', async ({ page }) => {
  await capture(page, 'FL-06', 'truncated', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await truncatedBody(page)
    await scope.getByRole('button', { name: 'parramatta-crew-notes.md', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'File preview' })).toBeVisible()
    await expect(page.getByText(/bounded preview of 90,000 indexed characters/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse indexed sections' })).toBeVisible()
  })
})

test('FL-06-sections', async ({ page }) => {
  await capture(page, 'FL-06', 'sections', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await truncatedBody(page)
    await scope.getByRole('button', { name: 'parramatta-crew-notes.md', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'File preview' })).toBeVisible()
    await page.getByRole('button', { name: 'Browse indexed sections' }).click()
    await expect(page.getByRole('region', { name: 'Indexed section 1', exact: true })).toBeVisible()
    await expect(page.getByText(/Sections 1–20/)).toBeVisible()
    await page.getByText(/Sections 1–20/).scrollIntoViewIfNeeded()
  })
})

test('FL-07-open', async ({ page }) => {
  await capture(page, 'FL-07', 'open', () => gotoFiles(page), async () => {
    const scope = await filesScope(page)
    await fileRow(scope, 'ryde-roster-scan.pdf').getByRole('button', { name: 'Review retry' }).click()
    await expect(page.getByRole('dialog', { name: 'Review file processing retry' })).toBeVisible()
    await expect(page.getByText('Retry resumes this file and reuses saved image results.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resume file processing' })).toBeDisabled()
  })
})

test('FL-07-stale', async ({ page }) => {
  // Four combos each wait out a 5s poll phase; the default 30s budget can
  // kill combo 4 under parallel load (same shape as GC-04-conflict).
  test.setTimeout(90000)
  // Stateful override: live rows until the dialog opens, bumped after, so
  // the next 5s poll marks the frozen review stale regardless of timing.
  let bumped = false
  await capture(page, 'FL-07', 'stale', async () => {
    bumped = false
    await gotoFiles(page)
    await page.route(`**/v1/sectors/${SECTOR}/files`, async (route) => {
      if (route.request().method() !== 'GET') { await route.fallback(); return }
      const rows = bumped ? libraryFiles.map((file) => file.id === 'file-pdf-2' && file.processing
        ? { ...file, processing: { ...file.processing, revision: 3, completedImages: 3 } }
        : file) : libraryFiles
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: rows }) })
    })
  }, async () => {
    const scope = await filesScope(page)
    await fileRow(scope, 'ryde-roster-scan.pdf').getByRole('button', { name: 'Review retry' }).click()
    await expect(page.getByRole('dialog', { name: 'Review file processing retry' })).toBeVisible()
    bumped = true
    await expect(page.getByText('Processing changed. Review the latest state before retrying.')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Review latest processing' })).toBeVisible()
  })
})

test('FL-08-many', async ({ page }) => {
  await capture(page, 'FL-08', 'many', () => gotoFiles(page, { data: { filesVariant: 'large' } }), async () => {
    const scope = await filesScope(page)
    await scope.getByRole('button', { name: 'Show hidden files' }).click()
    await expect(scope.getByText('Showing 50 of 2,005 files')).toBeVisible()
    await expect(scope.getByRole('button', { name: 'Show more' })).toBeVisible()
  })
})
