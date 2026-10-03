# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: files-scale.spec.ts >> files state: empty, 390px
- Location: ../tests/frontend-e2e/files-scale.spec.ts:146:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Sector files' }).getByText('Upload source material or ask an agent to create a file.')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Sector files' }).getByText('Upload source material or ask an agent to create a file.') with timeout 5000ms
  - waiting for getByRole('region', { name: 'Sector files' }).getByText('Upload source material or ask an agent to create a file.')

```

```yaml
- main:
  - tabpanel "Chat":
    - log "Conversation messages":
      - heading "Ask about this research" [level=3]
      - paragraph: Questions, comparisons, and review requests stay in this thread.
      - button "Summarize progress so far"
      - button "Which companies were found?"
      - button "What needs my review?"
      - status:
        - text: Reconnecting. Your conversation is saved.
        - button "Reconnect now"
- region "Notifications alt+T"
- dialog "Files and global context":
  - heading "Files and global context" [level=2]
  - button "Close Files and global context"
  - region "Sector files":
    - heading "Files" [level=2]
    - text: 0 files
    - button "Upload file"
    - button "Show hidden files"
    - textbox "Search files"
    - paragraph: Upload PDFs, documents or data, or ask an agent to create a file.
    - button "Upload file"
    - paragraph: Showing 0 of 0 files
  - region "Global context":
    - heading "Global context" [level=2]
    - text: v1
    - button "Context history"
    - button "Edit global context"
    - paragraph: Scope
    - paragraph: TEST synthetic library scope
    - paragraph: Decisions
    - paragraph: Not set yet
    - paragraph: Findings
    - paragraph: Not set yet
    - paragraph: Open questions
    - paragraph: Not set yet
