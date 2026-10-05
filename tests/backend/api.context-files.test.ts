// A6 file blocks: owner add/retry routes, approval-to-summarize, ready
// apply, and injection over an isolated Postgres. No live provider.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import {
  applyReadyContextFileBlock, createSector, ensureResearchSession, ingestSectorDocument,
  listDocumentUnits, proposeFileContext, readGlobalContext, setFileVisibility, workspaceReferences,
} from '../../backend/src/db/index.js'
import { readContextFileBlock } from '../../backend/src/db/context-files.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()
const KEYS = {
  approver: { presented: 'key-cb-approver', tenant: 'tenant-cb', project: null, role: 'approver' },
  operator: { presented: 'key-cb-operator', tenant: 'tenant-cb', project: null, role: 'operator' },
  viewer: { presented: 'key-cb-viewer', tenant: 'tenant-cb', project: null, role: 'viewer' },
} as const
const authHeader = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` })
const FILE_TEXT = 'TEST block evidence: revenue 12,400 in 2024 across 20 sites.'

describe.skipIf(!ENABLED)('context file blocks', () => {
  let app: FastifyInstance
  let pool: Pool
  let runs: FakeRunsGateway
  const sector = `sec-blocks-${STAMP}`
  const scope = { tenantId: 'tenant-cb', projectId: null }
  let documentId = ''
  let fileHash = ''

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_context_blocks'), max: 5 })
    for (const [keyId, key] of Object.entries(KEYS)) {
      await pool.query(
        `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash, roles = EXCLUDED.roles`,
        [keyId, hashKey(key.presented), key.tenant, key.project, key.role],
      )
    }
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })
    await createSector(pool, { name: 'Blocks sector', topic: 'Blocks', scope, sectorId: sector })
    await projectNewEvents(pool)
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', headers: authHeader(KEYS.operator.presented), payload: { title: `Blocks chat ${STAMP}`, sectorId: sector } })
    expect(created.statusCode).toBe(201)
    const document = await ingestSectorDocument(pool, { sectorId: sector, filename: 'TEST evidence.md', contentBase64: Buffer.from(FILE_TEXT).toString('base64'), scope })
    documentId = document.id
    fileHash = document.sha256
    await projectNewEvents(pool)
  })
  afterAll(async () => { await app.close(); await pool.end() })

  it('refuses non-approver adds', async () => {
    for (const key of [KEYS.viewer.presented, KEYS.operator.presented]) {
      const response = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(key), payload: { fileId: documentId } })
      expect(response.statusCode).toBe(403)
    }
  })

  it('validates the file before adding', async () => {
    const missing = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(KEYS.approver.presented), payload: { fileId: 'no-such-file' } })
    expect(missing.statusCode).toBe(404)
    await setFileVisibility(pool, sector, documentId, true, scope)
    const hidden = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(KEYS.approver.presented), payload: { fileId: documentId } })
    expect(hidden.statusCode).toBe(409)
    await setFileVisibility(pool, sector, documentId, false, scope)
    await pool.query(`UPDATE sector_documents SET status='processing' WHERE id=$1`, [documentId])
    const unindexed = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(KEYS.approver.presented), payload: { fileId: documentId } })
    expect(unindexed.statusCode).toBe(409)
    await pool.query(`UPDATE sector_documents SET status='indexed' WHERE id=$1`, [documentId])
  })

  it('adds a file as summarizing and starts one workflow', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(KEYS.approver.presented), payload: { fileId: documentId } })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ fileId: documentId, state: 'summarizing', filename: 'TEST evidence.md' })
    expect(runs.startedFileSummaries).toContainEqual({ sectorId: sector, fileId: documentId, hash: fileHash })
    const again = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(KEYS.approver.presented), payload: { fileId: documentId } })
    expect(again.json().data).toMatchObject({ fileId: documentId, state: 'summarizing' })
    expect(runs.startedFileSummaries.filter((start) => start.fileId === documentId)).toHaveLength(1)
    const context = await readGlobalContext(pool, sector, scope)
    expect(context.files).toContainEqual(expect.objectContaining({ fileId: documentId, state: 'summarizing' }))
  })

  it('refuses the add when the context is full', async () => {
    const full = await ingestSectorDocument(pool, { sectorId: sector, filename: 'TEST full.md', contentBase64: Buffer.from('TEST full').toString('base64'), scope })
    await pool.query(`INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,summary,tokens,requested_by,added_version)
      VALUES ($1,$2,$2,'TEST hash','TEST full.md','ready','TEST summary',30000,'TEST',1)`, [sector, full.id])
    const response = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(KEYS.approver.presented), payload: { fileId: full.id } })
    // Ready blocks return as-is; a fresh over-budget add is refused instead.
    expect(response.statusCode).toBe(200)
    const other = await ingestSectorDocument(pool, { sectorId: sector, filename: 'TEST other.md', contentBase64: Buffer.from('TEST other').toString('base64'), scope })
    const refused = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files`, headers: authHeader(KEYS.approver.presented), payload: { fileId: other.id } })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toBe('Global context is full. Remove a file or compact first.')
    await pool.query('DELETE FROM context_file_blocks WHERE sector_id=$1 AND file_id=$2', [sector, full.id])
  })

  it('retries failed and legacy blocks only', async () => {
    const missing = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files/${documentId}/summarize`, headers: authHeader(KEYS.approver.presented) })
    expect(missing.statusCode).toBe(409)
    await pool.query(`UPDATE context_file_blocks SET state='failed',error='TEST boom' WHERE sector_id=$1 AND file_id=$2`, [sector, documentId])
    const starts = runs.startedFileSummaries.length
    const retry = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/files/${documentId}/summarize`, headers: authHeader(KEYS.approver.presented) })
    expect(retry.statusCode).toBe(200)
    expect(retry.json().data).toMatchObject({ fileId: documentId, state: 'summarizing', error: null })
    expect(runs.startedFileSummaries).toHaveLength(starts + 1)
  })

  it('approving an agent file proposal starts a summary without bumping the version', async () => {
    const research = (await ensureResearchSession(pool, sector, scope)).id
    await projectNewEvents(pool)
    const proposal = await proposeFileContext(pool, { sectorId: sector, fileId: documentId, baseVersion: 0, sourceThread: research, scope })
    expect(proposal.state).toBe('pending')
    const before = (await readGlobalContext(pool, sector, scope)).version
    const starts = runs.startedFileSummaries.length
    const decision = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/proposals/${proposal.id}/decision`, headers: authHeader(KEYS.approver.presented), payload: { approve: true } })
    expect(decision.statusCode).toBe(200)
    expect(decision.json().data).toMatchObject({ state: 'approved', version: null })
    expect((await readGlobalContext(pool, sector, scope)).version).toBe(before)
    expect((await readContextFileBlock(pool, sector, documentId))?.state).toBe('summarizing')
    expect(runs.startedFileSummaries).toHaveLength(starts + 1)
  })

  it('applies a ready block exactly once per file and serves it in references', async () => {
    const before = (await readGlobalContext(pool, sector, scope)).version
    const applied = await applyReadyContextFileBlock(pool, { sectorId: sector, fileId: documentId, summary: '### TEST evidence.md (MD)\n**Overview.** TEST block summary 12,400.', tokens: 42 })
    expect(applied).toEqual({ version: before + 1 })
    const context = await readGlobalContext(pool, sector, scope)
    expect(context.version).toBe(before + 1)
    expect(context.markdown).toContain('## Files')
    expect(context.markdown).toContain('TEST block summary 12,400.')
    expect(context.files).toContainEqual(expect.objectContaining({ fileId: documentId, state: 'ready', tokens: 42 }))
    const references = await workspaceReferences(pool, sector, scope)
    expect(references.join('\n')).toContain('TEST block summary 12,400.')
    expect(references.join('\n')).not.toMatch(/\[TEST evidence\.md:\d+\]/)
  })

  it('keeps legacy raw injection until the file is summarized', async () => {
    const legacy = await ingestSectorDocument(pool, { sectorId: sector, filename: 'TEST legacy.md', contentBase64: Buffer.from('TEST legacy-only fact 98765').toString('base64'), scope })
    const units = await listDocumentUnits(pool, legacy.id)
    const changeId = randomUUID()
    await pool.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,0,'{}','owner','owner','approved',0,$3,'[]')`,
      [changeId, sector, JSON.stringify({ fileId: legacy.id, hash: legacy.sha256, filename: legacy.filename, ords: units.map((unit) => unit.ord) })])
    await pool.query(`INSERT INTO workspace_files(sector_id,file_id,included,approval_id) VALUES($1,$2,true,$3)
      ON CONFLICT(sector_id,file_id) DO UPDATE SET included=true,approval_id=$3`, [sector, legacy.id, changeId])
    await pool.query(`INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,requested_by) VALUES ($1,$2,$2,$3,$4,'legacy','TEST')`,
      [sector, legacy.id, legacy.sha256, legacy.filename])
    const references = await workspaceReferences(pool, sector, scope)
    expect(references.join('\n')).toContain('TEST legacy-only fact 98765')
  })

  it('skips hidden files and fails changed files without blocking turns', async () => {
    await setFileVisibility(pool, sector, documentId, true, scope)
    const hiddenMarkdown = (await readGlobalContext(pool, sector, scope)).markdown
    expect(hiddenMarkdown).not.toContain('TEST block summary 12,400.')
    await setFileVisibility(pool, sector, documentId, false, scope)
    await pool.query('UPDATE sector_documents SET sha256=$2 WHERE id=$1', [documentId, 'TEST changed sha'])
    await workspaceReferences(pool, sector, scope)
    expect((await readContextFileBlock(pool, sector, documentId))?.state).toBe('failed')
    expect((await readContextFileBlock(pool, sector, documentId))?.error).toBe('file changed')
    expect((await readGlobalContext(pool, sector, scope)).markdown).not.toContain('TEST block summary 12,400.')
  })

  it('applies the first block on a sector with no workspace row yet', async () => {
    const fresh = `sec-blocks-fresh-${STAMP}`
    await createSector(pool, { name: 'Fresh blocks', topic: 'Fresh', scope, sectorId: fresh })
    await projectNewEvents(pool)
    const document = await ingestSectorDocument(pool, { sectorId: fresh, filename: 'TEST fresh.md', contentBase64: Buffer.from('TEST fresh').toString('base64'), scope })
    await pool.query(`INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,requested_by) VALUES ($1,$2,$2,$3,$4,'summarizing','TEST')`,
      [fresh, document.id, document.sha256, document.filename])
    const applied = await applyReadyContextFileBlock(pool, { sectorId: fresh, fileId: document.id, summary: '### TEST fresh.md (MD)\n**Overview.** TEST.', tokens: 8 })
    expect(applied).toEqual({ version: 1 })
    expect((await readGlobalContext(pool, fresh, scope)).version).toBe(1)
  })

  it('A7: removes a file instantly with no AI call', async () => {
    const victim = await ingestSectorDocument(pool, { sectorId: sector, filename: 'TEST victim.md', contentBase64: Buffer.from('TEST victim fact 44556').toString('base64'), scope })
    const units = await listDocumentUnits(pool, victim.id)
    await pool.query(`INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,summary,tokens,requested_by,added_version)
      VALUES ($1,$2,$2,$3,$4,'ready','### TEST victim.md (MD)\n**Overview.** TEST victim summary.',30,'TEST',2)`,
      [sector, victim.id, victim.sha256, victim.filename])
    const oldApproval = randomUUID()
    await pool.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,0,'{}','owner','owner','approved',0,$3,'[]')`,
      [oldApproval, sector, JSON.stringify({ fileId: victim.id, hash: victim.sha256, filename: victim.filename, ords: units.map((unit) => unit.ord) })])
    await pool.query(`INSERT INTO workspace_files(sector_id,file_id,included,approval_id) VALUES($1,$2,true,$3)
      ON CONFLICT(sector_id,file_id) DO UPDATE SET included=true,approval_id=$3`, [sector, victim.id, oldApproval])
    await pool.query(`UPDATE sector_workspace SET section_file_refs=$2::jsonb WHERE sector_id=$1`,
      [sector, JSON.stringify({ findings: [{ fileId: victim.id, hash: victim.sha256, filename: victim.filename, ords: units.map((unit) => unit.ord) }] })])
    const before = (await readGlobalContext(pool, sector, scope)).version
    const started = Date.now()
    const response = await app.inject({ method: 'DELETE', url: `/v1/sectors/${sector}/global-context/files/${victim.id}`, headers: authHeader(KEYS.approver.presented) })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(response.statusCode).toBe(200)
    expect(await readContextFileBlock(pool, sector, victim.id)).toBeUndefined()
    const flags = await pool.query('SELECT included,approval_id FROM workspace_files WHERE sector_id=$1 AND file_id=$2', [sector, victim.id])
    expect(flags.rows[0]).toMatchObject({ included: false, approval_id: null })
    const refs = await pool.query<{ section_file_refs: unknown }>('SELECT section_file_refs FROM sector_workspace WHERE sector_id=$1', [sector])
    expect(JSON.stringify(refs.rows[0]?.section_file_refs ?? {})).not.toContain(victim.id)
    const context = await readGlobalContext(pool, sector, scope)
    expect(context.version).toBe(before + 1)
    expect(context.markdown).not.toContain('TEST victim summary.')
    const history = await pool.query<{ author: string; state: string; file_ref: { fileId: string } }>(
      `SELECT author,state,file_ref FROM workspace_changes WHERE sector_id=$1 AND version=$2`, [sector, before + 1])
    expect(history.rows[0]).toMatchObject({ author: 'owner', state: 'approved' })
    expect(history.rows[0]?.file_ref.fileId).toBe(victim.id)
    await expect(workspaceReferences(pool, sector, scope)).resolves.toBeDefined()
  })

  it('A7: refuses removal without approver authority or a block', async () => {
    const denied = await app.inject({ method: 'DELETE', url: `/v1/sectors/${sector}/global-context/files/${documentId}`, headers: authHeader(KEYS.operator.presented) })
    expect(denied.statusCode).toBe(403)
    const missing = await app.inject({ method: 'DELETE', url: `/v1/sectors/${sector}/global-context/files/no-such-file`, headers: authHeader(KEYS.approver.presented) })
    expect(missing.statusCode).toBe(404)
  })

  it('A7: removing while summarizing cancels the workflow and keeps a late completion out', async () => {
    const racing = await ingestSectorDocument(pool, { sectorId: sector, filename: 'TEST racing.md', contentBase64: Buffer.from('TEST racing').toString('base64'), scope })
    await pool.query(`INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,requested_by) VALUES ($1,$2,$2,$3,$4,'summarizing','TEST')`,
      [sector, racing.id, racing.sha256, racing.filename])
    const cancels = runs.cancelledFileSummaries.length
    const response = await app.inject({ method: 'DELETE', url: `/v1/sectors/${sector}/global-context/files/${racing.id}`, headers: authHeader(KEYS.approver.presented) })
    expect(response.statusCode).toBe(200)
    expect(runs.cancelledFileSummaries.length).toBe(cancels + 1)
    expect(await applyReadyContextFileBlock(pool, { sectorId: sector, fileId: racing.id, summary: 'TEST late racing summary', tokens: 4 })).toBeNull()
    expect(await readContextFileBlock(pool, sector, racing.id)).toBeUndefined()
  })

  it('A8: reports usage that sums to its parts without calling the provider', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/sectors/${sector}/global-context`, headers: authHeader(KEYS.viewer.presented) })
    expect(response.statusCode).toBe(200)
    const usage = response.json().data.usage as { total: number; budget: number; method: string; bySection: Record<string, number>; byFile: Array<{ tokens: number }> }
    expect(usage.method).toBe('estimated')
    expect(usage.budget).toBe(30000)
    expect(usage.total).toBe(
      Object.values(usage.bySection).reduce((sum, tokens) => sum + tokens, 0) + usage.byFile.reduce((sum, file) => sum + file.tokens, 0),
    )
  })

  it('records background AI spend as events that survive file removal', async () => {
    const { recordContextAiUsage, readContextAiUsage, removeContextFileBlock } = await import('../../backend/src/db/index.js')
    const fresh = `sec-spend-${STAMP}`
    await createSector(pool, { name: 'Spend sector', topic: 'Spend', scope, sectorId: fresh })
    await projectNewEvents(pool)
    const document = await ingestSectorDocument(pool, { sectorId: fresh, filename: 'TEST spend.md', contentBase64: Buffer.from('TEST spend').toString('base64'), scope })
    await pool.query(`INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,summary,tokens,requested_by,added_version)
      VALUES ($1,$2,$2,$3,$4,'ready','### TEST spend.md (MD)\n**Overview.** TEST.',30,'TEST',1)`,
      [fresh, document.id, document.sha256, document.filename])
    const fileUsage = { kind: 'file-summary' as const, fileId: document.id, inputTokens: 100, outputTokens: 50, model: 'muse-spark-1.3-contributor' }
    await recordContextAiUsage(pool, { sectorId: fresh, idempotencyKey: `TEST spend file ${STAMP}`, usage: fileUsage, scope })
    await recordContextAiUsage(pool, { sectorId: fresh, idempotencyKey: `TEST spend compaction ${STAMP}`, usage: { kind: 'compaction' as const, inputTokens: 200, outputTokens: 60, model: 'muse-spark-1.3-contributor' }, scope })
    await recordContextAiUsage(pool, { sectorId: fresh, idempotencyKey: `TEST spend file ${STAMP}`, usage: fileUsage, scope })
    expect(await readContextAiUsage(pool, fresh, scope)).toEqual({ calls: 2, inputTokens: 300, outputTokens: 110 })
    expect((await readGlobalContext(pool, fresh, scope)).usage.aiUsage).toEqual({ calls: 2, inputTokens: 300, outputTokens: 110 })
    await removeContextFileBlock(pool, { sectorId: fresh, fileId: document.id, scope })
    expect(await readContextAiUsage(pool, fresh, scope)).toEqual({ calls: 2, inputTokens: 300, outputTokens: 110 })
  })

  it('A9: compaction refuses to touch scope, instructions or files', async () => {
    const { applySystemCompaction } = await import('../../backend/src/db/index.js')
    const seeded = await readGlobalContext(pool, sector, scope)
    await app.inject({
      method: 'PATCH', url: `/v1/sectors/${sector}/global-context`, headers: authHeader(KEYS.approver.presented),
      payload: { baseVersion: seeded.version, sections: { ...seeded.sections, scope: 'TEST compaction scope', instructions: 'TEST compaction instructions' } },
    })
    const current = await readGlobalContext(pool, sector, scope)
    const blocks = await pool.query('SELECT file_id,hash,state FROM context_file_blocks WHERE sector_id=$1', [sector])
    const base = {
      sectorId: sector, baseVersion: current.version, reason: 'manual' as const,
      baseScope: current.sections.scope, baseInstructions: current.sections.instructions,
      baseBlocks: blocks.rows.map((row) => ({ fileId: row.file_id as string, hash: row.hash as string, state: row.state as string })),
      sections: { decisions: 'TEST compacted decisions', findings: 'TEST compacted findings', questions: 'TEST compacted questions' },
    }
    await expect(applySystemCompaction(pool, { ...base, baseScope: 'TEST tampered scope' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(applySystemCompaction(pool, { ...base, baseInstructions: 'TEST tampered instructions' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(applySystemCompaction(pool, { ...base, baseVersion: base.baseVersion + 99 })).rejects.toMatchObject({ code: 'conflict' })
    await expect(applySystemCompaction(pool, { ...base, baseBlocks: [{ fileId: 'TEST ghost', hash: 'x', state: 'ready' }] })).rejects.toMatchObject({ code: 'conflict' })
    expect((await readGlobalContext(pool, sector, scope)).version).toBe(current.version)
    const applied = await applySystemCompaction(pool, base)
    expect(applied.version).toBe(current.version + 1)
    const after = await readGlobalContext(pool, sector, scope)
    expect(after.sections).toMatchObject({ scope: current.sections.scope, instructions: current.sections.instructions, decisions: 'TEST compacted decisions' })
    const history = await pool.query<{ author: string; source_thread: string }>('SELECT author,source_thread FROM workspace_changes WHERE sector_id=$1 AND version=$2', [sector, applied.version])
    expect(history.rows[0]).toEqual({ author: 'system:compaction', source_thread: 'compaction:manual' })
  })

  it('A9: auto trigger fires at 70% and not at 69%', async () => {
    const version = (await readGlobalContext(pool, sector, scope)).version
    const startsBefore = runs.startedCompactions.length
    const below = await app.inject({
      method: 'PATCH', url: `/v1/sectors/${sector}/global-context`, headers: authHeader(KEYS.approver.presented),
      payload: { baseVersion: version, sections: { scope: 's'.repeat(24000), instructions: 'i'.repeat(24000), decisions: '', findings: 'f'.repeat(30000), questions: '' } },
    })
    expect(below.statusCode).toBe(200)
    expect(runs.startedCompactions.length).toBe(startsBefore)
    const version2 = (await readGlobalContext(pool, sector, scope)).version
    expect(version2).toBe(version + 1)
    const full = await app.inject({
      method: 'PATCH', url: `/v1/sectors/${sector}/global-context`, headers: authHeader(KEYS.approver.presented),
      payload: { baseVersion: version2, sections: { scope: 's'.repeat(24000), instructions: 'i'.repeat(24000), decisions: '', findings: 'f'.repeat(36000), questions: '' } },
    })
    expect(full.statusCode).toBe(200)
    expect(runs.startedCompactions.length).toBe(startsBefore + 1)
    expect(runs.startedCompactions.at(-1)).toEqual({ sectorId: sector, reason: 'auto' })
  })

  it('A9: restore brings back an exact prior version', async () => {
    const v1 = await readGlobalContext(pool, sector, scope)
    const v2 = await app.inject({
      method: 'PATCH', url: `/v1/sectors/${sector}/global-context`, headers: authHeader(KEYS.approver.presented),
      payload: { baseVersion: v1.version, sections: { ...v1.sections, findings: 'TEST newer findings overwrite' } },
    })
    expect(v2.statusCode).toBe(200)
    const restored = await app.inject({
      method: 'POST', url: `/v1/sectors/${sector}/global-context/restore`, headers: authHeader(KEYS.approver.presented),
      payload: { version: v1.version },
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().data).toMatchObject({ version: v1.version + 2 })
    expect((await readGlobalContext(pool, sector, scope)).sections).toEqual(v1.sections)
    const unknown = await app.inject({
      method: 'POST', url: `/v1/sectors/${sector}/global-context/restore`, headers: authHeader(KEYS.approver.presented),
      payload: { version: 999999 },
    })
    expect(unknown.statusCode).toBe(404)
  })

  it('A9: manual compact starts the single-flight workflow', async () => {
    const { contextCompactionWorkflowId } = await import('../../backend/src/temporal/runs-gateway.js')
    expect(contextCompactionWorkflowId(sector)).toBe(`context-compaction-${sector}`)
    const starts = runs.startedCompactions.length
    const first = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/compact`, headers: authHeader(KEYS.approver.presented) })
    expect(first.statusCode).toBe(200)
    expect(first.json().data).toEqual({ started: true })
    expect(runs.startedCompactions.length).toBe(starts + 1)
    expect(runs.startedCompactions.at(-1)).toEqual({ sectorId: sector, reason: 'manual' })
    const denied = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/global-context/compact`, headers: authHeader(KEYS.operator.presented) })
    expect(denied.statusCode).toBe(403)
  })

  it('A10: rewrite starts a tracked chat with the rewrite purpose and first message', async () => {
    const instruction = 'Give equal weight to commercial customers in every section of the context.'
    const response = await app.inject({
      method: 'POST', url: `/v1/sectors/${sector}/global-context/rewrite`, headers: authHeader(KEYS.approver.presented),
      payload: { instruction },
    })
    expect(response.statusCode).toBe(200)
    const sessionId = (response.json().data as { sessionId: string }).sessionId
    const { getSession } = await import('../../backend/src/db/index.js')
    const created = await getSession(pool, sessionId, scope)
    expect(created?.title).toBe(`Context rewrite: ${instruction.slice(0, 40)}`)
    expect(created?.sectorId).toBe(sector)
    const settings = await pool.query<{ purpose: string }>('SELECT purpose FROM session_settings WHERE session_id=$1', [sessionId])
    expect(settings.rows[0]?.purpose).toBe('context-rewrite')
    expect(runs.signals).toContainEqual({ workflowId: `session-run-${sessionId}`, signal: 'runSend', args: [`Rewrite the global context: ${instruction}`] })
    const denied = await app.inject({
      method: 'POST', url: `/v1/sectors/${sector}/global-context/rewrite`, headers: authHeader(KEYS.operator.presented),
      payload: { instruction: 'TEST' },
    })
    expect(denied.statusCode).toBe(403)
    const empty = await app.inject({
      method: 'POST', url: `/v1/sectors/${sector}/global-context/rewrite`, headers: authHeader(KEYS.approver.presented),
      payload: { instruction: '' },
    })
    expect(empty.statusCode).toBe(400)
  })

  it('drops a late completion after the block is gone', async () => {
    const late = await ingestSectorDocument(pool, { sectorId: sector, filename: 'TEST late.md', contentBase64: Buffer.from('TEST late').toString('base64'), scope })
    await pool.query(`INSERT INTO context_file_blocks (sector_id,file_id,document_id,hash,filename,state,requested_by) VALUES ($1,$2,$2,$3,$4,'summarizing','TEST')`,
      [sector, late.id, late.sha256, late.filename])
    const before = (await readGlobalContext(pool, sector, scope)).version
    await pool.query('DELETE FROM context_file_blocks WHERE sector_id=$1 AND file_id=$2', [sector, late.id])
    expect(await applyReadyContextFileBlock(pool, { sectorId: sector, fileId: late.id, summary: 'TEST late summary', tokens: 5 })).toBeNull()
    expect((await readGlobalContext(pool, sector, scope)).version).toBe(before)
    expect(await readContextFileBlock(pool, sector, late.id)).toBeUndefined()
  })
})
