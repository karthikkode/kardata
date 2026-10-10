// Test-only config for the pilot UI-only ban fixtures: the base rule
// set plus the ban block re-scoped onto __ban-fixtures__/. Never
// auto-loaded (only eslint.config.js is); tests/backend/
// eslint.pilot-ban.test.ts passes it via --config (which replaces
// discovery, hence the self-sufficient base import). Reuses the ban
// block from eslint.config.js so the two cannot drift.
import base from '../../../frontend/eslint.config.js'
import pilot from './eslint.config.js'

const ban = pilot.filter((entry) => entry.rules?.['no-restricted-syntax']).at(-1)
if (!ban) throw new Error('pilot ban block missing from eslint.config.js')

export default [...base, { ...ban, files: ['__ban-fixtures__/*.ts'] }]
