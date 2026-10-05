// A15 subagent inheritance: the child preloads its parent's summary plus
// recent parent messages, stored before the goal is processed.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { estimateTokens } from '@kardata/agents'
import {
  appendEvent,
  buildInheritedContext,
  createSector,
  createSession,
  readInheritedContext,
  readThreadContext,
  saveInheritedContext,
  saveThreadContext,
} from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

describe.skipIf(!TEST_DATABASE_URL)('subagent inheritance (A15)', () => {
  let pool: Pool
  let runs: FakeRunsGateway
  const scope = { tenantId: 'test-inherit', projectId: null }
  let parent = ''
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_inherit'), max: 5 })
    runs = new FakeRunsGateway(pool)
    const sectorId = (await createSector(pool, { name: 'TEST inherit', topic: 'Inherit', scope })).sectorId
    await projectNewEvents(pool)
    parent = (await createSession(pool, 'TEST parent', scope, sectorId)).id
    await projectNewEvents(pool)
  })
  afterAll(async () => { await pool?.end() })

  async function seedParent(summary: string, texts: Array<{ role: string; text: string }>) {
    const current = await readThreadContext(pool, parent)
    await saveThreadContext(pool, parent, { version: current.version, summary })
    let seq = 0
    for (const message of texts) {
      seq += 1
      await appendEvent(pool, {
        idempotencyKey: `TEST inherit msg ${summary.slice(0, 8)} ${seq} ${message.text.slice(0, 12)}`,
        partition: `session:${parent}`,
        type: 't.message.appended',
        payload: { threadKey: parent, kind: 'text', message: { text: message.text, role: message.role } },
      })
    }
    await projectNewEvents(pool)
  }

  it('builds summary plus the last 20 parent messages in order', async () => {
    const texts = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'agent',
      text: `parent message ${index}`,
    }))
    await seedParent('parent summary here', texts)
    const inherited = await buildInheritedContext(pool, parent)
    expect(inherited).toContain('Parent summary:\nparent summary here')
    expect(inherited).toContain('Recent parent messages:')
    expect(inherited).toContain('Owner: parent message 24')
    expect(inherited).not.toContain('parent message 4\n')
    expect(inherited.indexOf('parent message 5')).toBeLessThan(inherited.indexOf('parent message 24'))
  })

  it('caps at 12000 estimated tokens by dropping the oldest messages first', async () => {
    const texts = Array.from({ length: 20 }, (_, index) => ({ role: 'user', text: `big-${index} ${'x'.repeat(4800)}` }))
    await seedParent('summary', texts)
    const inherited = await buildInheritedContext(pool, parent)
    expect(estimateTokens(inherited)).toBeLessThanOrEqual(12000)
    expect(inherited).toContain('Parent summary:\nsummary')
    expect(inherited).toContain('big-19')
    expect(inherited).not.toContain('big-0 ')
  })

  it('writes inherited context between acceptance and the goal signal', async () => {
    // The fake records its own accept/goal order: the inherited row is
    // written inside onAccepted, so a present row plus accept-before-goal
    // proves the write lands before the goal is processed.
    const { childId } = await runs.delegateSubagent({
      sessionId: parent,
      goal: 'child goal',
      mode: 'empty',
      queueCapacity: 8,
      onAccepted: async (accepted) => {
        await saveInheritedContext(pool, `agent:${accepted}`, 'inherited brief')
      },
    })
    expect(runs.delegationOrder).toEqual([`accepted:${childId}`, `goal:${childId}`])
    expect(await readInheritedContext(pool, `agent:${childId}`)).toBe('inherited brief')
  })
})
