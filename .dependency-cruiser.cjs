// dependency-cruiser rules (Phase 1: warn = report mode; Phase 2 flips to
// error). Run per workspace with its tsconfig (see quality:deps).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Module cycles hide layering violations.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'frontend-no-direct-api',
      severity: 'warn',
      comment: 'Components reach data only through data/use*.ts hooks.',
      from: { path: 'frontend/src/components' },
      to: { path: 'frontend/src/data/[^/]*-api|frontend/src/data/api/' },
    },
    {
      name: 'backend-no-pg-outside-db',
      severity: 'warn',
      comment: 'Only backend/src/db/** may import pg (mirrors the eslint ban).',
      from: { path: 'backend/src/(routes|mcp)' },
      to: { path: '^pg$' },
    },
    {
      name: 'agents-no-backend',
      severity: 'warn',
      comment: 'agents/ is the pure domain core; backend adapts it, never the reverse.',
      from: { path: 'agents/src' },
      to: { path: 'backend/src' },
    },
    {
      name: 'db-no-upward-imports',
      severity: 'warn',
      comment: 'The db layer never imports routes, mcp, or temporal.',
      from: { path: 'backend/src/db' },
      to: { path: 'backend/src/(routes|mcp|temporal)' },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', 'var/', 'dist', 'test-results', 'coverage'] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.d.ts'] },
  },
}
