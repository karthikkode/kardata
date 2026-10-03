# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> hardening surfaces 1440 dark
- Location: ../tests/frontend-e2e/workspace.spec.ts:206:3

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
            - generic "TEST Specialty foods" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: Approved
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
                - generic [ref=e38]: Approved
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Research" [level=1] [ref=e44]
          - generic [ref=e45]:
            - generic [ref=e46]: Approved
            - generic [ref=e48]: Plan v1 approved
        - button "Start research" [ref=e49] [cursor=pointer]
        - button "Hide files and context" [ref=e50] [cursor=pointer]
        - button "Conversation options" [ref=e51] [cursor=pointer]
      - generic [ref=e52]:
        - tablist "Research views" [ref=e53]:
          - tab "Chat" [selected] [ref=e54] [cursor=pointer]
          - tab "Plan" [ref=e56] [cursor=pointer]
        - generic [ref=e58]:
          - generic [ref=e62]: Subagents
          - generic [ref=e63]:
            - button "Source review" [ref=e64] [cursor=pointer]
            - button "Pricing analysis" [ref=e67] [cursor=pointer]
            - button "Problem discovery" [ref=e70] [cursor=pointer]
          - button "View all 6" [ref=e73] [cursor=pointer]
        - tabpanel "Chat" [ref=e74]:
          - generic [ref=e75]:
            - log "Conversation messages" [ref=e77]:
              - generic [ref=e78]:
                - generic [ref=e79]:
                  - heading "Ask about this research" [level=3] [ref=e83]
                  - paragraph [ref=e84]: Questions, comparisons, and review requests stay in this thread.
                  - generic [ref=e85]:
                    - button "Summarize progress so far" [ref=e86] [cursor=pointer]
                    - button "Which companies were found?" [ref=e87] [cursor=pointer]
                    - button "What needs my review?" [ref=e88] [cursor=pointer]
                - status [ref=e89]:
                  - generic [ref=e93]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e94] [cursor=pointer]
            - generic [ref=e96]:
              - generic [ref=e97]: Message this conversation
              - generic [ref=e98]:
                - generic [ref=e99]:
                  - generic [ref=e100]: Message this conversation
                  - textbox "Message this conversation" [active] [ref=e101]:
                    - /placeholder: Ask about this research...
                  - generic [ref=e102]:
                    - generic [ref=e103]:
                      - button "Local context" [ref=e104] [cursor=pointer]
                      - button "Choose a model" [ref=e107] [cursor=pointer]:
                        - generic [ref=e108]: muse-spark-1.3-contributor
                        - generic [ref=e109]: high
                    - generic [ref=e110]:
                      - button "Send message" [disabled]
                - paragraph [ref=e111]:
                  - generic [ref=e112]: Enter
                  - generic [ref=e113]: to send,
                  - generic [ref=e114]: Shift
                  - generic [ref=e115]: +
                  - generic [ref=e116]: Enter
                  - generic [ref=e117]: for a new line
    - complementary "Sector resources" [ref=e118]:
      - generic [ref=e119]:
        - region "Sector files" [ref=e120]:
          - generic [ref=e121]:
            - heading "Files" [level=2] [ref=e122]
            - generic [ref=e123]: 3 files
            - button "Upload file" [ref=e124] [cursor=pointer]
            - button "Show hidden files" [ref=e125] [cursor=pointer]
          - textbox "Search files" [ref=e129]
          - list "Files" [ref=e131]:
            - listitem [ref=e132]:
              - generic [ref=e134]:
                - button "TEST Market research and industry landscape.md" [ref=e135] [cursor=pointer]:
                  - generic [ref=e140]:
                    - generic [ref=e141]: TEST Market research and industry landscape.md
                    - generic "MD · Uploaded · In global context" [ref=e143]
                - generic [ref=e144]:
                  - img "In global context" [ref=e145]
                  - button "Hide TEST Market research and industry landscape.md from agents" [ref=e149] [cursor=pointer]
            - listitem [ref=e150]:
              - generic [ref=e152]:
                - button "TEST source-1.pdf" [ref=e153] [cursor=pointer]:
                  - generic [ref=e158]:
                    - generic [ref=e159]: TEST source-1.pdf
                    - generic "PDF · Research agent" [ref=e161]
                - generic [ref=e162]:
                  - button "Add TEST source-1.pdf to global context" [ref=e163] [cursor=pointer]
                  - button "Hide TEST source-1.pdf from agents" [ref=e164] [cursor=pointer]
            - listitem [ref=e165]:
              - generic [ref=e167]:
                - button "TEST source-2.pdf" [ref=e168] [cursor=pointer]:
                  - generic [ref=e173]:
                    - generic [ref=e174]:
                      - generic [ref=e175]: TEST source-2.pdf
                      - generic [ref=e176]: Needs OCR
                    - generic "PDF · Uploaded" [ref=e177]
                - button "Hide TEST source-2.pdf from agents" [ref=e179] [cursor=pointer]
          - paragraph [ref=e181]: Showing 3 of 3 files
        - region "Global context" [ref=e182]:
          - generic [ref=e183]:
            - heading "Global context" [level=2] [ref=e184]
            - generic [ref=e185]: v1
            - button "Context history" [ref=e186] [cursor=pointer]
            - button "Edit global context" [ref=e187] [cursor=pointer]
          - generic [ref=e189]:
            - generic [ref=e190]:
              - paragraph [ref=e191]: Scope
              - paragraph [ref=e194]: Research specialty food manufacturers in English-speaking markets.
            - generic [ref=e195]:
              - paragraph [ref=e196]: Decisions
              - paragraph [ref=e199]: Prioritize evidence of a costly operational problem. Keep uncertain claims explicit.
            - generic [ref=e200]:
              - paragraph [ref=e201]: Findings
              - paragraph [ref=e204]: Discovery has not started.
            - generic [ref=e205]:
              - paragraph [ref=e206]: Open questions
              - paragraph [ref=e209]: Which regions offer the strongest evidence?
  - region "Notifications alt+T"
```

# Test source

```ts
  112 | })
  113 | 
  114 | for (const width of [1440, 390]) for (const dark of [false, true]) {
  115 |   test(`workspace visual ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
  116 |     await page.setViewportSize({ width, height: 960 })
  117 |     await fixtures(page, { long: true, files: 30 })
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
> 212 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                          ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
```