import { Pool } from 'pg'
import { FakeProvider, emptyUsage, type ChatMessage } from '@kardata/agents'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { beginThreadTurn, clearTurnContinuation, consumeSteering, finishSteering, commitThreadCompaction, createSession, getThread, readThreadContext, readTurnContinuation, saveThreadContext, saveTurnContinuation } from '../../backend/src/db/index.js'
import { compactThread } from '../../backend/src/context.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('parked context compaction recovery', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_compaction_recovery') }) })
  afterAll(async () => { await pool?.end() })
  const usage = emptyUsage()

  it('compacts and reuses the saved working history even with a short visible transcript', async () => {
    const session = await createSession(pool, 'TEST parked turn')
    await projectNewEvents(pool)
    const messages: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `checkpoint-only evidence ${i}`, contextSeq: i + 1 }))
    const continuation = { user: 'Original task', runKey: 'original-operation', messages, sources: [], meta: { round: 3, usage, toolCalls: 2, elapsedMs: 500 } }
    await saveTurnContinuation(pool, session.id, continuation)
    const provider = new FakeProvider([{ text: 'Preserved objective, evidence and open work.' }])
    const transcriptBefore = (await getThread(pool, session.id))?.messages
    const result = await compactThread(pool, session.id, provider, true)
    expect(result.compacted).toBe(true)
    expect(JSON.stringify(provider.calls)).toContain('checkpoint-only evidence')
    const resumed = await readTurnContinuation(pool, session.id)
    expect(resumed?.messages[0]?.text).toContain('Preserved objective, evidence and open work.')
    expect(resumed?.messages.length).toBeLessThan(messages.length)
    expect(resumed).toMatchObject({ runKey: 'original-operation', user: 'Original task', meta: continuation.meta })
    expect((await getThread(pool, session.id))?.messages).toEqual(transcriptBefore)
  })

  it('rejects stale checkpoint replacement and does not overwrite newer work', async () => {
    const session = await createSession(pool, 'TEST stale compaction')
    await projectNewEvents(pool)
    const previous = { user: 'Task', runKey: 'task', messages: [{ role: 'user' as const, text: 'Old working history' }], sources: [], meta: { round: 1, usage, toolCalls: 0, elapsedMs: 10 } }
    const newer = { ...previous, messages: [{ role: 'user' as const, text: 'Newer working history' }] }
    await saveTurnContinuation(pool, session.id, newer)
    await expect(commitThreadCompaction(pool, session.id, { version: 0, summary: 'Stale summary', coveredSeq: 1, continuation: { previous, messages: [{ role: 'assistant', text: 'Stale summary' }] } })).rejects.toMatchObject({ code: 'conflict' })
    expect((await readTurnContinuation(pool, session.id))?.messages).toEqual(newer.messages)
  })

  it('rejects compaction while an activity owns the active turn', async () => {
    const session = await createSession(pool, 'TEST active compaction')
    await projectNewEvents(pool)
    await beginThreadTurn(pool, session.id, 'active-turn')
    await expect(commitThreadCompaction(pool, session.id, { version: 0, summary: 'Summary', coveredSeq: 1 })).rejects.toMatchObject({ code: 'conflict' })
  })
  it('fences late checkpoints and cleanup from a replaced attempt of the same operation', async () => {
    const session = await createSession(pool, 'TEST attempt fencing')
    await projectNewEvents(pool)
    const old = await beginThreadTurn(pool, session.id, 'same-operation')
    const continuation = { user: 'Task', runKey: 'same-operation', messages: [{ role: 'user' as const, text: 'Original checkpoint' }], sources: [], meta: { round: 1, usage, toolCalls: 0, elapsedMs: 10 } }
    await saveTurnContinuation(pool, session.id, continuation, old)
    const fresh = await beginThreadTurn(pool, session.id, 'same-operation')
    expect(fresh).not.toBe(old)
    const newer = { ...continuation, messages: [{ role: 'user' as const, text: 'Replacement checkpoint' }], meta: { ...continuation.meta, round: 2 } }
    await saveTurnContinuation(pool, session.id, newer, fresh)
    await expect(saveTurnContinuation(pool, session.id, continuation, old)).rejects.toMatchObject({ code: 'conflict' })
    await expect(consumeSteering(pool, session.id, 'same-operation', 3, old)).rejects.toMatchObject({ code: 'conflict' })
    await clearTurnContinuation(pool, session.id, old)
    await finishSteering(pool, session.id, 'same-operation', old)
    expect((await readTurnContinuation(pool, session.id))?.messages).toEqual(newer.messages)
    await expect(commitThreadCompaction(pool, session.id, { version: 0, summary: 'Must remain active', coveredSeq: 1 })).rejects.toMatchObject({ code: 'conflict' })
    await clearTurnContinuation(pool, session.id, fresh)
    await finishSteering(pool, session.id, 'same-operation', fresh)
    expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
  })

  it('denies a late write after its owner attempt has finished', async () => {
    const session = await createSession(pool, 'TEST finished attempt fence')
    await projectNewEvents(pool)
    const lease = await beginThreadTurn(pool, session.id, 'finished-operation')
    await finishSteering(pool, session.id, 'finished-operation', lease)
    const continuation = { user: 'Task', runKey: 'finished-operation', messages: [{ role: 'user' as const, text: 'Late callback' }], sources: [], meta: { round: 1, usage, toolCalls: 0, elapsedMs: 10 } }
    await expect(saveTurnContinuation(pool, session.id, continuation, lease)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
  })

  it('denies an old automatic summary even when it reads the replacement current version', async () => {
    const session = await createSession(pool, 'TEST summary attempt fence')
    await projectNewEvents(pool)
    const old = await beginThreadTurn(pool, session.id, 'summary-operation')
    const fresh = await beginThreadTurn(pool, session.id, 'summary-operation')
    const current = await readThreadContext(pool, session.id)
    await saveThreadContext(pool, session.id, { version: current.version, summary: 'Replacement summary', coveredSeq: 3 }, undefined, fresh)
    const replacement = await readThreadContext(pool, session.id)
    await expect(saveThreadContext(pool, session.id, { version: replacement.version, summary: 'Late old summary', coveredSeq: 3 }, undefined, old)).rejects.toMatchObject({ code: 'conflict' })
    expect((await readThreadContext(pool, session.id)).summary).toBe('Replacement summary')
  })

})
