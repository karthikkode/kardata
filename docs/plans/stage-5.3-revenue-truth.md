Status: done · Date: 2026-10-26

# Stage 5.3 — Revenue truth

Fix why research tiers companies on bad revenue figures. Case (synthetic summary): Apollo says
$607k for a company with about 20 staff; the public accounts show 17 employees, about £2M of
assets and a 2025 acquisition. The financials agent wrote "not credible" in prose. The
structured fact stayed clean, and the tier was built from it by hand, outside the pipeline.

## Owner rule D-55 (exact)

Revenue for the tier, best first:
- a) a figure with a named public source (filing, interview, press) wins. If it implies more
  than $1M per staff member, keep it but flag it "check";
- b) else Apollo's estimate, but only if it implies at least $75k per staff member;
- c) else staff × $175k, marked "estimated from staff". A rejected Apollo figure stays visible
  with the reason "rejected: below $75k per staff".

Staff count: the most recent dated count (Companies House accounts beats Apollo).
Tiers: A $10M+, B $2–10M, C $500k–2M, below $500k = not contacted.
Layer = 7 − signal score (score 2–6 → Layers 5–1); score 0–1 = watchlist. Exclusions stay
exclusions. The buyer's own answer always wins later; not modelled now.

**No hard outlines.** Thresholds flag and route; they never delete data and never present a
guess as a fact. Where the evidence is mixed, the agent's common sense decides and the flag
explains why. A disputed figure is visible everywhere, clean nowhere.

## Steps

1. Apollo revenue stored as a vendor estimate with a status (unverified / accepted /
   rejected + reason). No meaning change for other facts.
2. Companies House: check up to 20 candidates; match by website/domain, then registered
   name, then postcode; refuse ties. On a match, write the latest accounts as dated facts:
   total assets, cash, net assets, average employees. Record no-match with candidates tried.
3. Research prompts, new version (old kept): synthesis gains a plausibility check
   (revenue next to staff, accounts and channel count) writing
   `financials.revenue_plausibility` (ok | disputed + reason); decisions gains one exact-name
   quoted search for acquisitions/funding, accepted only if it matches on country, founder
   or products. Fix the URL-citation bug here if it is still open.
4. Tier and layer in the system: a domain function implementing D-55, read-only MCP tools
   (per-company revenue truth; sector counts by tier × layer and by revenue source), storage
   for signal scores and exclusion verdicts, and loading the 2026-10-26 ICP verdicts through
   an MCP tool.
5. Sheet export: an MCP tool writing `var/analysis/companies-<date>.csv` with only
   contactable companies, one block per tier, sorted by layer then score.

Refresh after the build (no AI reruns in this stage): recompute tiers from data already
stored; where accounts data is missing for a UK company, pull it through the standard
collector path. Then a dry run: how many companies change tier, and the new counts.

Finish: full suite once; `docs/reviews/stage-5.3-review.md` mapping root causes 1–7 to
fixes and tests; stop.
