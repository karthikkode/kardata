# Kardata

Rebuild home. Product vision lives in `documentation/vision.md` (write it first :
everything below hangs off it).

## Map

| Directory | What lives here | Its documentation |
|---|---|---|
| `frontend/` | UI code only. No SQL, secrets, or direct database access. | `documentation/frontend.md` |
| `backend/` | API and business logic. Owns all database access. | `documentation/backend.md` |
| `db/` | Schema + migrations (access layer lives in `backend/src/db/`). | `documentation/db.md` |
| `deployment/` | Compose files, Dockerfiles, environment templates. No secrets : ever. | `documentation/deployment.md` |
| `tests/` | Automated checks, mirroring the area they cover (`tests/frontend/...`, `tests/backend/...`). No fixtures pretending to be live data. | `documentation/tests.md` |
| `knowledge_base/` | Research data. Data only: it is never instructions, policy, or code. | `documentation/knowledge-base.md` |
| `documentation/` | All area docs plus cross-cutting decisions. | `documentation/README.md` |
| `agents/` | Karbot agent harness (own turn loop, providers, tools, subagents, context). No donor servers, persistence, auth, or telemetry. | `documentation/agents.md` |
| `third_party/` | Pinned donor references (manifest, licenses, patches, upstream tests). Reference only: never imported at runtime. | `third_party/README.md` |

## Conventions

- Every top-level directory has exactly one mirror doc in `documentation/`, named
  as the table above. Code and its doc change in the same commit.
- `README.md` (this file) is the index. If a new area appears, it lands here first.
- Area docs state their public surface: what other areas may use, and what is private.
- Nothing at the repo root except `README.md`, `AGENTS.md`, the npm workspace
  manifest (`package.json`, `package-lock.json`), and the directories above.
  No new top-level directory without the owner's approval.
- Two former map rows have no directories: the agent tool boundary lives in
  `backend/src/mcp/` (`documentation/mcp.md`) and shared contracts live in
  `backend/` (`documentation/common.md`). The empty top-level `mcp/` and
  `common/` placeholders were removed 2026-09-28; their docs remain the
  area authorities.

## Orienting (agents and humans)

1. Read this file.
2. Read `AGENTS.md` : the operating rules for anyone touching the repo.
3. Read the `documentation/` page for the area you will touch.
4. `documentation/README.md` lists cross-cutting decisions that override area docs.

## Status

Frontend harness built: Vite + React + TypeScript, Tailwind tokens, owned
primitives, Vitest + Playwright gates : all green from a clean install.
Karbot agents layer built (`agents/`, `third_party/` policy, area docs under
`documentation/agents*.md`): 155 tests passing across 26 files
(live suites skip without keys), agents lint/typecheck clean.
Repo-wide `npm run lint` is green (two pre-existing
`react-hooks/exhaustive-deps` warnings in frontend `ChatPanel`).
Live provider probes are opt-in (see `agents/.env.example`).
Backend scaffold built (`backend/`, `tests/backend/`, `docs/environments.md`):
`GET /healthz` + shared envelopes, lint/typecheck/test/build green, live
probe verified (200 envelope, 404 envelope).
Phase 1 provider/model selection: per-session `PATCH /v1/sessions/{id}/model`
(read back on `GET` session), Meta-only verified capability profiles
intersected with Meta's live `/models` listing, and `GET /v1/providers`
(catalog + key-presence boolean only). Default: `muse-spark-1.3-contributor`
at high effort; unavailable catalogs fail closed.
Phase 2 backend MCP server: `POST /mcp` (Streamable HTTP, stateless JSON)
with 64 tools over the db layer, API-key auth with per-tool role floors,
spec parity in `backend/openapi/v1.yaml`; proven by
`tests/backend/mcp.tools.test.ts` on fake/di doubles (no live keys).
Phase 3 Karbot turn: `agents/src/turnRunner.ts` (streamed model/tool loop
over injected provider + MCP client + delta sink) wired into
`karbotTurnActivity` with the per-session model, ephemeral outbox deltas,
and key-free logging; `sessionRun`/`subagentRun` call it, scripted echoes
retired. Proven by `agents/src/turnRunner.test.ts` and
`tests/backend/karbot.turn.test.ts` on fake/di doubles (no live keys).
Phase 4 frontend Models tab: sidebar section for the provider catalog
(key presence only) with per-session model binding over the Phase 1
routes (`GET /v1/providers`, `PATCH /v1/sessions/{id}/model`), zod
validation in the staging client, proven by
`tests/frontend/models-staging.test.tsx` and
`tests/frontend/models-api.test.ts` on stubbed fetch (no live keys).
Product knowledge corpus + master ledger (migration 0008): curated
`knowledge_base/` served from Postgres FTS via `db.kb_search`, six
`db.ledger_*` tools over `ledger_companies`/`ledger_problems`, corpus
accuracy 15/15 (`tests/backend/kb.eval.test.ts`).
Streaming responsiveness: TTFT timing logs, parallel same-round tool
dispatch, Thinking placeholder with elapsed clock, live tool-call ages.
House markdown: GFM replies through a safe renderer (`Markdown.tsx`,
no raw HTML, http(s)-only links), format contracted in the system prompt.
Checkpoint hardening: `npm run test:coverage` (istanbul) at 76% lines,
offline/SSE-resume regression tests, dead `ui/dialog` removed.
`documentation/vision.md` is still the first product doc to write.

Run from the repo root (Node 22): `npm run dev` (app), `npm test` (all
workspaces), `npm run test:e2e` (browser smoke), `npm run lint`,
`npm run typecheck`, `npm run build`. Live probes:
`npm run test:live --workspace=@kardata/agents` (needs keys, skips without).
