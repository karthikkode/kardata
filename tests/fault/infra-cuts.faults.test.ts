// F6-F8 infrastructure-cut drills (pg + Temporal via Toxiproxy). One file
// so proxy ports stay sequential: vitest may run files in parallel, and the
// toxiproxy listen ports are fixed. Drills skip without
// KARDATA_TEMPORAL_TEST, TEST_DATABASE_URL, or TOXIPROXY_URL.
import { randomUUID } from 'node:crypto'
import { get } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@temporalio/activity'
import { Client as WorkflowClient } from '@temporalio/client'
import { msToTs } from '@temporalio/common'
import type { NativeConnection, Worker } from '@temporalio/worker'
import {
  emptyUsage,
  type ProviderAdapter,
  type StreamEvent,
  type ToolDefinition,
  type TurnRunnerMcpClient,
} from '@kardata/agents'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEventActivity, executeKarbotTurn } from '../../backend/src/temporal/activities/turn.js'
import { createRoundRecorder } from '../../backend/src/temporal/activities/turn-rounds.js'
import type { KarbotTurnDeps, KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { SESSION_PREFIX } from '../../backend/src/temporal/runs-types.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
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
  TOXI_TEMPORAL_PORT,
  TOXIPROXY_URL,
  upstreamOf,
} from './toxiproxy.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const RUN_WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'run.ts')

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

