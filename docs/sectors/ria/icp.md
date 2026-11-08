# RIA ICP

Status: draft · Last updated: 2026-11-08 · Source: D-69, `hedge/ria/` research (owner's checkout)

## Terms (use only these)
Every firm in the sector gets one decision: **Accept**, **Hold** or **Reject**. Accepted firms get a **Tier** (0, 1 or 2).
Nothing is deleted; each firm keeps its decision and the reason.

## 1. Reject
Checked in this order; the first that applies is the reason.
- `not_active`: exempt reporting adviser, registration not active, or not in the newest SEC file.
- `not_us`: main office outside the US.
- `large`: over $10B regulatory AUM or over 100 employees.
- `no_staff`: 0 employees.

## 2. Hold
- `hold_not_wealth`: individuals and high-net-worth individuals are under half of clients, or the share is unknown
  (funds, companies, pensions). Not rejected: kept for a later phase with its own offer.

## 3. Accept, by tier
Accepted = registered with the SEC, active, main office in the US, wealth-focused (individuals and high-net-worth
individuals at least half of clients, Form ADV Item 5.D), up to $10B AUM and 1–100 employees.

| Tier | Rule | Why we call | What we offer |
|---|---|---|---|
| Tier 0 | 1 employee (solo) | First, for experience: the owner answers and decides alone | A small fixed job on one task ($500–1,500, 1–2 weeks) |
| Tier 1 | 2–100 employees and not Tier 2 | For experience and small jobs | A small fixed job on one task ($500–1,500, 1–2 weeks) |
| Tier 2 | $500M–$10B AUM and 10–100 employees | Main target; called after the US holiday week (from 2026-11-30) | A one-time check, then monthly work ($1–3k a month, a guess to test) |

Calling order: Tier 0, then Tier 1, then Tier 2. Revenue, if needed, is estimated as AUM × 0.8% and always labelled an
estimate.

## 4. Signals (each needs stored, quoted, dated evidence; evidence-rules.md applies)
| Key | Signal | Where it shows |
|---|---|---|
| `heavy_book` | Accounts or clients per employee in the top 25% of the firm's tier | Part 1 (accounts, clients, employees) |
| `multi_custodian` | Two or more custodians | Brochure Item 12, Part 1 |
| `growth` | AUM up 30%+ year on year, or staff up 20%+ and at least +2 people | SEC file history |
| `many_services` | Three or more service lines (planning, tax, insurance, retirement plan consulting, trusts/estates, investment management) | Brochure Item 4 |
| `outside_managers` | Outside managers, sub-advisers, wrap programs, model or TAMP providers | Brochure Items 4/8 |
| `alternatives` | Private funds or alternatives advised | Brochure, Part 1 Schedule D count |
| `custody_work` | Standing letters of authorization, third-party money movement, or surprise custody exams | Brochure Item 15 |
| `fee_complexity` | All three structural traits: family grouping, two or more fee types, and advance billing with proration or refunds. Negotiable wording is boilerplate and never counts | Brochure Item 5 |
| `regulatory_disclosure` | Any Part 1 Item 11 disclosure answer is Yes (code only, from the SEC file) | Part 1 Item 11 |
| `fee_problem` | RETIRED from the light path (never scored, never a lead) until it can be based on Part 1 disclosure answers; deep research only | — |
| `tool_sprawl` | Two or more distinct named software systems (portfolio, billing, CRM, planning, trading); custodians do not count | Brochure, website |
| `recent_deal` | Bought, merged with or was bought by another firm in the last 18 months; clients moved over | Deep research only |
| `ops_hiring` | Job post in the last 6 months for operations, billing, client service or onboarding staff | Deep research only |
Score = number of signals found. Layer = priority inside the tier: higher score is called first.
Score 0 is still called (owner calls every company), last. The sheet shows each firm's top 3 signals
ordered by rarity, plus a "Lead signal" column. The lead signal is the firm's rarest
counted signal (frequency over all accepted firms of its tier), for the call opener.

**Light path (Stage 5.8).** The light steps (firm data → brochure → ops read → contacts → signals)
compute these signals from stored facts in code, with no research run. The ops read is one model call
over brochure Items 4, 5, 8, 12, 14 and 15; every value is kept only with a verbatim quote that
grounds in the brochure text (PDF-normalised on both sides). `recent_deal` and `ops_hiring` come only
from deep research.

## 5. Who to contact
Tier 2: the COO, director or head of operations; else the chief compliance officer; else a founder.
Tier 1: the founder or managing partner; else an operations or office manager.
Tier 0: the owner (the only employee).
Names come from Schedule A, the website team page and stored leader records. Phone: the firm's main number from the
SEC file. Direct numbers and emails only from bought Apollo contacts (D-67).

## 6. What never counts as evidence
Guesses from the firm's size, a fee schedule that is simple, or "every firm has this problem". A signal is a fact
about this firm, with a source and a date.

