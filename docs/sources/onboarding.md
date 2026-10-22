# Onboarding a source adapter

Collect runs execute adapters from `src/collect/adapters.ts`, never ad-hoc
code. A company whose preflight plan names an unknown adapter id pauses with
`adapter_missing` until that id is onboarded here, then resumes.

## Steps

1. **Collector** — implement `Collector` in `src/collect/collectors/<id>.ts`
   (`name`, `areas`, `run`). Reuse `collectFetch`/`siteFetch` from
   `collectors/util.ts` so HTTP goes through `fetchUrl` (logged, budgeted,
   robots-aware). Write facts/records/documents only through
   `src/domain/research/`.
2. **Register** — append to `COLLECTORS` in
   `src/collect/collectors/index.ts` (order matters: later adapters may read
   `ctx.shared` from earlier ones).
3. **Adapter face** — add the one-line blurb to `BLURBS` in
   `src/collect/adapters.ts`. The id, areas and version come from the
   collector automatically; bump `ADAPTER_VERSION` only when that adapter's
   behavior changes. Add `detect()` when a cheap no-network signal decides
   applicability (absent = always attempt).
4. **Tests** — cover the new collector against the fake site in
   `tests/collect/` (ok + not_found + error paths, like its neighbors). No
   live network in tests, ever.
5. **Prompt** — nothing to do: the preflight prompt lists adapters from the
   registry automatically.

## Rules

- No network outside `fetchUrl` (or the browser container for JS-only pages,
  via the existing reviews-onsite path).
- No new dependencies without a plan naming them.
- Outcomes are honest: `done` / `not_found` / `blocked` / `error` /
  `skipped`, with a reason an operator can act on.
