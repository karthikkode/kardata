# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: files-scale.spec.ts >> files scale: 2005 mixed records, 1440px dark, reduced motion
- Location: ../tests/frontend-e2e/files-scale.spec.ts:89:3

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
            - generic "TEST Files scale" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: Approved
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
                - generic [ref=e38]: Approved
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Research" [level=1] [ref=e44]
          - generic [ref=e45]:
            - generic [ref=e46]: Approved
            - generic [ref=e48]: No plan yet
        - button "Start research" [ref=e49] [cursor=pointer]
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
            - generic [ref=e104]: 2,004 files
            - button "Upload file" [ref=e105] [cursor=pointer]
            - button "Show hidden files" [ref=e106] [cursor=pointer]
          - textbox "Search files" [ref=e110]
          - list "Files" [ref=e112]:
            - listitem [ref=e113]:
              - generic [ref=e115]:
                - button "TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md" [ref=e116] [cursor=pointer]:
                  - generic [ref=e121]:
                    - generic [ref=e122]: TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md
                    - generic "MD · Research agent" [ref=e124]
                - generic [ref=e125]:
                  - button "Add TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md to global context" [ref=e126] [cursor=pointer]
                  - button "Hide TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md from agents" [ref=e127] [cursor=pointer]
            - listitem [ref=e128]:
              - generic [ref=e130]:
                - button "TEST Uploaded file 0001.md" [ref=e131] [cursor=pointer]:
                  - generic [ref=e136]:
                    - generic [ref=e137]:
                      - generic [ref=e138]: TEST Uploaded file 0001.md
                      - generic [ref=e139]: Processing
                    - generic "MD · Uploaded" [ref=e140]
                - button "Hide TEST Uploaded file 0001.md from agents" [ref=e142] [cursor=pointer]
            - listitem [ref=e143]:
              - generic [ref=e145]:
                - button "TEST Generated file 0002.md" [ref=e146] [cursor=pointer]:
                  - generic [ref=e151]:
                    - generic [ref=e152]:
                      - generic [ref=e153]: TEST Generated file 0002.md
                      - generic [ref=e154]: Failed
                    - generic "MD · Research agent" [ref=e155]
                - button "Hide TEST Generated file 0002.md from agents" [ref=e157] [cursor=pointer]
            - listitem [ref=e158]:
              - generic [ref=e160]:
                - button "TEST Uploaded file 0003.md" [ref=e161] [cursor=pointer]:
                  - generic [ref=e166]:
                    - generic [ref=e167]:
                      - generic [ref=e168]: TEST Uploaded file 0003.md
                      - generic [ref=e169]: Needs OCR
                    - generic "MD · Uploaded" [ref=e170]
                - button "Hide TEST Uploaded file 0003.md from agents" [ref=e172] [cursor=pointer]
            - listitem [ref=e173]:
              - generic [ref=e175]:
                - button "TEST Uploaded file 0005.md" [ref=e176] [cursor=pointer]:
                  - generic [ref=e181]:
                    - generic [ref=e182]: TEST Uploaded file 0005.md
                    - generic "MD · Uploaded" [ref=e184]
                - generic [ref=e185]:
                  - button "Add TEST Uploaded file 0005.md to global context" [ref=e186] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0005.md from agents" [ref=e187] [cursor=pointer]
            - listitem [ref=e188]:
              - generic [ref=e190]:
                - button "TEST Generated file 0006.md" [ref=e191] [cursor=pointer]:
                  - generic [ref=e196]:
                    - generic [ref=e197]: TEST Generated file 0006.md
                    - generic "MD · Research agent" [ref=e199]
                - generic [ref=e200]:
                  - button "Add TEST Generated file 0006.md to global context" [ref=e201] [cursor=pointer]
                  - button "Hide TEST Generated file 0006.md from agents" [ref=e202] [cursor=pointer]
            - listitem [ref=e203]:
              - generic [ref=e205]:
                - button "TEST Uploaded file 0007.md" [ref=e206] [cursor=pointer]:
                  - generic [ref=e211]:
                    - generic [ref=e212]: TEST Uploaded file 0007.md
                    - generic "MD · Uploaded" [ref=e214]
                - generic [ref=e215]:
                  - button "Add TEST Uploaded file 0007.md to global context" [ref=e216] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0007.md from agents" [ref=e217] [cursor=pointer]
            - listitem [ref=e218]:
              - generic [ref=e220]:
                - button "TEST Generated file 0008.md" [ref=e221] [cursor=pointer]:
                  - generic [ref=e226]:
                    - generic [ref=e227]: TEST Generated file 0008.md
                    - generic "MD · Research agent" [ref=e229]
                - generic [ref=e230]:
                  - button "Add TEST Generated file 0008.md to global context" [ref=e231] [cursor=pointer]
                  - button "Hide TEST Generated file 0008.md from agents" [ref=e232] [cursor=pointer]
            - listitem [ref=e233]:
              - generic [ref=e235]:
                - button "TEST Uploaded file 0009.md" [ref=e236] [cursor=pointer]:
                  - generic [ref=e241]:
                    - generic [ref=e242]: TEST Uploaded file 0009.md
                    - generic "MD · Uploaded" [ref=e244]
                - generic [ref=e245]:
                  - button "Add TEST Uploaded file 0009.md to global context" [ref=e246] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0009.md from agents" [ref=e247] [cursor=pointer]
            - listitem [ref=e248]:
              - generic [ref=e250]:
                - button "TEST Generated file 0010.md" [ref=e251] [cursor=pointer]:
                  - generic [ref=e256]:
                    - generic [ref=e257]: TEST Generated file 0010.md
                    - generic "MD · Research agent" [ref=e259]
                - generic [ref=e260]:
                  - button "Add TEST Generated file 0010.md to global context" [ref=e261] [cursor=pointer]
                  - button "Hide TEST Generated file 0010.md from agents" [ref=e262] [cursor=pointer]
            - listitem [ref=e263]:
              - generic [ref=e265]:
                - button "TEST Uploaded file 0011.md" [ref=e266] [cursor=pointer]:
                  - generic [ref=e271]:
                    - generic [ref=e272]: TEST Uploaded file 0011.md
                    - generic "MD · Uploaded" [ref=e274]
                - generic [ref=e275]:
                  - button "Add TEST Uploaded file 0011.md to global context" [ref=e276] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0011.md from agents" [ref=e277] [cursor=pointer]
            - listitem [ref=e278]:
              - generic [ref=e280]:
                - button "TEST Generated file 0012.md" [ref=e281] [cursor=pointer]:
                  - generic [ref=e286]:
                    - generic [ref=e287]: TEST Generated file 0012.md
                    - generic "MD · Research agent" [ref=e289]
                - generic [ref=e290]:
                  - button "Add TEST Generated file 0012.md to global context" [ref=e291] [cursor=pointer]
                  - button "Hide TEST Generated file 0012.md from agents" [ref=e292] [cursor=pointer]
            - listitem [ref=e293]:
              - generic [ref=e295]:
                - button "TEST Uploaded file 0013.md" [ref=e296] [cursor=pointer]:
                  - generic [ref=e301]:
                    - generic [ref=e302]: TEST Uploaded file 0013.md
                    - generic "MD · Uploaded" [ref=e304]
                - generic [ref=e305]:
                  - button "Add TEST Uploaded file 0013.md to global context" [ref=e306] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0013.md from agents" [ref=e307] [cursor=pointer]
            - listitem [ref=e308]:
              - generic [ref=e310]:
                - button "TEST Generated file 0014.md" [ref=e311] [cursor=pointer]:
                  - generic [ref=e316]:
                    - generic [ref=e317]: TEST Generated file 0014.md
                    - generic "MD · Research agent" [ref=e319]
                - generic [ref=e320]:
                  - button "Add TEST Generated file 0014.md to global context" [ref=e321] [cursor=pointer]
                  - button "Hide TEST Generated file 0014.md from agents" [ref=e322] [cursor=pointer]
            - listitem [ref=e323]:
              - generic [ref=e325]:
                - button "TEST Uploaded file 0015.md" [ref=e326] [cursor=pointer]:
                  - generic [ref=e331]:
                    - generic [ref=e332]: TEST Uploaded file 0015.md
                    - generic "MD · Uploaded" [ref=e334]
                - generic [ref=e335]:
                  - button "Add TEST Uploaded file 0015.md to global context" [ref=e336] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0015.md from agents" [ref=e337] [cursor=pointer]
            - listitem [ref=e338]:
              - generic [ref=e340]:
                - button "TEST Generated file 0016.md" [ref=e341] [cursor=pointer]:
                  - generic [ref=e346]:
                    - generic [ref=e347]: TEST Generated file 0016.md
                    - generic "MD · Research agent" [ref=e349]
                - generic [ref=e350]:
                  - button "Add TEST Generated file 0016.md to global context" [ref=e351] [cursor=pointer]
                  - button "Hide TEST Generated file 0016.md from agents" [ref=e352] [cursor=pointer]
            - listitem [ref=e353]:
              - generic [ref=e355]:
                - button "TEST Uploaded file 0017.md" [ref=e356] [cursor=pointer]:
                  - generic [ref=e361]:
                    - generic [ref=e362]: TEST Uploaded file 0017.md
                    - generic "MD · Uploaded" [ref=e364]
                - generic [ref=e365]:
                  - button "Add TEST Uploaded file 0017.md to global context" [ref=e366] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0017.md from agents" [ref=e367] [cursor=pointer]
            - listitem [ref=e368]:
              - generic [ref=e370]:
                - button "TEST Generated file 0018.md" [ref=e371] [cursor=pointer]:
                  - generic [ref=e376]:
                    - generic [ref=e377]: TEST Generated file 0018.md
                    - generic "MD · Research agent" [ref=e379]
                - generic [ref=e380]:
                  - button "Add TEST Generated file 0018.md to global context" [ref=e381] [cursor=pointer]
                  - button "Hide TEST Generated file 0018.md from agents" [ref=e382] [cursor=pointer]
            - listitem [ref=e383]:
              - generic [ref=e385]:
                - button "TEST Uploaded file 0019.md" [ref=e386] [cursor=pointer]:
                  - generic [ref=e391]:
                    - generic [ref=e392]: TEST Uploaded file 0019.md
                    - generic "MD · Uploaded" [ref=e394]
                - generic [ref=e395]:
                  - button "Add TEST Uploaded file 0019.md to global context" [ref=e396] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0019.md from agents" [ref=e397] [cursor=pointer]
            - listitem [ref=e398]:
              - generic [ref=e400]:
                - button "TEST Generated file 0020.md" [ref=e401] [cursor=pointer]:
                  - generic [ref=e406]:
                    - generic [ref=e407]: TEST Generated file 0020.md
                    - generic "MD · Research agent" [ref=e409]
                - generic [ref=e410]:
                  - button "Add TEST Generated file 0020.md to global context" [ref=e411] [cursor=pointer]
                  - button "Hide TEST Generated file 0020.md from agents" [ref=e412] [cursor=pointer]
            - listitem [ref=e413]:
              - generic [ref=e415]:
                - button "TEST Uploaded file 0021.md" [ref=e416] [cursor=pointer]:
                  - generic [ref=e421]:
                    - generic [ref=e422]: TEST Uploaded file 0021.md
                    - generic "MD · Uploaded" [ref=e424]
                - generic [ref=e425]:
                  - button "Add TEST Uploaded file 0021.md to global context" [ref=e426] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0021.md from agents" [ref=e427] [cursor=pointer]
            - listitem [ref=e428]:
              - generic [ref=e430]:
                - button "TEST Generated file 0022.md" [ref=e431] [cursor=pointer]:
                  - generic [ref=e436]:
                    - generic [ref=e437]: TEST Generated file 0022.md
                    - generic "MD · Research agent" [ref=e439]
                - generic [ref=e440]:
                  - button "Add TEST Generated file 0022.md to global context" [ref=e441] [cursor=pointer]
                  - button "Hide TEST Generated file 0022.md from agents" [ref=e442] [cursor=pointer]
            - listitem [ref=e443]:
              - generic [ref=e445]:
                - button "TEST Uploaded file 0023.md" [ref=e446] [cursor=pointer]:
                  - generic [ref=e451]:
                    - generic [ref=e452]: TEST Uploaded file 0023.md
                    - generic "MD · Uploaded" [ref=e454]
                - generic [ref=e455]:
                  - button "Add TEST Uploaded file 0023.md to global context" [ref=e456] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0023.md from agents" [ref=e457] [cursor=pointer]
            - listitem [ref=e458]:
              - generic [ref=e460]:
                - button "TEST Generated file 0024.md" [ref=e461] [cursor=pointer]:
                  - generic [ref=e466]:
                    - generic [ref=e467]: TEST Generated file 0024.md
                    - generic "MD · Research agent" [ref=e469]
                - generic [ref=e470]:
                  - button "Add TEST Generated file 0024.md to global context" [ref=e471] [cursor=pointer]
                  - button "Hide TEST Generated file 0024.md from agents" [ref=e472] [cursor=pointer]
            - listitem [ref=e473]:
              - generic [ref=e475]:
                - button "TEST Uploaded file 0025.md" [ref=e476] [cursor=pointer]:
                  - generic [ref=e481]:
                    - generic [ref=e482]: TEST Uploaded file 0025.md
                    - generic "MD · Uploaded" [ref=e484]
                - generic [ref=e485]:
                  - button "Add TEST Uploaded file 0025.md to global context" [ref=e486] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0025.md from agents" [ref=e487] [cursor=pointer]
            - listitem [ref=e488]:
              - generic [ref=e490]:
                - button "TEST Generated file 0026.md" [ref=e491] [cursor=pointer]:
                  - generic [ref=e496]:
                    - generic [ref=e497]: TEST Generated file 0026.md
                    - generic "MD · Research agent" [ref=e499]
                - generic [ref=e500]:
                  - button "Add TEST Generated file 0026.md to global context" [ref=e501] [cursor=pointer]
                  - button "Hide TEST Generated file 0026.md from agents" [ref=e502] [cursor=pointer]
            - listitem [ref=e503]:
              - generic [ref=e505]:
                - button "TEST Uploaded file 0027.md" [ref=e506] [cursor=pointer]:
                  - generic [ref=e511]:
                    - generic [ref=e512]: TEST Uploaded file 0027.md
                    - generic "MD · Uploaded" [ref=e514]
                - generic [ref=e515]:
                  - button "Add TEST Uploaded file 0027.md to global context" [ref=e516] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0027.md from agents" [ref=e517] [cursor=pointer]
            - listitem [ref=e518]:
              - generic [ref=e520]:
                - button "TEST Generated file 0028.md" [ref=e521] [cursor=pointer]:
                  - generic [ref=e526]:
                    - generic [ref=e527]: TEST Generated file 0028.md
                    - generic "MD · Research agent" [ref=e529]
                - generic [ref=e530]:
                  - button "Add TEST Generated file 0028.md to global context" [ref=e531] [cursor=pointer]
                  - button "Hide TEST Generated file 0028.md from agents" [ref=e532] [cursor=pointer]
            - listitem [ref=e533]:
              - generic [ref=e535]:
                - button "TEST Uploaded file 0029.md" [ref=e536] [cursor=pointer]:
                  - generic [ref=e541]:
                    - generic [ref=e542]: TEST Uploaded file 0029.md
                    - generic "MD · Uploaded" [ref=e544]
                - generic [ref=e545]:
                  - button "Add TEST Uploaded file 0029.md to global context" [ref=e546] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0029.md from agents" [ref=e547] [cursor=pointer]
            - listitem [ref=e548]:
              - generic [ref=e550]:
                - button "TEST Generated file 0030.md" [ref=e551] [cursor=pointer]:
                  - generic [ref=e556]:
                    - generic [ref=e557]: TEST Generated file 0030.md
                    - generic "MD · Research agent" [ref=e559]
                - generic [ref=e560]:
                  - button "Add TEST Generated file 0030.md to global context" [ref=e561] [cursor=pointer]
                  - button "Hide TEST Generated file 0030.md from agents" [ref=e562] [cursor=pointer]
            - listitem [ref=e563]:
              - generic [ref=e565]:
                - button "TEST Uploaded file 0031.md" [ref=e566] [cursor=pointer]:
                  - generic [ref=e571]:
                    - generic [ref=e572]: TEST Uploaded file 0031.md
                    - generic "MD · Uploaded" [ref=e574]
                - generic [ref=e575]:
                  - button "Add TEST Uploaded file 0031.md to global context" [ref=e576] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0031.md from agents" [ref=e577] [cursor=pointer]
            - listitem [ref=e578]:
              - generic [ref=e580]:
                - button "TEST Generated file 0032.md" [ref=e581] [cursor=pointer]:
                  - generic [ref=e586]:
                    - generic [ref=e587]: TEST Generated file 0032.md
                    - generic "MD · Research agent" [ref=e589]
                - generic [ref=e590]:
                  - button "Add TEST Generated file 0032.md to global context" [ref=e591] [cursor=pointer]
                  - button "Hide TEST Generated file 0032.md from agents" [ref=e592] [cursor=pointer]
            - listitem [ref=e593]:
              - generic [ref=e595]:
                - button "TEST Uploaded file 0033.md" [ref=e596] [cursor=pointer]:
                  - generic [ref=e601]:
                    - generic [ref=e602]: TEST Uploaded file 0033.md
                    - generic "MD · Uploaded" [ref=e604]
                - generic [ref=e605]:
                  - button "Add TEST Uploaded file 0033.md to global context" [ref=e606] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0033.md from agents" [ref=e607] [cursor=pointer]
            - listitem [ref=e608]:
              - generic [ref=e610]:
                - button "TEST Generated file 0034.md" [ref=e611] [cursor=pointer]:
                  - generic [ref=e616]:
                    - generic [ref=e617]: TEST Generated file 0034.md
                    - generic "MD · Research agent" [ref=e619]
                - generic [ref=e620]:
                  - button "Add TEST Generated file 0034.md to global context" [ref=e621] [cursor=pointer]
                  - button "Hide TEST Generated file 0034.md from agents" [ref=e622] [cursor=pointer]
            - listitem [ref=e623]:
              - generic [ref=e625]:
                - button "TEST Uploaded file 0035.md" [ref=e626] [cursor=pointer]:
                  - generic [ref=e631]:
                    - generic [ref=e632]: TEST Uploaded file 0035.md
                    - generic "MD · Uploaded" [ref=e634]
                - generic [ref=e635]:
                  - button "Add TEST Uploaded file 0035.md to global context" [ref=e636] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0035.md from agents" [ref=e637] [cursor=pointer]
            - listitem [ref=e638]:
              - generic [ref=e640]:
                - button "TEST Generated file 0036.md" [ref=e641] [cursor=pointer]:
                  - generic [ref=e646]:
                    - generic [ref=e647]: TEST Generated file 0036.md
                    - generic "MD · Research agent" [ref=e649]
                - generic [ref=e650]:
                  - button "Add TEST Generated file 0036.md to global context" [ref=e651] [cursor=pointer]
                  - button "Hide TEST Generated file 0036.md from agents" [ref=e652] [cursor=pointer]
            - listitem [ref=e653]:
              - generic [ref=e655]:
                - button "TEST Uploaded file 0037.md" [ref=e656] [cursor=pointer]:
                  - generic [ref=e661]:
                    - generic [ref=e662]: TEST Uploaded file 0037.md
                    - generic "MD · Uploaded" [ref=e664]
                - generic [ref=e665]:
                  - button "Add TEST Uploaded file 0037.md to global context" [ref=e666] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0037.md from agents" [ref=e667] [cursor=pointer]
            - listitem [ref=e668]:
              - generic [ref=e670]:
                - button "TEST Generated file 0038.md" [ref=e671] [cursor=pointer]:
                  - generic [ref=e676]:
                    - generic [ref=e677]: TEST Generated file 0038.md
                    - generic "MD · Research agent" [ref=e679]
                - generic [ref=e680]:
                  - button "Add TEST Generated file 0038.md to global context" [ref=e681] [cursor=pointer]
                  - button "Hide TEST Generated file 0038.md from agents" [ref=e682] [cursor=pointer]
            - listitem [ref=e683]:
              - generic [ref=e685]:
                - button "TEST Uploaded file 0039.md" [ref=e686] [cursor=pointer]:
                  - generic [ref=e691]:
                    - generic [ref=e692]: TEST Uploaded file 0039.md
                    - generic "MD · Uploaded" [ref=e694]
                - generic [ref=e695]:
                  - button "Add TEST Uploaded file 0039.md to global context" [ref=e696] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0039.md from agents" [ref=e697] [cursor=pointer]
            - listitem [ref=e698]:
              - generic [ref=e700]:
                - button "TEST Generated file 0040.md" [ref=e701] [cursor=pointer]:
                  - generic [ref=e706]:
                    - generic [ref=e707]: TEST Generated file 0040.md
                    - generic "MD · Research agent" [ref=e709]
                - generic [ref=e710]:
                  - button "Add TEST Generated file 0040.md to global context" [ref=e711] [cursor=pointer]
                  - button "Hide TEST Generated file 0040.md from agents" [ref=e712] [cursor=pointer]
            - listitem [ref=e713]:
              - generic [ref=e715]:
                - button "TEST Uploaded file 0041.md" [ref=e716] [cursor=pointer]:
                  - generic [ref=e721]:
                    - generic [ref=e722]: TEST Uploaded file 0041.md
                    - generic "MD · Uploaded" [ref=e724]
                - generic [ref=e725]:
                  - button "Add TEST Uploaded file 0041.md to global context" [ref=e726] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0041.md from agents" [ref=e727] [cursor=pointer]
            - listitem [ref=e728]:
              - generic [ref=e730]:
                - button "TEST Generated file 0042.md" [ref=e731] [cursor=pointer]:
                  - generic [ref=e736]:
                    - generic [ref=e737]: TEST Generated file 0042.md
                    - generic "MD · Research agent" [ref=e739]
                - generic [ref=e740]:
                  - button "Add TEST Generated file 0042.md to global context" [ref=e741] [cursor=pointer]
                  - button "Hide TEST Generated file 0042.md from agents" [ref=e742] [cursor=pointer]
            - listitem [ref=e743]:
              - generic [ref=e745]:
                - button "TEST Uploaded file 0043.md" [ref=e746] [cursor=pointer]:
                  - generic [ref=e751]:
                    - generic [ref=e752]: TEST Uploaded file 0043.md
                    - generic "MD · Uploaded" [ref=e754]
                - generic [ref=e755]:
                  - button "Add TEST Uploaded file 0043.md to global context" [ref=e756] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0043.md from agents" [ref=e757] [cursor=pointer]
            - listitem [ref=e758]:
              - generic [ref=e760]:
                - button "TEST Generated file 0044.md" [ref=e761] [cursor=pointer]:
                  - generic [ref=e766]:
                    - generic [ref=e767]: TEST Generated file 0044.md
                    - generic "MD · Research agent" [ref=e769]
                - generic [ref=e770]:
                  - button "Add TEST Generated file 0044.md to global context" [ref=e771] [cursor=pointer]
                  - button "Hide TEST Generated file 0044.md from agents" [ref=e772] [cursor=pointer]
            - listitem [ref=e773]:
              - generic [ref=e775]:
                - button "TEST Uploaded file 0045.md" [ref=e776] [cursor=pointer]:
                  - generic [ref=e781]:
                    - generic [ref=e782]: TEST Uploaded file 0045.md
                    - generic "MD · Uploaded" [ref=e784]
                - generic [ref=e785]:
                  - button "Add TEST Uploaded file 0045.md to global context" [ref=e786] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0045.md from agents" [ref=e787] [cursor=pointer]
            - listitem [ref=e788]:
              - generic [ref=e790]:
                - button "TEST Generated file 0046.md" [ref=e791] [cursor=pointer]:
                  - generic [ref=e796]:
                    - generic [ref=e797]: TEST Generated file 0046.md
                    - generic "MD · Research agent" [ref=e799]
                - generic [ref=e800]:
                  - button "Add TEST Generated file 0046.md to global context" [ref=e801] [cursor=pointer]
                  - button "Hide TEST Generated file 0046.md from agents" [ref=e802] [cursor=pointer]
            - listitem [ref=e803]:
              - generic [ref=e805]:
                - button "TEST Uploaded file 0047.md" [ref=e806] [cursor=pointer]:
                  - generic [ref=e811]:
                    - generic [ref=e812]: TEST Uploaded file 0047.md
                    - generic "MD · Uploaded" [ref=e814]
                - generic [ref=e815]:
                  - button "Add TEST Uploaded file 0047.md to global context" [ref=e816] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0047.md from agents" [ref=e817] [cursor=pointer]
            - listitem [ref=e818]:
              - generic [ref=e820]:
                - button "TEST Generated file 0048.md" [ref=e821] [cursor=pointer]:
                  - generic [ref=e826]:
                    - generic [ref=e827]: TEST Generated file 0048.md
                    - generic "MD · Research agent" [ref=e829]
                - generic [ref=e830]:
                  - button "Add TEST Generated file 0048.md to global context" [ref=e831] [cursor=pointer]
                  - button "Hide TEST Generated file 0048.md from agents" [ref=e832] [cursor=pointer]
            - listitem [ref=e833]:
              - generic [ref=e835]:
                - button "TEST Uploaded file 0049.md" [ref=e836] [cursor=pointer]:
                  - generic [ref=e841]:
                    - generic [ref=e842]: TEST Uploaded file 0049.md
                    - generic "MD · Uploaded" [ref=e844]
                - generic [ref=e845]:
                  - button "Add TEST Uploaded file 0049.md to global context" [ref=e846] [cursor=pointer]
                  - button "Hide TEST Uploaded file 0049.md from agents" [ref=e847] [cursor=pointer]
            - listitem [ref=e848]:
              - generic [ref=e850]:
                - button "TEST Generated file 0050.md" [ref=e851] [cursor=pointer]:
                  - generic [ref=e856]:
                    - generic [ref=e857]: TEST Generated file 0050.md
                    - generic "MD · Research agent" [ref=e859]
                - generic [ref=e860]:
                  - button "Add TEST Generated file 0050.md to global context" [ref=e861] [cursor=pointer]
                  - button "Hide TEST Generated file 0050.md from agents" [ref=e862] [cursor=pointer]
          - generic [ref=e863]:
            - paragraph [ref=e864]: Showing 50 of 2,004 files
            - button "Show more" [ref=e865] [cursor=pointer]
        - region "Global context" [ref=e866]:
          - generic [ref=e867]:
            - heading "Global context" [level=2] [ref=e868]
            - generic [ref=e869]: v1
            - button "Context history" [ref=e870] [cursor=pointer]
            - button "Edit global context" [ref=e871] [cursor=pointer]
          - generic [ref=e873]:
            - generic [ref=e874]:
              - paragraph [ref=e875]: Scope
              - paragraph [ref=e878]: TEST synthetic library scope
            - generic [ref=e879]:
              - paragraph [ref=e880]: Decisions
              - paragraph [ref=e881]: Not set yet
            - generic [ref=e882]:
              - paragraph [ref=e883]: Findings
              - paragraph [ref=e884]: Not set yet
            - generic [ref=e885]:
              - paragraph [ref=e886]: Open questions
              - paragraph [ref=e887]: Not set yet
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | // Maintained browser proof over explicitly synthetic HTTP responses. This tests
  2   | // the production Files panel, not a live file server, DB, provider or agent.
  3   | import { expect, test, type Page } from '@playwright/test'
  4   | import { createHash } from 'node:crypto'
  5   | import { readFileSync, writeFileSync } from 'node:fs'
  6   | import { dirname, resolve } from 'node:path'
  7   | import { fileURLToPath } from 'node:url'
  8   | test.use({ video: 'on', trace: 'on' })
  9   | test.afterEach(async ({ page }, testInfo) => {
  10  |   const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  11  |   const sources = ['frontend/src/components/workspace-parts.tsx', 'frontend/src/components/SectorWorkspace.tsx', 'tests/frontend-e2e/files-scale.spec.ts']
  12  |   const evidencePath = testInfo.outputPath('source-evidence.json')
  13  |   writeFileSync(evidencePath, JSON.stringify({ proof: 'synthetic HTTP fixture; no live DB, file server, provider or Temporal', records: 2005, viewport: page.viewportSize(), node: process.version, at: new Date().toISOString(), sourceHashes: Object.fromEntries(sources.map((path) => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])) }, null, 2))
  14  |   await testInfo.attach('files-scale-source-evidence', { contentType: 'application/json', path: evidencePath })
  15  | })
  16  | 
  17  | const at = '2026-10-01T00:00:00.000Z'
  18  | const sectorId = 'TEST-files-scale-sector'
  19  | const sessionId = 'TEST-files-scale-research'
  20  | const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
  21  | const sector = { id: sectorId, name: 'TEST Files scale', topic: 'TEST synthetic library', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
  22  | const sections = { scope: 'TEST synthetic library scope', decisions: '', findings: '', questions: '' }
  23  | const longName = `TEST Generated ${'unbroken-filename-'.repeat(12)}.md`
  24  | const library = () => Array.from({ length: 2005 }, (_, index) => ({
  25  |   id: `TEST-scale-file-${index}`,
  26  |   filename: index === 0 ? longName : `TEST ${index % 2 ? 'Uploaded' : 'Generated'} file ${String(index).padStart(4, '0')}.md`,
  27  |   status: ['indexed', 'processing', 'failed', 'needs-ocr'][index < 4 ? index : 0],
  28  |   source: index % 2 ? 'Uploaded' : 'Research agent',
  29  |   hash: `TEST-version-${index}`, hidden: index === 4, included: false,
  30  |   kind: index % 2 ? 'document' : 'artifact',
  31  | }))
  32  | type FileState = 'ready' | 'loading' | 'empty' | 'error' | 'denied' | 'offline'
  33  | 
  34  | async function fixture(page: Page, initial: FileState = 'ready') {
  35  |   if (initial === 'offline') await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }))
  36  |   const files = library()
  37  |   let state = initial
  38  |   let release: () => void = () => undefined
  39  |   const held = new Promise<void>((resolve) => { release = resolve })
  40  |   await page.route('**/v1/**', async (route) => {
  41  |     const request = route.request(), path = new URL(request.url()).pathname
  42  |     if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  43  |     if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
  44  |     let data: unknown = []
  45  |     if (path.endsWith('/files')) {
  46  |       if (state === 'loading') await held
  47  |       if (state === 'offline') return route.abort('internetdisconnected')
  48  |       if (state === 'error' || state === 'denied') return route.fulfill({ status: state === 'denied' ? 403 : 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: state === 'denied' ? 'permission_denied' : 'internal', message: 'TEST Files unavailable' } }) })
  49  |       data = state === 'empty' ? [] : files
  50  |     } else if (path.endsWith('/body')) {
  51  |       const file = files.find((entry) => path.includes(entry.id))!
  52  |       data = { filename: file.filename, mediaType: 'text/markdown', text: '# TEST exact preview\n\nSynthetic retained content.', originalAvailable: true, contentBase64: Buffer.from('TEST original bytes').toString('base64') }
  53  |     } else if (path.includes('/files/') && request.method() === 'PATCH') {
  54  |       const file = files.find((entry) => path.endsWith(entry.id))!
  55  |       file.hidden = request.postDataJSON().hidden
  56  |       data = file
  57  |     } else if (path === '/v1/sectors') data = [sector]
  58  |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  59  |     else if (path.endsWith('/research-session')) data = session
  60  |     else if (path === '/v1/sessions') data = [session]
  61  |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections, markdown: '## Scope\n\nTEST synthetic library scope', researchSessionId: sessionId, changes: [] }
  62  |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  63  |     else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  64  |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
  65  |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  66  |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  67  |     else if (path.startsWith('/v1/sessions/')) data = session
  68  |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  69  |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  70  |   })
  71  |   return { ready: async () => { state = 'ready'; release(); if (initial === 'offline') await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })) } }
  72  | }
  73  | 
  74  | async function open(page: Page, width: number, dark = false) {
  75  |   await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
  76  |   await page.emulateMedia({ reducedMotion: 'reduce' })
  77  |   await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  78  |   await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  79  |   if (dark) {
  80  |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
> 81  |     await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                ^ Error: locator.click: Test timeout of 30000ms exceeded.
  82  |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  83  |   }
  84  |   if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  85  |   return page.getByRole('region', { name: 'Sector files' })
  86  | }
  87  | 
  88  | for (const width of [1440, 390]) for (const dark of [false, true]) {
  89  |   test(`files scale: 2005 mixed records, ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, testInfo) => {
  90  |     await fixture(page)
  91  |     const files = await open(page, width, dark)
  92  |     await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
  93  |     // The initial focus/DOM window stays bounded independently of library size.
  94  |     expect(await files.getByRole('button', { name: /^TEST (Generated|Uploaded)/ }).count()).toBeLessThanOrEqual(50)
  95  |     await expect(files.getByText('Showing 50 of 2004 files', { exact: true })).toBeVisible()
  96  |     await expect(files.getByRole('button', { name: 'Upload file' })).toBeVisible()
  97  |     await expect(files.getByRole('button', { name: 'Upload file' })).toBeInViewport()
  98  |     await expect(files.getByRole('button', { name: `Hide ${longName}`, exact: true })).toBeVisible()
  99  |     await expect(files.getByRole('button', { name: `Request context inclusion for ${longName}`, exact: true })).toBeVisible()
  100 |     await expect(files.getByRole('button', { name: `Hide ${longName}`, exact: true })).toBeInViewport()
  101 |     await expect(files.getByRole('button', { name: `Request context inclusion for ${longName}`, exact: true })).toBeInViewport()
  102 |     await expect(files.getByText('Processing', { exact: true })).toBeVisible()
  103 |     await expect(files.getByText('Failed', { exact: true })).toBeVisible()
  104 |     await expect(files.getByText('Needs OCR', { exact: true })).toBeVisible()
  105 |     const contextHeading = page.getByRole('heading', { name: 'Global context', exact: true })
  106 |     const contextPosition = (await contextHeading.boundingBox())!.y
  107 |     await files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true }).scrollIntoViewIfNeeded()
  108 |     await expect(files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true })).toBeInViewport()
  109 |     expect((await contextHeading.boundingBox())!.y).toBe(contextPosition)
  110 |     await files.getByRole('button', { name: longName, exact: true }).scrollIntoViewIfNeeded()
  111 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  112 |     await page.screenshot({ path: testInfo.outputPath('initial-window.png'), animations: 'disabled' })
  113 |     const more = files.getByRole('button', { name: 'Show more files', exact: true })
  114 |     await more.scrollIntoViewIfNeeded()
  115 |     await more.focus()
  116 |     await page.keyboard.press('Enter')
  117 |     await expect(files.getByText('Showing 100 of 2004 files', { exact: true })).toBeVisible()
  118 |     await files.getByRole('textbox', { name: 'Search files' }).fill('file 2004')
  119 |     const lastName = 'TEST Generated file 2004.md'
  120 |     await expect(files.getByRole('button', { name: lastName, exact: true })).toBeVisible()
  121 |     await expect(files.getByText('Showing 1 of 1 files', { exact: true })).toBeVisible()
  122 |     await files.getByRole('button', { name: lastName, exact: true }).focus()
  123 |     await page.keyboard.press('Enter')
  124 |     await expect(page.getByRole('dialog', { name: 'File preview' }).getByRole('heading', { name: 'TEST exact preview' })).toBeVisible()
  125 |     await page.keyboard.press('Escape')
  126 |     await expect(files.getByRole('button', { name: lastName, exact: true })).toBeFocused()
  127 |     await files.getByRole('textbox', { name: 'Search files' }).fill('no TEST filename matches')
  128 |     await expect(files.getByText('No matching files.', { exact: true })).toBeVisible()
  129 |     await files.getByRole('textbox', { name: 'Search files' }).fill('file 0004')
  130 |     await files.getByRole('button', { name: 'Show hidden files', exact: true }).click()
  131 |     const hiddenName = 'TEST Generated file 0004.md'
  132 |     await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeDisabled()
  133 |     await files.getByRole('button', { name: `Reveal ${hiddenName}`, exact: true }).click()
  134 |     await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeEnabled()
  135 |     await files.getByRole('textbox', { name: 'Search files' }).fill('')
  136 |     await expect(files.getByText('Showing 50 of 2005 files', { exact: true })).toBeVisible()
  137 |     await page.screenshot({ path: testInfo.outputPath('search-and-reveal.png'), animations: 'disabled' })
  138 |     if (width < 1280) {
  139 |       await page.keyboard.press('Escape')
  140 |       await expect(page.getByRole('button', { name: 'Open files and global context' })).toBeFocused()
  141 |     }
  142 |   })
  143 | }
  144 | 
  145 | for (const width of [1440, 390]) for (const state of ['loading', 'empty', 'error', 'denied', 'offline'] as const) {
  146 |   test(`files state: ${state}, ${width}px`, async ({ page }, testInfo) => {
  147 |     const controller = await fixture(page, state)
  148 |     const files = await open(page, width)
  149 |     if (state === 'loading') await expect(files.getByRole('status', { name: 'Files is loading' })).toBeVisible()
  150 |     else if (state === 'empty') await expect(files.getByText('Upload source material or ask an agent to create a file.')).toBeVisible()
  151 |     else await expect(files.getByRole('alert')).toContainText(state === 'denied' ? 'Files is not shared with this key.' : state === 'offline' ? 'No connection' : 'TEST Files unavailable')
  152 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  153 |     await page.screenshot({ path: testInfo.outputPath(`${state}.png`), animations: 'disabled' })
  154 |     await controller.ready()
  155 |     if (['error', 'denied', 'offline'].includes(state)) await files.getByRole('button', { name: 'Try again', exact: true }).click()
  156 |     if (state !== 'empty') await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
  157 |   })
  158 | }
  159 | 
```