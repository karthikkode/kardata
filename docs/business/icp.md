# ICP — who we sell to

Status: draft (scoring weights open until the first 100 contacts) · Last updated: 2026-10-26 · Source:
kardata_old/campaign/icp-filters.md + sector-plan.md (structure), owner 2026-10-19 (D2C target), owner 2026-10-26 (filters), Kardata DB
(counts)

The structure is the same for every sector:
1. filters;
2. exclusions;
3. a stack check;
4. a signal score, which sets the tier;
5. the buyer.

Only the signals change from sector to sector. The D2C version is below.

## 1. Filters (all must pass, D-24)

There are only two real filters:
1. **A D2C brand** selling its own products from its own online store. We need public data on a company before we
   reach out, and D2C brands put that data out in the open.
2. **Enough revenue to pay,** and enough for us to show value (D-25). There is no upper limit.
   - **About $2M a year or more:** the main list. They get the full offer, the audit leading to a retainer. Apollo
     has no revenue figures, so 11+ staff stands in for it.
   - **About $500k–2M:** a separate, small batch of 30–50 companies. They get the starter package (`offer.md`
     section 1b). About 5–10 staff stands in for it.
   - **Under about $500k:** not contacted.

Two more rules, which are market choices and not ways to judge a company:
- **HQ:** United States, United Kingdom, Canada or Australia.
- **Layer 1** (skincare, body and bath, men's grooming) first, then Layer 2.

**The store platform is not a filter** (D-23). Shopify, WooCommerce, BigCommerce or a custom store all qualify. The
problem we fix, disconnected systems, is the same on every platform. Shopify only makes the audit faster, because its
exports and APIs are standard.

## 2. Exclusions (skip, and never bring back unless the rule itself changes)

- **Has a data team:** 2+ data job titles, or any "Head/VP of Data". A hard no: our work would end up as a task for
  their data team.
- **Not a real D2C brand:** clinics, salons, spas, distributors, agencies, dead or parked sites.
- **Too small to pay:** under about $500k revenue.
- **Only one signal:** a lone signal is never enough to pitch.

**These are not exclusions:**
- **Has a tech team** (engineers, but no data roles): contact them later in the queue.
- **Owned by a PE fund or a small holding company:** kept.

**Owned by a listed or multi-brand company** (for example Unilever, L'Oréal, Amorepacific, Shiseido): excluded,
unless a source shows the brand has its own founder, CEO or GM who makes decisions (D-28). Its country arms don't make
their own data decisions, and the parent has data teams.

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
- **Tech team flag:** a company with engineers but no data roles keeps its tier, but goes to the back of the queue
  within it.

**A verdict needs 2+ independent signals, and at least one must not be hiring** (see `problem-bar.md`).

## Snapshot (DB, 2026-10-26, Layer 1, after the ICP check under D-24 and D-28)

| Group | Companies |
|---|---|
| Rows checked (753 finished, plus 61 failed, stopped or orphaned runs) | 814 |
| **Tier A** | **149** |
| **Tier B** | **256** |
| **Can be contacted (A + B)** | **405** |
| Watchlist (score 0–1, or no second system) | 348 |
| Excluded | 61 |
| Fit the starter band (5–10 staff) | 10 |
| On Shopify (for information only, not a filter since D-23) | 752 of 753 |

**What the check changed:** strict evidence moved many companies down, and the new group rule brought many back. 24
companies had no second system holding data and went to the watchlist. All the spa- and salon-named companies left
in A/B sell their own products.

**The Apollo pull is narrower than the ICP now.** It required Shopify and capped staff at 100, so brands on other
platforms or above 100 staff were never imported. The next pull uses only: D2C, US/UK/CA/AU, and 11+ staff. A
separate pull of 5–10 staff brands feeds the starter batch, since we have only 10.

Contacts: 753 companies × 2 buyers ≈ 1,500 contacts. That is enough for the funnel in `funnel.md` without a second
sector.

## 5. Buyer (who we contact)

- **For a brand owned by a group,** the buyer is the brand's own founder, CEO or GM, never someone at the parent.
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
