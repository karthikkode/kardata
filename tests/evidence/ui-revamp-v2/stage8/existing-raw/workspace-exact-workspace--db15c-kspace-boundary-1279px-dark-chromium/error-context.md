# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> exact workspace drawer boundaries >> workspace boundary 1279px dark
- Location: ../tests/frontend-e2e/workspace.spec.ts:63:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('complementary', { name: 'Sector sessions', includeHidden: true }).getByRole('button', { name: 'Use dark theme' })

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
        - button "Open files and global context" [ref=e50] [cursor=pointer]
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
                  - generic [ref=e80]: What should we look for in this sector?
                  - generic [ref=e82]:
                    - generic [ref=e83]:
                      - heading "A focused research direction" [level=2] [ref=e84]
                      - paragraph [ref=e85]: Look for companies with meaningful operational friction and capacity to invest.
                      - heading "Evidence to gather" [level=3] [ref=e86]
                      - list [ref=e87]:
                        - listitem [ref=e88]: Revenue and scale signals from reliable sources.
                        - listitem [ref=e89]: Repeated manual work across systems.
                        - listitem [ref=e90]: Cost or time impact, with explicit uncertainty.
                      - table [ref=e92]:
                        - rowgroup [ref=e93]:
                          - row [ref=e94]:
                            - columnheader "Area" [ref=e95]
                            - columnheader "Signal" [ref=e96]
                            - columnheader "Next step" [ref=e97]
                        - rowgroup [ref=e98]:
                          - row [ref=e99]:
                            - cell "Operations" [ref=e100]
                            - cell "Fragmented reporting" [ref=e101]
                            - cell "Verify the actual workflow" [ref=e102]
                          - row [ref=e103]:
                            - cell "Inventory" [ref=e104]
                            - cell "Manual reconciliation" [ref=e105]
                            - cell "Find a cost or time signal" [ref=e106]
                      - blockquote [ref=e107]:
                        - paragraph [ref=e108]: Keep the research broad. One symptom should not define the whole investigation.
                      - paragraph [ref=e109]:
                        - text: Use
                        - code [ref=e110]: company_id
                        - text: only when working with tools; explain findings in plain language.
                    - generic [ref=e111]:
                      - button "Copy" [ref=e112] [cursor=pointer]
                      - time [ref=e114]: 3d
                - status [ref=e115]:
                  - generic [ref=e119]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e120] [cursor=pointer]
            - generic [ref=e122]:
              - generic [ref=e123]: Message this conversation
              - generic [ref=e124]:
                - generic [ref=e125]:
                  - generic [ref=e126]: Message this conversation
                  - textbox "Message this conversation" [active] [ref=e127]:
                    - /placeholder: Ask about this research...
                  - generic [ref=e128]:
                    - generic [ref=e129]:
                      - button "Local context" [ref=e130] [cursor=pointer]
                      - button "Choose a model" [ref=e133] [cursor=pointer]:
                        - generic [ref=e134]: muse-spark-1.3-contributor
                        - generic [ref=e135]: high
                    - generic [ref=e136]:
                      - button "Send message" [disabled]
                - paragraph [ref=e137]:
                  - generic [ref=e138]: Enter
                  - generic [ref=e139]: to send,
                  - generic [ref=e140]: Shift
                  - generic [ref=e141]: +
                  - generic [ref=e142]: Enter
                  - generic [ref=e143]: for a new line
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test'
  2   | 
  3   | test.use({ video: 'on', trace: 'on' })
  4   | 
  5   | const stamp = '2026-09-30T00:00:00.000Z'
  6   | const sector = { id: 'test-sector', name: 'TEST Specialty foods', topic: 'Packaged foods', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
  7   | const research = { id: 'test-research', title: 'Research', kind: 'research', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
  8   | const normal = { id: 'test-chat', title: 'Product brainstorm', kind: 'normal', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
  9   | const sections = { scope: 'Research specialty food manufacturers in English-speaking markets.', decisions: 'Prioritize evidence of a costly operational problem. Keep uncertain claims explicit.', findings: 'Discovery has not started.', questions: 'Which regions offer the strongest evidence?' }
  10  | const executable = { researchDepth: 'discovery', discovery: [{ id: 'au', title: 'Australian discovery', queries: ['Australian SME manufacturers'], maxPages: 2 }], companyBrief: 'Verify company identity and sources.', budgets: { maxCompanies: 2000, maxWallMinutes: 60, concurrency: 2 }, acceptance: ['Distinct Australian companies with source evidence'] }
  11  | const plan = { sectorId: sector.id, versions: [{ version: 1, markdown: '## Scope\nFind specialty food companies.\n\n## Discovery\nSearch approved regions and verify company websites.\n\n## Company research\nInvestigate all worthy problems, with cited evidence.\n\n## Budgets\nTwo researchers at a time.\n\n## Acceptance\nEvery company has an evidence-backed verdict.', at: stamp, executable }], latest: null as unknown, approvals: [1], approvedVersion: 1 }
  12  | plan.latest = plan.versions[0]
  13  | const progress = { sectorId: sector.id, state: sector.state, planVersion: 1, plan, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  14  | 
  15  | async function fixtures(page: Page, options: { state?: string; denied?: boolean; files?: number; long?: boolean; saveError?: boolean; paused?: boolean; pending?: boolean; approvalConflict?: boolean; retained?: boolean } = {}) {
  16  |   await page.route('**/v1/**', async (route) => {
  17  |     const request = route.request(), url = new URL(request.url()), path = url.pathname
  18  |     if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return }
  19  |     if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' }); return }
  20  |     if (path.endsWith('/approve') && options.approvalConflict) { await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST global context changed. Review it before approving the plan.' } }) }); return }
  21  |     if (path.endsWith('/plan') && request.method() === 'PATCH' && options.saveError) { await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST plan save conflict. Review the latest version.' } }) }); return }
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
> 87  |         if (dark) await sessions.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                                  ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
```