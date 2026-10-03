# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: file-processing.spec.ts >> PDF processing review and full-section access 390 light
- Location: ../tests/frontend-e2e/file-processing.spec.ts:8:68

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('dialog', { name: 'Files and global context' }).getByRole('button', { name: 'Review file retry' })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - main [ref=e4]:
      - generic [aria-hidden] [ref=e5]:
        - button [ref=e6] [cursor=pointer]
        - generic [ref=e7]:
          - heading [level=1] [ref=e8]: Research
          - generic [ref=e9]:
            - generic [ref=e10]: Draft
            - generic [ref=e12]: No plan yet
        - button [ref=e13] [cursor=pointer]: Create plan
        - button [ref=e14] [cursor=pointer]
        - button [ref=e15] [cursor=pointer]
      - generic [ref=e16]:
        - tablist [aria-hidden] [ref=e17]:
          - tab [selected] [ref=e18] [cursor=pointer]: Chat
          - tab [ref=e20] [cursor=pointer]:
            - generic [ref=e21]: Plan
        - tabpanel "Chat" [ref=e22]:
          - generic [ref=e23]:
            - log "Conversation messages" [ref=e25]:
              - generic [ref=e26]:
                - generic [ref=e27]:
                  - heading "Ask about this research" [level=3] [ref=e31]
                  - paragraph [ref=e32]: Questions, comparisons, and review requests stay in this thread.
                  - generic [ref=e33]:
                    - button "Summarize progress so far" [ref=e34] [cursor=pointer]
                    - button "Which companies were found?" [ref=e35] [cursor=pointer]
                    - button "What needs my review?" [ref=e36] [cursor=pointer]
                - status [ref=e37]:
                  - generic [ref=e41]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e42] [cursor=pointer]
            - generic [ref=e44]:
              - generic [ref=e45]: Message this conversation
              - generic [ref=e47]:
                - generic [ref=e48]: Message this conversation
                - textbox [ref=e49]:
                  - /placeholder: Ask about this research...
                - generic [ref=e50]:
                  - generic [ref=e51]:
                    - button [ref=e52] [cursor=pointer]
                    - button [ref=e55] [cursor=pointer]:
                      - generic [ref=e56]: muse-spark-1.3-contributor
                      - generic [ref=e57]: high
                  - generic [ref=e58]:
                    - button [disabled]
    - region "Notifications alt+T"
  - dialog [active] [ref=e61]:
    - generic [ref=e62]:
      - heading "Files and global context" [level=2] [ref=e64]
      - button "Close Files and global context" [ref=e65] [cursor=pointer]
    - generic [ref=e71]:
      - region "Sector files" [ref=e72]:
        - generic [ref=e73]:
          - heading "Files" [level=2] [ref=e74]
          - generic [ref=e75]: 1 file
          - button "Upload file" [ref=e76] [cursor=pointer]
          - button "Show hidden files" [ref=e77] [cursor=pointer]
        - textbox "Search files" [ref=e81]
        - list "Files" [ref=e83]:
          - listitem [ref=e84]:
            - generic [ref=e85]:
              - generic [ref=e86]:
                - button "TEST mixed images, charts and native text.pdf" [ref=e87] [cursor=pointer]:
                  - generic [ref=e92]:
                    - generic [ref=e93]:
                      - generic [ref=e94]: TEST mixed images, charts and native text.pdf
                      - generic [ref=e95]: Failed
                    - generic "PDF · Uploaded" [ref=e96]
                - button "Hide TEST mixed images, charts and native text.pdf from agents" [ref=e98] [cursor=pointer]
              - generic [ref=e100]:
                - progressbar "File processing progress" [ref=e101]
                - status [ref=e103]: Image result needs review
                - paragraph [ref=e104]: 18 of 24 image analyses saved
                - paragraph [ref=e105]: The original file and saved image results are retained.
                - group [ref=e106]:
                  - generic "Processing details" [ref=e107] [cursor=pointer]
                - button "Review retry" [ref=e108] [cursor=pointer]
        - paragraph [ref=e110]: Showing 1 of 1 files
      - region "Global context" [ref=e111]:
        - generic [ref=e112]:
          - heading "Global context" [level=2] [ref=e113]
          - generic [ref=e114]: v0
          - button "Context history" [ref=e115] [cursor=pointer]
          - button "Edit global context" [ref=e116] [cursor=pointer]
        - generic [ref=e118]:
          - generic [ref=e119]:
            - paragraph [ref=e120]: Scope
            - paragraph [ref=e123]: TEST source scope
          - generic [ref=e124]:
            - paragraph [ref=e125]: Decisions
            - paragraph [ref=e126]: Not set yet
          - generic [ref=e127]:
            - paragraph [ref=e128]: Findings
            - paragraph [ref=e129]: Not set yet
          - generic [ref=e130]:
            - paragraph [ref=e131]: Open questions
            - paragraph [ref=e132]: Not set yet
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | 
  3  | test.use({ video: 'on', trace: 'on' })
  4  | const stamp = '2026-10-01T00:00:00.000Z'
  5  | const sector = { id: 'TEST sector', name: 'TEST PDF workspace', topic: 'TEST documents', state: 'draft', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
  6  | const session = { id: 'TEST research', title: 'Research', kind: 'research', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
  7  | const progress = { jobId: 'TEST file job', state: 'uncertain', revision: 1, totalImages: 24, completedImages: 18, failedImages: 0, uncertainImages: 1, errorCode: 'provider_outcome_unknown', retryRequiresApproval: true }
  8  | for (const width of [390, 1440]) for (const dark of [false, true]) test(`PDF processing review and full-section access ${width} ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
  9  |   await page.setViewportSize({ width, height: 900 })
  10 |   await page.emulateMedia({ reducedMotion: 'reduce' })
  11 |   let retried = false
  12 |   let denied = true
  13 |   let indexed = false
  14 |   const decisions: unknown[] = []
  15 |   await page.route('**/v1/**', async (route) => {
  16 |     const url = new URL(route.request().url()), path = url.pathname
  17 |     if (path.endsWith('/events')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' })
  18 |     if (path.endsWith('/retry')) {
  19 |       decisions.push(route.request().postDataJSON())
  20 |       if (denied) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'permission_denied', message: 'TEST owner key required' } }) })
  21 |       retried = true
  22 |       return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...progress, state: 'queued', revision: 2 } }) })
  23 |     }
  24 |     let data: unknown = []
  25 |     if (path.includes('/sectors/TEST%20sector') || path.includes('/sectors/TEST sector')) data = sector
  26 |     if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [{ provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['high'] }] }] }
  27 |     else if (path.endsWith('/sessions')) data = [session]
  28 |     else if (path.endsWith('/global-context')) data = { sectorId: sector.id, version: 0, markdown: '', sections: { scope: 'TEST source scope', decisions: '', findings: '', questions: '' }, researchSessionId: session.id, changes: [] }
  29 |     else if (path.endsWith('/files')) data = [{ id: 'TEST pdf', filename: 'TEST mixed images, charts and native text.pdf', status: indexed ? 'indexed' : retried ? 'processing' : 'failed', source: 'Uploaded', hash: 'TEST version', hidden: false, included: false, kind: 'document', processing: indexed ? { ...progress, state: 'complete', revision: 2, completedImages: 24, uncertainImages: 0 } : retried ? { ...progress, state: 'queued', revision: 2 } : progress }]
  30 |     else if (path.endsWith('/body')) data = { filename: 'TEST mixed images, charts and native text.pdf', mediaType: 'application/pdf', text: '## Page 1\nTEST bounded preview', fullChars: 90000, textTruncated: true, nextOrd: 0, originalAvailable: true, contentBase64: Buffer.from('TEST exact original bytes').toString('base64') }
  31 |     else if (path.endsWith('/units')) data = { status: 'indexed', units: [{ ord: Number(url.searchParams.get('fromOrd')), kind: 'ocr', text: '## Visual description\nTEST saved chart analysis with exact source placement.', uncertain: true, page: 3, imageOrdinal: 1, imageRole: 'embedded' }], nextOrd: url.searchParams.get('fromOrd') === '0' ? 20 : null, fullChars: 90000 }
  32 |     else if (path.endsWith('/threads')) data = [{ key: session.id, sessionId: session.id, kind: 'session', status: 'IDLE', acceptingSteer: false, queueDepth: 0, updatedAt: stamp }]
  33 |     else if (path.endsWith('/context')) data = { threadKey: session.id, task: '', notes: '', summary: '', coveredSeq: 0, version: 0, usage: { inputTokens: 0, budget: 100000, remaining: 100000, label: 'Estimate' } }
  34 |     else if (path.endsWith('/progress')) data = { sectorId: sector.id, state: 'draft', planVersion: 0, plan: { sectorId: sector.id, versions: [], latest: null, approvals: [], approvedVersion: null }, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  35 |     else if (path.endsWith('/plan')) data = { sectorId: sector.id, versions: [], latest: null, approvals: [], approvedVersion: null }
  36 |     else if (path.includes('/sessions/')) data = session
  37 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  38 |   })
  39 |   await page.goto(`/?section=SectorChat&sector=${encodeURIComponent(sector.id)}`)
  40 |   await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  41 |   if (dark) {
  42 |     if (width < 768) {
  43 |       await page.getByRole('button', { name: 'Open sessions' }).click()
  44 |       await page.getByRole('button', { name: 'Use dark theme' }).click()
  45 |       await page.keyboard.press('Escape')
  46 |     } else await page.getByRole('button', { name: 'Use dark theme' }).click()
  47 |   }
  48 |   if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  49 |   const resources = width < 1280 ? page.getByRole('dialog', { name: 'Files and global context' }) : page.getByRole('complementary', { name: 'Sector resources' })
  50 |   await expect(resources.getByText('18 of 24 image analyses saved')).toBeVisible()
> 51 |   await resources.getByRole('button', { name: 'Review file retry' }).click()
     |                                                                      ^ Error: locator.click: Test timeout of 30000ms exceeded.
  52 |   const dialog = page.getByRole('dialog', { name: 'Review file processing retry' })
  53 |   await expect(dialog.getByRole('button', { name: 'Resume file processing' })).toBeDisabled()
  54 |   await dialog.getByRole('checkbox').check()
  55 |   await dialog.getByRole('button', { name: 'Resume file processing' }).click()
  56 |   await expect(dialog.getByRole('alert')).toContainText('TEST owner key required')
  57 |   await expect(dialog.getByRole('checkbox')).toBeChecked()
  58 |   await page.screenshot({ path: info.outputPath('paid-review-denied.png'), animations: 'disabled' })
  59 |   denied = false
  60 |   await dialog.getByRole('button', { name: 'Resume file processing' }).click()
  61 |   await expect(dialog).toHaveCount(0)
  62 |   expect(decisions).toEqual([{ jobId: progress.jobId, revision: 1, allowDuplicatePaid: true }, { jobId: progress.jobId, revision: 1, allowDuplicatePaid: true }])
  63 |   indexed = true
  64 |   await resources.getByRole('button', { name: 'TEST mixed images, charts and native text.pdf', exact: true }).click()
  65 |   const preview = page.getByRole('dialog', { name: 'File preview' })
  66 |   await preview.getByRole('button', { name: 'Browse indexed sections' }).click()
  67 |   await expect(preview.getByRole('region', { name: 'Indexed section 1' })).toBeVisible()
  68 |   await expect(preview.getByText(/AI-derived, uncertain/)).toBeVisible()
  69 |   await preview.getByRole('button', { name: 'Next sections' }).click()
  70 |   await expect(preview.getByRole('region', { name: 'Indexed section 21' })).toBeVisible()
  71 |   await preview.getByRole('button', { name: 'Previous sections' }).click()
  72 |   await expect(preview.getByRole('region', { name: 'Indexed section 1' })).toBeVisible()
  73 |   await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  74 |   await page.screenshot({ path: info.outputPath('indexed-sections.png'), animations: 'disabled' })
  75 | })
  76 | 
```