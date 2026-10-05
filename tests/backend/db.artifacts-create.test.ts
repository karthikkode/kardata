// Session artifact creation (create_artifact): validate, store bytes,
// index for discovery. Hermetic: filesystem target in tmpdir, stub Db.
// Proves the summary shape, unknown-session rejection with no writes,
// and input validation.
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import { DbContractError, type TransactableDb } from '../../backend/src/db/index.js'
import { createArtifact } from '../../backend/src/db/event-artifacts.js'

function stubDb(session: boolean): TransactableDb {
  const log = new Map<string, { seq: number; idempotency_key: string; partition: string; type: string; payload: unknown; redacted: boolean; at: Date }>()
  let seq = 0
  return {
    connect: async () => ({}) as unknown as PoolClient,
    async query<TRow>(text: string, params: unknown[] = []): Promise<{ rowCount: number | null; rows: TRow[] }> {
      if (text.includes('FROM created c')) {
        return {
          rowCount: session ? 1 : 0,
          rows: (session
            ? [{ id: 's-1', title: 'Chat', sector: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }]
            : []) as unknown as TRow[],
        }
      }
      if (text.includes('INSERT INTO events')) {
        const [idempotencyKey, partition, type, payload, redacted] = params as [string, string, string, string, boolean]
        const hit = log.get(idempotencyKey)
        if (hit) return { rowCount: 0, rows: [] }
        seq += 1
        log.set(idempotencyKey, {
          seq, idempotency_key: idempotencyKey, partition, type,
          payload: JSON.parse(payload), redacted, at: new Date('2026-01-01T00:00:00.000Z'),
        })
        return { rowCount: 1, rows: [{ seq }] as unknown as TRow[] }
      }
      if (text.includes('FROM events WHERE idempotency_key')) {
        const hit = log.get(params[0] as string)
        return { rowCount: hit ? 1 : 0, rows: (hit ? [hit] : []) as unknown as TRow[] }
      }
      return { rowCount: 0, rows: [] }
    },
  }
}

const SCOPE = { tenantId: 't', projectId: null }

describe('createArtifact [F:db.index.DbContractError] [F:db.errors.DbContractError]', () => {
  it('stores, indexes, and summarizes a session file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kardata-art-create-'))
    const target = new FilesystemTarget(dir)
    const summary = await createArtifact(
      stubDb(true),
      { sessionId: 's-1', name: 'report.md', content: '# findings', kind: 'report', reason: 'report', scope: SCOPE },
      target,
    )
    expect(summary).toMatchObject({ name: 'report.md', kind: 'report', indexed: true })
    expect(summary.artifactId.length).toBeGreaterThan(0)
    expect(summary.sha256?.length).toBe(64)
    expect(readdirSync(dir, { recursive: true }).length).toBeGreaterThan(0)
  })

  it('rejects unknown sessions with no writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kardata-art-create-empty-'))
    const target = new FilesystemTarget(dir)
    await expect(
      createArtifact(stubDb(false), { sessionId: 's-nope', name: 'r.md', content: 'x', scope: SCOPE }, target),
    ).rejects.toBeInstanceOf(DbContractError)
    expect(readdirSync(dir, { recursive: true })).toEqual([])
  })

  it('validates name and content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kardata-art-create-valid-'))
    const target = new FilesystemTarget(dir)
    await expect(
      createArtifact(stubDb(true), { sessionId: 's-1', name: '', content: 'x', scope: SCOPE }, target),
    ).rejects.toBeInstanceOf(DbContractError)
    await expect(
      createArtifact(stubDb(true), { sessionId: 's-1', name: 'r.md', content: '', scope: SCOPE }, target),
    ).rejects.toBeInstanceOf(DbContractError)
  })
})
