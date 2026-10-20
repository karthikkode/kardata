# Stage 3b review: agent orchestrator

Commits: 6237939, b84d5e2, 16914a3 (Step 0) · 7f0d92a (Step 1) · 87e370b, 1954bd3 (Step 2+2.1) · 5bed995 (Step 3) · 0717753 (Step 4). Suite: 269 passed + 1 skipped; `test:live` green (20 s).

## Step 0 — app-owned harness (ACs)
- AC1 agent cannot read owner files: container `/home` holds only `agent,node`; agent probe of `.env`, `.ssh`, owner `auth.json` → all impossible. `harness/entrypoint.sh`, `src/harness/docker.ts:77`.
- AC2 no Postgres, yes MCP: `127.0.0.1:5433` + `host-gateway:5433` refused, `8787/healthz` 200 from container. `docker-compose.yml` binds pg to loopback.
- AC3 3a proofs in container: MCP read+write, browser, web_search/fetch, subagent, lockdown, `docker stop` → nothing left. Live evidence 2026-10-20.
- AC4 personal Muse untouched: deviation — no checksum reads (never-touch rule); proven by construction (only mount is `kardata_muse`, `HOME=/opt/muse/home`): `tests/harness/docker.test.ts`.
- AC5 base cost: trivial run 26.4K in (kardata-only), +4.5K with Playwright. Reminders/context flags no-ops (adopted as insurance); preset +2 tokens (rejected); `-c` tools-key refused, no subset mechanism.
- AC6 peak 375 MiB/full run → 4 concurrent ≈ 1.5 GB; `MAX_CONCURRENT_AGENTS=4` confirmed.
- Fixes found live: image needs `chrome` dist + `--no-sandbox`; `--contributor-mode off` is read-only → adopted `on` (`src/harness/docker.ts:35`); exit code after `docker stop` is 0 (Step 2 classifies by reason).

## Step 1 — tokens (ACs)
- Scope/denial/revocation/expiry: `src/mcp/auth.ts:20,92,129`, `src/runs/tokens.ts:26`. 11 tests `tests/mcp/run-tokens.test.ts`.
- Audit every run-token call (tool/args≤2KB/status/duration): `src/mcp/auth.ts` `auditCall`, incl. forbidden attempts.
- created_by `agent:<run>/<label|main>`; `run_finish` → `agent_finish` event. `area_status_set`/`run_finish` runId optional for agents.
- Deviation: `agent_label` only on the 5 tables that have `created_by` (sources/statuses attribute by run_id).

## Step 2 — runner (ACs, fake harness)
- Batch/already_running/ordering/fresh-skip, caps, stall→stalled, time→partial, cancel→cancelled, no-finish→partial, non-zero→failed, recovery+revoke, usage stored: `src/runs/agent.ts:72,128`, `src/runs/agent-runner.ts`, 19 tests `tests/runs/agent-runner.test.ts` + 4 `tests/runs/agent.test.ts`.
- 2.1 (pilot-found): runner owns liveness, harness timer off (`agent-runner.ts:325`); tick never throws; freshness = succeeded/partial collects only; `other` excluded from required areas.

## Steps 3–5
- v0 prompt `prompts/research-v0.md` + `src/runs/prompt.ts:41` (3 tests); lists the exact toolset after the pilot showed subagents probing operator tools.
- Operator tools: `research_start`, `run_activity` (`reads.ts:725`), extended `batch_status`/`run_get` with phase/minutes/tokens/items (`reads.ts:586`); `run_cancel` stops agents via the DB flag (proven at MCP level). 6 tests `tests/mcp/agent-operator.test.ts`.
- Pilot (C3 solo + C1/C2/C4 batch): C3/C2/C4 `succeeded` (~19–20 min, exit 0, 7/7 areas incl. one honest `not_found`); C1 `stalled` at 6.8 min (children done, parent silent 120 s+; forensics in run notes). Tokens in: 1.35M/439K/323K (79–96% cached), out ~4–5K. Docs 25 total, 0 facts/records/findings — v0 writes narratives, not structured data (Stage 4 prompt work). Forbidden: 0/5/2/1 (all denied+audited). 0 containers left, 4/4 tokens revoked, 0 Muse errors, no subscription limit.

## Unfinished / notes
- Stored usage is main-run only (`children_included: false`); true spend is higher by an unknown subagent multiple.
- `HOST=0.0.0.0` needed in `.env` for agent runs (owner runtime setting); `KARDATA_MUSE_VERSION=1.4.11-R6667.1` pinned by setup.
- Owner files untouched: `docs/plans/roadmap.md` (modified) + 2 untracked plans left as found.

## Stage 3b.1 (fix round)
1. Network: `kardata_agents` 172.31.250.0/24 (`setup.ts:16`, ensured by setup `scripts/harness-setup.ts:71`); server multi-listens on HOST comma list (`server.ts:29,109`), containers use `--network kardata_agents` + gateway MCP URL (`docker.ts:100`, `server.ts:229`). Proofs live: container→gateway /healthz `{"ok":true,"db":true}`; LAN 192.168.29.181 + Tailscale 100.104.71.64 refused; pg 5433 refused from container; `ss` shows only 127.0.0.1+gateway:8787. Version gate still fires (mismatch boots with agent runs disabled). `.env.example`/`README.md` updated. Tests: `tests/server.test.ts`, `setup.test.ts`, `docker.test.ts`.
2. Usage: `harness/usage-reader.mjs` (ESM, baked into image) sums reported provider `goal_usage_attribution` per `subagent/*/session.jsonl`, exits 0 with notes; `rollupUsage` (`usage.ts:84`) runs it via `--network none` + `:ro` volume; runner stores total=main+children with `childrenIncluded` + per-child rows (`agent-runner.ts:419`, `schema.ts:321`). Verified against real C3 session (8 children). Tests: `tests/runs/usage.test.ts` (10), wiring test in `agent-runner.test.ts`.
3. Stall: default 300 s, `AGENT_STALL_SECONDS` override (`agent-runner.ts:46,60`); stall/time stores last 10 harness + last 5 MCP events as a forensic log note (`agent-runner.ts:195,444`). Tests: default/env/caps/time-note in `agent-runner.test.ts`.
4. Plans committed: `roadmap.md`, `stage-3a-muse-spike.md`, `stage-3b-orchestrator.md`.
- Deviation: `.env.example` version-gate comment corrected (warn + agent runs disabled, not boot refusal — pre-existing 3b behavior, still fires). Live MCP test (`muse.live.test.ts`) updated to gateway URL but not re-run (needs `KARDATA_LIVE` + subscription spend; same path proven by container curl).
- Suite: 286 passed + 1 skipped (live) in 124 s; lint + typecheck clean.