```

# Test source

```ts
  50  |     } else if (path.endsWith('/body')) {
  51  |       const file = files.find((entry) => path.includes(entry.id))!
  52  |       data = { filename: file.filename, mediaType: 'text/markdown', text: '# TEST exact preview\n\nSynthetic retained content.', originalAvailable: true, contentBase64: Buffer.from('TEST original bytes').toString('base64') }
  53  |     } else if (path.includes('/files/') && request.method() === 'PATCH') {
  54  |       const file = files.find((entry) => path.endsWith(entry.id))!
  55  |       file.hidden = request.postDataJSON().hidden
  56  |       data = file
  57  |     } else if (path === '/v1/sectors') data = [sector]
  58  |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  59  |     else if (path.endsWith('/research-session')) data = session
  60  |     else if (path === '/v1/sessions') data = [session]
  61  |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections, markdown: '## Scope\n\nTEST synthetic library scope', researchSessionId: sessionId, changes: [] }
  62  |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  63  |     else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  64  |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
  65  |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  66  |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  67  |     else if (path.startsWith('/v1/sessions/')) data = session
  68  |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  69  |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  70  |   })
  71  |   return { ready: async () => { state = 'ready'; release(); if (initial === 'offline') await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })) } }
  72  | }
  73  | 
  74  | async function open(page: Page, width: number, dark = false) {
  75  |   await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
  76  |   await page.emulateMedia({ reducedMotion: 'reduce' })
  77  |   await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  78  |   await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  79  |   if (dark) {
  80  |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
  81  |     await page.getByRole('button', { name: 'Use dark theme' }).click()
  82  |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  83  |   }
  84  |   if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  85  |   return page.getByRole('region', { name: 'Sector files' })
  86  | }
  87  | 
  88  | for (const width of [1440, 390]) for (const dark of [false, true]) {
  89  |   test(`files scale: 2005 mixed records, ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, testInfo) => {
  90  |     await fixture(page)
  91  |     const files = await open(page, width, dark)
  92  |     await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
  93  |     // The initial focus/DOM window stays bounded independently of library size.
  94  |     expect(await files.getByRole('button', { name: /^TEST (Generated|Uploaded)/ }).count()).toBeLessThanOrEqual(50)
  95  |     await expect(files.getByText('Showing 50 of 2004 files', { exact: true })).toBeVisible()
  96  |     await expect(files.getByRole('button', { name: 'Upload file' })).toBeVisible()
  97  |     await expect(files.getByRole('button', { name: 'Upload file' })).toBeInViewport()
  98  |     await expect(files.getByRole('button', { name: `Hide ${longName}`, exact: true })).toBeVisible()
  99  |     await expect(files.getByRole('button', { name: `Request context inclusion for ${longName}`, exact: true })).toBeVisible()
  100 |     await expect(files.getByRole('button', { name: `Hide ${longName}`, exact: true })).toBeInViewport()
  101 |     await expect(files.getByRole('button', { name: `Request context inclusion for ${longName}`, exact: true })).toBeInViewport()
  102 |     await expect(files.getByText('Processing', { exact: true })).toBeVisible()
  103 |     await expect(files.getByText('Failed', { exact: true })).toBeVisible()
  104 |     await expect(files.getByText('Needs OCR', { exact: true })).toBeVisible()
  105 |     const contextHeading = page.getByRole('heading', { name: 'Global context', exact: true })
  106 |     const contextPosition = (await contextHeading.boundingBox())!.y
  107 |     await files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true }).scrollIntoViewIfNeeded()
  108 |     await expect(files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true })).toBeInViewport()
  109 |     expect((await contextHeading.boundingBox())!.y).toBe(contextPosition)
  110 |     await files.getByRole('button', { name: longName, exact: true }).scrollIntoViewIfNeeded()
  111 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  112 |     await page.screenshot({ path: testInfo.outputPath('initial-window.png'), animations: 'disabled' })
  113 |     const more = files.getByRole('button', { name: 'Show more files', exact: true })
  114 |     await more.scrollIntoViewIfNeeded()
  115 |     await more.focus()
  116 |     await page.keyboard.press('Enter')
  117 |     await expect(files.getByText('Showing 100 of 2004 files', { exact: true })).toBeVisible()
  118 |     await files.getByRole('textbox', { name: 'Search files' }).fill('file 2004')
  119 |     const lastName = 'TEST Generated file 2004.md'
  120 |     await expect(files.getByRole('button', { name: lastName, exact: true })).toBeVisible()
  121 |     await expect(files.getByText('Showing 1 of 1 files', { exact: true })).toBeVisible()
  122 |     await files.getByRole('button', { name: lastName, exact: true }).focus()
  123 |     await page.keyboard.press('Enter')
  124 |     await expect(page.getByRole('dialog', { name: 'File preview' }).getByRole('heading', { name: 'TEST exact preview' })).toBeVisible()
  125 |     await page.keyboard.press('Escape')
  126 |     await expect(files.getByRole('button', { name: lastName, exact: true })).toBeFocused()
  127 |     await files.getByRole('textbox', { name: 'Search files' }).fill('no TEST filename matches')
  128 |     await expect(files.getByText('No matching files.', { exact: true })).toBeVisible()
  129 |     await files.getByRole('textbox', { name: 'Search files' }).fill('file 0004')
  130 |     await files.getByRole('button', { name: 'Show hidden files', exact: true }).click()
  131 |     const hiddenName = 'TEST Generated file 0004.md'
  132 |     await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeDisabled()
  133 |     await files.getByRole('button', { name: `Reveal ${hiddenName}`, exact: true }).click()
  134 |     await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeEnabled()
  135 |     await files.getByRole('textbox', { name: 'Search files' }).fill('')
  136 |     await expect(files.getByText('Showing 50 of 2005 files', { exact: true })).toBeVisible()
  137 |     await page.screenshot({ path: testInfo.outputPath('search-and-reveal.png'), animations: 'disabled' })
  138 |     if (width < 1280) {
  139 |       await page.keyboard.press('Escape')
  140 |       await expect(page.getByRole('button', { name: 'Open files and global context' })).toBeFocused()
  141 |     }
  142 |   })
  143 | }
  144 | 
  145 | for (const width of [1440, 390]) for (const state of ['loading', 'empty', 'error', 'denied', 'offline'] as const) {
  146 |   test(`files state: ${state}, ${width}px`, async ({ page }, testInfo) => {
  147 |     const controller = await fixture(page, state)
  148 |     const files = await open(page, width)
  149 |     if (state === 'loading') await expect(files.getByRole('status', { name: 'Files is loading' })).toBeVisible()
> 150 |     else if (state === 'empty') await expect(files.getByText('Upload source material or ask an agent to create a file.')).toBeVisible()
      |                                                                                                                           ^ Error: expect(locator).toBeVisible() failed
  151 |     else await expect(files.getByRole('alert')).toContainText(state === 'denied' ? 'Files is not shared with this key.' : state === 'offline' ? 'No connection' : 'TEST Files unavailable')
  152 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  153 |     await page.screenshot({ path: testInfo.outputPath(`${state}.png`), animations: 'disabled' })
  154 |     await controller.ready()
  155 |     if (['error', 'denied', 'offline'].includes(state)) await files.getByRole('button', { name: 'Try again', exact: true }).click()
  156 |     if (state !== 'empty') await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
  157 |   })
  158 | }
  159 | 
```