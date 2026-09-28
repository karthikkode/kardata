// Structured logging (B5.1). Field presence on the per-request access
// log (method, route pattern, status, latency, trace_id, tenant), the
// traceparent join, level-by-status, and the secret-scrub re-proof: query
// strings and credential headers never reach a line. The worker-logger
// bridge and the keyed tenant join are covered alongside.
import { Writable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { createLogger, createWorkerLogger } from '../../backend/src/observability/logging.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

function capture(): { lines: string[]; stream: Writable } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) lines.push(line)
      }
      callback()
    },
  })
  return { lines, stream }
}

function logged(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

function requests(lines: string[]): Array<Record<string, unknown>> {
  return logged(lines).filter((line) => line['op'] === 'http.request')
}

describe('observability logs (B5.1)', () => {
  it('logs every request with method, route, status, latency, and trace_id', async () => {
    const { lines, stream } = capture()
    const app: FastifyInstance = buildApp({ logger: createLogger({ op: 'http' }, stream) })
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' })
      expect(response.statusCode).toBe(200)
      const entries = requests(lines)
      expect(entries).toHaveLength(1)
      const entry = entries[0] as Record<string, unknown>
      expect(entry['method']).toBe('GET')
      expect(entry['route']).toBe('/healthz')
      expect(entry['status']).toBe(200)
      expect(typeof entry['latencyMs']).toBe('number')
      expect(entry['trace_id']).toMatch(/^[0-9a-f]{32}$/)
      expect(entry['level']).toBe(30)
    } finally {
      await app.close()
    }
  })

  it('joins the traceparent header into the line and echoes it back', async () => {
    const { lines, stream } = capture()
    const app: FastifyInstance = buildApp({ logger: createLogger({ op: 'http' }, stream) })
    try {
      const traceId = '0af7651916cd43dd8448eb211c80319c'
      const response = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
      })
      expect(response.headers['traceparent']).toBe(`00-${traceId}-b7ad6b7169203331-01`)
      const entries = requests(lines)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.['trace_id']).toBe(traceId)
    } finally {
      await app.close()
    }
  })

  it('levels by status and never logs query strings or credentials', async () => {
    const { lines, stream } = capture()
    const app: FastifyInstance = buildApp({ logger: createLogger({ op: 'http' }, stream) })
    try {
      const missing = await app.inject({
        method: 'GET',
        url: '/nope?token=SECRET-QUERY-ZZZ',
        headers: { authorization: 'Bearer SECRET-HEADER-ZZZ' },
      })
      expect(missing.statusCode).toBe(404)
      const entries = requests(lines)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.['route']).toBe('/nope')
      expect(entries[0]?.['status']).toBe(404)
      expect(entries[0]?.['level']).toBe(40)
      const text = JSON.stringify(entries)
      expect(text).not.toContain('SECRET-QUERY-ZZZ')
      expect(text).not.toContain('SECRET-HEADER-ZZZ')
    } finally {
      await app.close()
    }
  })

  it('bridges worker logs to pino JSON with the scrub formatter', async () => {
    const { lines, stream } = capture()
    const workerLogger = createWorkerLogger('INFO', stream)
    workerLogger.info('signal received', { signal: 'runSend', pending: 2 })
    workerLogger.info('leak check', { apiKey: 'SECRET-KEY-ZZZ' })
    const entries = logged(lines)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ op: 'temporal', msg: 'signal received', signal: 'runSend', pending: 2 })
    // Fail-closed scrub applies to worker lines too.
    expect(JSON.stringify(entries)).not.toContain('SECRET-KEY-ZZZ')
  })

  describe.skipIf(!ENABLED)('against Postgres', () => {
    it('joins the tenant on keyed requests', async () => {
      const url = await ensureTestDb('kardata_test_logs')
      const pool = new Pool({ connectionString: url })
      const { lines, stream } = capture()
      const app: FastifyInstance = buildApp({
        pool,
        auth: true,
        logger: createLogger({ op: 'http' }, stream),
      })
      try {
        await pool.query(
          `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
           VALUES ('logs-op', $1, 'tenant-logs', NULL, 'operator')
           ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash`,
          [hashKey('key-logs-operator')],
        )
        const response = await app.inject({
          method: 'GET',
          url: '/v1/sessions',
          headers: { authorization: 'Bearer key-logs-operator' },
        })
        expect(response.statusCode).toBe(200)
        const entries = requests(lines)
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ route: '/v1/sessions', status: 200, tenant: 'tenant-logs' })
        expect(entries[0]?.['trace_id']).toMatch(/^[0-9a-f]{32}$/)
      } finally {
        await app.close()
        await pool.end()
      }
    }, 120_000)
  })
})
