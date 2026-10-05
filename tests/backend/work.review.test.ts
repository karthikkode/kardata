import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { appendEvent, createSector, recordPlanVersion, recordResearchWork, readResearchProgress, readResearchWorkItem, setSectorState } from '../../backend/src/db/index.js'
import { readResearchWorkReviewSequence } from '../../backend/src/db/work-review.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'
const scope = { tenantId: 'TEST review', projectId: null }
describe.skipIf(!TEST_DATABASE_URL)('owner intake review over real HTTP and isolated PG [F:http.reviewResearchWork]', () => {
  let pool: Pool, app: FastifyInstance, origin: string
  const sectorId = `TEST-review-${randomUUID()}`
  const id = (suffix: string) => `${sectorId}:v1:intake:${suffix}`
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_work_review') })
    for (const [key, role, tenant] of [['owner','approver',scope.tenantId],['model','operator',scope.tenantId],['foreign','approver','TEST foreign']]) await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,project_id,roles) VALUES($1,$2,$3,NULL,$4)', [key, hashKey(`TEST-${key}`), tenant, role])
    await createSector(pool, { sectorId, name: 'TEST review', topic: 'TEST only', scope })
    await projectNewEvents(pool)
    await recordPlanVersion(pool, sectorId, 'TEST approved plan', 'TEST plan', scope)
    await appendEvent(pool, { idempotencyKey: 'TEST approved', partition: `sector:${sectorId}`, type: 'sector.plan_approved', payload: { sectorId, version: 1 } })
    await setSectorState(pool, sectorId, 'paused', { scope })
    await projectNewEvents(pool)
    app = buildApp({ pool, runs: new FakeRunsGateway(pool), auth: true })
    origin = await app.listen({ port: 0, host: '127.0.0.1' })
  })
  afterAll(async () => { await app?.close(); await pool?.end() })
  async function seed(suffix: string, state: 'blocked' | 'failed' | 'complete' = 'blocked', kind: 'discovery' | 'company' = 'discovery') {
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { id: id(suffix), kind, title: `TEST ${suffix}`, state, attempts: 3, childId: null, evidence: ['https://example.com/TEST-evidence'], detail: 'uncertain: TEST source lacked Australian evidence', sourceUrl: 'https://example.com/' } })
    return readResearchWorkItem(pool, sectorId, 1, id(suffix), scope)
  }
  async function decide(suffix: string, receipt: string, decision = 'exclude', key = 'owner', idempotencyKey = randomUUID()) {
    const response = await fetch(`${origin}/v1/sectors/${sectorId}/work/${encodeURIComponent(id(suffix))}/review`, { method: 'POST', headers: { authorization: `Bearer TEST-${key}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify({ planVersion: 1, receiptVersion: receipt, decision, reason: 'TEST owner checked the exact saved source' }) })
    return { status: response.status, body: await response.json() as { data?: unknown } }
  }
  it('requires owner authority and exact scope; excludes without claiming completion or changing evidence', async () => {
    const before = await seed('exclude')
    expect((await decide('exclude', before.receiptVersion!, 'exclude', 'model')).status).toBe(403)
    expect((await decide('exclude', before.receiptVersion!, 'exclude', 'foreign')).status).toBe(404)
    expect(await readResearchWorkReviewSequence(pool, sectorId, 1, scope)).toBe(0)
    const result = await decide('exclude', before.receiptVersion!)
    expect(result.status).toBe(200)
    expect(result.body.data).toMatchObject({ ...before, receiptVersion: expect.any(String), state: 'excluded' })
    const progress = await readResearchProgress(pool, sectorId, scope)
    expect(progress).toMatchObject({ completed: 0, total: 0, unresolved: 0 })
    const event = (await pool.query("SELECT payload FROM events WHERE type='sector.research.work_reviewed' AND payload->>'workId'=$1", [id('exclude')])).rows[0]!.payload
    expect(await readResearchWorkReviewSequence(pool, sectorId, 1, scope)).toBeGreaterThan(0)
    expect(await readResearchWorkReviewSequence(pool, sectorId, 2, scope)).toBe(0)
    await expect(readResearchWorkReviewSequence(pool, sectorId, 1, { tenantId: 'TEST foreign', projectId: null })).rejects.toMatchObject({ code: 'not_found' })
    expect(event).toMatchObject({ author: 'owner', decision: 'exclude', reason: 'TEST owner checked the exact saved source', before })
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { ...before, state: 'complete', detail: 'TEST late activity completion' } })
    expect((await readResearchWorkItem(pool, sectorId, 1, id('exclude'), scope)).state).toBe('excluded')
  })
  it('replays one exact owner decision and refuses changed arguments under its original key', async () => {
    const before = await seed('repeat')
    const requestKey = randomUUID()
    const first = await decide('repeat', before.receiptVersion!, 'exclude', 'owner', requestKey)
    expect(first.status).toBe(200)
    const repeated = await decide('repeat', before.receiptVersion!, 'exclude', 'owner', requestKey)
    expect(repeated).toEqual(first)
    expect((await decide('repeat', before.receiptVersion!, 'retry', 'owner', requestKey)).status).toBe(409)
    const events = await pool.query("SELECT payload FROM events WHERE type='sector.research.work_reviewed' AND payload->>'workId'=$1", [id('repeat')])
    expect(events.rows).toHaveLength(1)
    expect((await readResearchWorkItem(pool, sectorId, 1, id('repeat'), scope)).state).toBe('excluded')
  })
  it('serializes contradictory decisions; preserves attempts and original reason on explicit retry', async () => {
    const before = await seed('race', 'failed')
    const results = await Promise.all([decide('race', before.receiptVersion!, 'retry'), decide('race', before.receiptVersion!, 'exclude')])
    expect(results.map((result) => result.status).sort()).toEqual([200,409])
    const after = await readResearchWorkItem(pool, sectorId, 1, id('race'), scope)
    expect(after).toMatchObject({ attempts: 3, detail: before.detail, evidence: before.evidence, sourceUrl: before.sourceUrl })
    const retry = await seed('retry')
    expect((await decide('retry', retry.receiptVersion!, 'retry')).body.data).toMatchObject({ state: 'pending', attempts: 3, detail: retry.detail })
  })
  it('refuses an active or unresolved-start candidate child at a paused boundary', async () => {
    const before = await seed('child')
    const childId = `TEST-child-${randomUUID()}`
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { ...before, childId } })
    const current = await readResearchWorkItem(pool, sectorId, 1, id('child'), scope)
    await pool.query('INSERT INTO thread_context(thread_key,active_lease) VALUES($1,$2)', [`agent:${childId}`, randomUUID()])
    expect((await decide('child', current.receiptVersion!)).status).toBe(409)
    await pool.query('UPDATE thread_context SET active_lease=NULL WHERE thread_key=$1', [`agent:${childId}`])
    const epoch = randomUUID()
    await pool.query("INSERT INTO execution_intents(epoch,workflow_id,thread_key,session_id,request_key,state,deadline_at) VALUES($1,$2,$3,$4,'TEST start','uncertain',now())", [epoch,childId,`agent:${childId}`,'TEST session'])
    expect((await decide('child', current.receiptVersion!)).status).toBe(409)
    await pool.query("UPDATE execution_intents SET state='failed' WHERE epoch=$1", [epoch])
    expect((await decide('child', current.receiptVersion!)).status).toBe(200)
  })
  it('refuses stale receipts, live lifecycle, settled receipts and company work', async () => {
    const before = await seed('stale')
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { ...before, attempts: 4 } })
    expect((await decide('stale', before.receiptVersion!)).status).toBe(409)
    const complete = await seed('complete','complete')
    expect((await decide('complete', complete.receiptVersion!)).status).toBe(409)
    const company = await seed('company','blocked','company')
    expect((await decide('company', company.receiptVersion!)).status).toBe(409)
    const current = await seed('live')
    await setSectorState(pool, sectorId, 'running', { scope })
    // Route projector catches up; durable state gate additionally protects lag races.
    expect((await decide('live', current.receiptVersion!)).status).toBe(409)
    await setSectorState(pool, sectorId, 'paused', { scope })
    await projectNewEvents(pool)
    await recordPlanVersion(pool, sectorId, 'TEST changed unapproved plan', 'TEST revised plan', scope)
    expect((await decide('live', current.receiptVersion!)).status).toBe(409)
  })
})
