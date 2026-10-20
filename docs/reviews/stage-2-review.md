# Stage 2 review — research store and collectors

Branch `stage-2`. Full suite: 188/188 green. No push.

## Acceptance criteria

- Store: 15 tables, enums, checks, GINs (`src/db/schema.ts`), migrations
  0001–0005. Seeds: 29 keys, 11 types. Proof: `tests/db/migrate.test.ts`,
  `tests/db/research-schema.test.ts`, `tests/db/research-model.test.ts` (22).
- Validators: 9 value types, auto-create + warnings, near-dup warnings, 5 hard
  rejects, provisional widening (`src/domain/research/facts.ts:58`,
  `records.ts:53`). Proof: research-model tests.
- Upsert: created/updated/unchanged, source union (`records.ts:53`).
  `reviews_ingest`: dedupe, identity strip, 5k cap, recomputed facts
  (`reviews.ts:99`). `facts_current` latest (`schema.ts:495`). Proof: same file.
- Constraints: one-active-run, finding source_ids, status reasons.
  Proof: research-schema tests.
- Fetcher: robots, 2s delay, 80 budget, 15s/5MB/5 redirects, SSRF guard,
  cancel-before-fetch (`src/collect/fetch.ts:27-40,54-63`). Proof: 15
  fetch tests against the fake server.
- Collectors: 11, ordered, outcomes merged done>blocked>error>not_found>skipped,
  fatal only on homepage failure (`src/collect/run.ts:30`). Docs carry paths;
  facts/records write strict through the domain. Per-provider endpoint comments
  in jobs/news/sec/wayback/companies-house. Proof: 32 fake-site tests +
  `tests/collect/run.test.ts` (merge, summary, requested-areas).
- Queue: batches ≤100, already_running, cancel, boot recovery, 10-min stall
  reaper, FIFO, COLLECT_CONCURRENCY=3 (`src/runs/queue.ts:18`,
  `src/runs/runner.ts:39`). Proof: `tests/runs/runner.test.ts` (9, fake clock).
- MCP: 28 tools (`src/mcp/research-tools.ts:47`), thin wrappers over the same
  domain/reads functions. Proof: `tests/mcp/research-tools.test.ts` (6),
  `tests/mcp/agent-style.test.ts` (tools-only shift), dossier/context <10KB.
- Smoke: ran 2026-10-20 on C1..C5 (see below): 4 succeeded, 1 partial.

## Deviations

