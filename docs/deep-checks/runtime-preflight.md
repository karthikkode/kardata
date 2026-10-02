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
- Worker SDK metrics returned HTTP 200, 27,059 bytes and 157 Temporal series.
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

## Isolated telemetry activation

The existing Prometheus service was subsequently started in the same owned UUID
project, with a loopback-only listener at http://127.0.0.1:19090. Its existing
configuration and rule mounts are unchanged. The temporary ignored
`backend/test-results/preflight-runtime-telemetry.override.yaml` only replaces
its host port; the shared Prometheus instance remains untouched.

At2026-10-01T16:45:31Z, the Prometheus targets API reported backend,
temporal-worker and Prometheus itself UP with no scrape errors. A real query
counted288 ingested `temporal_*` series from `job="temporal-worker"`. Both
existing rule groups were evaluating; all seven alert rules had health `ok`,
inactive state and no evaluation error. This establishes ingestion and active
rule evaluation, beyond the earlier exporter-only probe. It does not establish
firing or notification delivery.

The Alertmanagers API returned no active or dropped Alertmanagers. The existing
Prometheus configuration contains no alerting destination, and Compose contains
no Alertmanager/notification receiver. Loki's localhost9093 reference does not
provide a deployed receiver. Outbound alert delivery therefore remains an
explicit acceptance gap requiring an owner-selected existing notification
destination or an approved architecture addition. No receiver or service was
invented during this check.

Nonsecret evidence: `backend/test-results/preflight-runtime-prometheus-proof.json`
and `preflight-runtime-prometheus-boot.log`. Repeat read-only verification with
`curl http://127.0.0.1:19090/api/v1/targets`, `/api/v1/rules` and
`/api/v1/alertmanagers`; do not dump rendered Compose configuration containing
local credential values.

## Actual Meta PDF candidate activation, 2026-10-02

Owned backend and worker were updated to uncommitted candidate
`kardata-preflight:candidate-379de2d3d2e8`, image
`sha256:4d1ff060a644bbd764bc6da7b1755ada021e10f40e975909064fee888ffc8e00`.
Copied runtime-source manifest SHA256 is
`ff0a2839c70b1829c88d0b26b2793a3a7ac231f0c318ad5ec2cd235d565030b6`;
this is a source snapshot, not a committed SHA. The isolated DB/archive volumes
and existing three draft sectors remained intact, each with zero companies.
The new file-admission maintenance workflow is actually RUNNING. Meta-only
settings were copied into ignored mode0600 config; the test approver/MCP token
and shared Kardata services were unchanged.

A maintained Playwright UI journey uploaded the real-parser synthetic two-page
TEST PDF containing native text, bitmap squares and vector rectangles. The UI
accepted and retained original bytes, and the worker sealed four image records.
The actual Meta token-count operation returned HTTP 402, code `billing_not_configured`,
type `billing_error`: billing verification failed. This occurred before the paid
image request marker; zero image generations or completed images are proven.
The UI displayed failed progress honestly. Successful Meta-derived indexing and
its final download assertion remain unverified pending resolution of the token-count
endpoint failure. Subsequent same-key endpoint diagnostics returned HTTP 200 for
chat and Responses generation, including streams; only `/responses/input_tokens`
returned HTTP 402. This is not evidence of a global generation/billing outage.
A separate tiny-PNG Responses adapter diagnostic exposed HTTP 400 for
`tool_choice: none`; Meta requires `auto`. The corrected bounded request returned
HTTP 200 in 9.53 seconds with 49 input/512 output tokens, zero tool calls, zero text,
and explicit incomplete completion. This proves vision endpoint acceptance,
not usable OCR or successful app PDF processing. The 512-token diagnostic limit
was exhausted; production rejects incomplete responses rather than indexing them.
One authorized 4096-output-token follow-up on the same tiny PNG returned
HTTP 200 in 12.67 seconds, complete completion, 25 nonempty characters, no tool
calls, and 49 input/839 output tokens. This establishes bounded vision generation
through the existing Meta adapter; the pixel test establishes no OCR quality.
App PDF budget/finalization/UI acceptance remains a separate gate.
The gateway was not bypassed and no companies/research were created.

The first runner attempt failed before upload because it used the region name
Files instead of the observed Sector files. Correcting only that locator exposed
the genuine provider denial on the second run; assertions were not weakened.
CUA reported no available browsers, so the explicitly approved runnable Playwright
workflow drove the real UI instead.

Retained ignored evidence: preflight-pdf-candidate-source/health/runtime/volume
JSON, build/rollout logs, preflight-pdf-meta-token-http.json,
preflight-pdf-meta-failure-diagnostic.json and actual browser screenshots/video.
Live-key traces stay private and require redaction before sharing. The failure
is an external provider-account configuration gap, not successful live capability.

A separate actual retained-failure UI journey passed1 case in977ms (2.1s runner):
failed processing and0of4 image analyses were visible, and the owner downloaded
original bytes exactly (SHA256 matches the maintained synthetic fixture). It used
no upload/retry or backend mutation and explicitly skipped the success journey.
This establishes real failure-state/original-retention behavior, not successful
Meta generation. Screenshots/video/proofJSON are retained under
frontend/test-results/pdf-meta-denied-retention; raw traces remain private0600.


## Final real Meta PDF UI gate, 2026-10-02

Only the owned backend and worker were updated to uncommitted candidate
`kardata-preflight:candidate-9bda3bafa64a`, image
`sha256:3b90c2b0bd1c6acb6e1586c7c1c9907750e5c4196f9efa9e6ec90d1598d92e9e`.
Runtime source snapshot digest is
`ffaf3025e9f93cba5be6a30b2bd58f6506350750dd56a7f007a29b9728227115`;
production source matched after deployment. Two subsequently edited test files
differed from that snapshot, without changing runtime code. Owned DB/archive
volumes and the earlier failed PDF were retained; shared services were untouched.

The maintained opt-in `pdf-meta-preflight.spec.ts` real-provider UI journey
passed one case in 1.2 minutes; its alternate retained-denial-only case was
explicitly skipped. UI upload accepted a fresh labeled synthetic two-page PDF
with native text, two embedded bitmaps and two page visual analyses. The
previous same-bytes/new-name attempt correctly replayed the retained original
file identity; a harmless unique trailing TEST comment established a fresh
source version without changing the visual fixture. No old file was removed.

All four image receipts completed on attempt one, using actual Meta contributor
responses with explicit complete completion, nonempty text and exact archive
references. Read-only inspection used existing backend DB exports after the
public complete state. Actual usage totaled 5,752 input and 3,442 output tokens;
cache reads were zero. The UI showed native text from both pages, clearly labeled
uncertain AI-derived analysis and page overviews. Downloaded original bytes
matched all 1,655 uploaded bytes; no browser page errors occurred. This proves
the small synthetic PDF production path, not general OCR quality or a company
research pilot. No companies or research were started.

Ignored evidence: `preflight-pdf-final-candidate-source.json`,
`preflight-pdf-final-candidate-build.log`, `preflight-pdf-final-candidate-health.json`,
`preflight-pdf-final-meta-ui-unique.log`, `preflight-pdf-final-receipts.json`, and
`frontend/test-results/pdf-meta-final-9bda3bafa64a-unique/`. The safe visual bundle
contains screenshots, video and nonsecret diagnostic JSON only. Raw Playwright
traces contain the dedicated test credential and remain ignored/private mode0600;
never attach them to a PR or public handoff.
