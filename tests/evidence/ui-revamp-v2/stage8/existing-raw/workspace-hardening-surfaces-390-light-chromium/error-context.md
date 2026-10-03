# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> hardening surfaces 390 light
- Location: ../tests/frontend-e2e/workspace.spec.ts:206:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'Edit research plan' }).getByRole('textbox', { name: 'Plan', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog', { name: 'Edit research plan' }).getByRole('textbox', { name: 'Plan', exact: true }) with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Edit research plan' }).getByRole('textbox', { name: 'Plan', exact: true })

```

```yaml
- main
- region "Notifications alt+T"
- dialog "Edit research plan":
  - heading "Edit research plan" [level=2]
  - button "Close Edit research plan"
  - region "Plan text":
    - text: Plan text
    - textbox "Plan text": "## Scope Find specialty food companies. ## Discovery Search approved regions and verify company websites. ## Company research Investigate all worthy problems, with cited evidence. ## Budgets Two researchers at a time. ## Acceptance Every company has an evidence-backed verdict."
    - paragraph: Markdown supported.
  - region "Search":
    - heading "Search" [level=3]
    - text: Research depth
    - combobox "Research depth": discovery
    - text: Discovery target
    - spinbutton "Discovery target"
  - region "Search directions":
    - heading "Search directions" [level=3]
    - group "Australian discovery":
      - text: Australian discovery Queries for Australian discovery
      - textbox "Queries for Australian discovery": Australian SME manufacturers
      - paragraph: 1 of 30 queries
      - text: Pages per query for Australian discovery
      - spinbutton "Pages per query for Australian discovery": "2"
  - region "Limits":
    - heading "Limits" [level=3]
    - text: Company limit
    - spinbutton "Company limit": "2000"
    - text: Active minutes
    - spinbutton "Active minutes": "60"
  - region "Research instructions":
    - text: Research instructions
    - textbox "Research instructions": Verify company identity and sources.
  - region "Acceptance criteria":
    - text: Acceptance criteria
    - textbox "Acceptance criteria": Distinct Australian companies with source evidence
    - paragraph: 1 of 20 criteria, one per line
  - paragraph: Editing an approved plan reopens review. Execution uses the queries and limits shown here.
  - button "Cancel"
  - button "Save plan"
