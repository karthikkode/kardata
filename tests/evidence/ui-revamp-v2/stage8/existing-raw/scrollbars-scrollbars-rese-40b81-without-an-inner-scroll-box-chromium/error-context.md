# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scrollbars.spec.ts >> scrollbars: researches pages without an inner scroll box
- Location: ../tests/frontend-e2e/scrollbars.spec.ts:145:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Overflow sector 1')
Expected: visible
Error: strict mode violation: getByText('Overflow sector 1') resolved to 11 elements:
    1) <span data-type="Body" title="Overflow sector 1" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 1</span> aka getByRole('link', { name: 'Overflow sector 1 Bulk rows' })
    2) <span data-type="Body" title="Overflow sector 10" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 10</span> aka getByRole('link', { name: 'Overflow sector 10 Bulk rows' })
    3) <span data-type="Body" title="Overflow sector 11" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 11</span> aka getByRole('link', { name: 'Overflow sector 11 Bulk rows' })
    4) <span data-type="Body" title="Overflow sector 12" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 12</span> aka getByRole('link', { name: 'Overflow sector 12 Bulk rows' })
    5) <span data-type="Body" title="Overflow sector 13" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 13</span> aka getByRole('link', { name: 'Overflow sector 13 Bulk rows' })
    6) <span data-type="Body" title="Overflow sector 14" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 14</span> aka getByRole('link', { name: 'Overflow sector 14 Bulk rows' })
    7) <span data-type="Body" title="Overflow sector 15" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 15</span> aka getByRole('link', { name: 'Overflow sector 15 Bulk rows' })
    8) <span data-type="Body" title="Overflow sector 16" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 16</span> aka getByRole('link', { name: 'Overflow sector 16 Bulk rows' })
    9) <span data-type="Body" title="Overflow sector 17" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 17</span> aka getByRole('link', { name: 'Overflow sector 17 Bulk rows' })
    10) <span data-type="Body" title="Overflow sector 18" class="text-sm leading-[22px] text-foreground block truncate font-medium">Overflow sector 18</span> aka getByRole('link', { name: 'Overflow sector 18 Bulk rows' })
    ...

