# Schedule archive CSV repair

- Stray quotes retain field boundaries and payload quotes: `src/lib/sec/archive.ts:18`.
  `tests/unit/sec-archive.test.ts` checks embedded commas, chunk boundaries, escaped
  quotes, BOM, multiline fields, and parity with the existing strict parser.
- A malformed closing quote is repaired only when one bounded candidate gives a
  strictly valid row of the expected width: `src/lib/sec/archive.ts:92`.
  Valid CSV with missing columns is never reinterpreted to make its width fit.
- Each file reports rows, accepted, tolerant and rejected counts, with original
  start/end lines and expected/actual widths for every rejection:
  `src/lib/sec/archive.ts:175`, `src/domain/sec-adv/schedules.ts:184`.
  Counts cover the entire file, including unmatched firms, once per import call.
- Any rejected row blocks a real import before evidence or records are written:
  `src/domain/sec-adv/schedules.ts:208`; synthetic MCP tests in
  `tests/mcp/benchmark-tools.test.ts:198` verify dry-run reporting and zero writes.
- Reproducible offline scan: `scripts/sec-archive-scan.ts:1`. No database, environment
  loading or network access. All seven importer tables were scanned, including
  Base B for the historical snapshot fallback; the default schedule path reads six.

| Archive table (20111105–20241231) | Rows | Tolerant | Rejected |
|---|---:|---:|---:|
| IA_ADV_Base_A | 471,129 | 0 | 0 |
| IA_ADV_Base_B | 471,129 | 0 | 0 |
| IA_Schedule_A_B | 3,147,383 | 0 | 0 |
| IA_Schedule_D_1F | 1,379,778 | 0 | 0 |
| IA_Schedule_D_1I | 1,995,392 | 0 | 0 |
| IA_Schedule_D_5K3 | 302,077 | 0 | 0 |
| IA_Schedule_D_7A | 2,372,009 | 4,543 | 0 |

The scan found both stray inner quotes and malformed quote runs at a field end.
For all 602 rows initially failing width validation, the repaired first two IDs and
last three flags match the untouched source bytes. Source rows and private audit
outputs remain outside git; only aggregate counts and synthetic tests are committed.

Validation: Node 22; archive unit tests, MCP integration tests, lint, typecheck,
build, and the full suite against an isolated test database. CI status is on the PR.
Malformed widths remain rejected; unrecoverable truncation remains an explicit file
error. No production imports, fee-job calls, deployment, merge or data-file edits.
