# Solo call-brief tools review

- Standard MCP prepare/status/export tools: `src/mcp/call-brief-tools.ts`; wrappers delegate to domain code.
- Ordered windows and immediate private export: `src/domain/call-briefs/prepare.ts`; MCP tests cover first-window usability, list order and rerun reuse.
- Stored SEC facts retain their dates, qualifiers and bounds. Raw registration columns are read only after canonical-file digest and CRD checks; existing facts are never rewritten.
- Public requests use strict robots policy, bounded page counts and the SEC identifying User-Agent. Blocked hosts are skipped; no login, social profile or alternate report route is used.
- Codex is selected directly for these calls. Global provider, quota breaker and fee jobs are neither changed nor resumed; MCP tests compare protected rows before/after.
- Owner-supplied opener/reason shape is deterministic. Guesses must be conditional and cite existing facts. Unsupported quotes, numbers and references fail validation.
- Markdown bodies are bounded; sources/dates and gaps remain in expandable details. CSV includes the opener/reason, three questions, cited top guess and source count.
- Source inspection supports original stored HTML/text for checking public link targets without another fetch; PDF/binary raw views are rejected.
- Unit tests: `tests/unit/call-briefs.test.ts`, `tests/unit/source-fetch-policy.test.ts`.
- Database/MCP tests: `tests/mcp/call-briefs.test.ts` (including failed-firm reasons and concurrent storage).
- Validation: targeted tests, lint, typecheck and build passed; full local suite passed before the registration-column follow-up, which passed its targeted tests. Final CI is the deployment gate.
- Operational briefs, coverage and manual source-check results remain private in the requested export directory. No prospect data is committed.