Call log:
  - Expect "toBeVisible" getByText('Overflow sector 1') with timeout 5000ms
  - waiting for getByText('Overflow sector 1')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [ref=e5]:
        - generic [aria-hidden] [ref=e6]: K
        - generic [ref=e7]: Kardata
      - navigation "Primary" [ref=e8]:
        - button "Overview" [ref=e9] [cursor=pointer]
        - button "Researches" [ref=e16] [cursor=pointer]
        - button "Agents" [ref=e21] [cursor=pointer]
        - button "Models" [ref=e26] [cursor=pointer]
        - button "Emails (coming soon)" [disabled] [ref=e31]:
          - generic [ref=e35]: Emails
          - generic [ref=e36]: Soon
      - button "Collapse sidebar" [expanded] [ref=e38] [cursor=pointer]
    - generic [ref=e39]:
      - banner [ref=e40]:
        - button "Search... Ctrl K" [ref=e41] [cursor=pointer]:
          - generic [ref=e42]: Search...
          - generic [ref=e43]: Ctrl K
        - generic [ref=e44]:
          - button "Ask Karbot" [ref=e45] [cursor=pointer]
          - button "Theme" [ref=e46] [cursor=pointer]
      - main [ref=e47]:
        - generic [ref=e48]:
          - generic [ref=e49]:
            - generic [ref=e50]:
              - heading "Researches" [level=1] [ref=e52]
              - button "New sector" [ref=e54] [cursor=pointer]
            - paragraph [ref=e55]: Sectors you research and the companies they discover.
          - generic [ref=e56]:
            - tablist "Research type" [ref=e57]:
              - tab "Sectors 60" [selected] [ref=e58] [cursor=pointer]
              - tab "Companies 30" [ref=e60] [cursor=pointer]
            - generic [ref=e61]:
              - textbox "Search sectors" [ref=e63]
              - generic [ref=e64]:
                - 'combobox "Status: All" [ref=e65] [cursor=pointer]'
                - textbox [aria-hidden] [ref=e71]: all
              - paragraph [ref=e73]: 60 sectors
            - tabpanel "Sectors 60" [ref=e74]:
              - generic [ref=e76]:
                - table "Sectors" [ref=e77]:
                  - rowgroup [ref=e78]:
                    - row [ref=e79]:
                      - columnheader [ref=e80]:
                        - button "Sort by Sector" [ref=e81] [cursor=pointer]: Sector
                      - columnheader [ref=e85]:
                        - button "Sort by Status" [ref=e86] [cursor=pointer]: Status
                      - columnheader [ref=e90]:
                        - button "Sort by Companies" [ref=e91] [cursor=pointer]: Companies
                      - columnheader [ref=e95]:
                        - button "Sort by Updated" [ref=e96] [cursor=pointer]: Updated
                      - columnheader "Open" [ref=e100]
                  - rowgroup [ref=e102]:
                    - link [ref=e103] [cursor=pointer]:
                      - cell "Overflow sector 1 Bulk rows for scrollbar overflow" [ref=e104]:
                        - generic [ref=e105]:
                          - generic "Overflow sector 1" [ref=e106]
                          - generic "Bulk rows for scrollbar overflow" [ref=e107]
                      - cell "Queued" [ref=e108]
                      - cell "0" [ref=e111]
                      - cell "6d ago" [ref=e112]
                      - cell [ref=e113]
                    - link [ref=e116] [cursor=pointer]:
                      - cell "Overflow sector 2 Bulk rows for scrollbar overflow" [ref=e117]:
                        - generic [ref=e118]:
                          - generic "Overflow sector 2" [ref=e119]
                          - generic "Bulk rows for scrollbar overflow" [ref=e120]
                      - cell "Queued" [ref=e121]
                      - cell "0" [ref=e124]
                      - cell "6d ago" [ref=e125]
                      - cell [ref=e126]
                    - link [ref=e129] [cursor=pointer]:
                      - cell "Overflow sector 3 Bulk rows for scrollbar overflow" [ref=e130]:
                        - generic [ref=e131]:
                          - generic "Overflow sector 3" [ref=e132]
                          - generic "Bulk rows for scrollbar overflow" [ref=e133]
                      - cell "Queued" [ref=e134]
                      - cell "0" [ref=e137]
                      - cell "6d ago" [ref=e138]
                      - cell [ref=e139]
                    - link [ref=e142] [cursor=pointer]:
                      - cell "Overflow sector 4 Bulk rows for scrollbar overflow" [ref=e143]:
                        - generic [ref=e144]:
                          - generic "Overflow sector 4" [ref=e145]
                          - generic "Bulk rows for scrollbar overflow" [ref=e146]
                      - cell "Queued" [ref=e147]
                      - cell "0" [ref=e150]
                      - cell "6d ago" [ref=e151]
                      - cell [ref=e152]
                    - link [ref=e155] [cursor=pointer]:
                      - cell "Overflow sector 5 Bulk rows for scrollbar overflow" [ref=e156]:
                        - generic [ref=e157]:
                          - generic "Overflow sector 5" [ref=e158]
                          - generic "Bulk rows for scrollbar overflow" [ref=e159]
                      - cell "Queued" [ref=e160]
                      - cell "0" [ref=e163]
                      - cell "6d ago" [ref=e164]
                      - cell [ref=e165]
                    - link [ref=e168] [cursor=pointer]:
                      - cell "Overflow sector 6 Bulk rows for scrollbar overflow" [ref=e169]:
                        - generic [ref=e170]:
                          - generic "Overflow sector 6" [ref=e171]
                          - generic "Bulk rows for scrollbar overflow" [ref=e172]
                      - cell "Queued" [ref=e173]
                      - cell "0" [ref=e176]
                      - cell "6d ago" [ref=e177]
                      - cell [ref=e178]
                    - link [ref=e181] [cursor=pointer]:
                      - cell "Overflow sector 7 Bulk rows for scrollbar overflow" [ref=e182]:
                        - generic [ref=e183]:
                          - generic "Overflow sector 7" [ref=e184]
                          - generic "Bulk rows for scrollbar overflow" [ref=e185]
                      - cell "Queued" [ref=e186]
                      - cell "0" [ref=e189]
                      - cell "6d ago" [ref=e190]
                      - cell [ref=e191]
                    - link [ref=e194] [cursor=pointer]:
                      - cell "Overflow sector 8 Bulk rows for scrollbar overflow" [ref=e195]:
                        - generic [ref=e196]:
                          - generic "Overflow sector 8" [ref=e197]
                          - generic "Bulk rows for scrollbar overflow" [ref=e198]
                      - cell "Queued" [ref=e199]
                      - cell "0" [ref=e202]
                      - cell "6d ago" [ref=e203]
                      - cell [ref=e204]
                    - link [ref=e207] [cursor=pointer]:
                      - cell "Overflow sector 9 Bulk rows for scrollbar overflow" [ref=e208]:
                        - generic [ref=e209]:
                          - generic "Overflow sector 9" [ref=e210]
                          - generic "Bulk rows for scrollbar overflow" [ref=e211]
                      - cell "Queued" [ref=e212]
                      - cell "0" [ref=e215]
                      - cell "6d ago" [ref=e216]
                      - cell [ref=e217]
                    - link [ref=e220] [cursor=pointer]:
                      - cell "Overflow sector 10 Bulk rows for scrollbar overflow" [ref=e221]:
                        - generic [ref=e222]:
                          - generic "Overflow sector 10" [ref=e223]
                          - generic "Bulk rows for scrollbar overflow" [ref=e224]
                      - cell "Queued" [ref=e225]
                      - cell "0" [ref=e228]
                      - cell "6d ago" [ref=e229]
                      - cell [ref=e230]
                    - link [ref=e233] [cursor=pointer]:
                      - cell "Overflow sector 11 Bulk rows for scrollbar overflow" [ref=e234]:
                        - generic [ref=e235]:
                          - generic "Overflow sector 11" [ref=e236]
                          - generic "Bulk rows for scrollbar overflow" [ref=e237]
                      - cell "Queued" [ref=e238]
                      - cell "0" [ref=e241]
                      - cell "6d ago" [ref=e242]
                      - cell [ref=e243]
                    - link [ref=e246] [cursor=pointer]:
                      - cell "Overflow sector 12 Bulk rows for scrollbar overflow" [ref=e247]:
                        - generic [ref=e248]:
                          - generic "Overflow sector 12" [ref=e249]
                          - generic "Bulk rows for scrollbar overflow" [ref=e250]
                      - cell "Queued" [ref=e251]
                      - cell "0" [ref=e254]
                      - cell "6d ago" [ref=e255]
                      - cell [ref=e256]
                    - link [ref=e259] [cursor=pointer]:
                      - cell "Overflow sector 13 Bulk rows for scrollbar overflow" [ref=e260]:
                        - generic [ref=e261]:
                          - generic "Overflow sector 13" [ref=e262]
                          - generic "Bulk rows for scrollbar overflow" [ref=e263]
                      - cell "Queued" [ref=e264]
                      - cell "0" [ref=e267]
                      - cell "6d ago" [ref=e268]
                      - cell [ref=e269]
                    - link [ref=e272] [cursor=pointer]:
                      - cell "Overflow sector 14 Bulk rows for scrollbar overflow" [ref=e273]:
                        - generic [ref=e274]:
                          - generic "Overflow sector 14" [ref=e275]
                          - generic "Bulk rows for scrollbar overflow" [ref=e276]
                      - cell "Queued" [ref=e277]
                      - cell "0" [ref=e280]
                      - cell "6d ago" [ref=e281]
                      - cell [ref=e282]
                    - link [ref=e285] [cursor=pointer]:
                      - cell "Overflow sector 15 Bulk rows for scrollbar overflow" [ref=e286]:
                        - generic [ref=e287]:
                          - generic "Overflow sector 15" [ref=e288]
                          - generic "Bulk rows for scrollbar overflow" [ref=e289]
                      - cell "Queued" [ref=e290]
                      - cell "0" [ref=e293]
                      - cell "6d ago" [ref=e294]
                      - cell [ref=e295]
                    - link [ref=e298] [cursor=pointer]:
                      - cell "Overflow sector 16 Bulk rows for scrollbar overflow" [ref=e299]:
                        - generic [ref=e300]:
                          - generic "Overflow sector 16" [ref=e301]
                          - generic "Bulk rows for scrollbar overflow" [ref=e302]
                      - cell "Queued" [ref=e303]
                      - cell "0" [ref=e306]
                      - cell "6d ago" [ref=e307]
                      - cell [ref=e308]
                    - link [ref=e311] [cursor=pointer]:
                      - cell "Overflow sector 17 Bulk rows for scrollbar overflow" [ref=e312]:
                        - generic [ref=e313]:
                          - generic "Overflow sector 17" [ref=e314]
                          - generic "Bulk rows for scrollbar overflow" [ref=e315]
                      - cell "Queued" [ref=e316]
                      - cell "0" [ref=e319]
                      - cell "6d ago" [ref=e320]
                      - cell [ref=e321]
                    - link [ref=e324] [cursor=pointer]:
                      - cell "Overflow sector 18 Bulk rows for scrollbar overflow" [ref=e325]:
                        - generic [ref=e326]:
                          - generic "Overflow sector 18" [ref=e327]
                          - generic "Bulk rows for scrollbar overflow" [ref=e328]
                      - cell "Queued" [ref=e329]
                      - cell "0" [ref=e332]
                      - cell "6d ago" [ref=e333]
                      - cell [ref=e334]
                    - link [ref=e337] [cursor=pointer]:
                      - cell "Overflow sector 19 Bulk rows for scrollbar overflow" [ref=e338]:
                        - generic [ref=e339]:
                          - generic "Overflow sector 19" [ref=e340]
                          - generic "Bulk rows for scrollbar overflow" [ref=e341]
                      - cell "Queued" [ref=e342]
                      - cell "0" [ref=e345]
                      - cell "6d ago" [ref=e346]
                      - cell [ref=e347]
                    - link [ref=e350] [cursor=pointer]:
                      - cell "Overflow sector 20 Bulk rows for scrollbar overflow" [ref=e351]:
                        - generic [ref=e352]:
                          - generic "Overflow sector 20" [ref=e353]
                          - generic "Bulk rows for scrollbar overflow" [ref=e354]
                      - cell "Queued" [ref=e355]
                      - cell "0" [ref=e358]
                      - cell "6d ago" [ref=e359]
                      - cell [ref=e360]
                    - link [ref=e363] [cursor=pointer]:
                      - cell "Overflow sector 21 Bulk rows for scrollbar overflow" [ref=e364]:
                        - generic [ref=e365]:
                          - generic "Overflow sector 21" [ref=e366]
                          - generic "Bulk rows for scrollbar overflow" [ref=e367]
                      - cell "Queued" [ref=e368]
                      - cell "0" [ref=e371]
                      - cell "6d ago" [ref=e372]
                      - cell [ref=e373]
                    - link [ref=e376] [cursor=pointer]:
                      - cell "Overflow sector 22 Bulk rows for scrollbar overflow" [ref=e377]:
                        - generic [ref=e378]:
                          - generic "Overflow sector 22" [ref=e379]
                          - generic "Bulk rows for scrollbar overflow" [ref=e380]
                      - cell "Queued" [ref=e381]
                      - cell "0" [ref=e384]
                      - cell "6d ago" [ref=e385]
                      - cell [ref=e386]
                    - link [ref=e389] [cursor=pointer]:
                      - cell "Overflow sector 23 Bulk rows for scrollbar overflow" [ref=e390]:
                        - generic [ref=e391]:
                          - generic "Overflow sector 23" [ref=e392]
                          - generic "Bulk rows for scrollbar overflow" [ref=e393]
                      - cell "Queued" [ref=e394]
                      - cell "0" [ref=e397]
                      - cell "6d ago" [ref=e398]
                      - cell [ref=e399]
                    - link [ref=e402] [cursor=pointer]:
                      - cell "Overflow sector 24 Bulk rows for scrollbar overflow" [ref=e403]:
                        - generic [ref=e404]:
                          - generic "Overflow sector 24" [ref=e405]
                          - generic "Bulk rows for scrollbar overflow" [ref=e406]
                      - cell "Queued" [ref=e407]
                      - cell "0" [ref=e410]
                      - cell "6d ago" [ref=e411]
                      - cell [ref=e412]
                    - link [ref=e415] [cursor=pointer]:
                      - cell "Overflow sector 25 Bulk rows for scrollbar overflow" [ref=e416]:
                        - generic [ref=e417]:
                          - generic "Overflow sector 25" [ref=e418]
                          - generic "Bulk rows for scrollbar overflow" [ref=e419]
                      - cell "Queued" [ref=e420]
                      - cell "0" [ref=e423]
                      - cell "6d ago" [ref=e424]
                      - cell [ref=e425]
                    - link [ref=e428] [cursor=pointer]:
                      - cell "Overflow sector 26 Bulk rows for scrollbar overflow" [ref=e429]:
                        - generic [ref=e430]:
                          - generic "Overflow sector 26" [ref=e431]
                          - generic "Bulk rows for scrollbar overflow" [ref=e432]
                      - cell "Queued" [ref=e433]
                      - cell "0" [ref=e436]
                      - cell "6d ago" [ref=e437]
                      - cell [ref=e438]
                    - link [ref=e441] [cursor=pointer]:
                      - cell "Overflow sector 27 Bulk rows for scrollbar overflow" [ref=e442]:
                        - generic [ref=e443]:
                          - generic "Overflow sector 27" [ref=e444]
                          - generic "Bulk rows for scrollbar overflow" [ref=e445]
                      - cell "Queued" [ref=e446]
                      - cell "0" [ref=e449]
                      - cell "6d ago" [ref=e450]
                      - cell [ref=e451]
                    - link [ref=e454] [cursor=pointer]:
                      - cell "Overflow sector 28 Bulk rows for scrollbar overflow" [ref=e455]:
                        - generic [ref=e456]:
                          - generic "Overflow sector 28" [ref=e457]
                          - generic "Bulk rows for scrollbar overflow" [ref=e458]
                      - cell "Queued" [ref=e459]
                      - cell "0" [ref=e462]
                      - cell "6d ago" [ref=e463]
                      - cell [ref=e464]
                    - link [ref=e467] [cursor=pointer]:
                      - cell "Overflow sector 29 Bulk rows for scrollbar overflow" [ref=e468]:
                        - generic [ref=e469]:
                          - generic "Overflow sector 29" [ref=e470]
                          - generic "Bulk rows for scrollbar overflow" [ref=e471]
                      - cell "Queued" [ref=e472]
                      - cell "0" [ref=e475]
                      - cell "6d ago" [ref=e476]
                      - cell [ref=e477]
                    - link [ref=e480] [cursor=pointer]:
                      - cell "Overflow sector 30 Bulk rows for scrollbar overflow" [ref=e481]:
                        - generic [ref=e482]:
                          - generic "Overflow sector 30" [ref=e483]
                          - generic "Bulk rows for scrollbar overflow" [ref=e484]
                      - cell "Queued" [ref=e485]
                      - cell "0" [ref=e488]
                      - cell "6d ago" [ref=e489]
                      - cell [ref=e490]
                    - link [ref=e493] [cursor=pointer]:
                      - cell "Overflow sector 31 Bulk rows for scrollbar overflow" [ref=e494]:
                        - generic [ref=e495]:
                          - generic "Overflow sector 31" [ref=e496]
                          - generic "Bulk rows for scrollbar overflow" [ref=e497]
                      - cell "Queued" [ref=e498]
                      - cell "0" [ref=e501]
                      - cell "6d ago" [ref=e502]
                      - cell [ref=e503]
                    - link [ref=e506] [cursor=pointer]:
                      - cell "Overflow sector 32 Bulk rows for scrollbar overflow" [ref=e507]:
                        - generic [ref=e508]:
                          - generic "Overflow sector 32" [ref=e509]
                          - generic "Bulk rows for scrollbar overflow" [ref=e510]
                      - cell "Queued" [ref=e511]
                      - cell "0" [ref=e514]
                      - cell "6d ago" [ref=e515]
                      - cell [ref=e516]
                    - link [ref=e519] [cursor=pointer]:
                      - cell "Overflow sector 33 Bulk rows for scrollbar overflow" [ref=e520]:
                        - generic [ref=e521]:
                          - generic "Overflow sector 33" [ref=e522]
                          - generic "Bulk rows for scrollbar overflow" [ref=e523]
                      - cell "Queued" [ref=e524]
                      - cell "0" [ref=e527]
                      - cell "6d ago" [ref=e528]
                      - cell [ref=e529]
                    - link [ref=e532] [cursor=pointer]:
                      - cell "Overflow sector 34 Bulk rows for scrollbar overflow" [ref=e533]:
                        - generic [ref=e534]:
                          - generic "Overflow sector 34" [ref=e535]
                          - generic "Bulk rows for scrollbar overflow" [ref=e536]
                      - cell "Queued" [ref=e537]
                      - cell "0" [ref=e540]
                      - cell "6d ago" [ref=e541]
                      - cell [ref=e542]
                    - link [ref=e545] [cursor=pointer]:
                      - cell "Overflow sector 35 Bulk rows for scrollbar overflow" [ref=e546]:
                        - generic [ref=e547]:
                          - generic "Overflow sector 35" [ref=e548]
                          - generic "Bulk rows for scrollbar overflow" [ref=e549]
                      - cell "Queued" [ref=e550]
                      - cell "0" [ref=e553]
                      - cell "6d ago" [ref=e554]
                      - cell [ref=e555]
                    - link [ref=e558] [cursor=pointer]:
                      - cell "Overflow sector 36 Bulk rows for scrollbar overflow" [ref=e559]:
                        - generic [ref=e560]:
                          - generic "Overflow sector 36" [ref=e561]
                          - generic "Bulk rows for scrollbar overflow" [ref=e562]
                      - cell "Queued" [ref=e563]
                      - cell "0" [ref=e566]
                      - cell "6d ago" [ref=e567]
                      - cell [ref=e568]
                    - link [ref=e571] [cursor=pointer]:
                      - cell "Overflow sector 37 Bulk rows for scrollbar overflow" [ref=e572]:
                        - generic [ref=e573]:
                          - generic "Overflow sector 37" [ref=e574]
                          - generic "Bulk rows for scrollbar overflow" [ref=e575]
                      - cell "Queued" [ref=e576]
                      - cell "0" [ref=e579]
                      - cell "6d ago" [ref=e580]
                      - cell [ref=e581]
                    - link [ref=e584] [cursor=pointer]:
                      - cell "Overflow sector 38 Bulk rows for scrollbar overflow" [ref=e585]:
                        - generic [ref=e586]:
                          - generic "Overflow sector 38" [ref=e587]
                          - generic "Bulk rows for scrollbar overflow" [ref=e588]
                      - cell "Queued" [ref=e589]
                      - cell "0" [ref=e592]
                      - cell "6d ago" [ref=e593]
                      - cell [ref=e594]
                    - link [ref=e597] [cursor=pointer]:
                      - cell "Overflow sector 39 Bulk rows for scrollbar overflow" [ref=e598]:
                        - generic [ref=e599]:
                          - generic "Overflow sector 39" [ref=e600]
                          - generic "Bulk rows for scrollbar overflow" [ref=e601]
                      - cell "Queued" [ref=e602]
                      - cell "0" [ref=e605]
                      - cell "6d ago" [ref=e606]
                      - cell [ref=e607]
                    - link [ref=e610] [cursor=pointer]:
                      - cell "Overflow sector 40 Bulk rows for scrollbar overflow" [ref=e611]:
                        - generic [ref=e612]:
                          - generic "Overflow sector 40" [ref=e613]
                          - generic "Bulk rows for scrollbar overflow" [ref=e614]
                      - cell "Queued" [ref=e615]
                      - cell "0" [ref=e618]
                      - cell "6d ago" [ref=e619]
                      - cell [ref=e620]
                    - link [ref=e623] [cursor=pointer]:
                      - cell "Overflow sector 41 Bulk rows for scrollbar overflow" [ref=e624]:
                        - generic [ref=e625]:
                          - generic "Overflow sector 41" [ref=e626]
                          - generic "Bulk rows for scrollbar overflow" [ref=e627]
                      - cell "Queued" [ref=e628]
                      - cell "0" [ref=e631]
                      - cell "6d ago" [ref=e632]
                      - cell [ref=e633]
                    - link [ref=e636] [cursor=pointer]:
                      - cell "Overflow sector 42 Bulk rows for scrollbar overflow" [ref=e637]:
                        - generic [ref=e638]:
                          - generic "Overflow sector 42" [ref=e639]
                          - generic "Bulk rows for scrollbar overflow" [ref=e640]
                      - cell "Queued" [ref=e641]
                      - cell "0" [ref=e644]
                      - cell "6d ago" [ref=e645]
                      - cell [ref=e646]
                    - link [ref=e649] [cursor=pointer]:
                      - cell "Overflow sector 43 Bulk rows for scrollbar overflow" [ref=e650]:
                        - generic [ref=e651]:
                          - generic "Overflow sector 43" [ref=e652]
                          - generic "Bulk rows for scrollbar overflow" [ref=e653]
                      - cell "Queued" [ref=e654]
                      - cell "0" [ref=e657]
                      - cell "6d ago" [ref=e658]
                      - cell [ref=e659]
                    - link [ref=e662] [cursor=pointer]:
                      - cell "Overflow sector 44 Bulk rows for scrollbar overflow" [ref=e663]:
                        - generic [ref=e664]:
                          - generic "Overflow sector 44" [ref=e665]
                          - generic "Bulk rows for scrollbar overflow" [ref=e666]
                      - cell "Queued" [ref=e667]
                      - cell "0" [ref=e670]
                      - cell "6d ago" [ref=e671]
                      - cell [ref=e672]
                    - link [ref=e675] [cursor=pointer]:
                      - cell "Overflow sector 45 Bulk rows for scrollbar overflow" [ref=e676]:
                        - generic [ref=e677]:
                          - generic "Overflow sector 45" [ref=e678]
                          - generic "Bulk rows for scrollbar overflow" [ref=e679]
                      - cell "Queued" [ref=e680]
                      - cell "0" [ref=e683]
                      - cell "6d ago" [ref=e684]
                      - cell [ref=e685]
                    - link [ref=e688] [cursor=pointer]:
                      - cell "Overflow sector 46 Bulk rows for scrollbar overflow" [ref=e689]:
                        - generic [ref=e690]:
                          - generic "Overflow sector 46" [ref=e691]
                          - generic "Bulk rows for scrollbar overflow" [ref=e692]
                      - cell "Queued" [ref=e693]
                      - cell "0" [ref=e696]
                      - cell "6d ago" [ref=e697]
                      - cell [ref=e698]
                    - link [ref=e701] [cursor=pointer]:
                      - cell "Overflow sector 47 Bulk rows for scrollbar overflow" [ref=e702]:
                        - generic [ref=e703]:
                          - generic "Overflow sector 47" [ref=e704]
                          - generic "Bulk rows for scrollbar overflow" [ref=e705]
                      - cell "Queued" [ref=e706]
                      - cell "0" [ref=e709]
                      - cell "6d ago" [ref=e710]
                      - cell [ref=e711]
                    - link [ref=e714] [cursor=pointer]:
                      - cell "Overflow sector 48 Bulk rows for scrollbar overflow" [ref=e715]:
                        - generic [ref=e716]:
                          - generic "Overflow sector 48" [ref=e717]
                          - generic "Bulk rows for scrollbar overflow" [ref=e718]
                      - cell "Queued" [ref=e719]
                      - cell "0" [ref=e722]
                      - cell "6d ago" [ref=e723]
                      - cell [ref=e724]
                    - link [ref=e727] [cursor=pointer]:
                      - cell "Overflow sector 49 Bulk rows for scrollbar overflow" [ref=e728]:
                        - generic [ref=e729]:
                          - generic "Overflow sector 49" [ref=e730]
                          - generic "Bulk rows for scrollbar overflow" [ref=e731]
                      - cell "Queued" [ref=e732]
                      - cell "0" [ref=e735]
                      - cell "6d ago" [ref=e736]
                      - cell [ref=e737]
                    - link [ref=e740] [cursor=pointer]:
                      - cell "Overflow sector 50 Bulk rows for scrollbar overflow" [ref=e741]:
                        - generic [ref=e742]:
                          - generic "Overflow sector 50" [ref=e743]
                          - generic "Bulk rows for scrollbar overflow" [ref=e744]
                      - cell "Queued" [ref=e745]
                      - cell "0" [ref=e748]
                      - cell "6d ago" [ref=e749]
                      - cell [ref=e750]
                    - link [ref=e753] [cursor=pointer]:
                      - cell "Overflow sector 51 Bulk rows for scrollbar overflow" [ref=e754]:
                        - generic [ref=e755]:
                          - generic "Overflow sector 51" [ref=e756]
                          - generic "Bulk rows for scrollbar overflow" [ref=e757]
                      - cell "Queued" [ref=e758]
                      - cell "0" [ref=e761]
                      - cell "6d ago" [ref=e762]
                      - cell [ref=e763]
                    - link [ref=e766] [cursor=pointer]:
                      - cell "Overflow sector 52 Bulk rows for scrollbar overflow" [ref=e767]:
                        - generic [ref=e768]:
                          - generic "Overflow sector 52" [ref=e769]
                          - generic "Bulk rows for scrollbar overflow" [ref=e770]
                      - cell "Queued" [ref=e771]
                      - cell "0" [ref=e774]
                      - cell "6d ago" [ref=e775]
                      - cell [ref=e776]
                    - link [ref=e779] [cursor=pointer]:
                      - cell "Overflow sector 53 Bulk rows for scrollbar overflow" [ref=e780]:
                        - generic [ref=e781]:
                          - generic "Overflow sector 53" [ref=e782]
                          - generic "Bulk rows for scrollbar overflow" [ref=e783]
                      - cell "Queued" [ref=e784]
                      - cell "0" [ref=e787]
                      - cell "6d ago" [ref=e788]
                      - cell [ref=e789]
                    - link [ref=e792] [cursor=pointer]:
                      - cell "Overflow sector 54 Bulk rows for scrollbar overflow" [ref=e793]:
                        - generic [ref=e794]:
                          - generic "Overflow sector 54" [ref=e795]
                          - generic "Bulk rows for scrollbar overflow" [ref=e796]
                      - cell "Queued" [ref=e797]
                      - cell "0" [ref=e800]
                      - cell "6d ago" [ref=e801]
                      - cell [ref=e802]
                    - link [ref=e805] [cursor=pointer]:
                      - cell "Overflow sector 55 Bulk rows for scrollbar overflow" [ref=e806]:
                        - generic [ref=e807]:
                          - generic "Overflow sector 55" [ref=e808]
                          - generic "Bulk rows for scrollbar overflow" [ref=e809]
                      - cell "Queued" [ref=e810]
                      - cell "0" [ref=e813]
                      - cell "6d ago" [ref=e814]
                      - cell [ref=e815]
                    - link [ref=e818] [cursor=pointer]:
                      - cell "Overflow sector 56 Bulk rows for scrollbar overflow" [ref=e819]:
                        - generic [ref=e820]:
                          - generic "Overflow sector 56" [ref=e821]
                          - generic "Bulk rows for scrollbar overflow" [ref=e822]
                      - cell "Queued" [ref=e823]
                      - cell "0" [ref=e826]
                      - cell "6d ago" [ref=e827]
                      - cell [ref=e828]
                    - link [ref=e831] [cursor=pointer]:
                      - cell "Overflow sector 57 Bulk rows for scrollbar overflow" [ref=e832]:
                        - generic [ref=e833]:
                          - generic "Overflow sector 57" [ref=e834]
                          - generic "Bulk rows for scrollbar overflow" [ref=e835]
                      - cell "Queued" [ref=e836]
                      - cell "0" [ref=e839]
                      - cell "6d ago" [ref=e840]
                      - cell [ref=e841]
                    - link [ref=e844] [cursor=pointer]:
                      - cell "Overflow sector 58 Bulk rows for scrollbar overflow" [ref=e845]:
                        - generic [ref=e846]:
                          - generic "Overflow sector 58" [ref=e847]
                          - generic "Bulk rows for scrollbar overflow" [ref=e848]
                      - cell "Queued" [ref=e849]
                      - cell "0" [ref=e852]
                      - cell "6d ago" [ref=e853]
                      - cell [ref=e854]
                    - link [ref=e857] [cursor=pointer]:
                      - cell "Overflow sector 59 Bulk rows for scrollbar overflow" [ref=e858]:
                        - generic [ref=e859]:
                          - generic "Overflow sector 59" [ref=e860]
                          - generic "Bulk rows for scrollbar overflow" [ref=e861]
                      - cell "Queued" [ref=e862]
                      - cell "0" [ref=e865]
                      - cell "6d ago" [ref=e866]
                      - cell [ref=e867]
                    - link [ref=e870] [cursor=pointer]:
                      - cell "Overflow sector 60 Bulk rows for scrollbar overflow" [ref=e871]:
                        - generic [ref=e872]:
                          - generic "Overflow sector 60" [ref=e873]
                          - generic "Bulk rows for scrollbar overflow" [ref=e874]
                      - cell "Queued" [ref=e875]
                      - cell "0" [ref=e878]
                      - cell "6d ago" [ref=e879]
                      - cell [ref=e880]
                - paragraph [ref=e884]: Showing 60 of 60
  - region "Notifications alt+T"
