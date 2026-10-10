# Phase 8 review package (branch `p2-8-pilot`)

Pre-B1: stopped (not removed) restart-looping `kardata-preflight-5a1c4314-{backend,worker}`.
B6 skipped per trim; severity rules go atop the first issue log. Shell ulimit is 1024
(raised per-command via `prlimit --nofile=65536 --` before the pilot; hard cap 1048576).

## What each B-item built (commit : files : tests)

- B1 `4bd8691`: UI-only gate. `db/migrations/0032_api_key_client.sql`,
  `backend/src/auth/keys.ts` (`authorize()` 403 `ui_only_violation`), `db/keys.ts`,
  `observability/ambient.ts`, `routes/http.ts`. Tests: `http.ui-only` 6/6, `db.migrations` 5/5.
- B2 `a44cd3f`: RO role stays cluster-global SQL in `deployment/scripts/stack-lib.mjs`
  (never migration). Tests: `db.pilot-ro` 3/3 (incl. `must be owner` DDL fix).
- B3 `28474c2`+`4694c6b`: `stack:pilot up/down/status --worktree`. Scripts:
  `stack.mjs`/`stack-lib.mjs`. Live-validated in `/tmp/kardata-pilot-live` (up/status/
  sector-201/persistence), then cleaned. Fixes from live: backend-first boot, namespace
  register, hoisted vite bin, `:9464` refusal. Tests: `stack` 28/28.
- B4 `6ada195`: 15 specs in `tests/frontend-e2e/pilot/*.spec.ts` (+support, pilot
  playwright config), lint ban (`eslint.pilot-ban` 6/6), stress consumer at
  `tests/stress/meta-ceiling.test.ts`. `playwright --list` shows 15 tests.
- B5 `8789047`: `pilot:audit` CLI (`scripts/pilot-audit.mjs`) + lib. Tests: `pilot.audit` 7/7.
- B7 `5a07299`: `tests/stress/meta-ceiling.test.ts` live-gated (`KARDATA_LIVE_META=1`).
  Tests: 4 pass, live skipped. Live run deferred: after acceptance, prod idle, owner time.
- B8 (this branch head): `pilot:quality` CLI (`scripts/pilot-quality.mjs`) + lib:
  dup domains, missing sources, thin evidence, off-ICP keywords, stuck subagents,
  30-company sampler. Tests: `pilot.quality` 2/2 (ambiguous-`kind` fix).

## Pilot scheduling + Meta-key sharing

Prod stays `normal` during P1–P12; only the 1000-subagent tier uses
`stack:rebalance testing`, at owner-picked time. **Prod and staging SHARE one
Meta key** (prod `agents/.env` has only the UI key; `KARDATA_META_KEY`,
`KARDATA_META_SESSION`, `KARDATA_META_DBUS` inherit staging's).

## Post-pilot list (unchanged)

CI-only db-template race; restore required checks; B7 live run; B6 severity rules.
