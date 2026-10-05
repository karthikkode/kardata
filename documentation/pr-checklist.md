# PR checklist : agent merge gate

No change merges until the authoring agent has checked every Tier A item
and every Tier B item its trigger fires, with proof next to each. An
unchecked item blocks merge. Tier B items whose trigger did not fire need
no entry at all: silence means untouched, never skipped.

Tier A always applies. Tier B applies only when the change touches the
named area; the trigger line decides.

Enforcement: the gate is process first (this checklist in the change
description plus an independent subagent verdict, rule 8). CI runs
`npm run pr:verify`, the e2e suite, and the integration battery on every
PR and every push to `main`. Branch protection (no direct pushes to
`main`, PR required, CI green to merge) is the remaining owner-side step;
until it is on, no agent merges on its own verification alone.

## Tier A — every merge

### Scope and control

- [ ] The change stays inside the requested scope. Proof: file list of the diff.
- [ ] No new top-level directory, service, dependency, or framework.
  Proof: `package.json` diff empty, no new root entries.
- [ ] No unrelated refactors or drive-by cleanup. Proof: each touched file
  named with its reason.
- [ ] Checked the reuse map and the registry; `npm run quality:dup` did not
  rise. Proof: before/after duplication %.

### Gates and tests

- [ ] `npm run pr:verify` green on the final code. Proof: pasted tail output.
- [ ] Every behavior change ships a test that fails without the fix.
  Proof: test file path; for bug fixes, the failure observed first.
- [ ] No test proves itself: every stubbed leg fails closed without the
  network; the oracle is a maintained test, an existing suite, or observed
  behavior. Proof: the oracle named.
- [ ] A red suite anywhere in the process was root-caused (product or test,
  pinned behavior as arbiter) and recorded in
  `docs/implementation-status.md`. Proof: the entry quoted.

### Docs and handoff

- [ ] Area doc updated in the same change; `README.md` map updated when a
  surface or convention changed; ops impact → `docs/`, design impact →
  `documentation/`, cross-tree links never duplicated content.
  Proof: doc file paths.
- [ ] Handoff states what changed, how it was verified, what was skipped,
  and what decision is needed next. Skipped verification is explicit,
  never silent.

### Secrets and safety

- [ ] No secrets, tokens, passwords, or private keys committed; local-only
  config stays in ignored files. Proof: staged name and content scan.
- [ ] No data deleted, no databases dropped, no shared resources purged
  without an explicit, scoped instruction; destructive commands had a dry
  run or explicit inventory first. Proof: the instruction quoted or N/A.

### Independent verification (rule 8)

- [ ] An independent subagent re-verified the change with fresh context:
  it re-ran the gates (or reviewed the full diff when gates are
  environment-bound) and returned a verdict. Merging on the authoring
  agent's verification alone is blocked. Proof: subagent session ID plus
  the verdict quoted.

### Merge hygiene

- [ ] Branch cut from current `main`, description carries this checklist
  with proof, squash-merge, branch deleted. No direct pushes to `main`.
  Proof: branch name.
- [ ] Rollback noted: the revert commit for code, and (for migrations) that
  down-then-up round-trips on an empty database. Proof: one line.

## Tier B — only when touched

### Frontend (trigger: user-visible UI changed)

- [ ] Component follows props, render, states shape; data enters via props
  only, no fetch, no fixture imports; built by composing `components/ui`
  primitives. Proof: test file plus prop/import lists.
- [ ] Every async path shows loading, empty, error, and denied states where
  applicable; state matrix covered for data surfaces; overflow keeps full
  text one interaction away with truthful counts past the threshold.
  Proof: test names plus the threshold noted.
- [ ] Interactive elements are keyboard reachable with visible focus and
  pointer cursor; copy has no em dashes. Proof: walkthrough note plus
  scan test green.
- [ ] Every touched surface is shot in light and dark (1440 desktop, plus
  390 mobile where layout changes) with anchors asserted before every
  shot and animations frozen for stills; transitions carry video, not
  just stills. Proof: PNG/webm paths plus human verdicts recorded in
  `docs/frontend-verification.md`.

### Persistence (trigger: db layer, migrations, or projector touched)

- [ ] All reads and writes go through `backend/src/db/`; the `pg` import
  ban lint stays green; agents never receive database credentials.
- [ ] Live-DB tests catch the projector up with `projectNewEvents` exactly
  like the routes do; indexed fixtures respect the pinned 2000-char
  chunker cap. Proof: named live tests.
- [ ] No fixture, mock, or read-only action is described as live
  capability anywhere in code, tests, or docs. Proof: wording check.

### Observability (trigger: new cross-module call, route, tool, or signal)

- [ ] New calls are observable at their boundaries: MCP tools log the
  `logOp` start/done/error triple, HTTP routes log ingress/egress plus
  errors with route and trace context, Temporal signals log per signal.
  Errors are logged with code and rethrown, never swallowed.
  Proof: log lines or tests asserting them.

### Scenarios and stress (trigger: behavior with branches, fleets, or concurrency changed)

- [ ] New tests cover every reachable scenario of the changed behavior:
  happy path, each error and denied branch, boundary values, and empty.
  Copy-only changes state the exemption in one line.
  Proof: test file paths plus the scenario list they cover.
- [ ] The area's stress tier passed where it applies: UI overflow past the
  documented threshold with truthful totals; backend unit soaks where
  fleet logic changed; live-DB contention where concurrency changed.
  Proof: named suites with their numbers.

### Live-gated suites (trigger: Temporal, provider, compose, or browser behavior changed)

- [ ] Ran or explicitly skipped with reason: Temporal workflows
  (`KARDATA_TEMPORAL_TEST=1`), compose smoke (`KARDATA_COMPOSE=1`),
  provider probes (keys), `npm run test:e2e` when a user path changed.
  Proof: run output or the skip reason.