```

# Test source

```ts
  54  |     totalEstimatedTokens: 30,
  55  |   },
  56  |   files: [{
  57  |     id: 'sdoc-1', filename: 'overflow-units.md', mediaType: 'text/plain', status: 'indexed',
  58  |     sha256: 'abcdef1234567890abcdef1234567890', chars: 30000, excluded: false, units: UNITS,
  59  |   }],
  60  |   notes: [],
  61  | }
  62  | 
  63  | const DOCUMENTS = Array.from({ length: 15 }, (_, i) => ({
  64  |   id: `sdoc-${i + 1}`,
  65  |   sectorId: 'sec-overflow-1',
  66  |   filename: `overflow-doc-${i + 1}.md`,
  67  |   mediaType: 'text/plain',
  68  |   chars: 1000 + i,
  69  |   sha256: 'abcdef1234567890abcdef1234567890',
  70  |   createdAt: AT,
  71  |   status: 'indexed',
  72  | }))
  73  | 
  74  | const TABLE_REPLY = [
  75  |   'Scrollbar check with a wide table and code:',
  76  |   '',
  77  |   '| filename | status | id |',
  78  |   '|---|---|---|',
  79  |   ...Array.from({ length: 8 }, (_, i) => `| overflow-doc-${i + 1}.md | indexed | sdoc-aaaa1111-2222-3333-4444-${String(i).padStart(12, '0')} |`),
  80  |   '',
  81  |   '```text',
  82  |   ...Array.from({ length: 12 }, (_, i) => `code line ${i + 1} with a long token abcdef1234567890abcdef1234567890`),
  83  |   '```',
  84  | ].join('\n')
  85  | 
  86  | const MESSAGES = [
  87  |   ...Array.from({ length: 18 }, (_, i) => (
  88  |     i % 2 === 0
  89  |       ? { seq: i + 1, kind: 'text', role: 'user', text: `Scroll probe message ${i + 1} with enough text to fill the chat list.` }
  90  |       : { seq: i + 1, kind: 'text', role: 'agent', text: `Reply ${i + 1}: acknowledged with enough text to keep the list overflowing.` }
  91  |   )),
  92  |   { seq: 19, kind: 'text', role: 'user', text: 'Show the wide table.' },
  93  |   { seq: 20, kind: 'text', role: 'agent', text: TABLE_REPLY },
  94  | ]
  95  | 
  96  | const MODELS = Array.from({ length: 20 }, (_, i) => ({
  97  |   provider: 'meta',
  98  |   model: `scroll-model-${i + 1}`,
  99  |   displayName: `scroll-model-${i + 1}`,
  100 |   reasoning: 'native',
  101 |   mode: 'responses',
  102 |   efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  103 | }))
  104 | 
  105 | const session = { id: 's-1', title: 'Scrollbar chat', createdAt: AT, updatedAt: AT }
  106 | 
  107 | async function serveScrollbarApi(page: Page): Promise<void> {
  108 |   await page.route('**/v1/**', async (route) => {
  109 |     const url = route.request().url()
  110 |     const method = route.request().method()
  111 |     if (url.includes('/events?')) {
  112 |       await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  113 |       return
  114 |     }
  115 |     let data: unknown = []
  116 |     if (url.endsWith('/v1/sectors') && method === 'GET') data = SECTORS
  117 |     else if (url.endsWith('/v1/sectors/sec-overflow-1')) data = DETAIL
  118 |     else if (url.includes('/v1/companies')) data = { companies: COMPANIES, total: COMPANIES.length }
  119 |     else if (url.includes('/v1/sectors/sec-overflow-1/documents')) data = DOCUMENTS
  120 |     else if (url.includes('/v1/sectors/sec-overflow-1/context')) data = CONTEXT
  121 |     else if (url.includes('/v1/runs')) data = []
  122 |     else if (url.endsWith('/v1/sessions')) data = [session]
  123 |     else if (url.endsWith('/v1/sessions/s-1')) data = session
  124 |     else if (url.endsWith('/v1/sessions/s-1/threads')) {
  125 |       data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: AT }]
  126 |     } else if (url.includes('/v1/threads/s-1/messages') && method === 'GET') data = MESSAGES
  127 |     else if (url.includes('/v1/providers')) {
  128 |       data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'scroll-model-1', models: MODELS }] }
  129 |     }
  130 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  131 |   })
  132 | }
  133 | 
  134 | async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  135 |   for (const anchor of anchors) await expect(anchor).toBeVisible()
  136 |   await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
  137 | }
  138 | 
  139 | async function thinScrollbar(page: Page, locator: Locator): Promise<void> {
  140 |   await expect(locator).toHaveClass(/scroll-slim/)
  141 |   const width = await locator.evaluate((el) => getComputedStyle(el).scrollbarWidth)
  142 |   expect(width).toBe('thin')
  143 | }
  144 | 
  145 | test('scrollbars: researches pages without an inner scroll box', async ({ page }) => {
  146 |   await page.setViewportSize({ width: 1440, height: 900 })
  147 |   await serveScrollbarApi(page)
  148 |   await page.goto('/')
  149 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  150 |   await expect(page.getByText('Showing 50 of 60')).toBeVisible()
  151 |   // No inner scroll container: the page scrolls and Show more extends it.
  152 |   await expect(page.getByRole('table', { name: 'Sectors' }).locator('.scroll-slim')).toHaveCount(0)
  153 |   await page.getByRole('button', { name: 'Show more' }).click()
> 154 |   await expect(page.getByText('Overflow sector 1')).toBeVisible()
      |                                                     ^ Error: expect(locator).toBeVisible() failed
  155 |   await shot(page, 'scroll-researches', [page.getByText('Showing 60 of 60')])
  156 | })
  157 | 
  158 | test('scrollbars: chat list plus table and code scroll in place', async ({ page }) => {
  159 |   await page.setViewportSize({ width: 1440, height: 900 })
  160 |   await serveScrollbarApi(page)
  161 |   await page.goto('/')
  162 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  163 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  164 |   await expect(chat.getByText('Scroll probe message 1 with enough text to fill the chat list.', { exact: true })).toBeVisible()
  165 |   await thinScrollbar(page, chat.locator('[aria-label="Chat messages"]'))
  166 |   await thinScrollbar(page, chat.locator('pre.scroll-slim').first())
  167 |   await shot(page, 'scroll-chat-table', [
  168 |     chat.getByRole('columnheader', { name: 'filename' }),
  169 |     chat.getByText('overflow-doc-1.md').first(),
  170 |   ])
  171 | })
  172 | 
  173 | test('scrollbars: model menu list scrolls without detaching', async ({ page }) => {
  174 |   await page.setViewportSize({ width: 1440, height: 900 })
  175 |   await serveScrollbarApi(page)
  176 |   await page.goto('/')
  177 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  178 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  179 |   await chat.getByRole('button', { name: 'Choose a model' }).click()
  180 |   const menu = chat.getByRole('menu', { name: 'Models' })
  181 |   await expect(menu.getByText('scroll-model-20')).toBeVisible()
  182 |   await thinScrollbar(page, menu.locator('.scroll-slim').first())
  183 |   await shot(page, 'scroll-model-menu', [menu.getByText('scroll-model-20')])
  184 | })
  185 | 
  186 | const WS_AT = '2026-09-30T00:00:00.000Z'
  187 | const WS_SECTOR = { id: 'sec-overflow-ws', name: 'Overflow workspace', topic: 'Bulk rows', state: 'running', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: WS_AT, updatedAt: WS_AT }
  188 | const WS_RESEARCH = { id: 'ws-research', title: 'Overflow research', kind: 'research', sectorId: WS_SECTOR.id, createdAt: WS_AT, updatedAt: WS_AT }
  189 | const WS_NORMALS = Array.from({ length: 60 }, (_, i) => ({ id: `ws-chat-${i + 1}`, title: `Overflow chat ${i + 1}`, kind: 'normal', sectorId: WS_SECTOR.id, createdAt: WS_AT, updatedAt: WS_AT }))
  190 | const WS_SECTIONS = { scope: 'Overflow scope.', decisions: '', findings: '', questions: '' }
  191 | 
  192 | async function serveWorkspaceApi(page: Page): Promise<void> {
  193 |   await page.route('**/v1/**', async (route) => {
  194 |     const request = route.request(), url = new URL(request.url()), path = url.pathname
  195 |     if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }); return }
  196 |     let data: unknown = []
  197 |     if (path === '/v1/sectors') data = [WS_SECTOR]
  198 |     else if (path === `/v1/sectors/${WS_SECTOR.id}`) data = WS_SECTOR
  199 |     else if (path === '/v1/companies') data = { companies: [], total: 0 }
  200 |     else if (path.endsWith('/research-session')) data = WS_RESEARCH
  201 |     else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [WS_RESEARCH, ...WS_NORMALS] : []
  202 |     else if (path.endsWith('/global-context')) data = { sectorId: WS_SECTOR.id, version: 0, sections: WS_SECTIONS, markdown: '## Scope\n\nOverflow scope.', researchSessionId: WS_RESEARCH.id, changes: [] }
  203 |     else if (path.endsWith('/progress')) data = { sectorId: WS_SECTOR.id, state: WS_SECTOR.state, planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  204 |     else if (path.endsWith('/files')) data = []
  205 |     else if (path.endsWith('/threads')) data = [{ key: WS_RESEARCH.id, sessionId: WS_RESEARCH.id, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: WS_AT }]
  206 |     else if (path.endsWith('/messages')) data = []
  207 |     else if (path.endsWith('/context')) data = { threadKey: WS_RESEARCH.id, notes: '', summary: '', coveredSeq: 0, version: 0 }
  208 |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  209 |     else if (path.startsWith('/v1/sessions/')) data = WS_RESEARCH
  210 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  211 |   })
  212 | }
  213 | 
  214 | test('scrollbars: workspace session rail stays thin under overflow', async ({ page }) => {
  215 |   await page.setViewportSize({ width: 1440, height: 900 })
  216 |   await serveWorkspaceApi(page)
  217 |   await page.goto(`/?section=SectorChat&sector=${WS_SECTOR.id}&session=${WS_RESEARCH.id}&thread=${WS_RESEARCH.id}`)
  218 |   // Sixty chats overflow the rail list (windowed at fifty with Show more).
  219 |   await page.getByRole('button', { name: 'Chats', exact: true }).click()
  220 |   await expect(page.getByRole('button', { name: 'Show more (50 of 60)' })).toBeVisible()
  221 |   const rail = page.getByRole('complementary', { name: 'Sector sessions' }).locator('.scroll-slim.min-h-0.flex-1.space-y-1.overflow-y-auto')
  222 |   await expect(rail).toBeVisible()
  223 |   await thinScrollbar(page, rail)
  224 |   await thinScrollbar(page, page.getByRole('log', { name: 'Conversation messages' }))
  225 |   await shot(page, 'scroll-workspace-rail', [page.getByRole('group', { name: 'Session types' })])
  226 | })
  227 | 
  228 | test('scrollbars: dark chat keeps the same thin treatment', async ({ page }) => {
  229 |   await page.setViewportSize({ width: 1440, height: 900 })
  230 |   await serveScrollbarApi(page)
  231 |   await page.goto('/')
  232 |   await page.getByRole('button', { name: 'Theme' }).click()
  233 |   await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  234 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  235 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  236 |   await expect(chat.getByText('Scroll probe message 1 with enough text to fill the chat list.', { exact: true })).toBeVisible()
  237 |   await thinScrollbar(page, chat.locator('[aria-label="Chat messages"]'))
  238 |   await shot(page, 'scroll-chat-dark', [
  239 |     chat.getByRole('columnheader', { name: 'filename' }),
  240 |     chat.getByText('overflow-doc-8.md').first(),
  241 |   ])
  242 | })
  243 | 
```