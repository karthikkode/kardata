# Stage 5.5 review: ICP check per company, and the outreach sheet

Branch `feat/stage-5.5-icp`, one commit per step (plus a migrate-test fix). Full suite: 716 passed, 1 skipped
(after the fix to `tests/db/migrate.test.ts`). Lint and typecheck are clean on tracked files.

## Acceptance criteria

| Step | How it is met | Proof |
|---|---|---|
| 1 Evidence pack | `src/domain/icp/evidence.ts:224` `buildPack`, routes in `src/domain/icp/rules.ts`. Grounded rows, or collector rows read straight from the source; never `quote_mismatch` (`:93`). Windows: job posts 6 months, reviews 12, funding and events 18; reviews and events need a stated date (`:208`) | `tests/unit/icp-evidence.test.ts` (stale job post, undated review, mismatch, old funding, full pack, cap) |
| 2 Judge | Prompt `prompts/icp-v1/prompt.md`; schema built from the rule keys (`judge.ts:59`); `decideIcp` (`judge.ts:195`) drops refs outside the pack, counts shared evidence once (`:204`), applies the D-28 exception (`:217`) and under $500k | `tests/unit/icp-judge.test.ts` (11 cases, including a lone hiring signal, data team, parent and exception, prompt and schema) |
| 3 Storage | `company_icp_checks`, append-only (migration `0033_icp_checks.sql`); the verdict is written via `recordVerdicts` with `source = icp-v1:<checkId>` (`src/runs/icp.ts:78`); the Muse call is logged to `provider_calls` with stage `icp`, so quota windows count it (`:113`) | `tests/runs/icp.test.ts` (re-check appends and moves the verdict, an override is kept, no evidence means no call, a bad judgement writes no verdict) |
| 4 Job and tools | Runs after extraction (`src/runs/company.ts:804`, a failure logs `icp_failed` at `:995`); sector job `startSectorIcp` (`src/runs/sector.ts:164`) on the existing sector-job runner (`:677`); tools `sector_icp_start`, `sector_icp_status`, `company_icp_get`, `sector_icp_companies` (`src/mcp/research-tools.ts:1978-2037`); `batch_scorecard` takes `companyJobIds` and reports ICP outcomes (`scorecard.ts:705`) | `tests/mcp/icp.test.ts`, `tests/runs/company.test.ts` (ICP after extraction, success and failure), `tests/db/scorecard.test.ts` |
| 5 Sheet | `company_sheet_export` (`research-tools.ts:1552`) uses `outreachSheetRows` and `outreachCsv` (`src/domain/icp/sheet.ts:80`, `:102`); `includeAll` writes `-all.csv` (`:144`). Buyer order uses roles only | `tests/unit/icp-sheet.test.ts`, `tests/db/tiering.test.ts` |
| 6 End to end | 6 invented garden companies → sector ICP job → verdicts → tier summary → sheet, with the judge faked | `tests/runs/icp-e2e.test.ts`: A/L4, B/L5, watchlist, data-team exclusion, parent exclusion, research incomplete |

## Deviations from the plan

- **The ICP check is not added to `COMPANY_STAGES`.** A fifth stage would make all 827 completed jobs read as
  "incomplete", because done is defined as all stages complete, and it touches every engine. Instead the check runs
  at the end of the extraction drive. A failure is logged on the job, and `sector_icp_start` (onlyMissing) picks the
  company up again. The job still completes, so research is never lost. The check's tokens are in `provider_calls`
  (quota) but not in the job's `inputTokensSpent`.
- **The sector job reuses `sector_preflight_jobs`** with a new `kind` column (`preflight` or `icp`). This gives pause,
  resume, cancel, retry, budget and auto-pause on 3 same-class errors for free. `sector_icp_status` is a thin alias.
- **No `prompts/icp-v1/schema.json`.** The schema is built in code from the rule keys, so the two can't drift.
- **Manual overrides:** a verdict whose source starts with `override:` is never overwritten by a check. The
  2026-10-26 skincare verdicts have other sources, so a skincare `sector_icp_start` would replace them. That's the
  owner's call.
- **`batch_scorecard` gained `companyJobIds`.** It was needed to score the 10-company pilot, which has no batch id,
  through MCP.

## Prompt size (Muse tokens per company for the judge)

About 25K characters (~6K tokens) with 3 items per bucket. At the cap (25 items per bucket, 300-character values and
quotes) it is about 184K characters (~46K tokens). That is still below a web-mode preflight call (140–260K). Real
numbers come from `batch_scorecard.icp.icpTokensPerCheck` on the first live run.

## `icp.md` rules not fully mapped to stored data

- **"Best sellers out of stock":** product records carry no stock field, so this part of `revenue_left` can't be
  seen. Subscription and discount facts still feed it.
- **"A new retailer / new channel":** there's no dated retailer-added record. Only `company_event`, `news_item` and
  funding records with a stated date count.
- **Data team:** this is seen only through `leader` and `job_posting` titles. A LinkedIn headcount by role isn't
  collected, so a data team that never posts jobs is missed.

## Questions for the owner

1. Should the check re-score skincare (827 completed jobs) now, replacing the 2026-10-26 one-off verdicts, or keep
   them until January?
2. Are collector rows (job boards, review APIs) acceptable evidence without a grounding pass? They come straight
   from the source, which is how the pack treats them.

## Unfinished

Nothing in the plan's steps. Not done, by the plan's STOP: deploy, live migration, and a live ICP run.
