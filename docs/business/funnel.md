# Funnel, benchmarks and reviews

Status: locked · Last updated: 2026-10-26 · Source: kardata_old/campaign/campaign-size.md, benchmarks.md (verified
2026-10-07/11), gate-review.md, owner session 2026-10-24

## Benchmarks (outside data, checked 2026-10)

- **Cold email reply rates:**
  - the platform average is about 3.4–5% (Instantly, Woodpecker, Hunter);
  - well-run campaigns get 5–10%, and the top ones above 10%;
  - **under 1% means a deliverability or list problem.**
- **What lifts replies:**
  - personalised emails reply at about twice the rate of generic ones;
  - small batches (50 or fewer) beat 1,000+ by roughly 5.8% to 2.1%;
  - 3–5 touches beat 1 touch by roughly 8.3% to 4.1%;
  - contacting 2+ people per company gives about +93%.
- **The strictest measure** (unique replies ÷ sent, 7.5M agency emails) is about 0.45%. It uses a different
  denominator, so don't compare it directly with the figures above.
- **Cold calls:** the owner's reference funnel is 100 dials → 30 connects → 10 meetings → 5 held → 1 client. Plan on
  about **10% connects**, which is more conservative.

## Email maths (base case)

| Step | Rate |
|---|---|
| Reply | 5% |
| Positive replies | 30% |
| Positive reply → meeting | 50% |
| Meeting → client | 25% |

That gives about **0.19% per contact**, roughly 1 client per 530 contacts. Chance of at least one client:

| Contacts | Base case | Good case (7% reply, 35% positive) |
|---|---|---|
| 400 | 53% | 71% |
| 800 | 78% | 91% |
| 1,000 | 85% | 95% |
| 1,500 | 94% | 99% |

- **Batch shape:** 100 contacts a week, sent as two groups of 50, with 1 + 3 touches.
- **Tier C batch (low-revenue brands, D-25):** 30–50 companies, run alongside the main list, not instead of it. Track them
  as their own group in the review after every 100 contacts.

## Call maths (owner plan)

- **100 dials a week for 12 weeks** = 1,200 dials → about 120 connects → about 12–18 meetings → 50%+ held with
  confirmations.
- **Realistic in 100 days:** 1 paid audit. A retainer in that time is a stretch.
- **Risks:**
  - getting enough phone numbers: 300–400 prospects at 3–4 tries each;
  - calling hours across time zones;
  - the December holidays: book meetings for January;
  - how many booked meetings actually happen.

## What we track (one row per contact)

- **Who:** company, tier, layer, buyer name/title, channel (email/call), buyer slot (1/2).
- **What we said:** the hook fact and its type, the T1 word count, touch dates.
- **What happened:** reply class with the reply word for word, meeting date, audit status, value found, retainer
  status.

**Reply classes:**
- `positive`: wants a call or info.
- `neutral`: a question or objection.
- `negative`: no, or stop.
- `oos`: out of office.
- `bounce`.

**Call outcomes:** dial, connect, gatekeeper map, booked, held.

## Review after every 100 contacts (pooled with earlier batches)

| Result | What to do |
|---|---|
| 0 replies | Check deliverability first (seed tests, bounces, spam), then the hook and copy |
| 1–2 replies | Retest the same profile with a tweaked hook. No scaling, no kill |
| 3+ replies | Scale it: copy the winning structure and hook type |

**Also read:**
- replies by hook type;
- replies by T1 length (only from 300 contacts on);
- buyer 1 vs buyer 2;
- F2 (the email with the price) vs F1;
- price objections.

**Change price only if price is the top objection** at 300+ contacts while replies are healthy (3%+).

**Switch sector only if 400+ delivered contacts get under 1% replies.** Never earlier.