```

# Test source

```ts
  118 |     await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  119 |     await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  120 |     await expect(page.getByRole('heading', { name: 'A focused research direction' })).toBeVisible()
  121 |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
  122 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
  123 |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  124 |     await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toBeVisible()
  125 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  126 |     await page.screenshot({ path: `test-results/visual/workspace-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  127 |     if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  128 |     await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
  129 |     await expect(page.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
  130 |     await page.screenshot({ path: `test-results/visual/workspace-resources-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  131 |   })
  132 | }
  133 | 
  134 | test('paused research offers plan revision and preserves an unsuccessful edit', async ({ page }) => {
  135 |   await fixtures(page, { state: 'paused', saveError: true })
  136 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  137 |   await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  138 |   await page.getByRole('button', { name: 'Edit plan' }).click()
  139 |   const editor = page.getByRole('dialog', { name: 'Edit research plan' })
  140 |   await editor.getByRole('textbox', { name: 'Plan', exact: true }).fill('TEST revised paused scope')
  141 |   await editor.getByRole('button', { name: 'Save plan' }).click()
  142 |   await expect(editor.getByRole('alert')).toContainText('TEST plan save conflict')
  143 |   await expect(editor.getByRole('textbox', { name: 'Plan', exact: true })).toHaveValue('TEST revised paused scope')
  144 |   await page.screenshot({ path: 'test-results/visual/hardening-paused-plan-conflict.png', animations: 'disabled' })
  145 | })
  146 | test('deep-linked normal chat selects Chats; subagents and context are reachable', async ({ page }) => {
  147 |   await fixtures(page)
  148 |   await page.goto(`/?section=SectorChat&sector=${sector.id}&session=${normal.id}&thread=${normal.id}`)
  149 |   await expect(page.getByRole('button', { name: 'Chats', exact: true })).toHaveAttribute('aria-pressed', 'true')
  150 |   await page.getByRole('button', { name: 'All 6' }).click()
  151 |   await page.getByRole('dialog', { name: 'Subagents' }).getByRole('button', { name: /Source review/ }).click()
  152 |   await expect(page.getByRole('heading', { name: 'Source review', exact: true })).toBeVisible()
  153 |   await expect(page).toHaveURL(/thread=agent%3Atest-child-0/)
  154 |   await page.getByRole('button', { name: 'Local context', exact: true }).click()
  155 |   await expect(page.getByRole('textbox', { name: 'Local notes' })).toHaveValue('Stay broad and keep sources.')
  156 | })
  157 | test('permission failures remain visible instead of empty files or context', async ({ page }) => {
  158 |   await fixtures(page, { denied: true })
  159 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  160 |   await expect(page.getByText('Files is not shared with this key.')).toBeVisible()
  161 |   await expect(page.getByText('Global context is not shared with this key.')).toBeVisible()
  162 | })
  163 | 
  164 | test('file preview downloads retained bytes and returns focus to the file', async ({ page }) => {
  165 |   await fixtures(page)
  166 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  167 |   const file = page.getByRole('button', { name: 'TEST Market research and industry landscape.md', exact: true })
  168 |   await file.click()
  169 |   const dialog = page.getByRole('dialog', { name: 'File preview' })
  170 |   await expect(dialog.getByRole('heading', { name: 'TEST retained source' })).toBeVisible()
  171 |   const downloadPromise = page.waitForEvent('download')
  172 |   await dialog.getByRole('button', { name: 'Download original file' }).click()
  173 |   const download = await downloadPromise
  174 |   expect(download.suggestedFilename()).toBe('TEST Market research and industry landscape.md')
  175 |   await page.screenshot({ path: 'test-results/visual/hardening-file-preview.png', animations: 'disabled' })
  176 |   await page.keyboard.press('Escape')
  177 |   await expect(file).toBeFocused()
  178 | })
  179 | 
  180 | test('failed plan edits retain the owner draft and expose exact executable work', async ({ page }) => {
  181 |   await fixtures(page, { saveError: true })
  182 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  183 |   await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  184 |   await expect(page.getByRole('region', { name: 'Executable research work' })).toContainText('2,000 companies')
  185 |   await page.getByRole('button', { name: 'Edit plan' }).click()
  186 |   const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
  187 |   await dialog.getByRole('textbox', { name: 'Plan', exact: true }).fill('TEST owner draft retained after conflict')
  188 |   await dialog.getByRole('button', { name: 'Save plan' }).click()
  189 |   await expect(dialog.getByRole('alert')).toContainText('TEST plan save conflict')
  190 |   await expect(dialog.getByRole('textbox', { name: 'Plan', exact: true })).toHaveValue('TEST owner draft retained after conflict')
  191 |   await expect(dialog.getByRole('spinbutton', { name: 'Company limit' })).toHaveValue('2000')
  192 |   await page.screenshot({ path: 'test-results/visual/hardening-plan-conflict.png', animations: 'disabled' })
  193 | })
  194 | 
  195 | test('paused conversations offer a visible recovery action without indefinite thinking', async ({ page }) => {
  196 |   await fixtures(page, { paused: true })
  197 |   await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  198 |   await expect(page.getByRole('button', { name: 'Resume conversation' })).toBeVisible()
  199 |   await expect(page.getByText('This conversation is paused. Review local context, then resume the saved turn.')).toBeVisible()
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
> 218 |     await expect(editor.getByRole('textbox', { name: 'Plan', exact: true })).toBeVisible()
      |                                                                              ^ Error: expect(locator).toBeVisible() failed
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
```