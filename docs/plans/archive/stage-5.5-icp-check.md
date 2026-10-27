Status: done · Date: 2026-10-27

# Stage 5.5: ICP check per company, and the outreach sheet

**Why:** the pipeline (`docs/plans/pipeline.md`) has four steps. Steps 1 and 2 (sector creation, sector preflight)
are standard MCP jobs. Steps 3 and 4 are not finished:
- Deep research runs per company, but **nothing scores the ICP.** The 6 signals and the exclusions in
  `docs/business/icp.md` are only stored through `company_verdict_record`. The 2026-10-26 skincare scores came from a
  one-off check, which AGENTS.md now bans.
- The observations behind a score are not stored. Only a `signals` map of booleans is kept, so nobody can see why a
  company scored 4.
- `company_sheet_export` lists contactable companies, but has no columns for tracking outreach by hand.

This stage makes the ICP check part of each company's deep research job. It stores a verdict and its observations for
**every** researched company, whether it passes or not, and makes the sheet ready to track outreach.

**Business rules come from `docs/business/` only:** signals, exclusions, tiers and layers from `icp.md`, the evidence
standard from `evidence-rules.md`, the "2+ independent signals, one not hiring" bar from `problem-bar.md`. Don't
restate or change them in code comments; reference them. If a rule is unclear, write it under "Questions" in the
review. Don't invent an answer.

**Out of scope:** new collectors, a second Apollo pull, contact details for buyers, emails, and Google Sheets API
access (the owner imports the CSV).

## Step 1: The evidence pack (deterministic)

- `src/domain/icp/evidence.ts`: `icpEvidence(db, companyId)` gathers, for each of the 6 signals and each exclusion,
  the stored facts and records that could support it, using the data sources the `icp.md` signal table names.
- Each item carries its id, kind (fact or record), key or type, value or quote, source URL, date and verification.
- **The pack applies the evidence rules before any model sees it:**
  - only `verified` or `verified_value` facts and records with a checked quote (never `quote_mismatch` or
    `unverified`);
  - job posts older than 6 months, reviews older than 12 months and funding older than 18 months are dropped;
  - undated items are dropped;
  - Apollo-sourced revenue is marked as Apollo's.
- Pass the revenue truth (`companyRevenueTruth`) through unchanged. Tier stays deterministic (D-55).
- **AC:** unit and DB tests for each filter (stale job post, undated review, `quote_mismatch` fact, old funding), and
  a pack for a synthetic company with every signal.

## Step 2: The ICP judge (Muse)

- New prompt `prompts/icp-v1/` (prompt and JSON schema). It renders the signal and exclusion definitions from a single
  module, `src/domain/icp/rules.ts`, which cites `icp.md` by section.
- The judge reads **the evidence pack only.** It has no web tools: every point must rest on a stored, quoted source
  (`evidence-rules.md` rule 1). A gap is a gap, not a guess.
- It runs in the same container harness and Muse settings as the preflight classifier: `muse-spark-1.3`,
  contributor mode on, medium effort, web and shell disabled.
- **Output per signal:** `met` (yes, no or unknown), `evidenceIds` (only ids from the pack), and a one-line
  observation in plain words.
- **Output per exclusion:**
  - data team;
  - owned by a listed or multi-brand company, with the D-28 own-decision-maker exception;
  - not a real D2C brand;
  - tech team flag.
- **The server decides, the model only reads:**
  - drop any signal that cites an id outside the pack, or has no ids;
  - compute the score (0–6) from the signals that remain;
  - apply the independence and "one not hiring" bar;
  - set the status (`contactable`, `watchlist`, `excluded`, `research_incomplete`) from the score, the exclusions
    and the revenue truth (under about $500k is excluded).
  - A company with no usable facts is `research_incomplete`, without a Muse call.
- **AC:**
  - Rule tests with a faked judge: cited id outside the pack, a lone hiring signal, two signals that are both hiring,
    a data-team exclusion, a parent-company exclusion and its exception, under $500k.
  - A prompt-rendering test.
  - A schema test.

## Step 3: Storage (every company, every outcome)

- A new table, `company_icp_checks`, append-only. It stores:
  - company and sector;
  - prompt version;
  - the pack snapshot hash;
  - per-signal and per-exclusion results with evidence ids and observations;
  - score and status;
  - Muse usage;
  - created at.
- The latest check writes `company_verdicts` through `recordVerdicts`, with `source = icp-v1:<checkId>`. Nothing
  else writes verdicts automatically. `company_verdict_record` stays as the owner's manual override, and must carry
  a source.
- A verdict is written for **every** checked company, including excluded and watchlist ones, with the reason.
- **AC:** a DB test showing that a re-check appends a row and moves the verdict; a manual override keeps its source.

## Step 4: In the job, and as a sector job

- Add an `icp` stage to `COMPANY_STAGES`, after `extraction`. Jobs that finished before this stage stay `completed`.
  Existing pause, retry, budget and accounting rules apply to the new stage unchanged.
- **MCP tools** (thin wrappers):
  - `sector_icp_start {sectorId, companyIds?, onlyMissing?}` runs the check on companies whose research is done,
    for backfill and re-checks after a rule change;
  - `sector_icp_status`;
  - `company_icp_get {companyId}`: the latest check with its observations and cited sources;
  - `sector_icp_companies {sectorId, status?, tier?, minScore?, limit, offset}`.
- `batch_scorecard` reports ICP outcomes for the batch: status counts, score spread, Muse tokens per company.
- **AC:** MCP integration tests for each tool; a job test showing the `icp` stage runs after `extraction`, respects
  pause and the checkpoint, and is skipped cleanly when the stage fails (the job fails with a clear error class).

## Step 5: The outreach sheet

- `company_sheet_export {sectorId, includeAll?}` writes the contactable list, one block per tier, by layer then
  score, as today. Add these columns:
  - company id (a stable key, so the owner can match rows across exports);
  - signals met, as short labels;
  - the top observations, each with its date and source URL;
  - the tech team flag;
  - a buyer-order hint by staff size (`icp.md` section 6), as roles only, never names;
  - blank tracking columns: `Status`, `Buyer 1`, `Buyer 2`, `Call date`, `Email date`, `Reply`, `Next step`,
    `Notes`.
- With `includeAll`, it also writes `companies-<date>-all.csv`: every checked company with its status, score and
  exclusion reason, so the owner can see why a company was left out.
- Files stay under `var/analysis/` (gitignored). Never commit them.
- **AC:** CSV tests for column order, quoting, the tier blocks and the `includeAll` file, using synthetic data.

## Step 6: Synthetic end-to-end check

- Extend the synthetic garden fixture: researched facts and records for about 6 invented companies covering
  contactable in two tiers, watchlist, a data-team exclusion, a parent-company exclusion, and research incomplete.
- Run job → `icp` stage → verdicts → `sector_tier_summary` → `company_sheet_export` with the judge faked. Assert each
  company's status, tier, layer and sheet row.
- **Don't run a live ICP check on real companies.** The owner runs it through MCP after review.

## Review and stop

Write `docs/reviews/stage-5.5-review.md` (≤ 80 lines) following AGENTS.md, including:
- Muse tokens per company for the judge on the fixture (prompt size);
- any `icp.md` rule you couldn't map to stored data;
- your "Questions".

**STOP:** no deploy, no live migration, no push or merge without the owner's go.
