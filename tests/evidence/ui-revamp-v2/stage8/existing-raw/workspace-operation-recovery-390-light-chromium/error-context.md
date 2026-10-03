# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> operation recovery 390 light
- Location: ../tests/frontend-e2e/workspace.spec.ts:295:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Resume conversation' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'Resume conversation' }) with timeout 5000ms
  - waiting for getByRole('button', { name: 'Resume conversation' })

```

```yaml
- main:
  - button "Open sessions"
  - heading "Research" [level=1]
  - text: Approved Plan v1 approved
  - button "Start research"
  - button "Open files and global context"
  - button "Conversation options"
  - tablist "Research views":
    - tab "Chat" [selected]
    - tab "Plan"
  - text: Subagents
  - button "Source review"
  - button "Pricing analysis"
  - button "Problem discovery"
  - button "View all 6"
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
    - text: Message this conversation Message this conversation
    - textbox "Message this conversation":
      - /placeholder: Ask about this research...
    - button "Local context"
    - button "Choose a model": muse-spark-1.3-contributor high
    - button "Send message" [disabled]
- region "Notifications alt+T"
```

# Test source

```ts
  200 |   await expect(page.getByText(/Thinking/)).toHaveCount(0)
  201 |   await page.screenshot({ path: 'test-results/visual/hardening-context-paused.png', animations: 'disabled' })
  202 | })
  203 | 
  204 | for (const width of [1440, 390]) for (const dark of [false, true]) {
  205 |   test.use({ video: 'on' })
  206 |   test(`hardening surfaces ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
  207 |     await page.setViewportSize({ width, height: 960 })
  208 |     await fixtures(page, { saveError: true })
  209 |     await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  210 |     await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  211 |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
  212 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
  213 |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  214 |     await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  215 |     await expect(page.getByRole('region', { name: 'Executable research work' })).toBeVisible()
  216 |     await page.getByRole('button', { name: 'Edit plan' }).click()
  217 |     const editor = page.getByRole('dialog', { name: 'Edit research plan' })
  218 |     await expect(editor.getByRole('textbox', { name: 'Plan', exact: true })).toBeVisible()
  219 |     await expect(editor.getByRole('combobox', { name: 'Research depth' })).toHaveValue('discovery')
  220 |     const saveBox = await editor.getByRole('button', { name: 'Save plan' }).boundingBox()
  221 |     expect(saveBox).not.toBeNull()
  222 |     expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(960)
  223 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  224 |     await page.screenshot({ path: `test-results/visual/hardening-editor-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  225 |     await page.keyboard.press('Escape')
  226 |     await expect(page.getByRole('button', { name: 'Edit plan' })).toBeFocused()
  227 |     if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  228 |     await page.getByRole('button', { name: 'TEST Market research and industry landscape.md', exact: true }).click()
  229 |     const preview = page.getByRole('dialog', { name: 'File preview' })
  230 |     await expect(preview.getByRole('heading', { name: 'TEST retained source' })).toBeVisible()
  231 |     await expect(preview.getByRole('button', { name: 'Download original file' })).toBeVisible()
  232 |     await page.screenshot({ path: `test-results/visual/hardening-preview-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  233 |   })
  234 | }
  235 | 
  236 | 
  237 | test('overflow recovery shows the durable answer after a long history and clears stale thinking', async ({ page }) => {
  238 |   await fixtures(page)
  239 |   await page.route('**/v1/threads/*/messages?**', async (route) => {
  240 |     const after = Number(new URL(route.request().url()).searchParams.get('afterSeq'))
  241 |     const data = after === 0 ? Array.from({ length: 200 }, (_, index) => ({ seq: index + 1, kind: 'text', role: 'user', text: `TEST history ${index + 1}`, at: stamp }))
  242 |       : after === 200 ? [{ seq: 201, kind: 'text', role: 'agent', text: 'TEST recovered terminal answer', at: stamp }] : []
  243 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data, nextAfterSeq: after === 0 ? 200 : 201 }) })
  244 |   })
  245 |   await page.route('**/v1/threads/*/events?**', async (route) => {
  246 |     if (Number(new URL(route.request().url()).searchParams.get('lastSeq')) >= 300) { await route.fulfill({ contentType: 'text/event-stream', body: ': recovered\n\n' }); return }
  247 |     const frames = [
  248 |       { seq: 1, type: 'reasoning', payload: { runKey: 'TEST finished turn', text: 'TEST obsolete thinking' } },
  249 |       { seq: 300, type: 'state', payload: { status: 'RUNNING', historyRefresh: true } },
  250 |     ]
  251 |     await route.fulfill({ contentType: 'text/event-stream', body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') })
  252 |   })
  253 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  254 |   await expect(page.getByText('TEST recovered terminal answer', { exact: true })).toBeVisible()
  255 |   await expect(page.getByText('TEST obsolete thinking', { exact: true })).toHaveCount(0)
  256 |   await page.screenshot({ path: 'test-results/visual/hardening-overflow-recovery.png', animations: 'disabled' })
  257 | })
  258 | 
  259 | 
  260 | for (const outcome of ['consumed', 'missed'] as const) test(`overflow recovery restores ${outcome} steering in the UI`, async ({ page }) => {
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
> 300 |     await expect(page.getByRole('button', { name: 'Resume conversation' })).toBeVisible()
      |                                                                             ^ Error: expect(locator).toBeVisible() failed
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
  361 |   await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  362 |   await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toBeEnabled()
  363 |   await page.route(`**/v1/sectors/${sector.id}/global-context`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'overload', message: 'TEST context unavailable' } }) }))
  364 |   await expect(page.getByRole('alert').filter({ hasText: 'TEST context unavailable' }).first()).toBeVisible({ timeout: 10000 })
  365 |   await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toBeDisabled()
  366 | })
  367 | 
```