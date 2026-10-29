# Skincare results

Written before D-67: "contactable" and "can be contacted" below mean ICP accepted. Today contactable means an
Apollo-verified email (`docs/business/icp.md`, Terms).

## Snapshot (DB, 2026-10-26, research wave 1, after the ICP check and the tier split)

| Group | Companies |
|---|---|
| Rows checked | 814 |
| **Can be contacted now (Layers 1-5)** | **378** |
| Watchlist (score 0-1) | 262 |
| Research incomplete (zero facts; rerun pending) | 82 |
| Excluded (incl. 52 under $500k) | 92 |

Contactable by tier and layer (no company reached Layer 1):

| | Layer 2 | Layer 3 | Layer 4 | Layer 5 | Total |
|---|---|---|---|---|---|
| Tier A | 0 | 10 | 34 | 46 | 90 |
| Tier B | 2 | 11 | 70 | 169 | 252 |
| Tier C | 0 | 3 | 10 | 23 | 36 |

**Where the revenue came from:** a public figure 51, Apollo 382, staff estimate 381. So about half the tiers are
guesses.

**Still to do (revenue re-check):**
- 52 companies were excluded as under $500k on Apollo's figure alone, despite 11+ staff. Many are probably wrong.
- 12 companies have a public figure above $1M per staff member. Check the figure and the parent.
- Run after the AI quota allows; results update the tiers above.

The working list lives in the owner's Google Sheet (one tab per tier, contactable companies only), not in git.

**What the check changed:** strict evidence moved many companies down, and the new group rule brought many back. 24
companies had no second system holding data and went to the watchlist. All the spa- and salon-named companies left
among the contactable ones sell their own products.

**The Apollo pull is narrower than the ICP now.** It required Shopify and capped staff at 100, so brands on other
platforms or above 100 staff were never imported. The next pull uses only: D2C, US/UK/CA/AU, and 11+ staff. A
separate pull of smaller brands (about $500k–2M revenue, or 5–10 staff where revenue is missing) feeds the Tier C batch, since only 36 Tier C companies are contactable now.

Contacts: 753 companies × 2 buyers ≈ 1,500 contacts. That is enough for the funnel in `funnel.md` without a second
sector.

## 6. Buyer (who we contact)

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
