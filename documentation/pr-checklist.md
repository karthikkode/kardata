# PR checklist : agent merge gate

No change merges until the authoring agent has checked every applicable item
below and recorded proof next to it. An unchecked item blocks merge. "Not
applicable" is allowed only with a one-line reason. Paste this checklist into
the PR description with each box checked and its proof attached.

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

## Tests (`documentation/tests.md`)

- [ ] Every behavior change ships a test that fails without the fix.
  Proof: test file path; for bug fixes, the failure observed first.
- [ ] Queries prefer role, then label, then text; user-event for interaction;
  no markup snapshots. Proof: reviewer spot check.
- [ ] Scan guards green: no em dashes, typography tokens intact.
  Proof: `npm test` output.

## Gates and docs

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  green; `npm run test:e2e` green when a user path changed. Proof: pasted
  command output. Mechanical shortcut: `npm run pr:verify` runs all four
  (plus state which gates were open); judgment items below stay human.
- [ ] Area doc updated in the same change; `README.md` map updated when a
  surface or convention changed. Proof: doc file paths.
- [ ] Handoff states what changed, how it was verified, what was skipped,
  and what decision is needed next. Skipped verification is explicit.
