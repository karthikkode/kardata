# Website input recovery review

- Read-only MCP preflight: 348 underlying robots source rows with no HTTP status; 302 `redirect outside the allowed site or path`, 45 `fetch failed`, one `too many redirects (over 5)`. Redirect refusals are 86.8%; the build gate passes. Detailed rows remain private.
- Same-site redirects: exact host, one www/bare alias and HTTP→HTTPS; cross-domain, credentialed and downgrade redirects refused. Redirected robots rules govern the requested path and destination pages. Host delay applies at every hop, avoiding a same-host protocol-upgrade lock deadlock.
- Evidence: `tests/collect/fetch.test.ts` and `tests/unit/website-software.test.ts`, 34 tests passed at this step.
- One-attempt recovery: exact stored redirect error required; company citations resolve to library/robots evidence. HTTP 401/403/406/418/5xx, challenges, robots exclusions and competing failures remain skipped. A durable claim is saved before fetching and survives restart; a crash after claiming consumes the attempt conservatively.
- Expected recovery eligibility: up to 302 robots failures plus 122 direct redirect failures (424); actual foreign-domain redirects remain refused and historical blocks can reduce eligibility. The 45 generic fetch failures and one redirect loop are excluded. No production retry was run.
- Recovery evidence: 33 tests passed across website-retry, website-recovery MCP and existing benchmark-tools.
- Remaining steps: dated Schedule D address promotion, final validation.
- Production use was limited to the authorized source-row count. No fee-job access, code/deploy operation or collection was run on production.
