# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> plan approval stops when fresh global context becomes unavailable
- Location: ../tests/frontend-e2e/workspace.spec.ts:358:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('tab', { name: 'Plan', exact: true })

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
            - generic "TEST Specialty foods" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: Planned
            - generic [ref=e13]: 0 companies
        - tablist "Session types" [ref=e16]:
          - tab "Research" [selected] [ref=e17] [cursor=pointer]
          - tab "Chats ( 1 )" [ref=e20] [cursor=pointer]:
            - generic [ref=e21]:
              - text: Chats (
              - generic [ref=e22]: "1"
              - text: )
        - list "Research sessions" [ref=e24]:
          - listitem [ref=e25]:
            - button "Open Research" [ref=e26] [cursor=pointer]:
              - generic [ref=e36]:
                - generic "Research" [ref=e37]
                - generic [ref=e38]: Planned
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Research" [level=1] [ref=e44]
          - generic [ref=e45]:
            - generic [ref=e46]: Planned
            - generic [ref=e48]: Plan v1 approved
        - button "Review plan" [ref=e49] [cursor=pointer]
        - button "Open files and global context" [ref=e50] [cursor=pointer]
        - button "Conversation options" [ref=e51] [cursor=pointer]
      - generic [ref=e52]:
        - tablist "Research views" [ref=e53]:
          - tab "Chat" [selected] [ref=e54] [cursor=pointer]
          - tab "Plan needs approval" [ref=e56] [cursor=pointer]:
            - generic [ref=e57]:
              - text: Plan
              - generic [ref=e59]: needs approval
        - generic [ref=e60]:
          - generic [ref=e64]: Subagents
          - generic [ref=e65]:
            - button "Source review" [ref=e66] [cursor=pointer]
            - button "Pricing analysis" [ref=e69] [cursor=pointer]
            - button "Problem discovery" [ref=e72] [cursor=pointer]
          - button "View all 6" [ref=e75] [cursor=pointer]
        - tabpanel "Chat" [ref=e76]:
          - generic [ref=e77]:
            - log "Conversation messages" [ref=e79]:
              - generic [ref=e80]:
                - generic [ref=e81]:
                  - heading "Ask about this research" [level=3] [ref=e85]
                  - paragraph [ref=e86]: Questions, comparisons, and review requests stay in this thread.
                  - generic [ref=e87]:
                    - button "Summarize progress so far" [ref=e88] [cursor=pointer]
                    - button "Which companies were found?" [ref=e89] [cursor=pointer]
                    - button "What needs my review?" [ref=e90] [cursor=pointer]
                - status [ref=e91]:
                  - generic [ref=e95]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e96] [cursor=pointer]
            - generic [ref=e98]:
              - generic [ref=e99]: Message this conversation
              - generic [ref=e100]:
                - generic [ref=e101]:
                  - generic [ref=e102]: Message this conversation
                  - textbox "Message this conversation" [active] [ref=e103]:
                    - /placeholder: Ask about this research...
                  - generic [ref=e104]:
                    - generic [ref=e105]:
                      - button "Local context" [ref=e106] [cursor=pointer]
                      - button "Choose a model" [ref=e109] [cursor=pointer]:
                        - generic [ref=e110]: muse-spark-1.3-contributor
                        - generic [ref=e111]: high
                    - generic [ref=e112]:
                      - button "Send message" [disabled]
                - paragraph [ref=e113]:
                  - generic [ref=e114]: Enter
                  - generic [ref=e115]: to send,
                  - generic [ref=e116]: Shift
                  - generic [ref=e117]: +
                  - generic [ref=e118]: Enter
                  - generic [ref=e119]: for a new line
  - region "Notifications alt+T"
