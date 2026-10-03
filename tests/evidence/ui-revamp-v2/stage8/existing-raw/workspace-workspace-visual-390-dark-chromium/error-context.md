# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> workspace visual 390 dark
- Location: ../tests/frontend-e2e/workspace.spec.ts:115:3

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
- generic [ref=e1]:
  - generic [ref=e2]:
    - main [ref=e4]:
      - generic [aria-hidden] [ref=e5]:
        - button [ref=e6] [cursor=pointer]
        - generic [ref=e7]:
          - heading [level=1] [ref=e8]: Research
          - generic [ref=e9]: Approved
        - button [ref=e11] [cursor=pointer]: Start research
        - button [ref=e12] [cursor=pointer]
        - button [ref=e13] [cursor=pointer]
      - generic [ref=e14]:
        - tablist [aria-hidden] [ref=e15]:
          - tab [selected] [ref=e16] [cursor=pointer]: Chat
          - tab [ref=e18] [cursor=pointer]:
            - generic [ref=e19]: Plan
        - generic [aria-hidden] [ref=e20]:
          - generic [ref=e24]: Subagents
          - generic [ref=e25]:
            - button [ref=e26] [cursor=pointer]:
              - generic [ref=e28]: Source review
            - button [ref=e29] [cursor=pointer]:
              - generic [ref=e31]: Pricing analysis
            - button [ref=e32] [cursor=pointer]:
              - generic [ref=e34]: Problem discovery
          - button [ref=e35] [cursor=pointer]: View all 6
        - tabpanel "Chat" [ref=e36]:
          - generic [ref=e37]:
            - log "Conversation messages" [ref=e39]:
              - generic [ref=e40]:
                - generic [ref=e41]:
                  - generic [ref=e42]: What should we look for in this sector?
                  - generic [ref=e44]:
                    - generic [ref=e45]:
                      - heading "A focused research direction" [level=2] [ref=e46]
                      - paragraph [ref=e47]: Look for companies with meaningful operational friction and capacity to invest.
                      - heading "Evidence to gather" [level=3] [ref=e48]
                      - list [ref=e49]:
                        - listitem [ref=e50]: Revenue and scale signals from reliable sources.
                        - listitem [ref=e51]: Repeated manual work across systems.
                        - listitem [ref=e52]: Cost or time impact, with explicit uncertainty.
                      - table [ref=e54]:
                        - rowgroup [ref=e55]:
                          - row [ref=e56]:
                            - columnheader "Area" [ref=e57]
                            - columnheader "Signal" [ref=e58]
                            - columnheader "Next step" [ref=e59]
                        - rowgroup [ref=e60]:
                          - row [ref=e61]:
                            - cell "Operations" [ref=e62]
                            - cell "Fragmented reporting" [ref=e63]
                            - cell "Verify the actual workflow" [ref=e64]
                          - row [ref=e65]:
                            - cell "Inventory" [ref=e66]
                            - cell "Manual reconciliation" [ref=e67]
                            - cell "Find a cost or time signal" [ref=e68]
                      - blockquote [ref=e69]:
                        - paragraph [ref=e70]: Keep the research broad. One symptom should not define the whole investigation.
                      - paragraph [ref=e71]:
                        - text: Use
                        - code [ref=e72]: company_id
                        - text: only when working with tools; explain findings in plain language.
                    - generic [ref=e73]:
                      - button "Copy" [ref=e74] [cursor=pointer]
                      - time [ref=e76]: 3d
                - status [ref=e77]:
                  - generic [ref=e81]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e82] [cursor=pointer]
            - generic [ref=e84]:
              - generic [ref=e85]: Message this conversation
              - generic [ref=e87]:
                - generic [ref=e88]: Message this conversation
                - textbox [ref=e89]:
                  - /placeholder: Ask about this research...
                - generic [ref=e90]:
                  - generic [ref=e91]:
                    - button [ref=e92] [cursor=pointer]
                    - button [ref=e95] [cursor=pointer]:
                      - generic [ref=e96]: muse-spark-1.3-contributor
                      - generic [ref=e97]: high
                  - generic [ref=e98]:
                    - button [disabled]
    - region "Notifications alt+T"
  - dialog [active] [ref=e101]:
    - generic [ref=e102]:
      - heading "Sessions" [level=2] [ref=e104]
      - button "Close Sessions" [ref=e105] [cursor=pointer]
    - generic [ref=e110]:
      - generic [ref=e111]:
        - generic [ref=e112]:
          - button "Back to sector summary" [ref=e113] [cursor=pointer]
          - generic "TEST Specialty foods" [ref=e114]
        - generic [ref=e115]:
          - generic [ref=e116]: Approved
          - generic [ref=e118]: 0 companies
      - tablist "Session types" [ref=e121]:
        - tab "Research" [selected] [ref=e122] [cursor=pointer]
        - tab "Chats ( 1 )" [ref=e125] [cursor=pointer]:
          - generic [ref=e126]:
            - text: Chats (
            - generic [ref=e127]: "1"
            - text: )
      - list "Research sessions" [ref=e129]:
        - listitem [ref=e130]:
          - button "Open Research" [ref=e131] [cursor=pointer]:
            - generic [ref=e141]:
              - generic "Research" [ref=e142]
              - generic [ref=e143]: Approved
      - button "Theme" [ref=e145] [cursor=pointer]
