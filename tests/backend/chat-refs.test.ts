// A14 @chat references in the research chat: marker turns resolve the
// referenced chats into a preload chunk and narrow the turn grant to
// exclude the plan writer. Unknown ids drop with a note; non-research
// sessions, subagent threads and plain text resolve to no override.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, createSession, ensureResearchSession } from '../../backend/src/db/index.js'
import { resolveChatRefTurn } from '../../backend/src/temporal/activities/turn-chatrefs.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('research @chat references (A14) [F:backend.activity.turn_chatrefs.resolveChatRefTurn] [F:db.index.createSector] [F:db.index.createSession] [F:db.workspace.ensureResearchSession] [F:db.sectors.createSector] [F:db.sessions.createSession] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector] [F:db.sessions.sessionKind] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked]', () => {
  let pool: Pool
  const scope = { tenantId: 'test-chat-refs', projectId: null }
  let sectorId: string, research: string, normal: string
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_chat_refs'), max: 5 })
    sectorId = (await createSector(pool, { name: 'TEST chat refs', topic: 'Refs', scope })).sectorId
    await projectNewEvents(pool)
    research = (await ensureResearchSession(pool, sectorId, scope)).id
    normal = (await createSession(pool, 'TEST sibling', scope, sectorId)).id
    await projectNewEvents(pool)
  })
  afterAll(async () => { await pool?.end() })

  it('resolves markers to a preload chunk and a plan-free grant', async () => {
    const resolved = await resolveChatRefTurn(pool, {
      sessionId: research,
      threadKey: research,
      text: `[[session:${normal}|TEST sibling]] what should change?`,
    })
    expect(resolved).not.toBeNull()
    expect(resolved!.chunks.join('\n')).toContain('TEST sibling')
    expect(resolved!.chunks.join('\n')).toContain('Do not change the plan in this turn')
    expect(resolved!.toolAllow).not.toContain('db.update_sector_plan')
    expect(resolved!.toolAllow).toContain('db.read_sector_thread')
  })

  it('drops unknown ids with a preload note and still narrows', async () => {
    const resolved = await resolveChatRefTurn(pool, {
      sessionId: research,
      threadKey: research,
      text: '[[session:does-not-exist|Ghost]] what should change?',
    })
    expect(resolved).not.toBeNull()
    expect(resolved!.chunks).toContain('Referenced chat not found')
    expect(resolved!.toolAllow).not.toContain('db.update_sector_plan')
  })

  it('drops cross-sector ids with a preload note', async () => {
    const other = (await createSector(pool, { name: 'TEST other', topic: 'Other', scope })).sectorId
    await projectNewEvents(pool)
    const outsider = (await createSession(pool, 'TEST outsider', scope, other)).id
    await projectNewEvents(pool)
    const resolved = await resolveChatRefTurn(pool, {
      sessionId: research,
      threadKey: research,
      text: `[[session:${outsider}|TEST outsider]] what should change?`,
    })
    expect(resolved).not.toBeNull()
    expect(resolved!.chunks).toContain('Referenced chat not found')
  })

  it('returns no override for plain text, normal chats and subagent threads', async () => {
    expect(await resolveChatRefTurn(pool, { sessionId: research, threadKey: research, text: 'plain follow-up' })).toBeNull()
    expect(await resolveChatRefTurn(pool, {
      sessionId: normal,
      threadKey: normal,
      text: `[[session:${research}|Research]] hi`,
    })).toBeNull()
    expect(await resolveChatRefTurn(pool, {
      sessionId: research,
      threadKey: 'agent:some-child',
      text: `[[session:${normal}|TEST sibling]] hi`,
    })).toBeNull()
  })
})
