// F6-F7 infrastructure-cut drills (pg via Toxiproxy; F8 extends this
// file). One file so proxy ports stay sequential: vitest may run files in
// parallel, and the toxiproxy listen ports are fixed. Drills skip without
// KARDATA_TEMPORAL_TEST, TEST_DATABASE_URL, or TOXIPROXY_URL.
import { randomUUID } from 'node:crypto'
import { get } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import {
  appendEvent as appendDbEvent,
  createSector,
  getThread,
  latestOutboxSeq,
  publishOutboxFrame,
  readOutboxBacklog,
} from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'
import {
  addToxic,
  createProxy,
  deleteProxy,
  proxiedPostgresUrl,
  removeToxic,
  setProxyEnabled,
  sleep,
  TOXI_PG_PORT,
  TOXIPROXY_URL,
  upstreamOf,
} from './toxiproxy.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'

interface SseFrame {
  seq: number
}

interface SseReader {
  frames: SseFrame[]
  closed: Promise<void>
  destroy(): void
}

// Minimal SSE reader: data frames only, comment pings ignored. Resolves
// closed on socket EOF (the server closes mid-stream failures by design;
// the client resumes from its last good seq).
function readSse(port: number, threadKey: string, lastSeq: number, onFrame: (frame: SseFrame) => void): SseReader {
  const frames: SseFrame[] = []
  let buffer = ''
  let closedResolve = (): void => undefined
  const closed = new Promise<void>((resolve) => { closedResolve = resolve })
  const request = get({ host: '127.0.0.1', port, path: `/v1/threads/${encodeURIComponent(threadKey)}/events?lastSeq=${lastSeq}` }, (response) => {
    response.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const frame = JSON.parse(line.slice('data: '.length)) as SseFrame
          frames.push(frame)
          onFrame(frame)
        }
      }
    })
    response.on('close', () => closedResolve())
    response.on('end', () => closedResolve())
  })
  request.on('error', () => closedResolve())
  return { frames, closed, destroy: () => request.destroy() }
}

