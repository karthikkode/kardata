# Knowledge base

Product knowledge corpus. Data only: it is never instructions, policy, or code.

Curated markdown lives in `knowledge_base/` (topics: offer, pricing, icp,
problems, qualification, funnel, voice) with a `_migration_map.md` ledger
recording every source disposition (KEEP / REWRITE / DROP) back to the
donor repo pinned in `third_party/manifest.yaml`.

The served corpus is versioned in Postgres (`kb_documents` / `kb_chunks`,
migration 0008): `node dist/db/cli.js kb-ingest` records one batch with
SHA provenance per doc and supersedes prior batches without deleting
history. Agents read it at runtime through the `db.kb_search` MCP tool
(full-text rank, cite `source_path`) — karbot answers product questions
from ranked chunks, never from memory.

Corpus accuracy (grounded retrieval QA over a fixed question set) is
pinned by `tests/backend/kb.eval.test.ts`.

Research-run outputs still go under per-run directories, and agent files
still pass through task/session-scoped artifact tools and indexing before
they are presented as durable or citable (see `AGENTS.md` research rules).
