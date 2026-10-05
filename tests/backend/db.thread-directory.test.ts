import { Pool } from 'pg'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, createSession, listThreadHeaders, type Db } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('large thread directory metadata [F:db.index.appendEvent] [F:db.index.createSession] [F:db.index.listThreadHeaders] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.threads.listThreadHeaders] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.index.SectorSweepRunner]', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_thread_directory'), max: 5 }) })
  afterAll(async () => { await pool?.end() })
  it('lists one thousand children with names and statuses without hydrating transcripts', async () => {
    const session = await createSession(pool, 'TEST directory parent')
    for (let i = 0; i < 1000; i++) await appendEvent(pool, { idempotencyKey: `directory-launch-${i}`, partition: `session:${session.id}`, type: 't.subagent.launched', payload: { sessionId: session.id, childId: `test-directory-${i}`, name: `TEST discovery agent ${i}` } })
    await projectNewEvents(pool)
    let queries = 0
    const measured: Db = { query: async <R>(text: string, params?: unknown[]) => { queries++; const result = await pool.query(text, params); return { rows: result.rows as R[], rowCount: result.rowCount } } }
    const started = performance.now()
    const rows = await listThreadHeaders(measured, session.id)
    const durationMs = performance.now() - started
    expect(rows.filter((row) => row.kind === 'subagent')).toHaveLength(1000)
    expect(rows.some((row) => row.name === 'TEST discovery agent 999')).toBe(true)
    expect(rows.every((row) => row.messages.length === 0)).toBe(true)
    expect(queries).toBe(1)
    const evidenceDir = join(import.meta.dirname, '..', '..', 'backend', 'test-results')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, 'thread-directory.report.json'), JSON.stringify({ evidence: 'thread-directory', children: 1000, queries, durationMs: Math.round(durationMs), bytes: Buffer.byteLength(JSON.stringify(rows)), recordedAt: new Date().toISOString() }, null, 2))
  }, 60000)
})
