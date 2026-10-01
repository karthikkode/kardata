# Browser closure verification, 2026-10-01

The full maintained browser matrix passed113 cases with4 explicit live Meta
journey skips on Node22.23.3 in59.8 seconds, exit0. This is browser and isolated
scripted integration evidence; it does not approve the complete release.

Command: `KARDATA_TEMPORAL_TEST=1 TEST_DATABASE_URL=<owned-test-base>
KARDATA_LIVE_JOURNEY=0 npm run test:e2e -w frontend --
--output=test-results/browser-closure-final-20261001T1617/playwright --trace=on`.
The existing configuration selected117 cases across19 specs with8 workers.
The owned Postgres container was
`kardata-test-pg-preflight-ecdae3dd-f8cb-4f3b-b91d-b2c38fe86ec8`, host port32772,
1GiB shared memory. Helpers created fresh UUID databases. Shared port5433,
research data and shared worker queues were not changed or purged.

## What the maintained cases establish

- `files-db.spec.ts`: real loopback HTTP, Postgres and filesystem archives;
  failed upload publishes nothing, retry previews/downloads exact bytes and
  duplicate upload creates no second row. Chat events remain stubbed.
- `agent-context-db.spec.ts`: real HTTP/MCP/Postgres/Temporal with a scripted
  provider, its own UUID session and isolated queue. Local/authorized-sector
  reads, durable terminal answer, cleared Stop control and isolated LISTEN
  disconnect/reconnect preserve the unsent draft and one answer. This does not
  establish first-send workflow creation or Meta behavior.
- Files2005-record windows, execution inspection, receipt/rebuild, intake review,
  plan conflicts, overflow/steering, themes, resource states and motion remain
  synthetic HTTP fixtures with their existing maintained assertions.
- Eight added cases in `workspace.spec.ts` pin767/768/1279/1280px in both themes:
  correct rail/drawer visibility, keyboard Enter/Escape, trigger focus return,
  reachable composer and document horizontal-overflow bounds. No product source
  or design behavior changed.

## Failure found and correction

The initial105-pass/4-skip full run passed. After adding boundary cases, the
first117-case run passed112 and skipped4 but failed `files-db.spec.ts` during
teardown. Its trace shows completed upload/download/duplicate assertions followed
by late resource polling while the fixture closed its backend:503 responses and
`ECONNREFUSED` on the owned ephemeral listener. This was a fixture lifecycle race.

The corrected `finally` navigates the owned page to `about:blank`, waits for
routed reads with `unrouteAll({ behavior: 'wait' })`, then closes backend/pool in
nested `finally` blocks. No assertion or timeout was weakened. The same maintained
real-file case then passed1/0 skips, followed by the full113/4 final result.
One new-test collection attempt also failed because trace/video options were
inside `describe`; moving those worker-scoped options to file scope corrected
collection. These failed logs remain retained rather than treated as a baseline.

## Retained proof and visual review

Final ignored output: `frontend/test-results/browser-closure-final-20261001T1617/`.
It contains145 PNGs,82 WebM videos and113 trace ZIPs, plus watched `run.log`,
source-before/source-after manifests and `artifact-manifest.json`. All copied
hardcoded visual-directory stills were generated after this run started.
The before/after comparison of430 source/test/migration/configuration files found
no changed bytes during the final browser run. HEAD at capture was
`de2e54c416b126dc054ae657ee9298cd59a8f81b`; working-tree hashes identify the tested
uncommitted bytes and do not claim that HEAD already contains them.

| Proof | SHA256 |
|---|---|
| artifact-manifest.json | `bc1d56d645d4d9faa131d12c38e557ab218dd7e6862a4607679c198b66ce76b8` |
| source-before.json | `c35116dbd7ff9b726155db0c0c2d2d1932884d7153251e9cfcac3d0149a16102` |
| source-after.json | `864c3144cbd0535d5d71014a70c816e87ce191347a9c5e7fe97c708306ad5a2f` |
| workspace.spec.ts | `d882eb47a12ac72908b0c50b6525e8aff27b1d2e287e6523c6f821e1e0b87578` |
| files-db.spec.ts | `053fc65624c537ce1b9f3659375e1b8f4b0181120f83857108ef6618b8f51f28` |

Visual inspection covered mobile light/dark intake dialogs, mobile light/dark
rebuilt local context, desktop execution JSON and mobile dark large-library
resources from the initial run, plus final767-dark/768-light/1279-dark/1280-light
workspace stills and the previous run's complementary boundary themes/drawers.
The relevant UI implementation hashes stayed unchanged. Reviewed stills show
readable content/actions, bounded JSON and the expected rail transitions without
document overflow. Videos/traces are retained; not every frame was manually reviewed.

Other retained runs: `browser-closure-20261001T1607` (105/4),
`browser-closure-final-20261001T1610` (collection failure),
`browser-closure-final-20261001T1612` (112/4/1 teardown failure), and
`browser-file-cleanup-20261001T1615` (focused1/0).

## Explicit remaining gates

`plan-live`, `plan-full`, `pilot-live` and `plan-console` stayed skipped because
`KARDATA_LIVE_JOURNEY` stayed off. No Meta research turn,2000 genuine-company
campaign,50-company source validation, shared deployment, worker rollout, merge,
GCS access, complete catalogue/functionality acceptance or release approval is
established by this run. Root mechanical checks and independent acceptance review
remain separate from this browser proof; final catalogue/source refresh must
include the two changed maintained test files.
