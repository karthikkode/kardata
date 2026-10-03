# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> plan approval is unavailable when context authority is denied
- Location: ../tests/frontend-e2e/workspace.spec.ts:351:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  getByText('Global context is not shared with this key.')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" getByText('Global context is not shared with this key.') with timeout 5000ms
  - waiting for getByText('Global context is not shared with this key.')
    14 × locator resolved to <p data-type="Description" class="text-ui text-muted-foreground mt-1 max-w-80">Global context is not shared with this key. Ask a…</p>
       - unexpected value "hidden"

```

```yaml
- complementary "Sector sessions":
  - button "Back to sector summary"
  - text: TEST Specialty foods Planned 0 companies
  - tablist "Session types":
    - tab "Research" [selected]
    - tab "Chats ( 0 )"
  - alert:
    - heading "Access denied" [level=3]
    - paragraph: Sessions is not shared with this key. Ask an owner for access, then try again.
    - button "Try again"
  - button "Theme"
- main:
  - heading "Sector workspace" [level=1]
  - button "Open files and global context"
  - button "Conversation options" [disabled]
  - log "Conversation messages":
    - status "Conversation is loading": Loading Conversation
  - text: Message this conversation Message this conversation
  - textbox "Message this conversation" [disabled]:
    - /placeholder: Message...
  - button "Local context"
  - button "Send message" [disabled]
- region "Notifications alt+T"
```

# Test source

```ts
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
> 354 |   await expect(page.getByText('Global context is not shared with this key.')).toBeVisible()
      |                                                                               ^ Error: expect(locator).toBeVisible() failed
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