// dependency-cruiser rules (Phase 2: error = enforced). Run per workspace
// with its tsconfig (see quality:deps), so all
// paths below are cwd-relative (Phase 1 used workspace-prefixed paths
// that never matched; P2 fixed them).
const { frontendDirectApi } = require('./quality-allowlist.json')
// Grandfathered direct data/api importers (P3): exact repo-root-relative
// allowlist paths, re-rooted to the frontend cwd and suffix-anchored.
const grandfatheredApiImporters = frontendDirectApi[0].files.map(
  (file) => `${file.replace(/^frontend\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
)
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
      comment: 'Hooks-only (restored P3): components reach data through data/use*.ts hooks. 27 grandfathered files in quality-allowlist.json (frontendDirectApi); Phase 6 converts them while building the per-endpoint failure matrix.',
      from: { path: 'src/components', pathNot: grandfatheredApiImporters },
      to: { path: 'src/data/api|src/data/[^/]*-api' },
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
