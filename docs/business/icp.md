# ICP — who we sell to

Status: draft (scoring weights open until the first 100 contacts) · Last updated: 2026-10-25 (tiers revised) · Source:
kardata_old/campaign/icp-filters.md + sector-plan.md (structure), owner 2026-10-19 (D2C target), Kardata DB
(counts)

The structure is the same for every sector:
1. base filters;
2. exclusions;
3. a stack check;
4. a signal score, which sets the tier;
5. the buyer.

Only the signals change from sector to sector. The D2C version is below.

## 1. Base filters (all must pass)

- **Business:** a D2C brand selling its own products from its own online store.
  - Layer 1 (skincare, body and bath, men's grooming) first, then Layer 2.
- **HQ:** United States, United Kingdom, Canada or Australia.
- **Size:** 11–100 staff, which is roughly $2–20M revenue.

These three are already applied in the Apollo export. **All 753 finished Layer 1 companies pass** (DB,
2026-10-25). So in D2C, the tier depends on the signals.

**The store platform is not a filter** (D-23). Shopify, WooCommerce, BigCommerce or a custom store all qualify. The
problem we fix, disconnected systems, is the same on every platform. Shopify only makes the audit faster, because its
exports and APIs are standard.

## 2. Exclusions (skip, and never bring back)

- **Has a data team:** 2+ data job titles, or any "Head/VP of Data". They build it themselves.
- **Owned by a large group** (enterprise parent), or acquired.
- **Not a real D2C brand:** clinics, salons, spas, distributors, agencies, dead or parked sites.
- **Too small to pay:** under ~10 staff with no sign of revenue.
- **Only one signal:** a lone signal is never enough to pitch.

## 3. Stack check (from the stack collector)

- **Must have:** an online store on any platform, plus at least one more system holding sales or customer data:
  - **email or SMS:** Klaviyo, Attentive, Postscript;
  - **subscription:** Recharge;
  - **reviews:** Yotpo, Judge.me, Okendo;
  - **helpdesk:** Gorgias, Zendesk.
- **Better:** several channels, meaning Amazon or 3+ retailers. Disconnected systems are the problem we fix.
- **A solution already in motion** means they're already fixing it: an attribution tool such as Triple Whale, a
  data agency, or a recent data hire.
  - **This is not an exclusion.** Complement what they chose and never challenge it. Open on a gap the tool doesn't
    cover, for example Amazon or retail.

## 4. Signal score → tier (0–6)

Each signal adds 1 point, up to 6. Every point needs the evidence standard in `evidence-rules.md`.

| # | Signal | Where it is in our data |
|---|---|---|
| 1 | **Sells across channels:** Amazon, or 3+ retailers, or wholesale | `records.type = retailer`, Amazon facts, `business_model.wholesale` |
| 2 | **Hiring for manual work:** ops, inventory, planning, analyst, Excel-heavy roles | `records.type = job_posting` (open the JD text) |
| 3 | **Revenue left on the table:** products bought again but no subscription; best sellers out of stock; heavy, constant discounting | `business_model.subscription`, `records.type = product`, promo events |
| 4 | **Customer pain in reviews:** shipping, stock or order complaints, dated within the last 12 months | `records.type = review` (dated), `review_theme` |
| 5 | **A recent change:** funding in the last 18 months, a new retailer, a new channel, a rebrand | `funding_event`, `company_event` |
| 6 | **Tool sprawl:** 2+ tools doing the same job, or 4+ ad networks running | `marketing.tool` facts |

- **Tier A (score 3+):** call first; email if the call doesn't land.
- **Tier B (score 2):** email first; call only the ones who open or reply, or where the evidence is unusually sharp.
- **Watchlist (score 0–1):** never contacted. One signal alone is never enough to pitch.

**A verdict needs 2+ independent signals, and at least one must not be hiring** (see `problem-bar.md`).

## Snapshot (DB, 2026-10-25 evening, Layer 1 finished, agent tier run)

| Filter | Companies |
|---|---|
| Finished, Apollo base filters pass | 753 |
| On Shopify | 752 |
| Confirmed as D2C brands in our own data | 631 (107 unknown, 19 fail) |
| Sells across channels (signal 1) | 604 |
| Excluded (79 big-group owned, 19 not D2C, 9 too small) | 102 |
| **Tier A after exclusions** | **173** |
| **Tier B (score 2) after exclusions** | **244** |
| **Can be contacted** | **417 = ~317 confirmed D2C + ~100 still to confirm** |
| Already using Triple Whale (solution in motion) | ~133 |

The ~100 unconfirmed companies must pass the D2C check before anyone contacts them.

Contacts: 753 companies × 2 buyers ≈ 1,500 contacts. That is enough for the funnel in `funnel.md` without a second
sector.

## 5. Buyer (who we contact)

- **Order of priority:**
  1. Founder/CEO (under ~60 staff).
  2. COO / Head of Operations.
  3. Head of E-commerce / Growth.
  4. Finance lead.
- **Avoid as the first contact:** marketing agency contacts and the CTO. They tend to say "we'll build it".
- **Two buyers per company,** with the same research and a different angle. Send to buyer 2 two business days after
  buyer 1. If either replies, stop both.
- **The angle by buyer:**
  - **Founder:** growth vs workload, margin, hours per week.
  - **COO/Ops:** stock, orders, retailer paperwork, hours.
  - **E-commerce/Growth:** channel truth, repeat customers, wasted ad spend.