```

# Test source

```ts
  22  |     let data: unknown = []
  23  |     if (path === '/v1/sectors') data = [{ ...sector, state: options.state ?? sector.state }]
  24  |     else if (path === `/v1/sectors/${sector.id}`) data = { ...sector, state: options.state ?? sector.state }
  25  |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  26  |     else if (path.endsWith('/research-session')) data = research
  27  |     else if (path === '/v1/companies') data = { companies: [], total: 0 }
  28  |     else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [research, normal] : []
  29  |     else if (path.endsWith('/global-context')) data = { sectorId: sector.id, version: 1, sections, markdown: Object.entries(sections).map(([key, text]) => `## ${key === 'questions' ? 'Open questions' : key}\n\n${text}`).join('\n\n'), researchSessionId: research.id, changes: [] }
  30  |     else if (path.endsWith('/progress')) data = options.retained ? { ...progress, planVersion: 2, completed: 1, total: 1, items: [{ id: 'TEST v2 retained', kind: 'company', title: 'TEST retained Australian company', state: 'complete', attempts: 1, childId: null, evidence: ['https://company.example.test/'], sourceUrl: 'https://company.example.test/', detail: 'Source-backed basic intake passed. Retained from approved plan v1; scope and acceptance unchanged.' }] } : progress
  31  |     else if (path.endsWith('/plan')) data = options.retained ? { ...plan, versions: [plan.versions[0], { ...plan.versions[0], version: 2 }], latest: { ...plan.versions[0], version: 2 }, approvals: [1, 2], approvedVersion: 2 } : plan
  32  |     else if (path.endsWith('/files/test-file-0/body')) data = { filename: 'TEST Market research and industry landscape.md', mediaType: 'text/markdown', text: '# TEST retained source\n\nOriginal indexed evidence.', originalAvailable: true, contentBase64: Buffer.from('# TEST retained source\n\nOriginal indexed evidence.').toString('base64') }
  33  |     else if (path.endsWith('/files')) data = Array.from({ length: options.files ?? 3 }, (_, index) => ({ id: `test-file-${index}`, filename: index === 0 ? 'TEST Market research and industry landscape.md' : `TEST source-${index}.pdf`, status: index === 2 ? 'needs-ocr' : 'indexed', source: index === 1 ? 'Research agent' : 'Uploaded', hash: 'fixture-hash', hidden: false, included: index === 0, kind: 'document' }))
  34  |     else if (path.endsWith('/threads')) {
  35  |       const sessionId = path.includes(normal.id) ? normal.id : research.id
  36  |       data = [{ key: sessionId, sessionId, kind: 'session', status: options.paused ? 'PAUSED' : 'RUNNING', acceptingSteer: !options.paused, queueDepth: 0, updatedAt: stamp }, ...Array.from({ length: 6 }, (_, index) => ({ key: `agent:test-child-${index}`, name: ['Source review','Pricing analysis','Problem discovery','Market signals','Evidence check','Company review'][index], sessionId, kind: 'subagent', status: index < 2 ? 'RUNNING' : 'FINISHED', acceptingSteer: index < 2, queueDepth: 0, updatedAt: stamp }))]
  37  |     } else if (path.endsWith('/messages')) data = options.long ? [{ seq: 1, role: 'user', kind: 'text', text: 'What should we look for in this sector?', at: stamp }, { seq: 2, role: 'agent', kind: 'text', text: '## A focused research direction\n\nLook for companies with meaningful operational friction and capacity to invest.\n\n### Evidence to gather\n\n- Revenue and scale signals from reliable sources.\n- Repeated manual work across systems.\n- Cost or time impact, with explicit uncertainty.\n\n| Area | Signal | Next step |\n| --- | --- | --- |\n| Operations | Fragmented reporting | Verify the actual workflow |\n| Inventory | Manual reconciliation | Find a cost or time signal |\n\n> Keep the research broad. One symptom should not define the whole investigation.\n\nUse `company_id` only when working with tools; explain findings in plain language.', at: stamp }] : []
  38  |     else if (path.endsWith('/context')) data = { threadKey: path.split('/')[3], notes: 'Stay broad and keep sources.', summary: '', coveredSeq: 0, version: 1, ...(options.pending ? { pendingOperations: [{ operationId: 'TEST durable identity '.repeat(100), callId: 'TEST call', toolName: 'db.create_session', reason: 'The tool reply was lost; its committed effect remains unconfirmed.' }] } : {}) }
  39  |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [{ provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['low','high'] }] }] }
  40  |     else if (path.startsWith('/v1/sessions/')) data = path.includes(normal.id) ? normal : research
  41  |     const denied = options.denied && (path.endsWith('/files') || path.endsWith('/global-context'))
  42  |     await route.fulfill({ status: denied ? 403 : 200, contentType: 'application/json', body: JSON.stringify(denied ? { ok: false, error: { code: 'permission_denied', message: 'Fixture permission denial' } } : { ok: true, data }) })
  43  |   })
  44  | }
  45  | test('sector summary opens the shared plan/progress dialog and dedicated workspace', async ({ page }) => {
  46  |   await fixtures(page)
  47  |   await page.goto(`/?section=SectorDetail&sector=${sector.id}`)
  48  |   await expect(page.getByRole('region', { name: 'Research status' })).toBeVisible()
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
> 122 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                          ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  218 |     await expect(editor.getByRole('textbox', { name: 'Plan', exact: true })).toBeVisible()
  219 |     await expect(editor.getByRole('combobox', { name: 'Research depth' })).toHaveValue('discovery')
  220 |     const saveBox = await editor.getByRole('button', { name: 'Save plan' }).boundingBox()
  221 |     expect(saveBox).not.toBeNull()
  222 |     expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(960)
```