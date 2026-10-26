Status: done · Date: 2026-10-26

# Stage 4.3 — Quote grounding

**Why:** 4.2's value-matching check marks 58% of extractor items `unverified`, which mixes two things:
- **not checkable:** 311 booleans, 160 long texts, 71 json values;
- **check misses:** EU decimal commas (`80,00 €`), "100 employees" in the Apollo JSON, `$108.90` vs `108.9`,
  and so on.

Among checkable numbers and money, about a third are unverified. The number is meaningless until those two
are separated, and value matching can never verify a boolean, a retailer list or an event.

## Step 1 — Quotes in extraction

- Every extracted fact, record and finding carries **`quote`**: a verbatim span (≤ 300 chars) **copied from
  the provided text** that supports it, plus the `source_id` the quote comes from (agent-document text
  counts, with its `[src:id]`).
- The output schema requires it. Prompts become `extract-v2`.
- **Server check:** normalize whitespace, quotes/dashes and case, then check that `quote` is a substring of
  that source's stored text, or of the agent-document passage. Store `quote` and `quote_source_id`, with:
  - `verification = verified` when the quote matches **and** the value is consistent with it (numbers:
    normalized, with EU/US decimal forms; bools and long text: the quote match is enough);
  - `quote_mismatch` when the quote isn't found;
  - `doc_only` when the quote is only in an agent document whose cited source text doesn't contain it;
  - `unverified` when there is no quote.
- Fix the value normalizer: EU decimals, thousands separators, currency symbols and codes, "k/M" suffixes,
  ranges ("93–97") and percentages. Unit tests for each.

## Step 2 — Use it

- `company_screen(verifiedOnly)` and `company_context` default to `verified` + `doc_only`. Others are shown
  only when asked (`includeUnverified`).
- The scorecard reports shares per kind (number, money, date, short_text, bool, long_text, record type).
- Re-run extraction (v2) on the 10 v1.2 runs, with no re-research.

**AC:**
- **Of all extractor items, ≥ 85% are `verified` or `doc_only`; `quote_mismatch` ≤ 5%.**
- Report the shares, and 10 random `quote_mismatch` items with the reason (an extractor paraphrase or a
  truncated source).

## Review and stop

Append "4.3" to `docs/reviews/stage-4.1-review.md` (≤ 30 more lines). STOP. No push.
