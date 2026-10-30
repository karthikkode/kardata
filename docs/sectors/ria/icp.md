# RIA ICP

Status: draft · Last updated: 2026-10-31 · Source: D-69, `hedge/ria/` research (owner's checkout)

## 1. Who is in
- Registered with the SEC as an investment adviser, main office in the US, registration active.
- Wealth-focused: individuals and high-net-worth individuals are at least half of its clients (Form ADV Item 5.D).
- Not large: regulatory assets under management up to $10B and at most 100 employees. Larger firms are kept aside
  (ineligible, reason "large"), not deleted.

## 2. Kept aside (ineligible, with the reason stored)
- `large`: over $10B regulatory AUM or over 100 employees.
- `not_wealth`: individuals and HNW individuals under half of clients (funds, institutions, pensions).
- `no_staff`: fewer than 2 employees (nobody to buy).
- `exempt_or_inactive`: exempt reporting adviser, or registration not active.
- `not_us`: main office outside the US.

## 3. Size groups (replace D-55 revenue tiers for this sector)
| Group | Regulatory AUM | What we offer |
|---|---|---|
| Proof (P) | under $500M | A small fixed job on one workflow ($500–1,500, 1–2 weeks); first case studies |
| Retainer (R) | $500M–$10B | A one-time check, then monthly or quarterly work ($1–3k a month, a guess to test) |
Revenue, if needed, is estimated as AUM × 0.8% and always labelled an estimate.

## 4. Signals (each needs stored, quoted, dated evidence; evidence-rules.md applies)
| Key | Signal | Where it shows |
|---|---|---|
| `fee_complexity` | Fees that are hard to bill right: tiered schedules with family grouping, negotiable fees, several fee options (percent plus flat or hourly), billing in advance with prorating and refunds | Brochure Item 5 |
| `recent_deal` | Bought, merged with or was bought by another firm in the last 18 months; clients moved over | Filings, press, website |
| `ops_hiring` | Job post in the last 6 months for operations, billing, client service or onboarding staff | Job boards, website careers page |
| `multi_custodian` | Two or more custodians | Brochure Item 12/15, Part 1 |
| `growth` | AUM or staff up 20%+ in a year, or a new office | SEC file history, filings, press |
| `tool_sprawl` | Several named systems (portfolio, billing, CRM, planning) or a system change | Brochure, job posts, website |
| `fee_problem` | A fee or billing disclosure, refund or SEC deficiency on fees | Part 1 disclosures, brochure Item 9, SEC orders |
Score = number of signals found (0–7). Layer = priority inside the size group: higher score is called first.
Score 0 is still called (owner calls every company), last.

## 5. Who to contact
Retainer group: the COO, director or head of operations; else the chief compliance officer; else a founder.
Proof group: the founder or managing partner; else an operations or office manager.
Names come from Schedule A, the website team page and stored leader records. Phone: the firm's main number from the
SEC file. Direct numbers and emails only from bought Apollo contacts (D-67).

## 6. What never counts as evidence
Guesses from the firm's size, a fee schedule that is simple, or "every firm has this problem". A signal is a fact
about this firm, with a source and a date.
