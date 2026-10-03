# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> workspace visual 1440 dark
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
    - complementary "Sector resources" [ref=e144]:
      - generic [ref=e145]:
        - region "Sector files" [ref=e146]:
          - generic [ref=e147]:
            - heading "Files" [level=2] [ref=e148]
            - generic [ref=e149]: 30 files
            - button "Upload file" [ref=e150] [cursor=pointer]
            - button "Show hidden files" [ref=e151] [cursor=pointer]
          - textbox "Search files" [ref=e155]
          - list "Files" [ref=e157]:
            - listitem [ref=e158]:
              - generic [ref=e160]:
                - button "TEST Market research and industry landscape.md" [ref=e161] [cursor=pointer]:
                  - generic [ref=e166]:
                    - generic [ref=e167]: TEST Market research and industry landscape.md
                    - generic "MD · Uploaded · In global context" [ref=e169]
                - generic [ref=e170]:
                  - img "In global context" [ref=e171]
                  - button "Hide TEST Market research and industry landscape.md from agents" [ref=e175] [cursor=pointer]
            - listitem [ref=e176]:
              - generic [ref=e178]:
                - button "TEST source-1.pdf" [ref=e179] [cursor=pointer]:
                  - generic [ref=e184]:
                    - generic [ref=e185]: TEST source-1.pdf
                    - generic "PDF · Research agent" [ref=e187]
                - generic [ref=e188]:
                  - button "Add TEST source-1.pdf to global context" [ref=e189] [cursor=pointer]
                  - button "Hide TEST source-1.pdf from agents" [ref=e190] [cursor=pointer]
            - listitem [ref=e191]:
              - generic [ref=e193]:
                - button "TEST source-2.pdf" [ref=e194] [cursor=pointer]:
                  - generic [ref=e199]:
                    - generic [ref=e200]:
                      - generic [ref=e201]: TEST source-2.pdf
                      - generic [ref=e202]: Needs OCR
                    - generic "PDF · Uploaded" [ref=e203]
                - button "Hide TEST source-2.pdf from agents" [ref=e205] [cursor=pointer]
            - listitem [ref=e206]:
              - generic [ref=e208]:
                - button "TEST source-3.pdf" [ref=e209] [cursor=pointer]:
                  - generic [ref=e214]:
                    - generic [ref=e215]: TEST source-3.pdf
                    - generic "PDF · Uploaded" [ref=e217]
                - generic [ref=e218]:
                  - button "Add TEST source-3.pdf to global context" [ref=e219] [cursor=pointer]
                  - button "Hide TEST source-3.pdf from agents" [ref=e220] [cursor=pointer]
            - listitem [ref=e221]:
              - generic [ref=e223]:
                - button "TEST source-4.pdf" [ref=e224] [cursor=pointer]:
                  - generic [ref=e229]:
                    - generic [ref=e230]: TEST source-4.pdf
                    - generic "PDF · Uploaded" [ref=e232]
                - generic [ref=e233]:
                  - button "Add TEST source-4.pdf to global context" [ref=e234] [cursor=pointer]
                  - button "Hide TEST source-4.pdf from agents" [ref=e235] [cursor=pointer]
            - listitem [ref=e236]:
              - generic [ref=e238]:
                - button "TEST source-5.pdf" [ref=e239] [cursor=pointer]:
                  - generic [ref=e244]:
                    - generic [ref=e245]: TEST source-5.pdf
                    - generic "PDF · Uploaded" [ref=e247]
                - generic [ref=e248]:
                  - button "Add TEST source-5.pdf to global context" [ref=e249] [cursor=pointer]
                  - button "Hide TEST source-5.pdf from agents" [ref=e250] [cursor=pointer]
            - listitem [ref=e251]:
              - generic [ref=e253]:
                - button "TEST source-6.pdf" [ref=e254] [cursor=pointer]:
                  - generic [ref=e259]:
                    - generic [ref=e260]: TEST source-6.pdf
                    - generic "PDF · Uploaded" [ref=e262]
                - generic [ref=e263]:
                  - button "Add TEST source-6.pdf to global context" [ref=e264] [cursor=pointer]
                  - button "Hide TEST source-6.pdf from agents" [ref=e265] [cursor=pointer]
            - listitem [ref=e266]:
              - generic [ref=e268]:
                - button "TEST source-7.pdf" [ref=e269] [cursor=pointer]:
                  - generic [ref=e274]:
                    - generic [ref=e275]: TEST source-7.pdf
                    - generic "PDF · Uploaded" [ref=e277]
                - generic [ref=e278]:
                  - button "Add TEST source-7.pdf to global context" [ref=e279] [cursor=pointer]
                  - button "Hide TEST source-7.pdf from agents" [ref=e280] [cursor=pointer]
            - listitem [ref=e281]:
              - generic [ref=e283]:
                - button "TEST source-8.pdf" [ref=e284] [cursor=pointer]:
                  - generic [ref=e289]:
                    - generic [ref=e290]: TEST source-8.pdf
                    - generic "PDF · Uploaded" [ref=e292]
                - generic [ref=e293]:
                  - button "Add TEST source-8.pdf to global context" [ref=e294] [cursor=pointer]
                  - button "Hide TEST source-8.pdf from agents" [ref=e295] [cursor=pointer]
            - listitem [ref=e296]:
              - generic [ref=e298]:
                - button "TEST source-9.pdf" [ref=e299] [cursor=pointer]:
                  - generic [ref=e304]:
                    - generic [ref=e305]: TEST source-9.pdf
                    - generic "PDF · Uploaded" [ref=e307]
                - generic [ref=e308]:
                  - button "Add TEST source-9.pdf to global context" [ref=e309] [cursor=pointer]
                  - button "Hide TEST source-9.pdf from agents" [ref=e310] [cursor=pointer]
            - listitem [ref=e311]:
              - generic [ref=e313]:
                - button "TEST source-10.pdf" [ref=e314] [cursor=pointer]:
                  - generic [ref=e319]:
                    - generic [ref=e320]: TEST source-10.pdf
                    - generic "PDF · Uploaded" [ref=e322]
                - generic [ref=e323]:
                  - button "Add TEST source-10.pdf to global context" [ref=e324] [cursor=pointer]
                  - button "Hide TEST source-10.pdf from agents" [ref=e325] [cursor=pointer]
            - listitem [ref=e326]:
              - generic [ref=e328]:
                - button "TEST source-11.pdf" [ref=e329] [cursor=pointer]:
                  - generic [ref=e334]:
                    - generic [ref=e335]: TEST source-11.pdf
                    - generic "PDF · Uploaded" [ref=e337]
                - generic [ref=e338]:
                  - button "Add TEST source-11.pdf to global context" [ref=e339] [cursor=pointer]
                  - button "Hide TEST source-11.pdf from agents" [ref=e340] [cursor=pointer]
            - listitem [ref=e341]:
              - generic [ref=e343]:
                - button "TEST source-12.pdf" [ref=e344] [cursor=pointer]:
                  - generic [ref=e349]:
                    - generic [ref=e350]: TEST source-12.pdf
                    - generic "PDF · Uploaded" [ref=e352]
                - generic [ref=e353]:
                  - button "Add TEST source-12.pdf to global context" [ref=e354] [cursor=pointer]
                  - button "Hide TEST source-12.pdf from agents" [ref=e355] [cursor=pointer]
            - listitem [ref=e356]:
              - generic [ref=e358]:
                - button "TEST source-13.pdf" [ref=e359] [cursor=pointer]:
                  - generic [ref=e364]:
                    - generic [ref=e365]: TEST source-13.pdf
                    - generic "PDF · Uploaded" [ref=e367]
                - generic [ref=e368]:
                  - button "Add TEST source-13.pdf to global context" [ref=e369] [cursor=pointer]
                  - button "Hide TEST source-13.pdf from agents" [ref=e370] [cursor=pointer]
            - listitem [ref=e371]:
              - generic [ref=e373]:
                - button "TEST source-14.pdf" [ref=e374] [cursor=pointer]:
                  - generic [ref=e379]:
                    - generic [ref=e380]: TEST source-14.pdf
                    - generic "PDF · Uploaded" [ref=e382]
                - generic [ref=e383]:
                  - button "Add TEST source-14.pdf to global context" [ref=e384] [cursor=pointer]
                  - button "Hide TEST source-14.pdf from agents" [ref=e385] [cursor=pointer]
            - listitem [ref=e386]:
              - generic [ref=e388]:
                - button "TEST source-15.pdf" [ref=e389] [cursor=pointer]:
                  - generic [ref=e394]:
                    - generic [ref=e395]: TEST source-15.pdf
                    - generic "PDF · Uploaded" [ref=e397]
                - generic [ref=e398]:
                  - button "Add TEST source-15.pdf to global context" [ref=e399] [cursor=pointer]
                  - button "Hide TEST source-15.pdf from agents" [ref=e400] [cursor=pointer]
            - listitem [ref=e401]:
              - generic [ref=e403]:
                - button "TEST source-16.pdf" [ref=e404] [cursor=pointer]:
                  - generic [ref=e409]:
                    - generic [ref=e410]: TEST source-16.pdf
                    - generic "PDF · Uploaded" [ref=e412]
                - generic [ref=e413]:
                  - button "Add TEST source-16.pdf to global context" [ref=e414] [cursor=pointer]
                  - button "Hide TEST source-16.pdf from agents" [ref=e415] [cursor=pointer]
            - listitem [ref=e416]:
              - generic [ref=e418]:
                - button "TEST source-17.pdf" [ref=e419] [cursor=pointer]:
                  - generic [ref=e424]:
                    - generic [ref=e425]: TEST source-17.pdf
                    - generic "PDF · Uploaded" [ref=e427]
                - generic [ref=e428]:
                  - button "Add TEST source-17.pdf to global context" [ref=e429] [cursor=pointer]
                  - button "Hide TEST source-17.pdf from agents" [ref=e430] [cursor=pointer]
            - listitem [ref=e431]:
              - generic [ref=e433]:
                - button "TEST source-18.pdf" [ref=e434] [cursor=pointer]:
                  - generic [ref=e439]:
                    - generic [ref=e440]: TEST source-18.pdf
                    - generic "PDF · Uploaded" [ref=e442]
                - generic [ref=e443]:
                  - button "Add TEST source-18.pdf to global context" [ref=e444] [cursor=pointer]
                  - button "Hide TEST source-18.pdf from agents" [ref=e445] [cursor=pointer]
            - listitem [ref=e446]:
              - generic [ref=e448]:
                - button "TEST source-19.pdf" [ref=e449] [cursor=pointer]:
                  - generic [ref=e454]:
                    - generic [ref=e455]: TEST source-19.pdf
                    - generic "PDF · Uploaded" [ref=e457]
                - generic [ref=e458]:
                  - button "Add TEST source-19.pdf to global context" [ref=e459] [cursor=pointer]
                  - button "Hide TEST source-19.pdf from agents" [ref=e460] [cursor=pointer]
            - listitem [ref=e461]:
              - generic [ref=e463]:
                - button "TEST source-20.pdf" [ref=e464] [cursor=pointer]:
                  - generic [ref=e469]:
                    - generic [ref=e470]: TEST source-20.pdf
                    - generic "PDF · Uploaded" [ref=e472]
                - generic [ref=e473]:
                  - button "Add TEST source-20.pdf to global context" [ref=e474] [cursor=pointer]
                  - button "Hide TEST source-20.pdf from agents" [ref=e475] [cursor=pointer]
            - listitem [ref=e476]:
              - generic [ref=e478]:
                - button "TEST source-21.pdf" [ref=e479] [cursor=pointer]:
                  - generic [ref=e484]:
                    - generic [ref=e485]: TEST source-21.pdf
                    - generic "PDF · Uploaded" [ref=e487]
                - generic [ref=e488]:
                  - button "Add TEST source-21.pdf to global context" [ref=e489] [cursor=pointer]
                  - button "Hide TEST source-21.pdf from agents" [ref=e490] [cursor=pointer]
            - listitem [ref=e491]:
              - generic [ref=e493]:
                - button "TEST source-22.pdf" [ref=e494] [cursor=pointer]:
                  - generic [ref=e499]:
                    - generic [ref=e500]: TEST source-22.pdf
                    - generic "PDF · Uploaded" [ref=e502]
                - generic [ref=e503]:
                  - button "Add TEST source-22.pdf to global context" [ref=e504] [cursor=pointer]
                  - button "Hide TEST source-22.pdf from agents" [ref=e505] [cursor=pointer]
            - listitem [ref=e506]:
              - generic [ref=e508]:
                - button "TEST source-23.pdf" [ref=e509] [cursor=pointer]:
                  - generic [ref=e514]:
                    - generic [ref=e515]: TEST source-23.pdf
                    - generic "PDF · Uploaded" [ref=e517]
                - generic [ref=e518]:
                  - button "Add TEST source-23.pdf to global context" [ref=e519] [cursor=pointer]
                  - button "Hide TEST source-23.pdf from agents" [ref=e520] [cursor=pointer]
            - listitem [ref=e521]:
              - generic [ref=e523]:
                - button "TEST source-24.pdf" [ref=e524] [cursor=pointer]:
                  - generic [ref=e529]:
                    - generic [ref=e530]: TEST source-24.pdf
                    - generic "PDF · Uploaded" [ref=e532]
                - generic [ref=e533]:
                  - button "Add TEST source-24.pdf to global context" [ref=e534] [cursor=pointer]
                  - button "Hide TEST source-24.pdf from agents" [ref=e535] [cursor=pointer]
            - listitem [ref=e536]:
              - generic [ref=e538]:
                - button "TEST source-25.pdf" [ref=e539] [cursor=pointer]:
                  - generic [ref=e544]:
                    - generic [ref=e545]: TEST source-25.pdf
                    - generic "PDF · Uploaded" [ref=e547]
                - generic [ref=e548]:
                  - button "Add TEST source-25.pdf to global context" [ref=e549] [cursor=pointer]
                  - button "Hide TEST source-25.pdf from agents" [ref=e550] [cursor=pointer]
            - listitem [ref=e551]:
              - generic [ref=e553]:
                - button "TEST source-26.pdf" [ref=e554] [cursor=pointer]:
                  - generic [ref=e559]:
                    - generic [ref=e560]: TEST source-26.pdf
                    - generic "PDF · Uploaded" [ref=e562]
                - generic [ref=e563]:
                  - button "Add TEST source-26.pdf to global context" [ref=e564] [cursor=pointer]
                  - button "Hide TEST source-26.pdf from agents" [ref=e565] [cursor=pointer]
            - listitem [ref=e566]:
              - generic [ref=e568]:
                - button "TEST source-27.pdf" [ref=e569] [cursor=pointer]:
                  - generic [ref=e574]:
                    - generic [ref=e575]: TEST source-27.pdf
                    - generic "PDF · Uploaded" [ref=e577]
                - generic [ref=e578]:
                  - button "Add TEST source-27.pdf to global context" [ref=e579] [cursor=pointer]
                  - button "Hide TEST source-27.pdf from agents" [ref=e580] [cursor=pointer]
            - listitem [ref=e581]:
              - generic [ref=e583]:
                - button "TEST source-28.pdf" [ref=e584] [cursor=pointer]:
                  - generic [ref=e589]:
                    - generic [ref=e590]: TEST source-28.pdf
                    - generic "PDF · Uploaded" [ref=e592]
                - generic [ref=e593]:
                  - button "Add TEST source-28.pdf to global context" [ref=e594] [cursor=pointer]
                  - button "Hide TEST source-28.pdf from agents" [ref=e595] [cursor=pointer]
            - listitem [ref=e596]:
              - generic [ref=e598]:
                - button "TEST source-29.pdf" [ref=e599] [cursor=pointer]:
                  - generic [ref=e604]:
                    - generic [ref=e605]: TEST source-29.pdf
                    - generic "PDF · Uploaded" [ref=e607]
                - generic [ref=e608]:
                  - button "Add TEST source-29.pdf to global context" [ref=e609] [cursor=pointer]
                  - button "Hide TEST source-29.pdf from agents" [ref=e610] [cursor=pointer]
          - paragraph [ref=e612]: Showing 30 of 30 files
        - region "Global context" [ref=e613]:
          - generic [ref=e614]:
            - heading "Global context" [level=2] [ref=e615]
            - generic [ref=e616]: v1
            - button "Context history" [ref=e617] [cursor=pointer]
            - button "Edit global context" [ref=e618] [cursor=pointer]
          - generic [ref=e620]:
            - generic [ref=e621]:
              - paragraph [ref=e622]: Scope
              - paragraph [ref=e625]: Research specialty food manufacturers in English-speaking markets.
            - generic [ref=e626]:
              - paragraph [ref=e627]: Decisions
              - paragraph [ref=e630]: Prioritize evidence of a costly operational problem. Keep uncertain claims explicit.
            - generic [ref=e631]:
              - paragraph [ref=e632]: Findings
              - paragraph [ref=e635]: Discovery has not started.
            - generic [ref=e636]:
              - paragraph [ref=e637]: Open questions
              - paragraph [ref=e640]: Which regions offer the strongest evidence?
  - region "Notifications alt+T"
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