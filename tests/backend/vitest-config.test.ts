import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'node:path'
import config from '../../backend/vitest.config.js'

// The backend vitest root must be config-relative (absolute), not the
// cwd-relative '..': programmatic runners such as Stryker start from the
// repo root or a sandbox, where '..' resolves outside the project and
// discovers zero test files.
describe('backend vitest config root', () => {
  it('is absolute so include resolves from any cwd', () => {
    const root = (config as { root?: string }).root
    expect(root).toBeDefined()
    expect(isAbsolute(root as string)).toBe(true)
  })
})
