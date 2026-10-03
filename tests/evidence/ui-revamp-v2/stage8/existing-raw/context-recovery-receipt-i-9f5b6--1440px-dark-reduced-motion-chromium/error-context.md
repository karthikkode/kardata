# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: context-recovery.spec.ts >> receipt inspection 1440px dark, reduced motion
- Location: ../tests/frontend-e2e/context-recovery.spec.ts:57:3

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
            - generic "TEST Recovery evidence" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: Paused
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
                - generic [ref=e38]: Paused
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Research" [level=1] [ref=e44]
          - generic [ref=e45]:
            - generic [ref=e46]: Paused
            - generic [ref=e48]: No plan yet
        - button "Resume" [ref=e49] [cursor=pointer]
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
                      - generic [ref=e90]:
                        - button "Choose a model" [disabled]
                    - generic [ref=e91]:
                      - button "Send message" [disabled]
                - paragraph [ref=e92]:
                  - generic [ref=e93]: Enter
                  - generic [ref=e94]: to send,
                  - generic [ref=e95]: Shift
                  - generic [ref=e96]: +
                  - generic [ref=e97]: Enter
                  - generic [ref=e98]: for a new line
    - complementary "Sector resources" [ref=e99]:
      - generic [ref=e100]:
        - region "Sector files" [ref=e101]:
          - generic [ref=e102]:
            - heading "Files" [level=2] [ref=e103]
            - generic [ref=e104]: 0 files
            - button "Upload file" [ref=e105] [cursor=pointer]
            - button "Show hidden files" [ref=e106] [cursor=pointer]
          - textbox "Search files" [ref=e110]
          - generic [ref=e112]:
            - paragraph [ref=e113]: Upload PDFs, documents or data, or ask an agent to create a file.
            - button "Upload file" [ref=e115] [cursor=pointer]
          - paragraph [ref=e117]: Showing 0 of 0 files
        - region "Global context" [ref=e118]:
          - generic [ref=e119]:
            - heading "Global context" [level=2] [ref=e120]
            - generic [ref=e121]: v1
            - button "Context history" [ref=e122] [cursor=pointer]
            - button "Edit global context" [ref=e123] [cursor=pointer]
          - generic [ref=e125]:
            - generic [ref=e126]:
              - paragraph [ref=e127]: Scope
              - paragraph [ref=e130]: TEST Australian SME scope
            - generic [ref=e131]:
              - paragraph [ref=e132]: Decisions
              - paragraph [ref=e133]: Not set yet
            - generic [ref=e134]:
              - paragraph [ref=e135]: Findings
              - paragraph [ref=e136]: Not set yet
            - generic [ref=e137]:
              - paragraph [ref=e138]: Open questions
              - paragraph [ref=e139]: Not set yet
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | // Browser acceptance over synthetic HTTP fixtures: UI evidence only, no live
  2   | // provider, database, Temporal or owner business mutations.
  3   | import { expect, test, type Page } from '@playwright/test'
  4   | test.use({ video: 'on', trace: 'on' })
  5   | const sectorId = 'TEST-context-recovery-sector', sessionId = 'TEST-context-recovery-parent'
  6   | const at = '2026-10-01T00:00:00Z'
  7   | const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
  8   | const sections = { scope: 'TEST Australian SME scope', decisions: '', findings: '', questions: '' }
  9   | const sector = { id: sectorId, name: 'TEST Recovery evidence', topic: sections.scope, state: 'paused', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
  10  | const operationId = 'op:'.concat('a'.repeat(64))
  11  | async function fixture(page: Page, blocked: boolean) {
  12  |   let failRebuild = true
  13  |   let local = { threadKey: sessionId, notes: 'TEST keep draft notes', summary: '## Stored summary\n\nTEST objectives and retained historical evidence.', version: 2, coveredSeq: 4, task: 'TEST preserve original research objective', sourceRefs: [{ fileId: 'TEST source', filename: `TEST ${'long-source-'.repeat(15)}.md`, hash: 'b'.repeat(64), ords: [0, 1] }], ...(blocked ? { contextBlocked: 'TEST source is hidden. Reveal its exact version or rebuild independently.' } : { pendingOperations: [{ operationId, toolName: 'db.create_session', callId: 'TEST call', reason: 'TEST reply delivery was lost; avoid repeating a change.' }] }) }
  14  |   await page.route('**/v1/**', async (route) => {
  15  |     const request = route.request(), path = new URL(request.url()).pathname
  16  |     if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  17  |     if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
  18  |     let data: unknown = []
  19  |     if (path.endsWith('/context/rebuild')) {
  20  |       if (failRebuild) { local = { ...local, version: 3 }; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST recovery conflict: draft is kept.' } }) }) }
  21  |       const body = request.postDataJSON()
  22  |       expect(body).toMatchObject({ version: 3, independent: true })
  23  |       local = { ...local, summary: body.summary, version: 4, contextBlocked: undefined }
  24  |       data = local
  25  |     } else if (path.includes('/operations/')) data = { operationId, toolName: 'db.create_session', state: 'confirmed', reason: 'TEST durable successful reply is recorded. Original authority is required; guard conflicts remain blocked.' }
  26  |     else if (path.endsWith('/context')) data = local
  27  |     else if (path === '/v1/sectors') data = [sector]
  28  |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  29  |     else if (path.endsWith('/research-session')) data = session
  30  |     else if (path === '/v1/sessions') data = [session]
  31  |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections, markdown: '## Scope\n\nTEST Australian SME scope', researchSessionId: sessionId, changes: [] }
  32  |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  33  |     else if (path.endsWith('/progress')) data = { sectorId, state: 'paused', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  34  |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'PAUSED', acceptingSteer: false, queueDepth: 0, updatedAt: at }]
  35  |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  36  |     else if (path.startsWith('/v1/sessions/')) data = session
  37  |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  38  |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  39  |   })
  40  |   return { allowRebuild: () => { failRebuild = false } }
  41  | }
  42  | async function open(page: Page, width: number, dark: boolean) {
  43  |   await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
  44  |   await page.emulateMedia({ reducedMotion: 'reduce' })
  45  |   await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  46  |   await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  47  |   if (dark) {
  48  |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
> 49  |     await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                ^ Error: locator.click: Test timeout of 30000ms exceeded.
  50  |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  51  |   }
  52  |   const context = page.getByRole('button', { name: 'Local context', exact: true })
  53  |   await context.focus(); await page.keyboard.press('Enter')
  54  |   return page.getByRole('dialog', { name: 'Local context', exact: true })
  55  | }
  56  | for (const width of [1440, 390]) for (const dark of [false, true]) {
  57  |   test(`receipt inspection ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, info) => {
  58  |     await fixture(page, false)
  59  |     const context = await open(page, width, dark)
  60  |     await expect(context.getByText('Operation needs review')).toBeVisible()
  61  |     await context.getByRole('button', { name: 'Inspect receipt' }).click()
  62  |     await expect(context.getByText('Result confirmed')).toBeVisible()
  63  |     await context.getByText('Operation identity', { exact: true }).click()
  64  |     await expect(context.getByText(operationId, { exact: true })).toBeVisible()
  65  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  66  |     await page.screenshot({ path: info.outputPath('receipt-inspection.png'), animations: 'disabled' })
  67  |     await page.keyboard.press('Escape')
  68  |     await expect(page.getByRole('button', { name: 'Local context', exact: true })).toBeFocused()
  69  |   })
  70  |   test(`owner safe rebuild ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, info) => {
  71  |     const state = await fixture(page, true)
  72  |     const context = await open(page, width, dark)
  73  |     await expect(context.getByText('Context needs source review')).toBeVisible()
  74  |     await expect(context.getByRole('button', { name: 'Compact context' })).toBeDisabled()
  75  |     await context.getByRole('button', { name: 'Review safe rebuild' }).click()
  76  |     const review = page.getByRole('dialog', { name: 'Rebuild private context' })
  77  |     const confirm = review.getByRole('button', { name: 'Confirm safe rebuild' })
  78  |     await expect(confirm).toBeDisabled()
  79  |     await review.getByText('Stored summary and source dependencies', { exact: true }).click()
  80  |     await expect(review.getByText('b'.repeat(64), { exact: true })).toBeVisible()
  81  |     await review.getByRole('textbox', { name: 'Independent replacement' }).fill('## TEST reviewed objectives\n\nKeep completed work and open questions without hidden source content.')
  82  |     await expect(review.getByRole('region', { name: 'Replacement preview' })).toBeVisible()
  83  |     await review.getByRole('checkbox').check()
  84  |     await confirm.click()
  85  |     await expect(review.getByText('TEST recovery conflict: draft is kept.')).toBeInViewport({ ratio: 1 })
  86  |     await expect(review.getByText('TEST recovery conflict: draft is kept.')).toBeFocused()
  87  |     await expect(confirm).toBeInViewport()
  88  |     await expect(review.getByRole('textbox', { name: 'Independent replacement' })).toHaveValue(/Keep completed work/)
  89  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  90  |     await page.screenshot({ path: info.outputPath('safe-rebuild-conflict.png'), animations: 'disabled' })
  91  |     await expect(confirm).toBeDisabled()
  92  |     await review.getByRole('button', { name: 'Review latest context' }).click()
  93  |     await expect(review.getByRole('checkbox')).not.toBeChecked()
  94  |     await expect(review.getByRole('textbox', { name: 'Independent replacement' })).toHaveValue(/Keep completed work/)
  95  |     await review.getByRole('checkbox').check()
  96  |     state.allowRebuild(); await confirm.click()
  97  |     await expect(review).not.toBeVisible()
  98  |     await expect(context.getByRole('button', { name: 'Compact context' })).toBeEnabled()
  99  |     await expect(context.getByText('Context needs source review')).not.toBeVisible()
  100 |     await page.screenshot({ path: info.outputPath('safe-rebuild-complete.png'), animations: 'disabled' })
  101 |   })
  102 | }
  103 | 
```