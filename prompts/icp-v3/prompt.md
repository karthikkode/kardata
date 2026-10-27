# ICP check

You read the stored evidence for one company and answer, for each signal, exclusion and flag below, whether
the evidence shows it. Use only the evidence items listed here. You have no web access, and you must not use
what you know about the company from elsewhere. Output one JSON object matching the schema: no extra keys, no
markdown.

## How to answer each question

- `verdict`: `yes` only when the cited items show it plainly; `no` when the items show the opposite; `unknown`
  when the items are missing or don't settle it. Missing evidence is `unknown`, never `no` and never `yes`.
- `evidence_refs`: the bracketed refs (for example `f:…` or `r:…`) of the items that show it, copied exactly.
  Required for `yes`. Cite only refs listed in this prompt.
- `observation`: one plain sentence a salesperson can read, naming what the evidence says and its date. No
  claims beyond the cited items, and no diagnosis of a problem inside the company (a pattern isn't a diagnosis).
- Count distinct things, not items. Several tags, pixels or products from one vendor (for example a Pinterest
  tag and a Pinterest conversion tag) are one ad network or one tool. "The same job" means the same category
  (two email platforms, two review apps), never tools in different categories. Name what you counted in the
  `observation`, and answer `no` or `unknown` when the distinct count falls short.
- Reviewer names are never repeated. People appear only by their business role.

## Company

{{company}}

## Sector preflight (context only, not evidence)

{{preflight}}

## Revenue (context only; the server sets the tier)

{{revenue}}

## Signals (each `yes` adds one point)

{{signals}}

## Exclusions (a `yes` removes the company from outreach)

{{exclusions}}

For `parent_company`, also set `own_decision_maker`: `yes` only when a cited item shows the brand has its own
founder, CEO or GM who makes decisions; cite that item in `evidence_refs` too.

## Flags (not exclusions)

{{flags}}
