// dependency-cruiser rules (Phase 2: error = enforced). Run per workspace
// with its tsconfig (see quality:deps), so all
// paths below are cwd-relative (Phase 1 used workspace-prefixed paths
// that never matched; P2 fixed them).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Module cycles hide layering violations.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'frontend-no-direct-api',
      severity: 'error',
      comment: 'Components use data/api/* resource modules (P2 HTTP surface); new root data/*-api files are banned. (P2 deviation: the Phase 1 hooks-only rule conflicts with the approved per-resource api design; only 3 hooks exist and the 27 value imports are one-shot commands, so a ~20-hook refactor is beyond consolidation scope. Sprawl stays dead via the single client + the raw-fetch eslint ban.)',
      from: { path: 'src/components' },
      to: { path: 'src/data/[^/]*-api' },
    },
    {
      name: 'backend-no-pg-outside-db',
      severity: 'error',
      comment: 'Only backend/src/db/** may import pg (mirrors the eslint ban).',
      from: { path: 'src/(routes|mcp)' },
      to: { path: '^pg$' },
    },
    {
      name: 'agents-no-backend',
      severity: 'error',
      comment: 'agents/ is the pure domain core; backend adapts it, never the reverse.',
      from: { path: 'src' },
      to: { path: 'backend/src' },
    },
    {
      name: 'db-no-upward-imports',
      severity: 'error',
      comment: 'The db layer never imports routes, mcp, or temporal.',
      from: { path: 'src/db' },
      to: { path: 'src/(routes|mcp|temporal)' },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', 'var/', 'dist', 'test-results', 'coverage'] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.d.ts'] },
  },
}
