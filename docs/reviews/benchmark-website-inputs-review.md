# Website input recovery review

- Read-only MCP preflight: 348 underlying robots source rows with no HTTP status; 302 `redirect outside the allowed site or path`, 45 `fetch failed`, one `too many redirects (over 5)`. Redirect refusals are 86.8%; the build gate passes. Detailed rows remain private.
- Same-site redirects: exact host, one www/bare alias and HTTP→HTTPS; cross-domain, credentialed and downgrade redirects refused. Redirected robots rules govern the requested path and destination pages. Host delay applies at every hop, avoiding a same-host protocol-upgrade lock deadlock.
- Evidence: `tests/collect/fetch.test.ts` and `tests/unit/website-software.test.ts`, 34 tests passed at this step.
- Remaining steps: one-attempt recovery, dated Schedule D address promotion, final validation.
- Production use was limited to the authorized source-row count. No fee-job access, code/deploy operation or collection was run on production.
