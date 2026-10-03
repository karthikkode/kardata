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
  const namesOf = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((entry) => ts.isBindingElement(entry) ? namesOf(entry.name) : [])
  return source.statements.flatMap((node) => {
    if (ts.isExportAssignment(node)) return [node.isExportEquals ? 'export=' : 'default']
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) return node.exportClause.elements.map((entry) => entry.name.text)
      if (node.exportClause && ts.isNamespaceExport(node.exportClause)) return [node.exportClause.name.text]
      return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? [`*:${node.moduleSpecifier.text}`] : []
    }
    if (!ts.canHaveModifiers(node) || !ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return []
    if (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return ['default']
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return node.name ? [node.name.text] : []
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) return [node.name.text]
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap((declaration) => namesOf(declaration.name))
    return []
  }).filter((name, index, names) => names.indexOf(name) === index).sort()
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
  it('enumerates type, interface, re-export, namespace and anonymous default surfaces', () => {
    expect(exportsOf('example.ts', `
      export interface Context { version: number }
      export type Decision = string;
      export { local as publicAlias } from './local';
      export * from './tools';
      export * as namespace from './types';
      export default function() {}
      export const { first, nested: { second } } = value;
    `)).toEqual(['*:./tools', 'Context', 'Decision', 'default', 'first', 'namespace', 'publicAlias', 'second'].sort())
  })
  it('records every maintained file exactly once, including migrations, configs and tests', () => {
    expect(catalogue.version).toBe(1)
    expect(catalogue.files.map((file) => file.path)).toEqual(maintainedFiles())
    expect(new Set(catalogue.files.map((file) => file.path)).size).toBe(catalogue.files.length)
  })
  it('records current public function/class/schema names rather than implying test coverage', () => {
    for (const file of catalogue.files) {
      // Evidence binaries need no content check: only maintained sources
      // are parsed and only reviewed files are re-hashed, so runtime stays
      // flat as evidence grows.
      const parseable = /\.[cm]?[jt]sx?$/.test(file.path) || file.review === 'reviewed'
      const text = parseable ? readFileSync(join(root, file.path), 'utf8') : ''
      expect(file.exports, file.path).toEqual(exportsOf(file.path, text))
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
