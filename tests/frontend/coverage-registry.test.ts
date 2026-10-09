// Enforceable coverage gate: every component file under frontend/src
// maps to the scenario registry. A missing mapping fails this test; a
// "not applicable" state needs its written reason in the registry, not
// silence. Named visual subcomponents inside a mapped file ride on the
// file entry and are reviewed by hand. Structural references (test
// files, source paths, handoff IDs, primitive adoption) are validated
// below so the registry cannot drift from the tree.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..')
const SRC = join(ROOT, 'frontend', 'src', 'components')
const REGISTRY = join(import.meta.dirname, 'coverage-registry.md')

// Nonvisual by construction: pure utilities and headless runtime providers
// that render no DOM of their own. Everything else must appear in the
// registry by basename.
const NONVISUAL = new Set(['assistantAdapter', 'AssistantRuntimeAdapter', 'useChatScroll', 'useChatSync'])

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return componentFiles(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('coverage registry gate', () => {
  it('maps every component file or justifies its nonvisual classification', () => {
    const registry = readFileSync(REGISTRY, 'utf8')
    const missing = componentFiles(SRC)
      .map((file) => file.split('/').pop()!.replace(/\.tsx?$/, ''))
      .filter((name) => !NONVISUAL.has(name))
      .filter((name) => !registry.includes(name))
    expect(missing).toEqual([])
  })

  it('documents the nonvisual classification it relies on', () => {
    const registry = readFileSync(REGISTRY, 'utf8')
    for (const name of NONVISUAL) {
      expect(registry).toContain(name)
    }
  })

  it('references only test files that exist', () => {
    const registry = readFileSync(REGISTRY, 'utf8')
    const unit = new Set(
      Array.from(registry.matchAll(/(^|[\s(`'"])([\w-]+\.test\.tsx?)/g)).map((match) => match[2]),
    )
    const e2e = new Set(
      Array.from(registry.matchAll(/(^|[\s(`'"])([\w-]+\.spec)(?:\.ts)?(?=[\s`'".,;]|$)/g)).map((match) => `${match[2]}.ts`),
    )
    expect(unit.size).toBeGreaterThan(0)
    expect(e2e.size).toBeGreaterThan(0)
    for (const file of unit) {
      expect(existsSync(join(ROOT, 'tests', 'frontend', file)), file).toBe(true)
    }
    for (const file of e2e) {
      const top = existsSync(join(ROOT, 'tests', 'frontend-e2e', file))
      const v2 = existsSync(join(ROOT, 'tests', 'frontend-e2e', 'v2', file))
      expect(top || v2, file).toBe(true)
    }
  })

  it('references only source paths that exist', () => {
    const registry = readFileSync(REGISTRY, 'utf8')
    const sources = new Set(
      Array.from(registry.matchAll(/frontend\/src\/[\w/-]+\.tsx?/g)).map((match) => match[0]),
    )
    expect(sources.size).toBeGreaterThan(0)
    for (const file of sources) {
      expect(existsSync(join(ROOT, file)), file).toBe(true)
    }
  })

  it('covers every handoff area with at least one mapped entry', () => {
    const registry = readFileSync(REGISTRY, 'utf8')
    for (const prefix of ['SH', 'OV', 'RS', 'SL', 'WS', 'CH', 'KB', 'MD', 'PL', 'GC', 'LC', 'FL', 'AG', 'MO']) {
      const rows = registry.split('\n').filter((line) => new RegExp(`^\\| ${prefix}-\\d+ `).test(line))
      expect(rows.length, `${prefix} entries`).toBeGreaterThan(0)
    }
  })

  it('backs every adopted primitive with an existing adopter', () => {
    const registry = readFileSync(REGISTRY, 'utf8')
    const section = registry.slice(registry.indexOf('## Primitive adoption'))
    expect(section).toContain('No suitable surface')
    const adopted = Array.from(section.matchAll(/`frontend\/src\/[^`]+`/g)).map((match) => match[0].slice(1, -1))
    expect(adopted.length).toBeGreaterThan(0)
    for (const file of adopted) {
      expect(existsSync(join(ROOT, file)), file).toBe(true)
    }
  })
})
