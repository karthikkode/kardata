#!/usr/bin/env node
// Lean feature registry sync (Phase 1). Enumerates product surfaces and
// merges them into tests/registry/features.yaml: new surfaces append with
// tiers:[todo], removed ones print, hand-edited fields are never touched.
// Usage: npm run registry:sync
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_PATH = join(ROOT, 'tests', 'registry', 'features.yaml')

const sanitize = (name) => name.replace(/[^A-Za-z0-9_.]/g, '_')
const baseOf = (path) => path.split('/').pop().replace(/\.[^.]+$/, '')

/** Value export names of one TS file (functions, classes, consts, enums,
 *  namespaces, re-exports, default). Types and interfaces are skipped. */
export function valueExports(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const out = []
  for (const node of source.statements) {
    if (ts.isExportAssignment(node)) {
      out.push('default')
      continue
    }
    if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const entry of clause.elements) out.push(entry.name.text)
      } else {
        out.push('*')
      }
      continue
    }
    if (!ts.canHaveModifiers(node) || !ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      out.push('default')
      continue
    }
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
      if (node.name) out.push(node.name.text)
      continue
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) continue
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.push(decl.name.text)
      }
    }
  }
  return [...new Set(out)].sort()
}

function tsFiles(dir, root) {
  let out = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) out = out.concat(tsFiles(`${dir}/${entry.name}`, root))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(`${dir}/${entry.name}`)
  }
  return out.sort()
}

function exportsOfDir(dir, idPrefix, layer, root) {
  const surfaces = []
  for (const file of tsFiles(dir, root)) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const name of valueExports(text, file)) {
      surfaces.push({ id: sanitize(`${idPrefix}.${baseOf(file)}.${name}`), layer, surface: file })
    }
  }
  return surfaces
}

function openApiSurfaces(root) {
  const doc = parseYaml(readFileSync(join(root, 'backend', 'openapi', 'v1.yaml'), 'utf8'))
  const surfaces = []
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (op && typeof op === 'object' && op.operationId) {
        surfaces.push({ id: sanitize(`http.${op.operationId}`), layer: 'backend', surface: `backend/openapi/v1.yaml (${method.toUpperCase()} ${path})` })
      }
    }
  }
  return surfaces
}

function mcpToolSurfaces(root) {
  const text = readFileSync(join(root, 'backend', 'src', 'mcp', 'tools.ts'), 'utf8')
  const start = text.indexOf('export const TOOL_LAYER')
  const block = text.slice(start, text.indexOf('\n}', start))
  const surfaces = []
  for (const match of block.matchAll(/^  '([^']+)':/gm)) {
    surfaces.push({ id: sanitize(`mcp.${match[1]}`), layer: 'mcp', surface: 'backend/src/mcp/tools.ts' })
  }
  return surfaces
}

function frontendSurfaces(root) {
  const surfaces = []
  for (const file of tsFiles('frontend/src/components', root)) {
    const dotted = relative('frontend', file).replace(/\.[^.]+$/, '').split('/').join('.')
    surfaces.push({ id: sanitize(`frontend.${dotted}`), layer: 'frontend', surface: file })
  }
  for (const file of tsFiles('frontend/src/data', root).filter((f) => /\/use[^/]*\.ts$/.test(f))) {
    surfaces.push({ id: sanitize(`frontend.hook.${baseOf(file)}`), layer: 'frontend', surface: file })
  }
  return surfaces
}

