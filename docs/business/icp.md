# ICP — who we sell to

Status: draft (scoring weights open until the first 100 contacts) · Last updated: 2026-10-26 · Source:
kardata_old/campaign/icp-filters.md + sector-plan.md (structure), owner 2026-10-19 (D2C target), owner 2026-10-26 (filters, tiers and layers), Kardata DB
(counts)

The structure is the same for every sector:
1. filters;
2. exclusions;
3. a stack check;
4. the tier: annual revenue, which sets the offer and price;
5. the layer: the signal score, which sets who we contact first inside a tier;
6. the buyer.

## Terms (D-29)

- **Tier** = how much the company earns (annual revenue), not how many staff it has. It decides which offer and
  price we pitch. It exists for our convenience, to group the list.
  - **Tier A:** high revenue. **Tier B:** mid revenue. **Tier C:** low revenue.
- **Layer** = priority inside a tier, set by the signal score. **Layer 1 has the highest score**, and the layer number
  goes up as the score goes down. "Tier B, Layer 1" means a mid-revenue company with the strongest signals.
- **Watchlist:** score 0. Not in any layer and never contacted. Score 1 is Layer 6 (D-64).
- **Research wave:** which group of companies gets researched first (wave 1: skincare, body and bath, men's
  grooming; wave 2: 156 more, counted 2026-10-26 from sector preflight). Older plans and reviews call this "Layer 1/Layer 2". That old use is retired.
- **Older docs and the 2026-10-26 ICP check** used "Tier A/B" for the signal score. That old use is retired too. Read
  old "Tier A" as score 3+ and old "Tier B" as score 2.

Only the signals change from sector to sector. The D2C version is below.

## 1. Filters (all must pass, D-24)

There are only two real filters:
1. **A D2C brand** selling its own products from its own online store. We need public data on a company before we
   reach out, and D2C brands put that data out in the open.
2. **Enough revenue to pay,** and enough for us to show value (D-25). There is no upper limit. Under about $500k
   is not contacted. Above that, revenue sets the tier (section 4).

**HQ:** United States, United Kingdom, Canada or Australia. This is a market choice, not a way to judge a company.
Research runs in waves: wave 1 first, then wave 2.

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
- **Has a tech team** (engineers, but no data roles): contact them last within their layer.
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

## 4. Tier: annual revenue → offer (D-29, D-33, D-34)

| Tier | Annual revenue (working lines, D-31) | Offer (`offer.md`) |
|---|---|---|
| **A** | $10M or more | $2,500 diagnostic, credited against a $3–6k build |
| **B** | $2M–10M | $1,500 diagnostic, credited against a $2k / $3k / $5k retainer |
| **C** | $500k–2M | $1,250 diagnostic plus one build; then $750/mo active work or $400/mo support |

**Where the revenue number comes from, best first:**
1. A revenue figure with a named public source (an interview, a press article, a filing).
2. Apollo's "Annual Revenue" estimate, which we store for each company (`financials.revenue_estimate`).
3. If both are missing, the staff count stands in for it, at about $175k per person (range $150–200k). Mark the tier as "estimated
   from staff".

Revenue figures from outside are estimates. **The buyer's own answer on a call always wins,** and the tier is
updated to match.

Never write a tier into an email or call opener. It's for our grouping only.

- **Tier C is a small, separate batch** of 30–50 companies, run alongside A and B, not instead of them.
- **Never show the Tier C offer to a Tier A or B company.** It includes a build for less than a Tier B diagnostic.

## 5. Layer: signal score → priority inside a tier (0–6)

Each signal adds 1 point, up to 6. Every point needs the evidence standard in `evidence-rules.md`.

| # | Signal | Where it is in our data |
|---|---|---|
| 1 | **Sells across channels:** Amazon, or 3+ retailers, or wholesale | `records.type = retailer`, Amazon facts, `business_model.wholesale` |
| 2 | **Hiring for manual work:** ops, inventory, planning, analyst, Excel-heavy roles | `records.type = job_posting` (open the JD text) |
| 3 | **Revenue left on the table:** products bought again but no subscription; best sellers out of stock; heavy, constant discounting | `business_model.subscription`, `records.type = product`, promo events |
| 4 | **Customer pain in reviews:** shipping, stock or order complaints, dated within the last 12 months | `records.type = review` (dated), `review_theme` |
| 5 | **A recent change:** funding in the last 18 months, a new retailer, a new channel, a rebrand | `funding_event`, `company_event` |
| 6 | **Tool sprawl:** 2+ tools doing the same job, or 4+ ad networks running | `marketing.tool` facts |

**Layer = 7 − score**, so each score has its own layer:

| Layer | Score | First contact |
|---|---|---|
| 1 | 6 | Call first; email if the call doesn't land |
| 2 | 5 | Call first |
| 3 | 4 | Call first |
| 4 | 3 | Call first |
| 5 | 2 | Email first; call only those who open or reply, or where the evidence is unusually sharp |
| 6 | 1 | Discovery call: learn how they run, no problem claim. One signal is never enough to pitch a problem (D-64) |
| Watchlist | 0 | Never contacted |

- **Work order:** inside each tier, Layer 1 first, then Layer 2, and so on.
- **Tech team flag:** a company with engineers but no data roles keeps its layer, but goes last within it.

**A problem claim (verdict) needs 2+ independent signals, and at least one must not be hiring** (see `problem-bar.md`). Layer 6 is contacted without one.

See docs/sectors/skincare/results.md for the 2026-10-26 snapshot.
