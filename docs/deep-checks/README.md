# Deep checks

Retired 2026-10-05: `catalogue.json` and `acceptance.json` fingerprinted
every repo file, so every edit reset reviews to `pending` and every change
paid a regen commit for a gate that stayed permanently red. They now live
read-only in `archive/` with the old README; git history retains the rest.
No test regenerates them; no gate reads them.

The release gate is `npm run pr:verify` plus CI (`verify`, `e2e`,
`integration` jobs). Live suites state their own gates in
`documentation/tests.md`. Dated history in `docs/implementation-status.md`
and `preflight-authority-review.md` still names the old files; that is
history, not instruction.