/** Every enumerated surface, sorted by id. Pure except for file reads. */
export function enumerateSurfaces(repoRoot = ROOT) {
  const surfaces = [
    ...openApiSurfaces(repoRoot),
    ...mcpToolSurfaces(repoRoot),
    ...exportsOfDir('backend/src/temporal/workflows', 'backend.workflow', 'backend', repoRoot),
    ...exportsOfDir('backend/src/temporal/activities', 'backend.activity', 'backend', repoRoot),
    ...exportsOfDir('backend/src/db', 'db', 'db', repoRoot),
    ...exportsOfDir('agents/src', 'agents', 'agents', repoRoot),
    ...frontendSurfaces(repoRoot),
  ]
  return surfaces.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function loadRegistry(repoRoot = ROOT) {
  try {
    const parsed = parseYaml(readFileSync(join(repoRoot, 'tests', 'registry', 'features.yaml'), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/** Merge enumerated surfaces onto stored entries. Old entries keep their
 *  hand-edited fields untouched; new ids append as todo; stored ids that
 *  vanished stay (reported as removed, never deleted). */
export function mergeRegistry(oldEntries, surfaces) {
  const old = new Map(oldEntries.map((entry) => [entry.id, entry]))
  const seen = new Set(surfaces.map((surface) => surface.id))
  const entries = [...oldEntries]
  const added = []
  for (const surface of surfaces) {
    if (!old.has(surface.id)) {
      entries.push({ id: surface.id, layer: surface.layer, surface: surface.surface, tiers: ['todo'], states: [] })
      added.push(surface.id)
    }
  }
  const removed = [...old.keys()].filter((id) => !seen.has(id))
  return { entries, added, removed }
}

const TAG_PATTERN = /\[F:([A-Za-z0-9_.-]+)\]/g

/** Tier heuristic by test path (Phase 7 hardens exactness). */
export function tierOfFile(relPath) {
  if (relPath.startsWith('tests/stress/')) return ['stress']
  if (relPath.startsWith('tests/fault/')) return ['fault']
  if (relPath.startsWith('tests/backend/live/') || relPath.endsWith('.live.spec.ts')) return ['live']
  if (relPath.startsWith('tests/frontend-e2e/')) return ['e2e']
  if (/^tests\/backend\/(workflows|temporal)[./]/.test(relPath) || /^tests\/backend\/(workflows|temporal)\..*\.test\.ts$/.test(relPath)) return ['unit', 'db', 'temporal']
  if (relPath.startsWith('tests/backend/')) return ['unit', 'db']
  if (relPath.startsWith('agents/src/')) return ['unit']
  if (relPath.startsWith('tests/frontend/')) return ['unit']
  return ['unit']
}

export function scanTags(repoRoot = ROOT) {
  const roots = ['tests/backend', 'tests/frontend', 'tests/frontend-e2e', 'agents/src']
  const tags = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        walk(rel)
      } else if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const text = readFileSync(join(repoRoot, rel), 'utf8')
        for (const match of text.matchAll(TAG_PATTERN)) {
          tags.push({ id: match[1], file: rel, tiers: tierOfFile(rel) })
        }
      }
    }
  }
  for (const root of roots) {
    try {
      walk(root)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return tags
}

export function checkRegistry(entries, surfaces, tags, { enforce = false } = {}) {
  const known = new Set(entries.map((entry) => entry.id))
  const missing = surfaces.map((surface) => surface.id).filter((id) => !known.has(id))
  const unknown = tags.filter((tag) => !known.has(tag.id)).map((tag) => ({ id: tag.id, file: tag.file }))
  if (!enforce) return { missing, unknown, todo: [], gaps: [] }
  const covered = new Map()
  for (const tag of tags) {
    if (!covered.has(tag.id)) covered.set(tag.id, new Set())
    for (const tier of tag.tiers) covered.get(tag.id).add(tier)
  }
  const todo = []
  const gaps = []
  for (const entry of entries) {
    if (entry.tiers.includes('todo')) todo.push(entry.id)
    if (entry.tiers.includes('none')) {
      if (!entry.why) gaps.push({ id: entry.id, tier: 'none-needs-why' })
      continue
    }
    for (const tier of entry.tiers) {
      if (!covered.get(entry.id)?.has(tier)) gaps.push({ id: entry.id, tier })
    }
  }
  return { missing, unknown, todo, gaps }
}

function main() {
  const surfaces = enumerateSurfaces()
  const old = loadRegistry()
  const { entries, added, removed } = mergeRegistry(old, surfaces)
  const header = '# Lean feature registry (Phase 1). Generated by npm run registry:sync:\n# new surfaces append as tiers:[todo]; hand-edited tiers/why/states are kept;\n# removed ids are reported, never deleted. No hashes, no statuses.\n'
  writeFileSync(REGISTRY_PATH, header + stringifyYaml(entries))
  const perLayer = {}
  for (const entry of entries) perLayer[entry.layer] = (perLayer[entry.layer] ?? 0) + 1
  console.log(`registry: ${entries.length} entries (${Object.entries(perLayer).map(([layer, count]) => `${layer} ${count}`).join(', ')})`)
  console.log(`registry: +${added.length} new, -${removed.length} removed${removed.length > 0 ? `: ${removed.join(', ')}` : ''}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
