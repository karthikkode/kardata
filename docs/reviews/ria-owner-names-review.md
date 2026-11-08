# RIA owner names review — 2026-11-08

PR #189 merged and deployed at ee6737d. Import, gap marking, checks and export used standard MCP tools; no paid/model calls.
Code: `src/domain/sec-adv/owner-names.ts` (latest stored CRD filing, individuals only); `contact-people.ts` (tier selection/provenance).
Validation: local full suite 130 files / 1,170 tests passed, 1 optional live test skipped; initial CI passed. Selection follow-up: 19 targeted tests, lint and typecheck passed.
Unit/MCP evidence: `tests/unit/sec-owner-names.test.ts`, `tests/mcp/sec-owner-names.test.ts`; contacts and existing RIA/skincare tests passed.

| Cohort | Firms | Named person | Missing |
|---|---:|---:|---:|
| Tier 0 | 471 | 342 | 129 |
| Tier 1 | 6,407 | 5,462 | 945 |
| Tier 2 | 1,963 | 1,927 | 36 |
| Hold | 4,887 | 4,236 | 651 |
MCP read-back: 37,720 person records; 11,967/13,728 firms named. Every gap: `no_filing_in_archive_newer_sec_unavailable` (1,761).
Newer official bulk manifest/report host: robots access HTTP 403; skipped without a bypass. Tier 0 archive gaps are exactly 129.
Filing-year spread below counts named firms; missing filings are counted above.
Tier 0: 2012: 14, 2016: 1, 2017: 1, 2021: 1, 2022: 1, 2023: 3, 2024: 321.
Tier 1: 2011: 2, 2012: 57, 2014: 5, 2015: 1, 2016: 7, 2017: 3, 2018: 5, 2019: 14, 2020: 8, 2021: 7, 2022: 12, 2023: 16, 2024: 5,325.
Tier 2: 2024: 1,927.
Hold: 2012: 1, 2015: 2, 2016: 1, 2017: 2, 2018: 2, 2019: 2, 2020: 3, 2021: 3, 2022: 7, 2023: 13, 2024: 4,200.
Spot checks: 10 Tier 0 + 10 Tier 2 summaries reachable; all 20 reports unavailable (robots HTTP 403). Matches 0, mismatches 0, unverified 20.
Tier 0 unavailable IDs: 005ad947-eb7f-4a06-b3eb-763af3d57e8e, 012c4bda-8046-4fd0-88cc-e585f6d11563, 01691a74-c824-4f17-86dc-5dc31d1ca82a, 0306f0de-b405-4d21-9a62-b9ea4efa6b8a, 0369df39-318b-4490-bd15-b54d3999541f.
Tier 0 unavailable IDs: 03b2d1d9-d4b5-4b6c-b394-86df5270bff8, 03c27f16-8510-485b-b2f5-7a0495d30c45, 04cd3ccf-0239-479a-92af-ab76ea855c06, 0740fd9a-841b-40ba-aebc-2ae54c01ca26, 087be310-1e1e-46b0-9bfb-92f7d3a961fc.
Tier 2 unavailable IDs: 000ed8f4-d12a-4b1e-8174-4eb319c82835, 005f369b-5e1b-452f-bb83-7c59247b6caf, 006949e2-5115-4a0c-97fd-8f782cfe2efc, 008dafb1-937b-44d1-b0e5-6650c1c46016, 008fdd99-f2e5-406b-984d-f9038fe8dc22.
Tier 2 unavailable IDs: 0090e79f-270a-4bd1-a531-409598903860, 00a60914-5c48-476e-b5ed-a22491ab5f39, 00c18ea1-cc13-46c7-8579-65dedc1df8d9, 010f2bad-2592-4aca-9f69-0ae41e1f9e19, 014acffc-95c7-49c5-8d5a-df96a1b51bf5.
MCP contacts read-back verified provenance for 20/20; CSV exports 8,841 accepted firms with selected contact and filing metadata.
Output-order discrepancy at firm 005ad947-eb7f-4a06-b3eb-763af3d57e8e: one person has multiple Schedule A statuses; this follow-up combines reported roles and gives MCP/CSV identical ordering, with regression tests.
Re-run: 0 written, 13,728 unchanged; no duplicate contacts. Confirmed contacts are preserved; filing names remain unconfirmed/may be out of date. Apollo-only contactability unchanged.
All 8,642,495 facts, all saved revisions (including 8598a1e041f2ffbee69f8a42), and all fee-job rows/lists unchanged; paused job retains its 8,403 IDs.
Unfinished: names for 1,761 firms and current-report comparisons for 20 firms remain unavailable because the newer SEC source blocks robots access.