describe.skipIf(!ENABLED || !TEST_DATABASE_URL || !TOXIPROXY_URL)('infrastructure cuts F6-F7', () => {
  let databaseUrl = ''
  let upstream = { host: '', port: 0 }

  beforeAll(async () => {
    databaseUrl = await ensureTestDb('kardata_test_fault_infra')
    upstream = upstreamOf(databaseUrl, 5432)
    await deleteProxy('fault-pg-f6')
    await deleteProxy('fault-pg-f7')
  }, 120_000)

  afterAll(async () => {
    await deleteProxy('fault-pg-f6').catch(() => undefined)
    await deleteProxy('fault-pg-f7').catch(() => undefined)
  })

  async function seedSession(pool: Pool): Promise<string> {
    const sessionId = `TEST-infra-${randomUUID()}`
    const sectorId = `sector-${randomUUID()}`
    await createSector(pool, { name: `TEST infra ${sectorId}`, sectorId, idempotencyKey: `fault-infra-sector:${sectorId}` })
    await appendDbEvent(pool, {
      idempotencyKey: `fault-infra-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST infra ${sessionId}`, sectorId, tenantId: 'TEST infra cuts', projectId: null },
    })
    await projectNewEvents(pool)
    return sessionId
  }

  function track(reader: SseReader): { reader: SseReader; eof: { value: boolean } } {
    const eof = { value: false }
    void reader.closed.then(() => { eof.value = true })
    return { reader, eof }
  }

  it('F6: 10 s Postgres cut closes SSE, then replay plus live tail lose nothing', async () => {
    const direct = new Pool({ connectionString: databaseUrl })
    try {
      await createProxy('fault-pg-f6', TOXI_PG_PORT, upstream.host, upstream.port)
      const proxiedUrl = proxiedPostgresUrl(databaseUrl, TOXI_PG_PORT)
      const serverPool = new Pool({ connectionString: proxiedUrl })
      try {
        const sessionId = await seedSession(direct)
        for (let index = 0; index < 5; index += 1) {
          await publishOutboxFrame(direct, sessionId, 'state', { text: `TEST pre-cut ${index}` })
        }
        const thread = await getThread(direct, sessionId)
        expect(thread).toBeDefined()
        const app: FastifyInstance = buildApp({ pool: serverPool })
        await app.listen({ port: 0, host: '127.0.0.1' })
        const address = app.server.address()
        if (!address || typeof address === 'string') throw new Error('TEST F6: no listen address')
        const received: SseFrame[] = []
        try {
          const reader = readSse(address.port, sessionId, 0, (frame) => received.push(frame))
          const started = Date.now()
          while (received.length < 5 && Date.now() - started < 15_000) await sleep(100)
          expect(received.length).toBe(5)
          const cutAt = Date.now()
          await setProxyEnabled('fault-pg-f6', false)
          // Writers fail fast through the cut instead of hanging.
          const writeStarted = Date.now()
          await expect(publishOutboxFrame(serverPool, sessionId, 'state', { text: 'TEST cut write' })).rejects.toThrow()
          expect(Date.now() - writeStarted).toBeLessThan(5_000)
          const sseStarted = Date.now()
          const cutSse = await app.inject({ method: 'GET', url: `/v1/threads/${sessionId}/events?lastSeq=0` })
          expect(Date.now() - sseStarted).toBeLessThan(5_000)
          expect(cutSse.statusCode).toBe(500)
          await sleep(Math.max(0, 10_000 - (Date.now() - cutAt)))
          await setProxyEnabled('fault-pg-f6', true)
          const healedAt = Date.now()
          // The pre-cut socket may have died (server closes on LISTEN
          // failure) or stalled half-open; either way the client ends with
          // every frame, reconnecting whenever the socket is gone — even on
          // a late post-heal RST.
          let current = track(reader)
          for (let index = 0; index < 3; index += 1) {
            await publishOutboxFrame(serverPool, sessionId, 'state', { text: `TEST post-heal ${index}` })
          }
          let reconnects = 0
          const endBy = Date.now() + 20_000
          while (received.length < 8 && Date.now() < endBy) {
            if (current.eof.value) {
              current.reader.destroy()
              const lastSeq = received.length > 0 ? received[received.length - 1]!.seq : 0
              current = track(readSse(address.port, sessionId, lastSeq, (frame) => received.push(frame)))
              reconnects += 1
            }
            await sleep(100)
          }
          current.reader.destroy()
          expect(received.length).toBe(8)
          const seqs = received.map((frame) => frame.seq)
          for (let index = 1; index < seqs.length; index += 1) expect(seqs[index]).toBe(seqs[index - 1]! + 1)
          expect(await latestOutboxSeq(direct, sessionId)).toBe(seqs[seqs.length - 1])
          console.log(`[fault F6] cutMs=${healedAt - cutAt} frames=8 contiguous reconnects=${reconnects}`)
        } finally {
          await app.close()
        }
      } finally {
        await serverPool.end()
        await deleteProxy('fault-pg-f6')
      }
    } finally {
      await direct.end()
    }
  }, 120_000)

  it('F7: +2 s Postgres latency drains 20 writers, timeouts fail fast, pool recovers', async () => {
    const direct = new Pool({ connectionString: databaseUrl })
    try {
      await createProxy('fault-pg-f7', TOXI_PG_PORT, upstream.host, upstream.port)
      const proxiedUrl = proxiedPostgresUrl(databaseUrl, TOXI_PG_PORT)
      const pool = new Pool({ connectionString: proxiedUrl })
      try {
        const sessionId = await seedSession(pool)
        const baseline = Date.now()
        await publishOutboxFrame(pool, sessionId, 'state', { text: 'TEST baseline' })
        expect(Date.now() - baseline).toBeLessThan(2_000)
        await addToxic('fault-pg-f7', { name: 'latency', type: 'latency', attributes: { latency: 2000 } })
        try {
          const burst = Date.now()
          await Promise.all(Array.from({ length: 20 }, (_, index) =>
            publishOutboxFrame(pool, sessionId, 'state', { text: `TEST burst ${index}` }),
          ))
          expect(Date.now() - burst).toBeLessThan(30_000)
          const backlog = await readOutboxBacklog(direct, sessionId, 0)
          expect(backlog.filter((row) => (row.payload as { text?: string }).text?.startsWith('TEST burst')).length).toBe(20)
          const tight = new Pool({ connectionString: proxiedUrl, statement_timeout: 1000 })
          try {
            const timeoutStarted = Date.now()
            const failure = await publishOutboxFrame(tight, sessionId, 'state', { text: 'TEST timeout' }).then(
              () => undefined,
              (error: unknown) => error as { code?: string },
            )
            expect(Date.now() - timeoutStarted).toBeLessThan(10_000)
            expect(failure?.code).toBe('57014')
          } finally {
            await tight.end()
          }
        } finally {
          await removeToxic('fault-pg-f7', 'latency')
        }
        const healed = Date.now()
        await publishOutboxFrame(pool, sessionId, 'state', { text: 'TEST healed' })
        expect(Date.now() - healed).toBeLessThan(2_000)
        console.log('[fault F7] writers=20 timeouts=clean recovery=fast')
      } finally {
        await pool.end()
        await deleteProxy('fault-pg-f7')
      }
    } finally {
      await direct.end()
    }
  }, 120_000)
})
