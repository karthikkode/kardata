// Pilot worktrees will live under var/ (ignored runtime dir). No test
// runner, linter, or quality tool may scan it: a worktree looks like a
// second repo and would double every suite and gate. This test fails if
// any config loses its var/ exclusion.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import agentsVitest from '../../agents/vitest.config.js'
import agentsEslint from '../../agents/eslint.config.js'
import backendVitest from '../../backend/vitest.config.js'
import backendEslint from '../../backend/eslint.config.js'
import frontendVite from '../../frontend/vite.config.js'
import frontendEslint from '../../frontend/eslint.config.js'
import frontendPlaywright from '../../frontend/playwright.config.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const readRoot = (name: string): string => readFileSync(`${ROOT}/${name}`, 'utf8')

const eslintIgnoresVar = (config: unknown): boolean =>
  Array.isArray(config) &&
  config.some((entry) => Array.isArray((entry as { ignores?: unknown }).ignores) && ((entry as { ignores: string[] }).ignores.some((pattern) => pattern.includes('var/'))))

describe('var/ exclusion', () => {
  it('keeps var/ out of all three vitest configs', () => {
    for (const config of [agentsVitest, backendVitest, frontendVite]) {
      const exclude = (config as { test?: { exclude?: string[] } }).test?.exclude ?? []
      expect(exclude.some((pattern) => pattern.includes('var/'))).toBe(true)
    }
  })

  it('keeps var/ out of all eslint configs', () => {
    expect(eslintIgnoresVar(agentsEslint)).toBe(true)
    expect(eslintIgnoresVar(backendEslint)).toBe(true)
    expect(eslintIgnoresVar(frontendEslint)).toBe(true)
  })

  it('keeps Playwright scoped to tests/frontend-e2e', () => {
    const testDir = String((frontendPlaywright as { testDir?: unknown }).testDir ?? '')
    expect(testDir).toContain('tests/frontend-e2e')
    expect(testDir).not.toContain('var/')
  })

  it('keeps var/ out of knip, jscpd, and dependency-cruiser configs', () => {
    expect(readRoot('knip.json')).toContain('var/')
    expect(readRoot('.jscpd.json')).toContain('var/')
    expect(readRoot('.dependency-cruiser.cjs')).toContain('var/')
  })
})
