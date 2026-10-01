import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const cataloguePath = join(root, 'docs', 'deep-checks', 'catalogue.json')
interface FileReview { path: string; sha256: string; review: 'pending' | 'reviewed' | 'excluded'; reason?: string; contract?: string; tests: string[]; exports: string[] }
interface Catalogue { version: 1; files: FileReview[] }
const ownedRoots = ['agents/', 'backend/', 'frontend/', 'db/', 'deployment/', 'tests/', '.github/']

function maintainedFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter((path) => path && (ownedRoots.some((prefix) => path.startsWith(prefix)) || ['package.json', 'package-lock.json', 'AGENTS.md', 'README.md', '.gitignore'].includes(path))).sort()
}
function exportsOf(path: string, text: string): string[] {
  if (!/\.[cm]?[jt]sx?$/.test(path)) return []
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  return source.statements.flatMap((node) => {
    if (!ts.canHaveModifiers(node) || !ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return []
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return node.name ? [node.name.text] : []
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
    return []
  }).sort()
}
function scan(previous?: Catalogue): Catalogue {
  const old = new Map(previous?.files.map((file) => [file.path, file]) ?? [])
  return { version: 1, files: maintainedFiles().map((path) => {
    const bytes = readFileSync(join(root, path))
    const text = bytes.toString('utf8')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const existing = old.get(path)
    const fixture = /\/fixtures\/|^tests\/evidence\//.test(path)
    const lock = path === 'package-lock.json'
    return { path, sha256, review: existing?.sha256 === sha256 ? existing.review : fixture || lock ? 'excluded' : 'pending', ...(fixture || lock ? { reason: fixture ? 'Test evidence/data: validate provenance and consumers; not owned runtime behavior.' : 'Generated npm lock: dependency and integrity review belongs to package manifests.' } : {}), ...(existing?.contract ? { contract: existing.contract } : {}), tests: existing?.tests ?? [], exports: exportsOf(path, text) }
  }) }
}

// Explicit maintenance mode; ordinary tests never rewrite tracked evidence.
if (process.env['UPDATE_HARDENING_CATALOG'] === '1') {
  let previous: Catalogue | undefined
  try { previous = JSON.parse(readFileSync(cataloguePath, 'utf8')) as Catalogue } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  writeFileSync(cataloguePath, JSON.stringify(scan(previous), null, 2) + '\n')
}
const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8')) as Catalogue

describe('maintained functionality catalogue', () => {
  it('records every maintained file exactly once, including migrations, configs and tests', () => {
    expect(catalogue.version).toBe(1)
    expect(catalogue.files.map((file) => file.path)).toEqual(maintainedFiles())
    expect(new Set(catalogue.files.map((file) => file.path)).size).toBe(catalogue.files.length)
  })
  it('records current public function/class/schema names rather than implying test coverage', () => {
    for (const file of catalogue.files) {
      expect(file.exports, file.path).toEqual(exportsOf(file.path, readFileSync(join(root, file.path), 'utf8')))
      if (file.review === 'excluded') expect(file.reason, file.path).toBeTruthy()
      if (file.review === 'reviewed') {
        expect(file.sha256, file.path).toBe(createHash('sha256').update(readFileSync(join(root, file.path))).digest('hex'))
        expect(file.contract, file.path).toBeTruthy()
        expect(file.tests.length, file.path).toBeGreaterThan(0)
        for (const test of file.tests) expect(readFileSync(join(root, test), 'utf8').length).toBeGreaterThan(0)
      }
    }
  })
  it.skipIf(process.env['KARDATA_HARDENING_ACCEPTANCE'] !== '1')('release acceptance refuses pending file reviews', () => {
    expect(catalogue.files.filter((file) => file.review === 'pending').map((file) => file.path)).toEqual([])
  })
})
