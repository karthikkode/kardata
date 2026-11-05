# Website input recovery review

- Read-only MCP preflight: 348 underlying robots source rows with no HTTP status; 302 `redirect outside the allowed site or path`, 45 `fetch failed`, one `too many redirects (over 5)`. Redirect refusals are 86.8%; the build gate passes. Detailed rows remain private.
- Same-site redirects: exact host, one www/bare alias and HTTP→HTTPS; cross-domain, credentialed and downgrade redirects refused. Redirected robots rules govern the requested path and destination pages. Host delay applies at every hop, avoiding a same-host protocol-upgrade lock deadlock.
- Evidence: `tests/collect/fetch.test.ts` and `tests/unit/website-software.test.ts`, 34 tests passed at this step.
- One-attempt recovery: exact stored redirect error required; company citations resolve to library/robots evidence. HTTP 401/403/406/418/5xx, challenges, robots exclusions and competing failures remain skipped. A durable claim is saved before fetching and survives restart; a crash after claiming consumes the attempt conservatively.
- Expected recovery eligibility: up to 302 robots failures plus 122 direct redirect failures (424); actual foreign-domain redirects remain refused and historical blocks can reduce eligibility. The 45 generic fetch failures and one redirect loop are excluded. No production retry was run.
- Recovery evidence: 33 tests passed across website-retry, website-recovery MCP and existing benchmark-tools.
- Dated field: `src/domain/benchmark/filed-website.ts` and `website-address.ts`; `sec_adv_website_promote` in the thin MCP wrapper defaults to dry-run and supports bounded ID/cursor batches. Verified filing identity and one globally unshared, non-provider host printed on the latest stored brochure cover are required. Filing/brochure dates, original filed addresses and both citations are retained; company website/domain never change.
- Fallback: `website-input.ts` uses the dated field only for a missing/shared current input and rechecks all-sector company/filing claims. Newly shared hosts become unusable; older imports cannot displace a newer dated field. Provider exclusions live in sector data without changing the vendor-map cache key.
- Expected promotion population: 658 core candidates from the saved readiness measurement (462 under the stricter single-candidate rule, which was not chosen). The tool repeats the 658-rule checks; no production promotion/dry-run was performed here.
- Promotion tests: six MCP cases plus website-software unit cases cover default dry-run, concurrent/idempotent writes, source/date preservation, current-input priority, outside-sector sharing, provider/platform/email rejection, ambiguity, identity and newer-date protection.
- Recovery budget is per company and normalized site host, including across www/bare and vendor-map key changes. Historical hard blocks stay skipped across those changes. Only qualifying redirect failures get a new attempt; unrelated historical failures remain cached conservatively.
- Local lint, typecheck and build passed. Final full-suite/CI results are recorded in the PR.
- Plan details: kept the existing dated evidence/fact layer instead of adding company columns or a migration. A durable pre-fetch claim deliberately consumes the single attempt if the process dies after claiming. No fetch workaround or automatic alternate-domain retry was added.
- Production use was limited to the authorized source-row count. No fee-job access, code/deploy operation or collection was run on production.

| Acceptance | Implementation | Proof |
|---|---|---|
| Same-site redirects / redirected policy | `src/collect/same-site.ts:2`, `src/collect/fetch.ts:670` | fetch tests: both aliases, upgrade, disallow, foreign-domain refusal |
| Single recovery / no block retries | `src/domain/benchmark/website-retry.ts:15`, `src/domain/benchmark/website.ts:127` | retry unit tests and recovery MCP tests, including races, aliases, history and cached robots |
| Dated, sourced separate address | `src/domain/benchmark/filed-website.ts:19`, `src/domain/benchmark/website-address.ts:7` | six filed-websites MCP cases; no company-field changes |
| Fallback only / global sharing | `src/domain/benchmark/website-input.ts:43` | website-software unit tests and filed-websites MCP cases |
