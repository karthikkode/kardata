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
| `heavy_book` | Accounts or clients per employee in the top 25% of the firm's group (P or R) | Part 1 (accounts, clients, employees) |
| `multi_custodian` | Two or more custodians | Brochure Item 12, Part 1 |
| `growth` | AUM up 30%+ year on year, or staff up 20%+ and at least +2 people | SEC file history |
| `many_services` | Three or more service lines (planning, tax, insurance, retirement plan consulting, trusts/estates, investment management) | Brochure Item 4 |
| `outside_managers` | Outside managers, sub-advisers, wrap programs, model or TAMP providers | Brochure Items 4/8 |
| `alternatives` | Private funds or alternatives advised | Brochure, Part 1 Schedule D count |
| `custody_work` | Standing letters of authorization, third-party money movement, or surprise custody exams | Brochure Item 15 |
| `fee_complexity` | All three structural traits: family grouping, two or more fee types, and advance billing with proration or refunds. Negotiable wording is boilerplate and never counts | Brochure Item 5 |
| `fee_problem` | A real fee issue only: a fee-related Part 1 disclosure, or Item 9 text tying fees/billing/overcharging/refunds to a regulator action (order, fine, sanction, consent, deficiency). An ordinary Item 5 refund-of-prepaid-fees sentence does not count | Part 1 disclosures, brochure Item 9, SEC orders |
| `tool_sprawl` | Two or more distinct named software systems (portfolio, billing, CRM, planning, trading); custodians do not count | Brochure, website |
| `recent_deal` | Bought, merged with or was bought by another firm in the last 18 months; clients moved over | Deep research only |
| `ops_hiring` | Job post in the last 6 months for operations, billing, client service or onboarding staff | Deep research only |
Score = number of signals found. Layer = priority inside the size group: higher score is called first.
Score 0 is still called (owner calls every company), last. The sheet shows each firm's top 3 signals
(by lead priority: fee_problem, recent_deal, outside_managers, alternatives,
multi_custodian, custody_work, ops_hiring, many_services, tool_sprawl, heavy_book, growth,
fee_complexity — rarer, firm-specific signals lead; boilerplate-driven ones last) with
quotes, plus a "Lead signal" column naming the strongest one for the call opener.

**Light path (Stage 5.8).** The light steps (firm data → brochure → ops read → contacts → signals)
compute these signals from stored facts in code, with no research run. The ops read is one model call
over brochure Items 4, 5, 8, 12, 14 and 15; every value is kept only with a verbatim quote that
grounds in the brochure text (PDF-normalised on both sides). `recent_deal` and `ops_hiring` come only
from deep research.

## 5. Who to contact
Retainer group: the COO, director or head of operations; else the chief compliance officer; else a founder.
Proof group: the founder or managing partner; else an operations or office manager.
Names come from Schedule A, the website team page and stored leader records. Phone: the firm's main number from the
SEC file. Direct numbers and emails only from bought Apollo contacts (D-67).

## 6. What never counts as evidence
Guesses from the firm's size, a fee schedule that is simple, or "every firm has this problem". A signal is a fact
about this firm, with a source and a date.