describe.skipIf(!ENABLED || !TEST_DATABASE_URL || !TOXIPROXY_URL)('infrastructure cuts F6-F8 [F:http.streamThread] [F:db.outbox.publishOutboxFrame] [F:db.outbox.readOutboxBacklog] [F:db.outbox.latestOutboxSeq] [F:db.outbox.subscribeOutbox] [F:http.sendMessage] [F:http.getRun] [F:backend.workflow.run.sessionRun] [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.appendEventActivity]', () => {
  let databaseUrl = ''
  let upstream = { host: '', port: 0 }

  beforeAll(async () => {
    databaseUrl = await ensureTestDb('kardata_test_fault_infra')
    upstream = upstreamOf(databaseUrl, 5432)
    await deleteProxy('fault-pg-f6')
    await deleteProxy('fault-pg-f7')
    await deleteProxy('fault-temporal-f8')
  }, 120_000)

  afterAll(async () => {
    await deleteProxy('fault-pg-f6').catch(() => undefined)
    await deleteProxy('fault-pg-f7').catch(() => undefined)
    await deleteProxy('fault-temporal-f8').catch(() => undefined)
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
        // The live reader, destroyed in the finally: app.close() waits on
        // open hijacked sockets, so any throw with a socket open hangs the
        // close into a 120 s timeout instead of failing fast.
        let current: ReturnType<typeof track> | undefined
        try {
          const reader = readSse(address.port, sessionId, 0, (frame) => received.push(frame))
          current = track(reader)
          const started = Date.now()
          // Six, not five: the seed's session creation projects its own
          // birth state frame ahead of the five published ones.
          while (received.length < 6 && Date.now() - started < 15_000) await sleep(100)
          expect(received.length).toBe(6)
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
          for (let index = 0; index < 3; index += 1) {
            await publishOutboxFrame(serverPool, sessionId, 'state', { text: `TEST post-heal ${index}` })
          }
          let reconnects = 0
          const endBy = Date.now() + 20_000
          while (received.length < 9 && Date.now() < endBy) {
            if (current!.eof.value) {
              current!.reader.destroy()
              const lastSeq = received.length > 0 ? received[received.length - 1]!.seq : 0
              current = track(readSse(address.port, sessionId, lastSeq, (frame) => received.push(frame)))
              reconnects += 1
            }
            await sleep(100)
          }
          current!.reader.destroy()
          expect(received.length).toBe(9)
          const seqs = received.map((frame) => frame.seq)
          for (let index = 1; index < seqs.length; index += 1) expect(seqs[index]).toBe(seqs[index - 1]! + 1)
          expect(await latestOutboxSeq(direct, sessionId)).toBe(seqs[seqs.length - 1])
          console.log(`[fault F6] cutMs=${healedAt - cutAt} frames=9 contiguous reconnects=${reconnects}`)
        } finally {
          current?.reader.destroy()
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

  it('F8: 30 s Temporal cut 503s starts, running work resumes after', async () => {
    const savedTemporal = process.env['TEMPORAL_ADDRESS']
    const savedProvider = process.env['KARDATA_PROVIDER']
    const savedDb = process.env['DATABASE_URL']
    const savedNamespace = process.env['TEMPORAL_NAMESPACE']
    const separator = ADDRESS.lastIndexOf(':')
    const upstreamHost = ADDRESS.slice(0, separator)
    const upstreamPort = Number(ADDRESS.slice(separator + 1))
    await createProxy('fault-temporal-f8', TOXI_TEMPORAL_PORT, upstreamHost, upstreamPort)
    process.env['TEMPORAL_ADDRESS'] = `127.0.0.1:${TOXI_TEMPORAL_PORT}`
    process.env['DATABASE_URL'] = databaseUrl
    process.env['KARDATA_PROVIDER'] = 'fake'
    // The HTTP send path hardcodes the turn-lane queue, so the drill
    // worker must poll that name: isolate with a throwaway namespace
    // (registered while the proxy is up) instead of a unique queue.
    const namespace = `kardata-test-fault-f8-${Date.now()}-${randomUUID().slice(0, 8)}`
    const registrar = await connectClient()
    try {
      await registrar.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86_400_000) })
    } finally {
      await registrar.close()
    }
    process.env['TEMPORAL_NAMESPACE'] = namespace
    const pool = new Pool({ connectionString: databaseUrl })
    let connection: NativeConnection | undefined
    let worker: Worker | undefined
    let run: Promise<void> | undefined
    const mcp: TurnRunnerMcpClient = {
      async listTools(): Promise<ToolDefinition[]> { return [] },
      async callTool(name: string): Promise<{ content: string; isError?: boolean }> { return { content: `TEST unexpected tool ${name}`, isError: true } },
    }
    const deps: KarbotTurnDeps = {
      loadSessionModel: async () => undefined,
      loadHistory: async () => [],
      resolveTurnAdapter: (): ProviderAdapter => ({
        providerName: 'TEST-cut',
        chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }),
        chatStream: async function* (): AsyncIterable<StreamEvent> {
          await sleep(35_000)
          yield { kind: 'text_delta', text: 'TEST cut survivor' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        },
      }),
      mcp,
      publishDelta: async () => {},
      publishReasoning: async () => {},
      publishTool: async () => {},
      log: () => {},
    }
    try {
      const sessionId = await seedSession(pool)
      connection = await connectWorker()
      const client = new WorkflowClient({ connection: await connectClient(), namespace })
      worker = await createLaneWorker({
        lane: 'turn',
        connection,
        namespace: temporalNamespace(),
        workflowsPath: RUN_WORKFLOWS_PATH,
        taskQueue: 'kardata-turn-v1',
        activities: {
          appendEventActivity,
          karbotTurnActivity: async (input: KarbotTurnInput) => {
            const context = Context.current()
            let settled = false
            const beating = (async () => {
              while (!settled) {
                try { context.heartbeat({ at: Date.now() }) } catch { break }
                await sleep(5000)
              }
            })()
            try {
              const recorder = createRoundRecorder(pool, `session:${input.sessionId}`, () => undefined)
              return await executeKarbotTurn(input, {
                ...deps,
                attempt: context.info.attempt,
                recordRound: (fields) => recorder.recordRound(fields),
                recordToolCall: (fields) => recorder.recordToolCall(fields),
              })
            } finally {
              settled = true
              await beating
            }
          },
        },
      })
      run = worker.run()
      run.catch(() => undefined)
      // The prod-named queue poll stays inside the drill namespace: a
      // default-namespace worker here would steal owner turns.
      expect(temporalNamespace()).toBe(namespace)
      expect((worker.options as { namespace?: string }).namespace).toBe(namespace)
      const app: FastifyInstance = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
      try {
        const first = await app.inject({ method: 'POST', url: '/v1/commands/send', payload: { threadKey: sessionId, text: 'F8 hello' } })
        expect(first.statusCode).toBe(202)
        const startBy = Date.now() + 60_000
        for (;;) {
          await projectNewEvents(pool)
          const { rows } = await pool.query<{ count: string }>(
            'SELECT COUNT(*) AS count FROM execution_rounds WHERE thread_key = $1 AND attempt = 1',
            [sessionId],
          )
          if (Number(rows[0]?.count ?? 0) > 0) break
          if (Date.now() > startBy) throw new Error('TEST F8: round 1 never started')
          await sleep(500)
        }
        const cutAt = Date.now()
        await setProxyEnabled('fault-temporal-f8', false)
        const down = Date.now()
        const cut = await app.inject({ method: 'POST', url: '/v1/commands/send', payload: { threadKey: sessionId, text: 'F8 during' } })
        const downMs = Date.now() - down
        expect(cut.statusCode).toBe(503)
        expect((cut.json() as { error: { code: string } }).error.code).toBe('temporal_unavailable')
        expect(downMs).toBeLessThan(10_000)
        await sleep(Math.max(0, 30_000 - (Date.now() - cutAt)))
        await setProxyEnabled('fault-temporal-f8', true)
        const healedAt = Date.now()
        const endBy = Date.now() + 150_000
        for (;;) {
          await projectNewEvents(pool)
          const thread = await getThread(pool, sessionId)
          const texts = (thread?.messages ?? [])
            .filter((message) => message.kind === 'text')
            .map((message) => (message.payload as Record<string, unknown>)['text'] as string)
          if (texts.includes('TEST cut survivor')) break
          if (Date.now() > endBy) throw new Error('TEST F8: turn never resumed')
          await sleep(1000)
        }
        const recoveredAt = Date.now()
        const after = await app.inject({ method: 'GET', url: `/v1/runs/${SESSION_PREFIX}${sessionId}` })
        expect(after.statusCode).toBe(200)
        const handle = client.workflow.getHandle(`${SESSION_PREFIX}${sessionId}`)
        await handle.signal('runCancel')
        expect(await handle.result()).toBe('cancelled')
        console.log(`[fault F8] downMs=${downMs} cutMs=${healedAt - cutAt} recoveryMs=${recoveredAt - healedAt}`)
      } finally {
        await app.close()
      }
    } finally {
      if (savedTemporal === undefined) delete process.env['TEMPORAL_ADDRESS']
      else process.env['TEMPORAL_ADDRESS'] = savedTemporal
      if (savedProvider === undefined) delete process.env['KARDATA_PROVIDER']
      else process.env['KARDATA_PROVIDER'] = savedProvider
      if (savedDb === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = savedDb
      if (savedNamespace === undefined) delete process.env['TEMPORAL_NAMESPACE']
      else process.env['TEMPORAL_NAMESPACE'] = savedNamespace
      await worker?.shutdown()
      await run?.catch(() => undefined)
      await connection?.close()
      await pool.end()
      await deleteProxy('fault-temporal-f8')
    }
  }, 300_000)
})
