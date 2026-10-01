# Final platform acceptance and live sector campaign

Owner approved 2026-10-01. Extends the repo-hardening contract; does not waive
its merge checklist. Design authorities remain the area docs. Operating results
and the acceptance matrix live under docs/deep-checks/.

## Campaign

Australian electrical, plumbing and HVAC service businesses. Create at least
2000 distinct real businesses through UI-driven Meta research. Basic filtering
excludes non-business pages, directories, articles, jobs, duplicates, unrelated
services and out-of-geography results. Preserve source URLs and timestamps;
unknown size stays unknown. Company deep research, advanced qualification,
problem scoring and outreach are future features, not pilot work. Discovery
sample reviewers are permitted and must not execute company deep research.

Begin with electrical/plumbing, then test a reviewed HVAC scope expansion. Use
one persistent research parent, target/limit 2000, two active reviewers and the
existing 1440-active-minute budget ceiling. No monetary cap. Exhausted resources
park honestly; they never authorize invented results or reset cumulative usage.
All business creation, plans, approvals, context/file actions and steering use
UI controls. Read-only traces and DB-layer inspection diagnose failures. Never
populate results manually or bypass a failed UI flow using backend mutations.
Automated UI approvals are authorized for this script using an existing locally
configured approver credential. Do not upgrade an operator key or disclose keys.

## Acceptance records

Every maintained functionality maps to a stable ID, behavior, authority,
persistence, failure recovery, deadlines, telemetry, tests and operating limits.
Enumerate source exports, HTTP operation IDs, MCP names and reachable UI surfaces.
Generated enumeration is pending review, not proof. Internal helpers/configuration
map to supported behaviors. Missing mappings, pending reviews and unavailable
applicable gates block release. Each scenario records trigger, expected outcomes,
maintained tests, evidence and status. Hash changes invalidate file review.

Module coverage: providers/execution/context/delegation; all DB repositories and
migrations; archive/extraction/indexing/visibility/import; routes/auth/idempotency/
streams; all MCP tools and human-action coverage; logs/traces/metrics/reconciliation;
Temporal/deployment/replay; every frontend surface/shared primitive/legacy path;
and the isolation, contract, stress and browser-review infrastructure itself.

## Cross-module acceptance

- Plans expose and pin exact executable queries, limits and criteria. Stale or
  unapproved plans cannot dispatch. Retry/restart/revision cannot duplicate work.
- Normal chats propose exact versioned context diffs. Until approval, research
  uses the committed version. Rejection changes nothing. Stale proposals require
  renewed review. Approved clarifications refresh at the next safe provider
  boundary and record the first consuming round. Scope/objective/budget changes
  pause affected work for revised-plan approval; completed eligible work remains.
- Research children route findings through their parent. Permitted autonomous
  parent edits cannot overwrite owner decisions or approved scope. Parent/child
  local notes/history/summary/instructions remain isolated.
- Stable prompt prefixes serialize consistently; actual cache counters retain
  availability information. Test cold/warm reuse and freshness after context/file
  changes. No fixed hit-rate promise or missing-counter-as-observed-zero claim.
- Compaction counts the whole request, caps input at min(100000, verified window
  minus reserve), triggers at 80% and targets 50%. Preserve tool/result groups,
  objectives/citations/decisions. Failure parks without destroying context;
  persisted summaries survive restart; transcripts remain immutable.
- Steering is consumed exactly once at safe boundaries. Completion races retain
  unapplied instructions for explicit next-turn action. Pause/resume preserves
  completed discoveries, checkpoints, attempts and cumulative budgets.
- Files retain exact original bytes/provenance/integrity. Index publication is
  atomic. Hide blocks subsequent reads/discovery/reference assembly; history is
  retained. Global inclusion always needs approval of exact file version/units.
- Auth/grants/validated execution bindings govern every route/tool. Retrieved
  text cannot elevate authority. Uncertain mutations remain guarded and visible;
  only proven pre-effect failures retry automatically. Reconciliation is bounded.
- Progress is identical on landing/Plan views, unknown while expanding, honest
  for partial/blocked outcomes and 100% only after acceptance.
- Supervise stalled progress, missing beats, leases/orphans and starvation without
  killing healthy slow work. Correlate HTTP/workflow/provider/tool/DB/archive
  events; secrets stay out of logs. Telemetry outages preserve execution records.
- Durable execution inspection links rounds to context/plan versions, permitted
  exact request/response/tool-result archive references, hashes, usage and receipts.
- Historical replay and legacy mutation-cache compatibility pass before rollout;
  controlled baseline fixtures cover missing historical workflow types.

## UI and evidence

Create sector and two brainstorming sessions; upload/preview/download files;
generate/review/approve/start plan; inspect progress and arriving companies;
exercise clarification approval, rejection, stale conflict, scope expansion,
child steering/Stop, next-turn sending, pause/resume, reload, session switching,
file hide/reveal/inclusion, compaction and caching. Preserve drafts/history and
visible receipts. Correct defects through supported flows and retain regressions.

Every applicable UI state: loading, first-run empty, filtered empty, few/many,
error, partial success, denied/offline/rate-limit, recovery. Verify long content,
keyboard/focus/scroll, both themes, reduced motion, 1440/390 widths and drawer
boundaries 1280/768. Capture anchored stills and transition videos. Visual findings
become maintained regressions; screenshots alone are not assertions.

Freeze final population and reproduce the deterministic sample of 50. All 50
must pass identity/geography/sector/fetched-source checks. Inspect whole-population
duplicates. Correct affected records, replenish to 2000 and rerun if validation
fails. Archive a readable report through the app; results remain inspectable.

## Independent release requirements

Disruptive fault drills use isolated DBs/task queues/archives, never pilot data.
Test provider/tool hangs/errors, worker death, DB disconnect/deadlock, archive
failure, projector lag, duplicate requests and steering/completion races. Run
1/10/100 discovery-child tiers and 1000 queued items with bounded active calls;
UI tiers 1/50/100/1000/2000. Measure throughput, latency distributions, queue age,
pool wait, peak CPU/RSS, indexing and recovery time; publish limits/overload.

Final candidate passes lint/typecheck/tests/builds/contracts, isolated DB/Temporal,
browser/stress/live-provider gates, complete file/functionality review, the live
2000-company campaign and independent verification. Evidence identifies commit
and environment. Every defect records the missed test/contract layer. Full PR
checklist carries proof before squash merge. Preserve pilot records and compatible
archive readers; handoff includes limits, rollback and exact future commands.
