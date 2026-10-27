Status: done · Date: 2026-10-26
Banner (2026-10-26): in this old review, "Layer 1/2" means research wave and "core/adjacent" is retired (see docs/business/icp.md, Terms). Company names below predate the no-names rule in AGENTS.md.

# Stage 5 pre-launch checklist review (branch `stage-5`, PR #54)

## 1. Run/dev separation — done
- `src/lib/env.ts:28` `loadAppEnv()` (`KARDATA_ENV_FILE` or `.env`); all 8
  entry points use it. `package.json:10-12`: `dev` (tsx + `.env.dev`),
  `dev:migrate`, `mcp`. README + `.env.example` document the layout.
- Evidence: fresh `dist` boots and serves `/healthz`; dev `8788/kardata_dev`
  serves with 0 sectors vs prod `8787/kardata` with 1; prod untouched.
  `tests/unit/env.test.ts` 2/2. `kardata_dev` created + migrated.

## 2. Research stalls — root-caused and fixed
- Forensics via MCP `run_activity`: 4 research stalls, all "MCP call never
  returned" (300s+ silence mid-call). 2 hung on the first `company_context`
  within 65s of each other; that tool is bounded SELECTs
  (`src/domain/research/reads.ts:334`) → transient server/container-network
  issue, not tool logic. 30 more failed on 429 `usage_limit`; 72 extra
  preflight attempts are tsx-watch reload orphans + 429s during 5.1 dev.
- Fix: liveness bump on every agent tool call (`src/mcp/auth.ts:139`) kills
  false stalls; first consecutive stall/usage_limit auto-requeues
  (`src/runs/company.ts:56,477-490`), second parks, `server_stopped` never
  retries; systemd prod kills reload orphans. <5% needs wave-1 numbers to
  prove — the rate reducers are in, observation is pending.
- Tests: auto-retry ×2 (`tests/runs/company.test.ts`), bump ×1
  (`tests/mcp/agent-operator.test.ts`). Plus a `company_jobs_list` status
  filter (`src/mcp/research-tools.ts:1327`) for failure triage.

## 3. Backups — done
- `scripts/backup-db.sh` (pg_dump `-Fc` via `docker exec`, keeps 7 days in
  `~/kardata-backups/`) + `kardata-backup.service/.timer` (daily).
- Evidence: first backup 745M; restore to scratch DB matched prod exactly
  (31 tables, 7776 companies, 14643 facts); scratch dropped.
- Owner installs: copy unit + timer to `~/.config/systemd/user/`,
  `daemon-reload`, `enable --now kardata-backup.timer`. No sudo.

## 4. Off-site review APIs — researched, no scrapers built
- Google Places (New): Place Details → rating, review count, a few snippets;
  ~$17-25/1k calls, needs GCP key + billing. Blockers: pure DTC brands have
  no Place entry (no storefront) → ~zero coverage of the 914; terms forbid
  warehousing review content. Not worth building.
- Trustpilot official API: a business's OWN reviews only (business account +
  paid add-on). Useless for third-party research; no official path exists.
- Amazon PA-API: average rating + count only, no review text; needs an
  Associates account. Not worth it.
- Decision stands: off-site ratings stay agent-found, secondary-graded.

## 5. MCP-only ops — done (standing rule in AGENTS.md)
- New tools `company_jobs_supersede` (`research-tools.ts:1390`) and
  `sector_scope_apply` (`:1623`); `scripts/mcp-call.ts` standard caller
  (`npm run mcp -- <tool> '<json>'`); one-off scope script deleted.
- `pipeline_start` gives failed/cancelled history a fresh job.
- Tests: supersede + scope-apply (`tools.test.ts`), retry-failure
  (`sector-preflight.test.ts`).

## 6. PR #54 — suite green, CI TBD
- No rebase needed (base == origin/main `d40fc05`).
- Full suite: 549 passed + 1 skipped, 0 failed. Harness note: `resetTestDb`
  now retries TRUNCATE deadlocks (40P01), mirroring `ensureMigrated`.

## Left unfinished
- Wave 1 (758 core) launches after owner merges + installs the service;
  wave 2 (156 adjacent) only on owner go. Stall <5% to confirm from wave 1.
- Service install: `npm run build`, copy `scripts/kardata-server.service` to
  `~/.config/systemd/user/`, `daemon-reload`, `enable --now`. No sudo.
