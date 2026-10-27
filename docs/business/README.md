# Business — how Kardata makes money

This folder holds the **business side** of Kardata: who we sell to, what we sell, how we find problems, and how we
reach people. The code in this repo exists to serve it. `docs/plans/` covers how the service gets built, and this
folder covers what the service is for.

**Owner:** Karthik. Only the owner, or Claude acting on his instructions, edits these files. Coding agents read them
and never change them.

## Files

| File | What it answers |
|---|---|
| [strategy.md](strategy.md) | Who we are, the goal and timeline, which sectors, how the business works |
| [offer.md](offer.md) | What we sell: the audit, the retainer, prices, the guarantee, the value formula |
| [icp.md](icp.md) | Who we sell to: filters, exclusions, tiers (revenue → offer), layers (score → priority), buyers |
| [problem-bar.md](problem-bar.md) | When a problem is worth pitching: the 5 tests, the 8 dimensions, the value estimate |
| [evidence-rules.md](evidence-rules.md) | What counts as evidence in an email, on a call or in content, and what never does |
| [outreach-email.md](outreach-email.md) | Cold email: the reading order, voice, bans, fixed lines, follow-ups |
| [outreach-calls.md](outreach-calls.md) | Cold calls: call map, discovery, exit signals, close, pre-call research |
| [outreach-sequence.md](outreach-sequence.md) | How LinkedIn, calls and email work together; who to contact inside a company; manual only |
| [deliverability.md](deliverability.md) | Sending setup that must be ready before any email goes out |
| [funnel.md](funnel.md) | Benchmarks, funnel math, what we track, the review after every 100 contacts |
| [website.md](website.md) | kardata.co: its job in the funnel, pages, home page copy, blog and booking requirements |
| [content.md](content.md) | Content: audience, theme, the shape of every piece, mix, channels, writing rules, checks |
| [content-plan.md](content-plan.md) | The next 10 posts: the owner's problem, concept, sourced case and source status for each |
| [sector-selection.md](sector-selection.md) | How we pick the next sector: what people buy again, scored on a sample first |
| [decisions.md](decisions.md) | Every business decision, with its date, plus the decisions still open |

## Standard for every file here

1. **Header block:** a title, then one line each for `Status` (`locked` / `draft` / `open`), `Last updated`
   (YYYY-MM-DD) and `Source`. Source says where the content came from.
2. **One topic per file.** If two files disagree, the one updated more recently wins, and the older one gets fixed in
   the same change.
3. **Every decision goes in [decisions.md](decisions.md)** with its date, even when it is also written into the file
   it changes.
4. **No real prospect data.** No company names, people, emails or phone numbers of real prospects. Those live in the
   database, which is private. Examples are generic or invented.
5. **Plain words.** Write for the owner reading it in a hurry. No invented terms. Define any term that isn't
   everyday English.
6. **Numbers carry their source and date.** For example: "564 of 753 finished companies (DB, 2026-10-25)".

## Where this came from

- `~/projects/kardata_old/campaign/`: the outbound system built 2026-10-07 → 10-18 for B2B SaaS. The offer, the
  problem bar, the email voice, the funnel math and the deliverability gate come from there. Material specific to the
  HR sector was left out on purpose.
- The owner's business sessions on 2026-10-19 and 2026-10-23/24: the pivot to D2C, positioning, cold calling and the
  narrow-wedge rule.
- Kardata v2 data: the counts in `icp.md`.
