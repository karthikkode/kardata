// Sector backend v1 global context model (A4+): section order,
// migration-free defaults, usage sums. Isolated Postgres.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ContextSections, createSector, createSession, decideContextChange, formatGlobalContext, proposeGlobalContext, readGlobalContext, readSessionSettings, setUseGlobalContext } from '../../backend/src/db/index.js'
import { turnContextSnapshot, turnSectorRefs } from '../../backend/src/temporal/activities/turn.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const scope = { tenantId: 'TEST global context', projectId: null }

describe.skipIf(!TEST_DATABASE_URL)('global context sections (A4) [F:backend.activity.turn.turnContextSnapshot] [F:backend.activity.turn.turnSectorRefs]', () => {
  let pool: Pool
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_global_context'), max: 5 })
  })
  afterAll(async () => {
    await pool?.end()
  })

  it('renders six headings in sector order, skipping empty parts', () => {
    const sections = ContextSections.parse({ scope: 's', instructions: 'i', decisions: 'd', findings: 'f', questions: 'q' })
    const markdown = formatGlobalContext(sections, [
      { fileId: 'b', filename: 'b.md', summary: 'B summary', addedVersion: 2 },
      { fileId: 'a', filename: 'a.md', summary: 'A summary', addedVersion: 1 },
    ])
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(headings).toEqual(['Scope', 'Instructions', 'Decisions', 'Findings', 'Open questions', 'Files'])
    expect(markdown.indexOf('A summary')).toBeLessThan(markdown.indexOf('B summary'))
    const sparse = formatGlobalContext(ContextSections.parse({ scope: '', instructions: '', decisions: 'd', findings: '', questions: '' }))
    expect(sparse).toBe('## Decisions\n\nd')
  })

  it('defaults a missing settings row to global context on', async () => {
    expect(await readSessionSettings(pool, 'TEST unknown session')).toEqual({ useGlobalContext: true, purpose: 'chat' })
  })

  it('persists the per-chat switch and gates turn references on it', async () => {
    const { sectorId } = await createSector(pool, { name: 'TEST switch', topic: 'TEST switch', scope })
    await projectNewEvents(pool)
    await proposeGlobalContext(pool, { sectorId, baseVersion: 0, sections: ContextSections.parse({ scope: 'TEST sector scope' }), sourceThread: 'TEST owner', owner: true, scope })
    await projectNewEvents(pool)
    const sessionId = (await createSession(pool, 'TEST switch chat', scope, sectorId)).id
    await projectNewEvents(pool)
    expect((await turnSectorRefs(pool, sessionId, sectorId, sessionId)).join('\n')).toContain('TEST sector scope')
    expect(await turnContextSnapshot(pool, sessionId, sectorId, sessionId)).toMatchObject({ contextVersion: 1 })
    await setUseGlobalContext(pool, sessionId, false, scope)
    expect(await readSessionSettings(pool, sessionId)).toEqual({ useGlobalContext: false, purpose: 'chat' })
    expect(await turnSectorRefs(pool, sessionId, sectorId, sessionId)).toEqual([])
    expect(await turnContextSnapshot(pool, sessionId, sectorId, sessionId)).toEqual({ references: [], contextVersion: null })
  })

  it('merges a partial agent proposal onto current sections, never wiping omissions', async () => {
    const { sectorId } = await createSector(pool, { name: 'TEST patch', topic: 'TEST patch', scope })
    await projectNewEvents(pool)
    const full = { scope: 'S', instructions: 'I', decisions: 'D', findings: 'F', questions: 'Q' }
    await proposeGlobalContext(pool, { sectorId, baseVersion: 0, sections: full, sourceThread: 'TEST owner', owner: true, scope })
    const sessionId = (await createSession(pool, 'TEST patch chat', scope, sectorId)).id
    await projectNewEvents(pool)
    const proposal = await proposeGlobalContext(pool, { sectorId, baseVersion: 1, sections: { instructions: 'I2' }, sourceThread: sessionId, owner: false, scope })
    expect(proposal.state).toBe('pending')
    expect(proposal.sections).toEqual({ ...full, instructions: 'I2' })
    const decided = await decideContextChange(pool, { sectorId, id: proposal.id, approve: true, scope })
    expect(decided.state).toBe('approved')
    expect((await readGlobalContext(pool, sectorId, scope)).sections).toEqual({ ...full, instructions: 'I2' })
  })

  it('clears a section only on explicit empty string, keeping omissions', async () => {
    const { sectorId } = await createSector(pool, { name: 'TEST clear', topic: 'TEST clear', scope })
    await projectNewEvents(pool)
    const full = { scope: 'S', instructions: 'I', decisions: 'D', findings: 'F', questions: 'Q' }
    await proposeGlobalContext(pool, { sectorId, baseVersion: 0, sections: full, sourceThread: 'TEST owner', owner: true, scope })
    const sessionId = (await createSession(pool, 'TEST clear chat', scope, sectorId)).id
    await projectNewEvents(pool)
    const proposal = await proposeGlobalContext(pool, { sectorId, baseVersion: 1, sections: { findings: '' }, sourceThread: sessionId, owner: false, scope })
    await decideContextChange(pool, { sectorId, id: proposal.id, approve: true, scope })
    expect((await readGlobalContext(pool, sectorId, scope)).sections).toEqual({ ...full, findings: '' })
  })

  it('rejects a proposal that changes no section', async () => {
    const { sectorId } = await createSector(pool, { name: 'TEST noop', topic: 'TEST noop', scope })
    await projectNewEvents(pool)
    await proposeGlobalContext(pool, { sectorId, baseVersion: 0, sections: { scope: 'S' }, sourceThread: 'TEST owner', owner: true, scope })
    const sessionId = (await createSession(pool, 'TEST noop chat', scope, sectorId)).id
    await projectNewEvents(pool)
    await expect(proposeGlobalContext(pool, { sectorId, baseVersion: 1, sections: {}, sourceThread: sessionId, owner: false, scope })).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('reads a migration-free old row with instructions defaulted', async () => {
    const { sectorId } = await createSector(pool, { name: 'TEST ctx', topic: 'TEST ctx', scope })
    await projectNewEvents(pool)
    const legacy = { scope: 's', decisions: 'd', findings: 'f', questions: 'q' }
    await proposeGlobalContext(pool, { sectorId, baseVersion: 0, sections: legacy as never, sourceThread: 'TEST owner', owner: true, scope })
    await projectNewEvents(pool)
    const context = await readGlobalContext(pool, sectorId, scope)
    expect(context.sections.instructions).toBe('')
    expect(context.markdown).toContain('## Decisions')
    expect(context.markdown).not.toContain('## Instructions')
  })
})
