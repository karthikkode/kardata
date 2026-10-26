Status: done · Date: 2026-10-26
Banner (2026-10-26): in this old review, "Layer 1/2" means research wave and "core/adjacent" is retired (see docs/business/icp.md, Terms). Company names below predate the no-names rule in AGENTS.md.

# Stage 5.1 review: sector preflight (eligibility) pass

## 25-company checkpoint (tripped 13:27 UTC at exactly 25; Step 0 cancelled 2476 queued as superseded)
- Per company: 116.7 facts / 144.3 records / 34.5 findings. Areas: done 309, not_found 46, error 5, skipped 7.
- Failures by stage+reason: preflight 36 failed (34 server-restart orphans, 2 no-report) + 43 server_stopped + 3 stall; collect 13 failed (2 bot walls, 1 timeout, 1 DNS, 1 robots, 1 fetch, 3 restarted); research 4 failed (all restarted) + 23 server_stopped + 10 stall. All transient retried; honest terminals: Shelton's (dead domain), Casa (timeout x2), Suppl (robots), SABON (fetch).
- Verification, v1.3+ extractor rows: facts 263 verified / 426 verified_value / 1055 doc_only / 76 mismatch / 0 unverified; records 153 / 132 / 461 / 12 / 0. Combined: 16% / 22% / 59% / 3% / 0%.
- Minutes/company/stage (avg): preflight 1.8, collect 1.7, research 11.3, extraction 6.7. Tokens/company: preflight 728K in, research ~10.2M in (cached incl.). Quota: null (app Muse exposes no usage surface).

## Sector preflight, full pass (job b22cb0e, 2539 companies in 39.9 min)
- 2539/2539 succeeded, 0 failed. 138.7M input / 4.75M output tokens. Concurrency 16->32->64, 5 clean min per level, no step-backs. Mem holds 0, rate limits 0; lowest MemAvailable 48.6 GB (floor 12 GB).
- Eligibility (all 2559): eligible 700, review 1124, ineligible 735. Top buckets: dtc_brand x skincare x eligible 564; dtc_brand x makeup/haircare/supplements x review 229/178/167; retailer x other x ineligible 166; dtc_brand x other x ineligible 149; clinic x skincare x ineligible 96.
- 20-company live check passed first (7 eligible / 8 review / 5 ineligible); full pass gated on it.

## Spot checks (10 random)
- Organic to Green | dtc skincare | eligible — own Shopify line. "Liquid coconut oil for skin, face and hair..."
- LYCON Cosmetics | dtc skincare | eligible — own wax/skincare store. "Shop skincare, home waxing kits..."
- Greeniche | dtc supplements | review — vitamins, category edge. "leading provider of natural health..."
- Think Goodness | dtc other, low | review — jewelry/makeup mix, empty products.json.
- JEZ V | dtc skincare, medium | ineligible — intimate care, out of scope.
- Pasante | dtc other | ineligible — condoms. Youth Lab | clinic skincare | ineligible — Perth injectables clinic.
- Bragg | dtc supplements | review — food products (quote picked page chrome, weak).
- HigherDOSE | dtc supplements, medium | review — wellness devices (quote picked JS selector, weak).
- Dimple | dtc other | ineligible — contact lenses, correctly out.

## Deltas from plan
- 0021: sector_preflight runs exempt from one-active-run index (coexist with company runs); launch failures fail the item, not the job. 0022: bot-wall rules (blocked collect proceeds; v1.4 fetch order; evidence grades; web_searches logging). Quote picker sometimes grabs page chrome/JS — extractor-side, next stage.
