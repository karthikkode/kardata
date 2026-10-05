// Actual HTTP/MCP/activity/Postgres/FS path, explicitly scripted provider.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { MockActivityEnvironment } from '@temporalio/testing'
import { FakeProvider, emptyUsage, type ProviderRequest } from '@kardata/agents'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { FilesystemTarget, readExecutionRecord, resolveArchiveTarget, type ArchivedExecutionRecord } from '../../backend/src/archive/targets.js'
import { createSector, createSession, listSessions, readPartition, readThreadContext, readTurnContinuation, registerApiKey, saveThreadContext } from '../../backend/src/db/index.js'
import * as dbLayer from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { karbotTurnActivity, type TurnOutcome } from '../../backend/src/temporal/activities/turn.js'
import { type KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('paid provider response recording recovery', () => {
  let pool: Pool, app: FastifyInstance, endpoint: string
  const token = 'TEST paid response worker credential'
  const scope = { tenantId: 'TEST paid response recovery', projectId: null }
  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_paid_response')
    vi.stubEnv('DATABASE_URL', url); vi.stubEnv('KARDATA_PROVIDER', 'fake'); vi.stubEnv('KARDATA_MCP_TOKEN', token)
    vi.stubEnv('KARDATA_GCS_BUCKET', ''); vi.stubEnv('KARDATA_ARCHIVE_DIR', mkdtempSync(join(tmpdir(), 'kardata-paid-response-')))
    pool = new Pool({ connectionString: url, max: 5 })
    await registerApiKey(pool, { keyId: 'TEST paid response key', keyHash: hashKey(token), scope, role: 'operator' })
    app = buildApp({ pool, auth: true }); endpoint = `${await app.listen({ host: '127.0.0.1', port: 0 })}/mcp`
  })
  afterAll(async () => { await app?.close(); await pool?.end(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
  it('resumes the exact paid reply and usage after lost archive acknowledgement without another provider call', async () => {
    const session = await createSession(pool, 'TEST paid response session', scope)
    await projectNewEvents(pool)
    const environment = new MockActivityEnvironment()
    const original = 'TEST original paid final reply'
    const actualUsage = { ...emptyUsage(), inputTokens: 121, outputTokens: 17, cacheReadTokens: 40 }
    const chat = FakeProvider.prototype.chatStream
    let providerCalls = 0
    const providerSpy = vi.spyOn(FakeProvider.prototype, 'chatStream').mockImplementation(async function* (this: FakeProvider, request: ProviderRequest) {
      providerCalls++
      for await (const event of chat.call(this, request)) yield event.kind === 'done' ? { ...event, usage: actualUsage } : event
    })
    const write = FilesystemTarget.prototype.write
    let lost = false
    const archiveSpy = vi.spyOn(FilesystemTarget.prototype, 'write').mockImplementation(async function (this: FilesystemTarget, key, body, signal) {
      await write.call(this, key, body, signal)
      if (!lost && body.includes(original)) { lost = true; throw new Error('TEST archive wrote reply but acknowledgement was lost') }
    })
    const input: KarbotTurnInput = { sessionId: session.id, threadKey: session.id, runKey: 'TEST original paid operation', text: 'TEST preserve the paid reply', mcpEndpoint: endpoint, mcpToken: token, toolAllow: [], fakeSteps: [{ text: original }] }
    try {
      await expect(environment.run(karbotTurnActivity, input)).rejects.toMatchObject({ type: 'ContextBlocked', nonRetryable: true })
      const pending = await readTurnContinuation(pool, session.id)
      expect(pending?.meta.pendingResponse?.response).toMatchObject({ text: original, usage: actualUsage })
      expect(pending?.meta.usage).toEqual(actualUsage)
      expect(providerCalls).toBe(1)
      await expect(environment.run(karbotTurnActivity, { ...input, runKey: 'TEST replacement assignment', text: 'TEST cannot abandon paid response' })).rejects.toMatchObject({ type: 'ContextBlocked' })
      const local = await readThreadContext(pool, session.id, scope)
      await saveThreadContext(pool, session.id, { version: local.version, notes: 'TEST notes changed after original response' }, scope)
      const completed = await environment.run<[KarbotTurnInput], TurnOutcome, typeof karbotTurnActivity>(karbotTurnActivity, { ...input, fakeSteps: [{ text: 'TEST must never replace the original reply' }] })
      expect(completed.reply).toBe(original); expect(providerCalls).toBe(1)
      expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
      const records = (await readPartition(pool, `session:${session.id}`)).filter((event) => event.type === 't.execution.recorded')
      expect(records).toHaveLength(2)
      const response = records.find((event) => (event.payload as { kind: string }).kind === 'response')!
      const ref = (response.payload as { ref: ArchivedExecutionRecord }).ref
      const repaired = await readExecutionRecord(resolveArchiveTarget(), session.id, ref) as { attemptLease: string }
      expect(repaired.attemptLease).toBe(pending!.meta.pendingResponse!.metadata!['attemptLease'])
      expect((response.payload as { lease: string }).lease).not.toBe(repaired.attemptLease)
      expect(await readExecutionRecord(resolveArchiveTarget(), session.id, ref)).toMatchObject({ boundary: pending!.meta.pendingResponse!.metadata!.boundary, data: { text: original, usage: actualUsage } })
    } finally { archiveSpy.mockRestore(); providerSpy.mockRestore() }
  })
  it('replays the original multi-argument mutation after tool-result storage failure despite JSONB key reordering', async () => {
    const sectorId = (await createSector(pool, { name: 'TEST mutation replay sector', topic: 'TEST', scope })).sectorId
    await projectNewEvents(pool)
    const session = await createSession(pool, 'TEST mutation replay caller', scope)
    await projectNewEvents(pool)
    const environment = new MockActivityEnvironment()
    const call = { id: 'TEST multi-argument mutation', name: 'db.create_session', args: { sectorId, title: 'TEST exactly one recovered session' } }
    const write = FilesystemTarget.prototype.write
    let failed = false
    const archiveSpy = vi.spyOn(FilesystemTarget.prototype, 'write').mockImplementation(async function (this: FilesystemTarget, key, body, signal) {
      const record = JSON.parse(body) as { data?: { outcome?: unknown } }
      if (!failed && record.data?.outcome) { failed = true; throw new Error('TEST tool result archive unavailable') }
      return write.call(this, key, body, signal)
    })
    const input: KarbotTurnInput = { sessionId: session.id, threadKey: session.id, runKey: 'TEST multi argument operation', text: 'TEST create one session', mcpEndpoint: endpoint, mcpToken: token, toolAllow: ['db.create_session'], fakeSteps: [{ text: '', toolCalls: [call] }, { text: 'TEST must not continue before recording the result' }] }
    try {
      await expect(environment.run(karbotTurnActivity, input)).rejects.toMatchObject({ type: 'ContextBlocked' })
      const pending = await readTurnContinuation(pool, session.id)
      const operation = pending!.meta.blockedOperations![0]!
      expect(Object.keys(operation.call.args)).toEqual(['title', 'sectorId'])
      expect(operation.serializedCall).toBe(JSON.stringify(call))
      expect((await listSessions(pool, scope)).filter((row) => row.title === call.args.title)).toHaveLength(1)
      const recovered = await environment.run<[KarbotTurnInput], TurnOutcome, typeof karbotTurnActivity>(karbotTurnActivity, { ...input, fakeSteps: [{ text: 'TEST original mutation recovered successfully' }] })
      expect(recovered.reply).toBe('TEST original mutation recovered successfully')
      expect((await listSessions(pool, scope)).filter((row) => row.title === call.args.title)).toHaveLength(1)
      expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
    } finally { archiveSpy.mockRestore() }
  })

  it('retains the final paid reply when final continuation clearing fails after successful response publication', async () => {
    const session = await createSession(pool, 'TEST finalizer recovery session', scope)
    await projectNewEvents(pool)
    const environment = new MockActivityEnvironment()
    const providerSpy = vi.spyOn(FakeProvider.prototype, 'chatStream')
    const clear = dbLayer.clearTurnContinuation
    let failures = 0
    const fault = vi.spyOn(dbLayer, 'clearTurnContinuation').mockImplementation(async (db, thread, lease) => {
      if (thread === session.id && failures < 2) { failures++; throw new Error('TEST final continuation clear unavailable') }
      return clear(db, thread, lease)
    })
    const input: KarbotTurnInput = { sessionId: session.id, threadKey: session.id, runKey: 'TEST finalized paid operation', text: 'TEST preserve final response', mcpEndpoint: endpoint, mcpToken: token, toolAllow: [], fakeSteps: [{ text: 'TEST original successfully recorded final reply' }] }
    try {
      await expect(environment.run(karbotTurnActivity, input)).rejects.toThrow('TEST final continuation clear unavailable')
      expect((await readTurnContinuation(pool, session.id))?.meta.pendingResponse?.response.text).toBe('TEST original successfully recorded final reply')
      const originalPending = (await readTurnContinuation(pool, session.id))!.meta.pendingResponse!
      const local = await readThreadContext(pool, session.id, scope)
      await saveThreadContext(pool, session.id, { version: local.version, notes: 'TEST changed notes before second failed finalizer' }, scope)
      await expect(environment.run(karbotTurnActivity, { ...input, fakeSteps: [{ text: 'TEST must not replace original on second failure' }] })).rejects.toThrow('TEST final continuation clear unavailable')
      expect((await readTurnContinuation(pool, session.id))!.meta.pendingResponse).toEqual(originalPending)
      const recovered = await environment.run<[KarbotTurnInput], TurnOutcome, typeof karbotTurnActivity>(karbotTurnActivity, { ...input, fakeSteps: [{ text: 'TEST must not replace a paid final reply' }] })
      expect(recovered.reply).toBe('TEST original successfully recorded final reply')
      expect(providerSpy).toHaveBeenCalledTimes(1)
      expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
      const responses = (await readPartition(pool, `session:${session.id}`)).filter((event) => event.type === 't.execution.recorded' && (event.payload as { kind: string }).kind === 'response')
      expect(responses).toHaveLength(3)
      expect(new Set(responses.map((event) => (event.payload as { ref: ArchivedExecutionRecord }).ref.hash)).size).toBe(1)
      expect(await readExecutionRecord(resolveArchiveTarget(), session.id, (responses[0]!.payload as { ref: ArchivedExecutionRecord }).ref)).toMatchObject({ attemptLease: originalPending.metadata!['attemptLease'], boundary: originalPending.metadata!['boundary'] })
    } finally { fault.mockRestore(); providerSpy.mockRestore() }
  })

})
