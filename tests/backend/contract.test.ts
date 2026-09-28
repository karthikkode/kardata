import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkParity, EXPECTED_TYPES, loadSpec, PARITY } from '../../backend/src/contract.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function exportedTypes(relativePath: string): string[] {
  const text = readFileSync(join(REPO, relativePath), 'utf8')
  const names: string[] = []
  for (const match of text.matchAll(/^export (?:type|interface) (\w+)/gm)) names.push(match[1])
  return names
}

describe('API contract (B0.2)', () => {
  it('ships a versioned v1 spec with the planned operations', () => {
    const spec = loadSpec() as { openapi: string; info: { version: string }; paths: Record<string, unknown> }
    expect(spec.openapi).toMatch(/^3\.1\./)
    expect(spec.info.version).toMatch(/^1\./)
    for (const path of [
      '/v1/sessions',
      '/v1/sessions/{sessionId}',
      '/v1/sessions/{sessionId}/threads',
      '/v1/threads/{threadKey}',
      '/v1/threads/{threadKey}/messages',
      '/v1/threads/{threadKey}/events',
      '/v1/runs',
      '/v1/runs/{runId}',
      '/v1/commands/send',
      '/v1/commands/steer',
      '/v1/commands/pause',
      '/v1/commands/resume',
      '/v1/commands/cancel',
      '/v1/commands/approve',
      '/v1/debug/runs/{runId}',
      '/v1/skills',
      '/v1/sectors/{sectorId}/start',
      '/v1/sectors/{sectorId}/documents',
    ]) {
      expect(path in spec.paths, path).toBe(true)
    }
  })

  it('every operation names an id and every mutation takes an idempotency key', () => {
    const spec = loadSpec() as {
      paths: Record<string, Record<string, { operationId?: string; parameters?: Array<{ name?: string; $ref?: string }> }>>
    }
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation.operationId, `${method} ${path}`).toBeTruthy()
        if (method === 'post') {
          const names = (operation.parameters ?? []).map((param) => param.name ?? param.$ref?.split('/').pop())
          expect(names, `${method} ${path} idempotency`).toContain('IdempotencyKey')
        }
      }
    }
  })

  it('object schemas are strict: every object names its required fields', () => {
    const spec = loadSpec() as {
      components: { schemas: Record<string, { type?: string; required?: string[]; properties?: object }> }
    }
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      if (schema.type === 'object' && schema.properties) {
        expect(schema.required, `schema ${name}`).toBeTruthy()
      }
    }
  })

  it('parity table covers every live UI wire shape', () => {
    const covered = new Set(PARITY.map((entry) => `${entry.sourceFile}::${entry.mockType}`))
    for (const expected of EXPECTED_TYPES) {
      expect(covered.has(`${expected.sourceFile}::${expected.mockType}`), `${expected.mockType}`).toBe(true)
    }
    // No silent additions: every exported UI type in ChatPanel is expected.
    const actual = new Set<string>()
    for (const name of exportedTypes('frontend/src/components/ChatPanel.tsx')) {
      actual.add(`frontend/src/components/ChatPanel.tsx::${name}`)
    }
    for (const expected of EXPECTED_TYPES.filter((entry) => entry.sourceFile === 'frontend/src/components/ChatPanel.tsx')) {
      actual.delete(`${expected.sourceFile}::${expected.mockType}`)
    }
    expect([...actual]).toEqual([])
  })

  it('every counterpart pointer exists and every deferral names an owner', () => {
    expect(checkParity(loadSpec())).toEqual([])
  })
})
