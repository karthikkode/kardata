// F11/F12/F15 database faults: projector pause, idempotent replay, and
// opposite-order transactions. No worker, no Temporal, no Toxiproxy: plain
// Postgres plus the Fastify app. Skipped explicitly without
// TEST_DATABASE_URL.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import {
  appendEvent as appendDbEvent,
  createSector,
  getThread,
  workspaceTransaction,
} from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'
import { FakeRunsGateway } from '../backend/fake-gateway.js'
import { sleep } from './toxiproxy.js'

describe.skipIf(!TEST_DATABASE_URL)('database faults F11-F12, F15', () => {
  let pool: Pool

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_fault_db')
    pool = new Pool({ connectionString: url })
  })

  afterAll(async () => {
    await pool?.end()
  })

  async function seedSession(): Promise<string> {
    const sessionId = `TEST-db-${randomUUID()}`
    const sectorId = `sector-${randomUUID()}`
    await createSector(pool, { name: `TEST db ${sectorId}`, sectorId, idempotencyKey: `fault-db-sector:${sectorId}` })
    await appendDbEvent(pool, {
      idempotencyKey: `fault-db-session:${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.session.created',
      payload: { sessionId, title: `TEST db ${sessionId}`, sectorId, tenantId: 'TEST db faults', projectId: null },
    })
    await projectNewEvents(pool)
    return sessionId
  }

  function seqsOf(messages: Array<{ seq: number }>): number[] {
    return messages.map((message) => message.seq).sort((a, b) => a - b)
  }

  it('F11: paused projector serves a consistent stale prefix, then catches up exactly once', async () => {
    const sessionId = await seedSession()
    for (let index = 0; index < 50; index += 1) {
      await appendDbEvent(pool, {
        idempotencyKey: `fault-f11:${sessionId}:${index}`,
        partition: `session:${sessionId}`,
        type: 't.message.appended',
        payload: { threadKey: sessionId, kind: 'text', message: { text: `TEST ${index}`, role: 'user' } },
      })
    }
    const stale = await getThread(pool, sessionId)
    const staleTexts = (stale?.messages ?? []).map((message) => (message.payload as Record<string, unknown>)['text'] as string)
    expect(staleTexts.some((text) => text.startsWith('TEST '))).toBe(false)
    const staleSeqs = seqsOf(stale?.messages ?? [])
    for (let index = 1; index < staleSeqs.length; index += 1) expect(staleSeqs[index]).toBe(staleSeqs[index - 1]! + 1)
    await Promise.all([projectNewEvents(pool), projectNewEvents(pool), projectNewEvents(pool)])
    const fresh = await getThread(pool, sessionId)
    const freshTexts = (fresh?.messages ?? []).map((message) => (message.payload as Record<string, unknown>)['text'] as string)
    for (let index = 0; index < 50; index += 1) {
      expect(freshTexts.filter((text) => text === `TEST ${index}`).length).toBe(1)
    }
    const freshSeqs = seqsOf(fresh?.messages ?? [])
    expect(new Set(freshSeqs).size).toBe(freshSeqs.length)
    for (let index = 1; index < freshSeqs.length; index += 1) expect(freshSeqs[index]).toBe(freshSeqs[index - 1]! + 1)
    console.log('[fault F11] events=50 stale=consistent caught-up=exactly-once')
  }, 120_000)

  it('F12: same idempotency key x5 executes once, then replays', async () => {
    const sessionId = await seedSession()
    const runs = new FakeRunsGateway(pool)
    const app: FastifyInstance = buildApp({ pool, runs })
    try {
      const key = `TEST-f12-${randomUUID()}`
      const send = (): Promise<{ status: number; body: unknown }> =>
        app.inject({
          method: 'POST',
          url: '/v1/commands/send',
          headers: { 'idempotency-key': key },
          payload: { threadKey: sessionId, text: 'F12 hello' },
        }).then((response) => ({ status: response.statusCode, body: response.json() }))
      const first = await send()
      expect(first.status).toBe(202)
      for (let index = 0; index < 4; index += 1) {
        const replay = await send()
        expect(replay.status).toBe(202)
        expect(replay.body).toEqual(first.body)
      }
      expect(runs.signals.length).toBe(1)
      const raceKey = `TEST-f12-race-${randomUUID()}`
      const race = (): Promise<{ status: number; body: unknown }> =>
        app.inject({
          method: 'POST',
          url: '/v1/commands/send',
          headers: { 'idempotency-key': raceKey },
          payload: { threadKey: sessionId, text: 'F12 race' },
        }).then((response) => ({ status: response.statusCode, body: response.json() }))
      const raced = await Promise.all([race(), race(), race(), race(), race()])
      expect(runs.signals.length).toBe(2)
      for (const response of raced) expect([202, 409]).toContain(response.status)
      const winners = raced.filter((response) => response.status === 202)
      expect(winners.length).toBeGreaterThanOrEqual(1)
      for (const winner of winners.slice(1)) expect(winner.body).toEqual(winners[0]!.body)
      console.log('[fault F12] sequential=1-effect-4-replay race=1-effect')
    } finally {
      await app.close()
    }
  }, 120_000)

  it('F15: same-key transactions never deadlock; opposite-order nesting fails clean and retries', async () => {
    await Promise.all(Array.from({ length: 20 }, () =>
      workspaceTransaction(pool, 'TEST-f15-same', async (tx) => {
        await tx.query('SELECT pg_sleep(0.05)')
      }),
    ))
    let arrived = 0
    const outer = (first: string, second: string, alone = false): Promise<void> =>
      workspaceTransaction(pool, first, async () => {
        arrived += 1
        const barrierBy = Date.now() + 10_000
        while (!alone && arrived < 2) {
          if (Date.now() > barrierBy) throw new Error('TEST F15: barrier never filled')
          await sleep(10)
        }
        await workspaceTransaction(pool, second, async () => {})
      })
    const pair = await Promise.allSettled([
      outer('TEST-f15-x', 'TEST-f15-y'),
      outer('TEST-f15-y', 'TEST-f15-x'),
    ])
    const fulfilled = pair.filter((result) => result.status === 'fulfilled')
    const rejected = pair.filter((result) => result.status === 'rejected')
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    const code = (rejected[0] as PromiseRejectedResult).reason as { code?: string }
    expect(code?.code).toBe('40P01')
    const loser = pair[0]!.status === 'rejected'
      ? () => outer('TEST-f15-x', 'TEST-f15-y', true)
      : () => outer('TEST-f15-y', 'TEST-f15-x', true)
    await loser().then(
      () => undefined,
      (error: unknown) => { throw new Error(`TEST F15: retry failed: ${(error as Error).message}`) },
    )
    console.log('[fault F15] same-key=20-ok opposite-order=1-deadlock-1-retry-ok')
  }, 120_000)
})
