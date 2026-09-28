# Agents

Karbot agent harness. Public surface: the `@kardata/agents` package barrel
(`agents/src/index.ts`). Everything else in `agents/src/` is private to the
package unless re-exported there.

Other areas may: import the barrel, implement the provider and tool interfaces
it declares, consume transcript event shapes.

Temporal workflow bundles may additionally import the `@kardata/agents/loop`
subpath (run states plus `isLegalTransition`, zero imports, deterministic).
Workflows must never import the barrel: it pulls Node-only modules
(`stub.ts` needs `node:http`) that the workflow sandbox cannot bundle.

No area may: import donor code through this package, pass credentials into it,
or assume persistence beyond the transcript and checkpoint shapes it exposes.