- CH has no website field in its API: issuer match is name/postcode only.
- `reviews.avg_rating` also takes `platform` (the spec's own example needs it).
- Areas: `fact_keys.area` nullable for general keys; doc area falls back to
  `other` for non-area folders.
- Money facts store `{amount}` + currency column; fact unit is copied key→fact.
- 0004 split from 0003 (PG forbids new enum values mid-transaction); the four
  json-valued review keys are auto-created provisionally by `reviews_ingest`
  instead, so fresh-DB migrate stays green (verified on empty kardata_test).
- Apollo facts impossible without provenance: apollo_profile writes its
  document only; stack skips facts when the homepage source is missing.
- `source_fetch`/`source_capture` reuse one queued agent run per company
  (`queue.ts:80`); the spec is silent on their run provenance.
- `requestedAreas` scopes outcomes (side-effect docs stay); job roles without
  a URL skip records (no natural key).

## Unfinished

- Finding of note: findings cite sources/facts/records only — Apollo import
  data (document-only, no source) cannot be cited by a finding. Fixed in 2.1:
  every import now snapshots an `apollo_import` source per row.

## Stage 2.1 + live smoke (2026-10-20)

Fixes, one commit: operator writes share one `manual` run per company per UTC
day (born succeeded, `created_by=owner`); `getOrCreateAgentRun` deleted.
Proof: `tests/mcp/research-tools.test.ts` (note_add + source_fetch, then
collect_start is queued). Apollo provenance: `createApolloImportSource`,
`findApolloImportSource`, `backfillApolloImportSources`
(`src/domain/research/sources.ts`), import snapshots per row, backfill runs
from `scripts/migrate.ts`; apollo_profile writes the 4 financial facts and
stack cites the import source per detection. Proof:
`tests/db/imports.test.ts`, `tests/db/apollo-provenance.test.ts`,
`tests/collect/apollo-profile.test.ts`, stack tests. Full suite: 195/195.

Dev repair (not a product change): the 2,559 dev companies had no sectors or
imports (smoke-real artifact), so the backfill honestly skipped them. They
were re-imported through the normal path into sector `skincare`: 2,559
updated in place, 2,559 `apollo_import` sources. That also live-verified the
new import-source code.

Smoke: `SMOKE_COMPANY_IDS=C1..C5`, batch `cc415968`, ~2 min. 4 succeeded,
1 partial. Every area of every company has a status. Legend: NF = not_found
with the footnoted reason.

- C1 (succeeded): reviews NF(a), marketing NF(b), financials done,
  business_model done, hiring done, product NF(e), decisions done.
- C2 (succeeded): reviews done, marketing done, financials done,
  business_model NF(c), hiring done, product NF(e), decisions done.
- C3 (succeeded): reviews done, marketing NF(b), financials done,
  business_model done, hiring NF(d), product done, decisions done.
- C4 (succeeded): reviews NF(a), marketing done, financials done,
  business_model NF(c), hiring NF(d), product done, decisions done.
- C5 (partial): reviews done, marketing done, financials done,
  business_model done, hiring NF(d), product ERROR(f), decisions done.

Reasons: (a) no ratings or review app detected; (b) no marketing tools
detected; (c) no About/Wholesale/Subscribe/FAQ pages and no business-model
tools; (d) no Careers pages and no supported job board linked; (e) Apollo
lists Shopify but /products.json does not answer JSON; (f) BUG — shopify
upserted a 500+ product catalog in one call (`at most 500 records per
call`), needs batching.

Collectors that never reached done: news (C1–C3 GDELT HTTP 429 — 3
concurrent runs vs the ~1 req/5s throttle; C4 GDELT 200 invalid JSON; C5
fetch failed); sec_form_d (C4/C5 skipped non-US by design; C1–C3 SEC 403 —
the UA contact is a URL and SEC requires an email-style contact);
companies_house (4 skipped non-UK by design; C4 is UK but skipped —
`COMPANIES_HOUSE_API_KEY` is empty in `.env`); feeds (no RSS/Atom link on
these homepages, by design). Apollo live proof: 28 facts cite
`apollo_import` sources (14 apollo_profile: 5 founded, 5 employees, 2
revenue, 2 funding; 14 stack).

DB growth for 5 companies: 77 → 83 MB (+6 MB); +90 sources, +72 blobs, +32
documents, +194 facts, +382 records, +5 runs, +236 events, +35 statuses.
Projection for 2,559 (×512): ~3.1 GB; ~100k facts, ~200k records, ~46k
sources; ~17 h at COLLECT_CONCURRENCY=3. Skew warning: one 500+ catalog
dominates records; GDELT/SEC currently contribute ~nothing (blocked).

## Stage 2.2 (2026-10-20)

1. Chunked domain writes: `chunked()` (`validate.ts`); `addFacts` /
`upsertRecords` loop slices of the old max, `reviewsIngest` delegates to the
chunked upsert; the 200/500/500 limits moved to the MCP tools with identical
messages. Proof: `tests/db/research-model.test.ts` (201 facts ok),
`tests/mcp/research-tools.test.ts` (all three MCP limits reject),
`tests/collect/shopify-jobs.test.ts` (1,200-product catalog stores 1,200).
Deviation: slices are independent statements, NOT one transaction per chunk —
Postgres aborts a transaction on the first error, which would silently drop
the per-item ok/error contract. `SHOPIFY_MAX_PAGES` 4→8 (2,000-product cap).
2. GDELT: per-host delay map (`api.gdeltproject.org` 6 s) plus
`KARDATA_HOST_DELAYS` env, default still 2 s; 429s retry ≤2 honoring
Retry-After else 10 s (`KARDATA_429_WAIT_MS` test knob; honored values capped
at 60 s); 200-non-JSON → error outcome with the first 200 body chars as the
reason. Proof: `tests/collect/fetch.test.ts` (delay resolution, Retry-After
recovery, give-up-after-2), news non-JSON test in providers tests.
3. SEC: `KARDATA_CONTACT_EMAIL` (in `.env.example`, empty); UA
`Kardata <email>` via a new `FetchOptions.userAgent`; unset → sec_form_d
skipped with `no KARDATA_CONTACT_EMAIL`. Proof: providers SEC tests (skip +
captured UA on search and filing).
4. Shopify: probe `/products.json`, then `/collections/all/products.json`,
then `/{locale}/products.json` (locale from homepage hreflang, else
canonical); pages the winner; not_found reason carries tried paths plus the
last final URL, HTTP status and content-type (`FetchResult.contentType` new).
Proof: shopify fallback/locale/reason tests (2 old reasons updated).
5. Stack-map: census of 677 Apollo names ≥10; new groups attribution,
review_apps, upsell, marketplace; `business_model.marketplace` facts
(walmart/ebay/amazon); exact-line ignore list (Facebook variants, AdSense,
Bing Webmaster Tools). Proof: stack coverage + ignored-only tests.
Full suite: 207/207.

Coverage (name → mapping; ✓ = already mapped, + = new):
ads/pixel → tool + channel: Facebook Pixel → Meta/meta ✓, Google Ads →
Google/google ✓, TikTok + TikTok Ads → TikTok pixel/tiktok +,
Microsoft Advertising + Bing → Microsoft Ads/microsoft ads +,
YouTube Advertising → YouTube ads/youtube +, DoubleClick ×3 → DoubleClick/google +,
Pinterest (+ Conversion Tag) → Pinterest tag/pinterest ✓, TikTok Ads (same needle),
Google Remarketing/Ad Manager/Publisher Tag/Marketing Platform + DV360 → google +,
LinkedIn Ads/Insight Tag/Marketing Solutions (+ licdn scripts) → linkedin +,
Twitter Ads (+ ads-twitter scripts) → twitter +, Amazon Advertising/AMS → amazon +,
Reddit for business → reddit +, AdRoll → adroll +, Criteo → criteo +,
Taboola → taboola +, Outbrain → outbrain +, The Trade Desk → the trade desk +,
Xandr → xandr +, 24-7 Media → 24-7 media +, StackAdapt → stackadapt +,
Simpli.fi → simpli.fi +, TripleLift → triplelift +, Media.net → media.net +,
Content.ad → content.ad +, Open AdStream → open adstream +,
Adobe Advertising Cloud → adobe +, Wider Planet → wider planet +,
Quantcast (×2) → quantcast +, Tapad → tapad +,
Meta Audience Network → meta +, PixelYourSite + AdNabu → tool only +.
affiliate → Impact ✓, Refersion ✓, Grin/creator ✓, ShareASale +, Awin +,
SkimLinks +, Linkshare +, AvantLink +, Everflow +, Amazon Associates +;
referral → Curebit +, ReferralCandy +, Friendbuy +, AddShoppers +;
creator → Foursixty +, Curalate +, Moast +, Tolstoy +.
email/sms → email: Klaviyo ✓ (email+sms), Attentive/Postscript/SMSBump ✓ (sms),
Mailchimp (+ Mandrill/Stores) ✓, Omnisend ✓, SendGrid (×3) +, Mailgun +,
Amazon SES (+ Simple Email Service) +, HubSpot (×3) +, Constant Contact +,
Brevo +, Dotdigital +, MailerLite +, Mailshake +, CampaignMonitor +, Listrak +,
ActiveCampaign +, Flodesk +, Privy +, Wunderkind +, MailChannels +,
ElasticEmail +, Mailjet +, smtp2go +, Postmark +.
review_apps → tool: Yotpo ×4 +, Judge.me +, Shopify Product Reviews +,
Trustpilot +, Stamped +, Loox +, Reviews.io +, Junip +, Bazaarvoice +,
PowerReviews +, Google Customer Reviews +, Reviews.co.uk +, Podium +.
subscriptions → fact: Recharge ✓, Seal ✓, Skio ✓, Bold Commerce +.
loyalty → Smile.io ✓, LoyaltyLion ✓, Yotpo Loyalty ✓, Swell Rewards +.
support → Gorgias ✓, Zendesk ✓, Tidio ✓, Intercom ✓, Help Scout +, Reamaze +,
LiveChat +. bnpl → Afterpay ✓, Klarna (×2) ✓, Affirm ✓, Sezzle +.
wholesale → Faire ✓, Stockist +, Storeify +. attribution → Triple Whale +,
Northbeam +, Black Crow +. upsell → Rebuy +, BOGOS +, Upsellit +, OptiMonk +,
Nosto +. marketplace → Amazon Pay (+ for Business) tool-only +,
Walmart → walmart +, eBay → ebay +, Buy with Prime → amazon +,
Helium 10 → amazon +.
Ignored: Facebook ×6 + AdSense + Bing Webmaster Tools (exact-line filter);
bare Google (ambiguous); YouTube/Vimeo/Instagram ×3/X/Twitter Sharing+Analytics
(presence, not spend); TUNE (needle hits iTunes); Zip (unsafe needle);
payment rails (Apple/Shop/Google Pay, PayPal, Venmo, Stripe, card networks);
platforms (Shopify ×3, Woo, Magento, Wix ×2, Squarespace ×3, BigCommerce,
Adobe Commerce, Centra); analytics/CRO (GA ×3, GTM, GSC, Hotjar, Clarity ×2,
Lucky Orange, MouseFlow, Smartlook, CrazyEgg, Contentsquare, VWO, AB Tasty,
Convert, Shoplift, Replo); CDP (Segment, Lytics); post-purchase (Loop,
AfterShip, ParcelPanel); Octane, Typeform, Jotform, Shogun ×2, PageFly,
GemPages, Beae, Signifyd, WhatsApp ×2, Weglot, Multilingual, HREF Lang.

Smoke re-run #1 (batch `f8551102`, same 5 ids): 5/5 succeeded, NO error areas.
C5 product now done (chunking fix verified live). C1/C2 product not_found with
the new reason (tried both paths; last /collections/all/products.json → 404).
news errored ×5: C1/C4 GDELT 200 with error body, C2/C3/C5 fetch failed; sec
skipped ×5 — `KARDATA_CONTACT_EMAIL` was NOT set (absent from `.env` and env
despite the brief), and `COMPANIES_HOUSE_API_KEY` is still empty, so CH
skipped C4 again. The 200 bodies exposed a real query bug: GDELT answers
`Queries containing OR'd terms must be surrounded by ()` — the
`"name" OR domain` query was never parenthesized, so news could never
succeed. Fixed (`news.ts` always parenthesizes + strips stray quotes; test
asserts the exact query form) — this fix is required by the clean-gate and is
included in 2.2.

Gate smoke (batch `80a76f70`, same 5 ids, vars set, ~1 h GDELT cooldown):
4 succeeded, 1 failed (C1 homepage timeout after 15 s — site-side; all its
areas still have statuses). No ERROR areas. SEC verified live: C1–C3 honest
not_found (email UA, no more 403), C4/C5 skipped non-US by design. CH verified
live: C4 honest not_found, rest skipped non-UK. News still failing: C5 HTTP
429 (throttle persists), C1/C3 fetch failed, C2/C4 HTTP 200 with GDELT error
body — now a further query issue: `One or more of your keywords were too
short, too long or too common: (<domain>)`. The paren fix holds (queries go
out parenthesized), but bare domain OR-terms are rejected; quoting the domain
is the likely next step and needs a live check.
Gate verdict: PUSHED per the 429 fallback (owner go): news is unverified
live, paren fix covered by tests (`providers.test.ts` asserts the exact query
form). Follow-ups: quote GDELT domain terms; re-run smoke after cooldown.
