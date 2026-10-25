# Offer

Status: locked structure, **Tier A price open** (see decisions.md D-32) · Last updated: 2026-10-26 · Source:
kardata_old/campaign/offer-onepager.md v3 (2026-10-13), owner sessions 2026-10-23 and 2026-10-26 (offer by tier)

The prices are fixed and there is no haggling. The only thing decided case by case is which retainer level fits, and
that is decided at the audit readout, never in an email.

## Offer by tier (D-30)

The tier is the company's annual revenue (`icp.md` section 4). It sets which offer we pitch.

| Tier | Size | Pitch | The diagnostic fee |
|---|---|---|---|
| **A** | $10M+ revenue | Diagnostic, then we build the fix: $3–6k (what the $3–6k covers is open, D-32) | Credited against the build if they hire us to build the fix |
| **B** | $2M–10M revenue | **$1,500 diagnostic** (the audit in section 1), then the retainer | Credited against the retainer if they retain us |
| **C** | $500k–2M revenue | **$1,000** diagnostic plus one build, then $1,000/mo active work or $500/mo support (section 1b) | Already includes the build |

- **"Credited" means the fee comes off their next bill.** We don't hand the money back. The only money-back case is
  the guarantee.
- **Never show the Tier C offer to a Tier A or B company.**

## The one value formula (used everywhere)

**Recoverable value per month** = hours spent on repeatable work × loaded hourly cost + revenue at risk that the data
ties to a cause we can fix.

- Every audit report shows this number, with the method and inputs, so the client can check the maths.
- Our internal estimates before a call use the same formula. Prospecting, the guarantee and the retainer rule all
  measure the same thing.
- **Default hourly costs,** unless the client gives real ones: $45/hr for ops, support and warehouse roles; $70/hr
  for sales and marketing roles.
- **Internal estimates are never quoted to a prospect.**

## 1. The audit (entry product)

- **One business question,** chosen with the buyer on the call, answered from their own data.
- **Price (Tier B):** $1,500 fixed, about 3 days of work (D-07). The Tier A diagnostic price is open (D-32).

**Audit types for D2C (pick one on the call):**

| Audit type | The question it answers | Typical data |
|---|---|---|
| One true number across channels | What did we actually sell and earn last week, across every channel? | Store (Shopify, WooCommerce, etc.), Amazon Seller Central, retailer reports, ad accounts |
| Customers and retention | Who buys again, who stops, and why? | Store orders, Klaviyo, subscription app, reviews |
| Ops and inventory | Where do hours and stock go: stock-outs, retailer purchase orders, manual reports? | Store/3PL inventory, PO emails/PDFs, spreadsheets, helpdesk |

If the founder names a problem outside all three, take it only if one export can answer it within the audit window.
Otherwise say so plainly and offer to scope it separately.

**What they get (same shape every time):**

1. **What repeats:** the 3–5 patterns going unnoticed, with counts.
2. **What it costs:** recoverable value per month, with the method shown.
3. **What to fix first:** the two fixes I'd do first, each with its expected effect and effort.
4. **What's ready for AI:** which patterns could be automated now, and which need cleanup first.
5. **Readout call:** 45 minutes.

They keep the report and the working sheet whatever happens next.

**How it runs:**
- **Inputs:** a 30-minute kickoff, read-only exports or API access, and one named contact. Nothing else is asked of
  their team.
- **Out of scope:** building dashboards, changing their tools, and anything that needs write access.

**Terms:**
- Paid upfront.
- **The full fee is credited** against the first two retainer months if they continue.
- **Guarantee (said on the call, never in email):** if the report doesn't find at least **10× the audit fee per
  year** in recoverable value, the full fee comes back. At $1,500 that's $15,000 a year.

**The first 2 audits** are free, or $500 (the owner decides on the day), in exchange for:
- a testimonial;
- a logo;
- permission to quote one number.

Say it honestly: "I'm building my case studies, so I'm doing two of these free." This happens twice only, then the
offer is retired.

## 1b. The Tier C package ($500k–2M revenue only, D-26, D-30)

For brands at about **$500k–2M revenue**. They can't pay for the full audit plus a retainer. But while we have no
clients, a small paid job brings in cash and gives us our first case study and testimonial.

| Part | Price | Limit |
|---|---|---|
| **Diagnostic plus one build** | **$1,000** fixed, paid upfront | At most **5 working days** in total |
| **Active work** (optional, monthly) | **$1,000/mo** | A fixed number of hours, about 10 a month (working limit) |
| **Support only** (optional, monthly) | **$500/mo** | Fixes to what we built. No new work |

- **The diagnostic** is the same "what repeats" and "what it costs" as the audit report, but shorter.
- **The build** is one small thing, for example a weekly sheet with one true sales number across their store and
  Amazon. Anything bigger is quoted separately.
- **No 10× guarantee,** because small brands have smaller problems.
- **Limit:** at most 2 Tier C clients in progress at the same time, so outreach to Tiers A and B doesn't stop.
- The build is a report or sheet on their own data, not an automation, so it doesn't break the rule in section 3.

## 2. The retainer (monthly)

| | Core | Full |
|---|---|---|
| Price | $3k/mo | $5k/mo (range $3–6k, see D-07) |
| Scope | 1 audit type | Up to 3 audit types |
| Data sources | Up to 2 | Up to 4 |
| Reporting | A weekly report you can open every Monday | Live dashboards plus the weekly report |
| Fixes | One fix specified and shipped with their team each month | One small fix or automation built each month (up to ~10 h) |
| Contact | Monthly review call | Monthly review call plus Slack |

- **The client pays the infrastructure** on top, about $50–200/mo.
- **Term:** a 3-month initial term, then month to month with 30 days' notice.
- **Every monthly review reports recoverable value against the audit baseline.** If it isn't moving after month 3,
  say so before they ask.

**The honesty rule:**
- **Recommend a retainer only when the audit measured at least 3× the monthly fee:** $9k/mo or more for Core,
  $15k/mo or more for Full.
- Below that, say so. They keep the report, and the two fixes can be quoted as a one-off project.
- A client who pays $3k to recover $4k churns by month 3 and never refers anyone. Turning that one down is what makes
  the yes believable.

## 3. Automation projects (after the retainer only)

- **What:** larger builds such as AI agents on clean data, alerts and matching rules. Quoted per job at $2–5k, plus a
  retainer increase.
- **Never offered in outreach.**
- **Never sold without the retainer.** The live reporting is what proves the automation worked.
- The Tier C build (section 1b) is not an automation project.

## Confirmation questions (on the call, before offering the audit)

Public signal plus one question confirms the problem. Use the question for the audit type the conversation is
heading to:

- **Across channels:** "When you look at last week's sales, how many places do you pull numbers from?"
- **Customers:** "Of the customers who stopped buying this year, how many could you have spotted three months
  earlier?"
- **Ops:** "When a retailer order comes in, how does it get from the email into your system?"

**If they push back on the observation:** "Fair enough, that was just the outside view. What does it look like from
the inside?" Then ask about the problem *they* name.

**If they confirm the pain,** offer the audit on the call: the fixed price, the timeline, the report is theirs, the fee
is credited if they continue, and the fee comes back if it can't find 10× its value per year.
