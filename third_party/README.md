# third_party — donor reference policy

Adopt-don't-depend. Donor code is read-only reference; it is never imported,
installed, or executed at runtime. No donor servers, persistence, auth, or
telemetry enter the repo through this directory.

## Adoption pipeline

1. Pin: add a `manifest.yaml` entry with repo, exact commit SHA, license name,
   license path verified at that SHA, what was taken, and why.
2. Read: re-open the exact donor files at the pinned SHA.
3. Specify: write a Karbot spec against our interfaces first.
4. Port: patterns reimplemented, verbatim copies kept with attribution headers.
5. Port the donor regression tests into `upstream-tests/` (adapted, attributed).
6. Prove in Karbot with our own replay or golden test.
7. Review: spec, evidence, code, both tests, written reasons for divergences.
8. Freeze: no auto-updates; re-adoption is a new pin plus changelog entry.
   Local fixes to verbatim code live in `patches/`.

An adoption missing donor evidence (file plus line at SHA), Karbot spec, or a
passing test does not ship.

## Manifest schema

```yaml
pins:
  - donor: pi
    repo: https://github.com/earendil-works/pi
    sha: <full-commit-sha>
    license: MIT
    licensePath: LICENSE
    taken:
      - path: packages/ai/src/types.ts
        lines: 189-500
        kind: pattern
        karbotSpec: docs/agents-tools.md#canonical-shapes
    why: Normalized tool/call/result shapes plus index-keyed delta accumulator.
    changes: Reimplemented in TypeScript against Karbot interfaces; no verbatim copy.
```
