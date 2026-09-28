# PR checklist : agent merge gate

No change merges until the authoring agent has checked every applicable item
below and recorded proof next to it. An unchecked item blocks merge. "Not
applicable" is allowed only with a one-line reason. Paste this checklist into
the PR description with each box checked and its proof attached.

Enforcement: the gate is process first (this checklist in the PR description
plus an independent subagent verdict, rule 8). Local git hooks are convenience
only and bypassable with `--no-verify`. Once a remote exists, branch
protection (no direct pushes to `main`, PR required) plus CI running
`npm run pr:verify` and the e2e suite makes the mechanical items
non-bypassable. Until then, no agent merges on its own verification alone.

## Scope and control

- [ ] The change stays inside the requested scope. Proof: file list of the diff.
- [ ] No new top-level directory, service, dependency, or framework.
  Proof: `package.json` diff empty, no new root entries.
- [ ] No unrelated refactors or drive-by cleanup. Proof: each touched file
  named with its reason.

## Component and design rules (`documentation/frontend.md`)

- [ ] Component follows props, render, states shape; data enters via props
  only, no fetch, no fixture imports. Proof: test file plus prop list.
- [ ] Built by composing `components/ui` primitives; no primitive forked for
  feature styling. Proof: import list.
- [ ] Styling uses tokens only; both themes verified. Proof: screenshots or
  notes for light and dark; no hardcoded color in diff.
- [ ] Every async path shows loading, empty, error, and denied states where
  applicable. Proof: test names or screenshots per state.
- [ ] State matrix covered for data surfaces: loading, first-run empty,
  filtered empty, few, many with overflow strategy, error, denied.
  Proof: per-state evidence or written reason per missing state.
- [ ] Overflow scales: truncation keeps full text one interaction away,
  counts stay truthful past the documented threshold. Proof: threshold noted
  plus overflow evidence.
- [ ] Interactive elements are keyboard reachable with visible focus and
  pointer cursor; read-only elements keep default cursor with `select-none`.
  Proof: keyboard walkthrough note.
- [ ] Copy has no em dashes; labels use plain words. Proof: scan test green.

## Typography and UX

- [ ] Only Geist Variable (UI) and Geist Mono Variable (code) used; hierarchy
  from size and weight. Proof: typography test green.
- [ ] Each applicable Nielsen rule (status, plain words, exits, consistency,
  prevention, recognition, efficiency, minimalism, recovery, teaching) holds.
  Proof: one line per rule or the rules marked not applicable with reason.

## Frontend rigor (rule 5)

- [ ] Every touched surface is shot in light and dark (1440 desktop, plus
  390 mobile where layout changes) with anchors asserted before every
  shot; animations frozen for stills. Proof: PNG paths plus human verdicts
  recorded in `docs/frontend-verification.md`.
- [ ] Transitions carry video, not just stills: each enter/exit pair
  recorded (dock, section switch, menus, focus returns). Proof: webm paths.
- [ ] Hover, focus, and scroll contracts are asserted in a real browser
  (pins stay, wheel chains, no sideways spill), never by class names.
  Proof: spec names plus the browser assertions they make.

## Tests (`documentation/tests.md`)

- [ ] Every behavior change ships a test that fails without the fix.
  Proof: test file path; for bug fixes, the failure observed first.
- [ ] Queries prefer role, then label, then text; user-event for interaction;
  no markup snapshots. Proof: reviewer spot check.
- [ ] Scan guards green: no em dashes, typography tokens intact.
  Proof: `npm test` output.

## Scenario and stress coverage (rules 1 and 6)

- [ ] New tests cover every reachable scenario of the changed behavior:
  happy path, each error and denied branch, boundary values, and empty.
  Proof: test file paths plus the scenario list they cover.
- [ ] The area's stress tier passed: UI overflow past the documented
  threshold (50/60/120 rows) with truthful totals; backend unit soaks
  (100-entity drills with mixed fates) where fleet logic changed;
  live-DB contention (twin storms, races, timeouts) where concurrency
  changed. Proof: named suites with their numbers. Copy-only changes state
  the exemption in one line.
- [ ] No scenario is proven only by a scratch script, or by a test that
  encodes the same assumption as the fix; every stubbed leg fails closed
  without the network. Proof: the independent oracle named (maintained
  test, existing suite, or observed behavior).

## Observability (rule 2)

- [ ] New cross-module calls are observable at their boundaries: MCP tools
  log the `logOp` start/done/error triple, HTTP routes log ingress/egress
  plus errors with route and trace context, Temporal signals log per
  signal. Proof: log lines or tests asserting them.
- [ ] Errors are logged with code and rethrown, never swallowed.
  Proof: reviewer spot check of the touched handlers.

## Persistence (rule 3)

- [ ] All reads and writes go through `backend/src/db/` (routes and tools
  only); agents never receive database credentials. Proof: the `pg` import
  ban lint stays green.
- [ ] Live-DB tests catch the projector up with `projectNewEvents` exactly
  like the routes do; indexed fixtures respect the pinned 2000-char
  chunker cap. Proof: named live tests.
- [ ] No fixture, mock, or read-only action is described as live
  capability anywhere in code, tests, or docs. Proof: wording check.

## Gates and docs

- [ ] The whole suite ran: `npm run lint`, `npm run typecheck`, `npm test`
  across all workspaces (`npm run pr:verify`), `npm run build -w frontend`,
  plus `npm run test:e2e` when a user path changed. Proof: pasted command
  output. Mechanical shortcut: `npm run pr:verify` builds `@kardata/agents`
  first (backend tests resolve its `dist` entry), then lint, typecheck,
  and tests (plus state which gates were open); judgment items below stay
  human.
- [ ] Live-gated suites were run or explicitly skipped with reason:
  Temporal workflows (`KARDATA_TEMPORAL_TEST=1`), compose smoke
  (`KARDATA_COMPOSE=1`), provider probes (keys). Skipped verification is
  stated, never silent. Proof: run output or the skip reason.
- [ ] Area doc updated in the same change; `README.md` map updated when a
  surface or convention changed. Proof: doc file paths.
- [ ] Doc routing respected: ops impact → `docs/`, design or contract
  impact → `documentation/`; cross-tree links, never duplicated content.
  Proof: doc file paths.
- [ ] Handoff states what changed, how it was verified, what was skipped,
  and what decision is needed next. Skipped verification is explicit.

## Independent subagent verification (rule 8)

- [ ] An independent subagent re-verified the change with fresh context:
  it re-ran the gates (or reviewed the full diff when gates are
  environment-bound) and returned a verdict. Merging on the authoring
  agent's verification alone is blocked. Proof: subagent session ID plus
  the verdict quoted.
- [ ] A red suite anywhere in the process was root-caused (product or test,
  with the pinned behavior as arbiter) and the finding recorded in
  `docs/implementation-status.md` before merge. Proof: the entry link.

## Secrets and safety (addition)

- [ ] No secrets, tokens, passwords, or private keys are committed;
  local-only config stays in ignored files. Proof: staged name and content
  scan (patterns: private keys, provider tokens, key assignments).
- [ ] No data deleted, no databases dropped, no shared resources purged
  without an explicit, scoped instruction; destructive commands had a dry
  run or explicit inventory first. Proof: the instruction quoted or N/A.

## Merge hygiene (addition)

- [ ] Branch cut from current `main`, PR description carries this checklist
  with proof, squash-merge, branch deleted. No direct pushes to `main`.
  Proof: branch name.
- [ ] Rollback noted: the revert commit for code, and (for migrations) that
  down-then-up round-trips on an empty database. Proof: one line.
