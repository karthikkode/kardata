# Isolated matching-runtime preflight, 2026-10-01

This verifies the production Docker image and entrypoints from commit
`4415b709160c0457e7092a07f95caf916cde2cf4`, not the shared deployment or Meta pilot.
The exact image manifest is
`sha256:102ad9a8b8f7dcbac59559108f9cb593d8827644e85ec27313933592ebd0857a`.

The existing Compose services were started under owned project
`kardata-preflight-5a1c4314-3eaa-49ec-9868-7a1c064af1cc`, with fresh project-scoped
Postgres and archive volumes. Only db, Temporal, browser, backend and worker were
started. Backend and worker share the same archive volume; Postgres has 1 GiB
shared memory. Host listeners bind loopback on 15433 (DB), 17233 (Temporal),
13001 (HTTP) and 15173 (Vite). Shared resources and frontend/.env were untouched.
The isolated provider is fake, with no copied provider/search credentials.
Dedicated test keys were registered through the existing DB administrative layer,
under the owner's prior test-key authorization; their ignored env files are mode0600.

## Observed results

- Health returned the exact commit. All five owned containers were running with
  zero restarts at capture.
- The production worker started turn and research lanes; the durable reconciliation
  owner described as RUNNING, with a successful first page.
- Worker SDK metrics returned HTTP200, 27,059 bytes and 157 Temporal series.
  This establishes exporter activation, not alert delivery or Prometheus ingestion.
- The production browser adapter navigated HTTPS example.com through the backend
  network guard and closed its context successfully. Authenticated MCP listed 74 tools.
- Existing `npm run prom:check` and `npm run prom:test` both exited0. These are
  deterministic rule/configuration checks, not outbound notification proof.

Root operated the UI directly, without route interception or backend population:
created `TEST Runtime preflight Australian trades` (sector
`sec-4a08af49-e614-4ad7-b021-f68957e26782`), opened the persistent research session,
checked the draft progress dialog, and created a normal brainstorming session.
Uploaded a clearly labeled test text file, inspected its extracted preview, hid it,
verified it disappeared, showed hidden files and revealed it. An owner Decisions
edit survived reload. An unsent draft survived research/chat switching.

A UI send cold-started the production session workflow. With no scripted steps,
the deliberately unconfigured fake provider failed honestly; the durable failure
message appeared and Stop/running controls cleared. This establishes cold-start
failure termination, not a successful provider reply or research discovery.
No companies, approved plan, Meta turns, deep research or outreach were created.

Two manual selectors used incorrect accessible names before fresh observations
corrected them. The IAB download-event observer timed out and reset its handle;
this manual run does not establish downloaded-byte equality. The separate maintained
Chromium file journey passed locally and in CI. No console errors were observed.
A transient false-unavailable message on new-session creation was found and fixed:
the workspace adopts the server-acknowledged session before URL navigation. Late
acknowledgements after a scope change cannot publish or navigate. The maintained
regression suite covers pending list refresh, real foreign-session denial, stale
resource acknowledgement and stale create navigation. A fresh UI creation showed
loading conversation with no false denial. Required frontend gates passed:
337 tests,6 explicit skips, lint/typecheck/build; existing warnings remain.
Hot reload during the hook edit temporarily invalidated development hook order;
a fresh reload recovered. This was not observed in the fresh-page browser gate.

## Retained evidence and repeatability

Ignored `backend/test-results/preflight-runtime-*` includes image build log,
nonsecret metadata, isolation/container inventory, production browser/MCP probes,
worker evidence, SDK metrics and supervisor status, rule logs, and UI screenshot.
The app remains available at http://127.0.0.1:15173 for owner inspection.
All owned data/volumes are preserved.

The local override and mode0600 auth/UI files live under backend/test-results;
never attach these credential files or dump rendered Compose environment output.
To inspect the retained environment:

```sh
docker compose -p kardata-preflight-5a1c4314-3eaa-49ec-9868-7a1c064af1cc \
  -f deployment/compose.yaml \
  -f backend/test-results/preflight-runtime.override.yaml ps
curl --fail http://127.0.0.1:13001/healthz
npm run prom:check
npm run prom:test
```

No shared rollout, container replacement, migration, backup/restore exercise,
archive-writer restart, real-provider campaign, full audit or stress envelope is
established by this check. Those acceptance gates remain explicitly pending.

## Maintained production-stack browser gate

`tests/frontend-e2e/runtime-preflight.spec.ts` passed1 case in3.0 seconds against
the retained stack with no route interception. It created a fresh labeled test
sector, checked draft progress, uploaded UTF-8 bytes, previewed and downloaded
the exact original bytes, hid/revealed the file, persisted owner Decisions through
reload, and verified normal/research switching preserves an unsent draft.
No browser page errors occurred. The first runner attempt reached byte equality
but failed because the test used checkbox.check on an aria-pressed button; the
corrected role/button interaction passed without weakening product assertions.

Final log: backend/test-results/preflight-runtime-browser-final.log. Screenshot,
video and retained-record JSON: frontend/test-results/runtime-preflight-final/.
TypeScript strict standalone check passed. This gate is explicitly skipped unless
KARDATA_RUNTIME_PREFLIGHT_URL names the isolated app; the default smoke server
is not the target. Existing frontend Playwright configuration remains unchanged.

```sh
KARDATA_RUNTIME_PREFLIGHT_URL=http://127.0.0.1:15173 \
  npm run test:e2e -w frontend -- runtime-preflight.spec.ts \
  --output=test-results/runtime-preflight-final
```

Controlled baseline verification temporarily restored only the two original
workspace source files from4415b709, ran the focused regressions and restored
the final files in a finally block. Original code:3failed/1passed; final code:
4passed. Two failures prove actual bugs (missing selection after creation and
late old-sector navigation); the third is the new acknowledgement API absent on
baseline. Foreign-session denial passed on both versions. Byte-identical final
restoration is recorded in preflight-session-creation-red-green-proof.json.

Final frozen-source `npm run pr:verify` exited0: frontend337passed/6skipped,
agents229passed, backend551passed/389skipped (1117passed/395explicit skips),
including lint/typecheck and frontend build. Existing five Hooks warnings and
bundle advisory remain. Relevant workspace browser matrix passed37cases in23.4s.
Independent bounded review found no actionable issue; focused maintained suites
passed35/35. This does not approve the full file/functionality catalogue.

The original agent-owned Vite process later exited; read-only listener probing
confirmed port15173 absent before restarting only that isolated dev server.
All Docker services and stored records remained intact. No shared process was
restarted. Owner inspection uses the restored local Vite process.
