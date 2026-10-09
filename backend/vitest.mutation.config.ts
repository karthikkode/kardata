import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'

// Mutation-only vitest config for stryker.backend.mutation.json.
// Scope: unit + DB + temporal tiers. Stress, fault, fleet-load and
// live suites are excluded: with coverageAnalysis "all" every mutant
// otherwise pulls the thousand-leg (~20 min), making backend mutation
// infeasible. Inherits timeouts/workers/env/setup from the base config
// so budget changes apply here automatically.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/backend/**/*.test.ts', 'tests/registry/**/*.test.ts'],
    exclude: [
      ...(base.test?.exclude ?? []),
      '**/workflows.fleet-load.test.ts',
      'tests/backend/live/**',
    ],
  },
})
