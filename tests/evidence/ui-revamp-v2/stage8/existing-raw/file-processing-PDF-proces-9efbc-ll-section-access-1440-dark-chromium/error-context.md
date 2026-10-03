# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: file-processing.spec.ts >> PDF processing review and full-section access 1440 dark
- Location: ../tests/frontend-e2e/file-processing.spec.ts:8:68

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Use dark theme' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary "Sector sessions" [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - generic [ref=e7]:
            - button "Back to sector summary" [ref=e8] [cursor=pointer]
            - generic "TEST PDF workspace" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: Draft
            - generic [ref=e13]: 0 companies
        - tablist "Session types" [ref=e16]:
          - tab "Research" [selected] [ref=e17] [cursor=pointer]
          - tab "Chats ( 0 )" [ref=e20] [cursor=pointer]:
            - generic [ref=e21]:
              - text: Chats (
              - generic [ref=e22]: "0"
              - text: )
        - list "Research sessions" [ref=e24]:
          - listitem [ref=e25]:
            - button "Open Research" [ref=e26] [cursor=pointer]:
              - generic [ref=e36]:
                - generic "Research" [ref=e37]
                - generic [ref=e38]: Draft
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Research" [level=1] [ref=e44]
          - generic [ref=e45]:
            - generic [ref=e46]: Draft
            - generic [ref=e48]: No plan yet
        - button "Create plan" [ref=e49] [cursor=pointer]
        - button "Hide files and context" [ref=e50] [cursor=pointer]
        - button "Conversation options" [ref=e51] [cursor=pointer]
      - generic [ref=e52]:
        - tablist "Research views" [ref=e53]:
          - tab "Chat" [selected] [ref=e54] [cursor=pointer]
          - tab "Plan" [ref=e56] [cursor=pointer]
        - tabpanel "Chat" [ref=e58]:
          - generic [ref=e59]:
            - log "Conversation messages" [ref=e61]:
              - generic [ref=e62]:
                - generic [ref=e63]:
                  - heading "Ask about this research" [level=3] [ref=e67]
                  - paragraph [ref=e68]: Questions, comparisons, and review requests stay in this thread.
                  - generic [ref=e69]:
                    - button "Summarize progress so far" [ref=e70] [cursor=pointer]
                    - button "Which companies were found?" [ref=e71] [cursor=pointer]
                    - button "What needs my review?" [ref=e72] [cursor=pointer]
                - status [ref=e73]:
                  - generic [ref=e77]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e78] [cursor=pointer]
            - generic [ref=e80]:
              - generic [ref=e81]: Message this conversation
              - generic [ref=e82]:
                - generic [ref=e83]:
                  - generic [ref=e84]: Message this conversation
                  - textbox "Message this conversation" [active] [ref=e85]:
                    - /placeholder: Ask about this research...
                  - generic [ref=e86]:
                    - generic [ref=e87]:
                      - button "Local context" [ref=e88] [cursor=pointer]
                      - button "Choose a model" [ref=e91] [cursor=pointer]:
                        - generic [ref=e92]: muse-spark-1.3-contributor
                        - generic [ref=e93]: high
                    - generic [ref=e94]:
                      - button "Send message" [disabled]
                - paragraph [ref=e95]:
                  - generic [ref=e96]: Enter
                  - generic [ref=e97]: to send,
                  - generic [ref=e98]: Shift
                  - generic [ref=e99]: +
                  - generic [ref=e100]: Enter
                  - generic [ref=e101]: for a new line
    - complementary "Sector resources" [ref=e102]:
      - generic [ref=e103]:
        - region "Sector files" [ref=e104]:
          - generic [ref=e105]:
            - heading "Files" [level=2] [ref=e106]
            - generic [ref=e107]: 1 file
            - button "Upload file" [ref=e108] [cursor=pointer]
            - button "Show hidden files" [ref=e109] [cursor=pointer]
          - textbox "Search files" [ref=e113]
          - list "Files" [ref=e115]:
            - listitem [ref=e116]:
              - generic [ref=e117]:
                - generic [ref=e118]:
                  - button "TEST mixed images, charts and native text.pdf" [ref=e119] [cursor=pointer]:
                    - generic [ref=e124]:
                      - generic [ref=e125]:
                        - generic [ref=e126]: TEST mixed images, charts and native text.pdf
                        - generic [ref=e127]: Failed
                      - generic "PDF · Uploaded" [ref=e128]
                  - button "Hide TEST mixed images, charts and native text.pdf from agents" [ref=e130] [cursor=pointer]
                - generic [ref=e132]:
                  - progressbar "File processing progress" [ref=e133]
                  - status [ref=e135]: Image result needs review
                  - paragraph [ref=e136]: 18 of 24 image analyses saved
                  - paragraph [ref=e137]: The original file and saved image results are retained.
                  - group [ref=e138]:
                    - generic "Processing details" [ref=e139] [cursor=pointer]
                  - button "Review retry" [ref=e140] [cursor=pointer]
          - paragraph [ref=e142]: Showing 1 of 1 files
        - region "Global context" [ref=e143]:
          - generic [ref=e144]:
            - heading "Global context" [level=2] [ref=e145]
            - generic [ref=e146]: v0
            - button "Context history" [ref=e147] [cursor=pointer]
            - button "Edit global context" [ref=e148] [cursor=pointer]
          - generic [ref=e150]:
            - generic [ref=e151]:
              - paragraph [ref=e152]: Scope
              - paragraph [ref=e155]: TEST source scope
            - generic [ref=e156]:
              - paragraph [ref=e157]: Decisions
              - paragraph [ref=e158]: Not set yet
            - generic [ref=e159]:
              - paragraph [ref=e160]: Findings
              - paragraph [ref=e161]: Not set yet
            - generic [ref=e162]:
              - paragraph [ref=e163]: Open questions
              - paragraph [ref=e164]: Not set yet
  - region "Notifications alt+T"
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
> 46 |     } else await page.getByRole('button', { name: 'Use dark theme' }).click()
     |                                                                       ^ Error: locator.click: Test timeout of 30000ms exceeded.
  47 |   }
  48 |   if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  49 |   const resources = width < 1280 ? page.getByRole('dialog', { name: 'Files and global context' }) : page.getByRole('complementary', { name: 'Sector resources' })
  50 |   await expect(resources.getByText('18 of 24 image analyses saved')).toBeVisible()
  51 |   await resources.getByRole('button', { name: 'Review file retry' }).click()
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