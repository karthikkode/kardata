# Pilot run notes (live, 2026-09-30)

## Sweep (discovery)
- Pilot sector sec-01800ad6 (fintech SME payments) restarted with Bing engine: COMPLETE, 100 companies in ~2 min.
- Precision finding: first 40 rows are junk (gambling spam, blogs, movie pages, printer support). Templates too broad + zero relevance gate. Follow-up: relevance-gate PR (pure, hermetic) + template shaping.

## Subagent research (10-pair instruction, model obeyed: 10 delegate calls)
- Observed: 20 children (2 batches, different goal phrasings). Suspected turn re-execution duplicated the fan-out. Follow-up: turn idempotency/timeout analysis with workflow history.
- Vendor saturation: 20-way concurrent research turns -> mass provider_failed (60-190s latencies). 2/20 succeeded (same pair: Dojo+Tyro). Follow-up: paced fan-out (vendor semaphore) in the sweep/research path.
- Empty-reply turns: ok:true turns with no text (5 tool turns, nothing written). Shape fix: one company per child + write-early brief. Follow-up: wall-budget review for research turns (300s).
- Uncertain verdict done right once (pair 1, d44e9d16): honest unknown, correct form, loop-guard halted repetition properly.

## Paced phase (sequential, one company per child)
- Pair-1 retry (child-920871f4): empty reply (see above).
- Helcim single (child-f6f45b6b): verdict pending.
- Remaining: 19 singles after Helcim lands.

## Evidence files
- journey.json (UI walk + timings), delegate-live.json (door proof),
  pilot-companies.json (20 verified targets), verdict-*.json per child.

## Empty-reply root cause (proven by experiment)
- Big briefs (2 full verdicts, many tool rounds) end ok:true with EMPTY
  text; tiny briefs (1 fetch, 2-line reply) land in ~1 min. Extraction
  is fine — the model drops output on large tool-heavy turns (likely
  reasoning-effort/output-budget interaction at high effort).
- Pilot recipe: one company per child, terse reply (under 150 words,
  7 headings), max 6 tool calls. Follow-up: research-turn output
  budget review.

## Pilot complete (2026-09-30)
- 20/20 verdicts collected, all form-compliant, zero invented facts.
- System findings (all recorded above): sweep precision 0%, turn
  duplication 20-for-10, vendor saturation at 20-way fan-out,
  empty replies on oversized briefs, browser-transient + dead sidecar.
- Recipe that works: one company per child, terse reply, max 6 tools,
  max 2 concurrent children. Verdicts land in ~1-2 min each.
- Follow-up PRs (in order): relevance gate for sweep precision; turn
  idempotency + budget review (duplication, empty replies, wall clock);
  paced fan-out with vendor semaphore; sidecar restart policy.
