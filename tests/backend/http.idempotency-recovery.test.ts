import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { createSession, listSessions, type TransactableDb } from '../../backend/src/db/index.js'
import { route, withIdempotency } from '../../backend/src/routes/http.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('mutation completion-record failure safety [F:db.index.createSession] [F:db.index.listSessions] [F:db.sessions.createSession] [F:db.sessions.listSessions] [F:db.errors.WorkspaceError] [F:db.sessions.SessionModelSelection] [F:db.index.Db] [F:db.index.SessionModelSelection] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.errors.Id] [F:db.errors.checked] [F:db.file_jobs.visible]', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_http_recovery') }) })
  afterAll(async () => { await pool?.end() })
  it.each(['completion', 'handler'] as const)('does not repeat a committed mutation after %s failure', async (failurePoint) => {
    let failCompletion = failurePoint === 'completion', calls = 0
    const db: TransactableDb = { connect: pool.connect.bind(pool), query: async <T>(sql: string, params?: unknown[]) => {
      if (failCompletion && sql.includes("SET state = 'completed'")) { failCompletion = false; throw new Error('TEST completion store unavailable') }
      const result = await pool.query(sql, params)
      return { rows: result.rows as T[], rowCount: result.rowCount }
    } }
    const app = buildApp({ pool: db })
    route(app, 'post', '/TEST/mutation', async (request, reply) => withIdempotency(request, reply, db, 'TEST caller', async () => {
      calls += 1
      const session = await createSession(db, `TEST committed ${failurePoint}`)
      if (failurePoint === 'handler') throw new Error('TEST handler failed after commit')
      return { status: 201, body: session }
    }))
    try {
      const before = await listSessions(pool)
      const headers = { 'idempotency-key': `TEST uncertain ${failurePoint}` }
      expect((await app.inject({ method: 'POST', url: '/TEST/mutation', headers, payload: {} })).statusCode).toBe(500)
      expect((await app.inject({ method: 'POST', url: '/TEST/mutation', headers, payload: {} })).statusCode).toBe(409)
      expect(calls).toBe(1)
      expect(await listSessions(pool)).toHaveLength(before.length + 1)
    } finally { await app.close() }
  })
})
