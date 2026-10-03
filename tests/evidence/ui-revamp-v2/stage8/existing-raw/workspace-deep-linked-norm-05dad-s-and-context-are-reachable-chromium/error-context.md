# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> deep-linked normal chat selects Chats; subagents and context are reachable
- Location: ../tests/frontend-e2e/workspace.spec.ts:146:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('button', { name: 'Chats', exact: true })
Expected: "true"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByRole('button', { name: 'Chats', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: 'Chats', exact: true })

```

```yaml
- complementary "Sector sessions":
  - button "Back to sector summary"
  - text: TEST Specialty foods Approved 0 companies
  - tablist "Session types":
    - tab "Research"
    - tab "Chats ( 1 )" [selected]
  - button "New chat"
  - list "Chat sessions":
    - listitem:
      - button "Open Product brainstorm": Product brainstorm 3d ago
      - button "Options for Product brainstorm"
  - button "Theme"
- main:
  - heading "Product brainstorm" [level=1]
  - paragraph: Chat · Updated 3d ago
  - button "Open files and global context"
  - button "Conversation options"
  - text: Subagents
  - button "Source review"
  - button "Pricing analysis"
  - button "Problem discovery"
  - button "View all 6"
  - log "Conversation messages":
    - heading "Start a conversation" [level=3]
    - paragraph: Brainstorm, compare, and draft against the sector context.
    - button "Brainstorm search directions"
    - button "Compare two companies"
    - button "Draft a plan outline"
    - status:
      - text: Reconnecting. Your conversation is saved.
      - button "Reconnect now"
  - text: Message this conversation Message this conversation
  - textbox "Message this conversation":
    - /placeholder: Message...
  - button "Local context"
  - button "Choose a model": muse-spark-1.3-contributor high
  - button "Send message" [disabled]
  - paragraph: Enter to send, Shift + Enter for a new line
- region "Notifications alt+T"
```

# Test source

```ts
  49  |   await expect(page.getByText('Company research has not started yet.')).toBeVisible()
  50  |   await page.getByRole('button', { name: 'View progress' }).click()
  51  |   await expect(page.getByRole('dialog', { name: 'Research progress' })).toBeVisible()
  52  |   await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible()
  53  |   await page.keyboard.press('Escape')
  54  |   await expect(page.getByRole('button', { name: 'View progress' })).toBeFocused()
  55  |   await page.getByRole('button', { name: 'Open', exact: true }).click()
  56  |   await expect(page.getByRole('tab', { name: 'Plan', exact: true })).toBeVisible()
  57  |   await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  58  |   await expect(page.getByRole('tabpanel', { name: 'Research plan' })).toBeVisible()
  59  |   await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible()
  60  | })
  61  | test.describe('exact workspace drawer boundaries', () => {
  62  |   for (const width of [767, 768, 1279, 1280]) for (const dark of [false, true]) {
  63  |     test(`workspace boundary ${width}px ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
  64  |       await page.setViewportSize({ width, height: 960 })
  65  |       await fixtures(page, { long: true, files: 30 })
  66  |       await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  67  |       await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  68  |       const sessions = page.getByRole('complementary', { name: 'Sector sessions', includeHidden: true })
  69  |       const resources = page.getByRole('complementary', { name: 'Sector resources', includeHidden: true })
  70  |       const openSessions = page.getByRole('button', { name: 'Open sessions', includeHidden: true })
  71  |       const openResources = page.getByRole('button', { name: 'Open files and global context', includeHidden: true })
  72  |       if (width < 768) {
  73  |         await expect(sessions).toBeHidden()
  74  |         await expect(openSessions).toBeVisible()
  75  |         await openSessions.focus()
  76  |         await page.keyboard.press('Enter')
  77  |         const drawer = page.getByRole('dialog', { name: 'Sessions', exact: true })
  78  |         await expect(drawer.getByRole('group', { name: 'Session types' })).toBeVisible()
  79  |         if (dark) await drawer.getByRole('button', { name: 'Use dark theme' }).click()
  80  |         await drawer.screenshot({ path: info.outputPath('sessions-drawer.png'), animations: 'disabled' })
  81  |         await page.keyboard.press('Escape')
  82  |         await expect(drawer).toHaveCount(0)
  83  |         await expect(openSessions).toBeFocused()
  84  |       } else {
  85  |         await expect(sessions).toBeVisible()
  86  |         await expect(openSessions).toBeHidden()
  87  |         if (dark) await sessions.getByRole('button', { name: 'Use dark theme' }).click()
  88  |       }
  89  |       if (width < 1280) {
  90  |         await expect(resources).toBeHidden()
  91  |         await expect(openResources).toBeVisible()
  92  |         await openResources.focus()
  93  |         await page.keyboard.press('Enter')
  94  |         const drawer = page.getByRole('dialog', { name: 'Files and global context', exact: true })
  95  |         await expect(drawer.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
  96  |         await expect(drawer.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
  97  |         await drawer.screenshot({ path: info.outputPath('resources-drawer.png'), animations: 'disabled' })
  98  |         await page.keyboard.press('Escape')
  99  |         await expect(drawer).toHaveCount(0)
  100 |         await expect(openResources).toBeFocused()
  101 |       } else {
  102 |         await expect(resources).toBeVisible()
  103 |         await expect(openResources).toBeHidden()
  104 |         await expect(resources.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
  105 |         await expect(resources.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
  106 |       }
  107 |       await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toBeVisible()
  108 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  109 |       await page.screenshot({ path: info.outputPath('workspace-boundary.png'), animations: 'disabled' })
  110 |     })
  111 |   }
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
> 149 |   await expect(page.getByRole('button', { name: 'Chats', exact: true })).toHaveAttribute('aria-pressed', 'true')
      |                                                                          ^ Error: expect(locator).toHaveAttribute(expected) failed
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
```