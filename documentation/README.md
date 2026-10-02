# Documentation index

Area docs (one per top-level directory):

- `frontend.md` : component shape, tokens, primitives, a11y, what a change ships with.
- `tests.md` : test-per-change rule, query priority, Playwright scope.
- `state-design.md` : seven-state matrix, overflow and scaling rules.
- `pr-checklist.md` : the merge gate. Every item checked with proof.

Cross-cutting decisions (override area docs when they conflict):

- Tokens in `frontend/src/index.css` are the only colors. No arbitrary values.
- Components never fetch and never import fixtures; data enters via props.
- Every behavior change ships its test in the same change.
- `vision.md` governs product scope; area docs govern implementation.