```

# Test source

```ts
  261 |   await fixtures(page)
  262 |   let steered = false
  263 |   await page.route('**/v1/commands/steer', async (route) => {
  264 |     steered = true
  265 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { commandId: 'TEST overflow steer', state: 'accepted' } }) })
  266 |   })
  267 |   await page.route('**/v1/threads/*/messages?**', async (route) => {
  268 |     const after = Number(new URL(route.request().url()).searchParams.get('afterSeq'))
  269 |     const data = steered && after === 0 ? [{ seq: 2, kind: 'text', role: 'agent', text: 'TEST terminal after steering', at: stamp }] : []
  270 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data, nextAfterSeq: steered ? 2 : 0 }) })
  271 |   })
  272 |   await page.route('**/v1/threads/*/steering-receipts?**', async (route) => {
  273 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [{ id: 'TEST overflow steer', state: outcome }], nextAfterId: null } }) })
  274 |   })
  275 |   await page.route('**/v1/threads/*/events?**', async (route) => {
  276 |     const after = Number(new URL(route.request().url()).searchParams.get('lastSeq'))
  277 |     const frames = after >= 300 ? [] : steered ? [{ seq: 300, type: 'state', payload: { status: 'FINISHED', historyRefresh: true } }]
  278 |       : [{ seq: 1, type: 'reasoning', payload: { runKey: 'TEST active', text: 'TEST initial active work' } }]
  279 |     await route.fulfill({ contentType: 'text/event-stream', body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') || ': recovered\n\n' })
  280 |   })
  281 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  282 |   await expect(page.getByRole('button', { name: 'Steer', exact: true })).toBeVisible()
  283 |   await page.getByRole('textbox', { name: 'Message this conversation' }).fill('TEST owner steering instruction')
  284 |   await page.getByRole('button', { name: 'Steer', exact: true }).click()
  285 |   await expect(page.getByText('TEST terminal after steering', { exact: true })).toBeVisible()
  286 |   await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0)
  287 |   if (outcome === 'missed') {
  288 |     await expect(page.getByRole('region', { name: 'Unapplied steering' })).toContainText('TEST owner steering instruction')
  289 |     await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toHaveValue('TEST owner steering instruction')
  290 |   }
  291 |   await page.screenshot({ path: `test-results/visual/hardening-overflow-steering-${outcome}.png`, animations: 'disabled' })
  292 | })
  293 | 
  294 | for (const width of [1440, 390]) for (const dark of [false, true]) {
  295 |   test(`operation recovery ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
  296 |     await page.setViewportSize({ width, height: 960 })
  297 |     await page.emulateMedia({ reducedMotion: 'reduce' })
  298 |     await fixtures(page, { paused: true, pending: true })
  299 |     await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  300 |     await expect(page.getByRole('button', { name: 'Resume conversation' })).toBeVisible()
  301 |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
  302 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
  303 |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  304 |     await page.getByRole('button', { name: 'Local context', exact: true }).click()
  305 |     const dialog = page.getByRole('dialog', { name: 'Local context' })
  306 |     const recovery = dialog.getByRole('region', { name: 'Pending operation recovery' })
  307 |     await expect(recovery.getByRole('heading', { name: 'Operation needs review' })).toBeVisible()
  308 |     await expect(recovery.getByText('db.create_session', { exact: true })).toBeVisible()
  309 |     await recovery.getByText('Operation identity', { exact: true }).click()
  310 |     await expect(recovery.locator('code')).toBeVisible()
  311 |     expect(await recovery.locator('code').evaluate((element) => element.clientHeight <= 128 && element.scrollHeight > element.clientHeight)).toBe(true)
  312 |     await recovery.locator('code').focus()
  313 |     await expect(recovery.locator('code')).toBeFocused()
  314 |     expect(await recovery.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  315 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  316 |     await page.screenshot({ path: `test-results/visual/operation-recovery-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  317 |     await page.keyboard.press('Escape')
  318 |     await expect(page.getByRole('button', { name: 'Local context', exact: true })).toBeFocused()
  319 |     await expect(page.getByText(/Thinking/)).toHaveCount(0)
  320 |   })
  321 | }
  322 | 
  323 | for (const width of [1440, 390]) for (const dark of [false, true]) {
  324 |   test(`plan approval context conflict ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
  325 |     await page.setViewportSize({ width, height: 960 })
  326 |     await fixtures(page, { state: 'planned', approvalConflict: true })
  327 |     await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  328 |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
  329 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
  330 |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  331 |     await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  332 |     const request = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/approve'))
  333 |     await page.getByRole('button', { name: 'Approve v1', exact: true }).click()
  334 |     expect((await request).postDataJSON()).toEqual({ version: 1, contextVersion: 1 })
  335 |     await expect(page.getByRole('alert').filter({ hasText: 'TEST global context changed' })).toBeVisible()
  336 |     await expect(page.getByRole('button', { name: 'Edit plan' })).toBeEnabled()
  337 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  338 |     await page.screenshot({ path: `test-results/visual/plan-context-conflict-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  339 |   })
  340 | }
  341 | test('retained discovery provenance remains visible in progress without a false percentage', async ({ page }) => {
  342 |   await fixtures(page, { retained: true })
  343 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  344 |   await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  345 |   const progress = page.getByRole('region', { name: 'Research progress' })
  346 |   await expect(progress.getByText('TEST retained Australian company', { exact: true })).toBeVisible()
  347 |   await expect(progress.getByText(/Retained from approved plan v1/)).toBeVisible()
  348 |   await expect(progress.getByText('Estimate pending', { exact: true })).toBeVisible()
  349 |   await expect(progress.getByRole('link', { name: 'Company source' })).toHaveAttribute('href', 'https://company.example.test/')
  350 | })
  351 | test('plan approval is unavailable when context authority is denied', async ({ page }) => {
  352 |   await fixtures(page, { state: 'planned', denied: true })
  353 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  354 |   await expect(page.getByText('Global context is not shared with this key.')).toBeVisible()
  355 |   await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toHaveCount(0)
  356 | })
  357 | 
  358 | test('plan approval stops when fresh global context becomes unavailable', async ({ page }) => {
  359 |   await fixtures(page, { state: 'planned' })
  360 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
> 361 |   await page.getByRole('tab', { name: 'Plan', exact: true }).click()
      |                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  362 |   await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toBeEnabled()
  363 |   await page.route(`**/v1/sectors/${sector.id}/global-context`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'overload', message: 'TEST context unavailable' } }) }))
  364 |   await expect(page.getByRole('alert').filter({ hasText: 'TEST context unavailable' }).first()).toBeVisible({ timeout: 10000 })
  365 |   await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toBeDisabled()
  366 | })
  367 | 
```