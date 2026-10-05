// Policy regressions over actual MCP/HTTP + isolated Postgres. No live provider.
import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, beginThreadTurn, finishSteering, getThread, createArtifact, createSession, findEventByKey, listSectorLibrary, referenceArtifact, createSector, ensureResearchSession, ingestSectorDocument, readGlobalContext, readThreadContext, readTurnContinuation, registerApiKey, saveTurnContinuation, saveThreadContext, setFileVisibility, workspaceReferences } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { resolveArchiveTarget, type ArchiveTarget } from '../../backend/src/archive/targets.js'
import { executeToolCall, type RecordedToolCall } from '../../backend/src/temporal/activities/tools.js'
import { ContextFileBlocked, inheritThreadFileRefs, threadFileRefs } from '../../backend/src/db/context-files.js'
import { localContextMessages } from '../../backend/src/context.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const FILE_TEXT = 'TEST uploaded business evidence: Australian plumbing SME dispatch delay finding, original file-only fact.'
describe.skipIf(!TEST_DATABASE_URL)('file-derived context promotion authority [F:http.previewContextProposal] [F:http.decideContextProposal] [F:http.rebuildLocalContext] [F:http.mcpRpc] [F:backend.activity.tools.executeToolCall] [F:backend.activity.tools.DEFAULT_TOOL_TIMEOUT_MS] [F:backend.activity.tools.SENSITIVE_TOOLS] [F:backend.activity.turn.sleep] [F:db.index.appendEvent] [F:db.index.createSector] [F:db.index.createSession] [F:db.index.registerApiKey] [F:db.index.findEventByKey] [F:db.workspace.ensureResearchSession] [F:db.index.ingestSectorDocument] [F:db.workspace_global_context.readGlobalContext] [F:db.workspace_global_context.setFileVisibility] [F:db.workspace_research.workspaceReferences] [F:db.workspace_threads.beginThreadTurn] [F:db.workspace_threads.finishSteering] [F:db.index.getThread] [F:db.workspace_threads.readThreadContext] [F:db.workspace_threads.readTurnContinuation] [F:db.workspace_threads.saveThreadContext] [F:db.workspace_threads.saveTurnContinuation] [F:db.index.referenceArtifact] [F:db.keys.registerApiKey] [F:db.index.createArtifact] [F:db.sectors.createSector] [F:db.context_files.ContextFileBlocked] [F:db.context_files.inheritThreadFileRefs] [F:db.context_files.threadFileRefs] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.events.findEventByKey] [F:db.threads.getThread] [F:db.event_artifacts.referenceArtifact] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.workspace.ContextFileRef] [F:db.context_files.assertThreadFileContext] [F:db.context_files.listContextFileBlocks] [F:db.context_files.markContextFileBlockFailed] [F:db.context_files.mergeFileRefs] [F:db.context_files.recordThreadFileExposure] [F:db.context_files.validateFileRefs] [F:db.document_units.listDocumentUnitOrdinals] [F:db.errors.ArtifactImportTimeout] [F:db.errors.WorkspaceError] [F:db.execution_epochs.bindExecutionEpoch] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.workspace_global_context.assertGlobalFileContext] [F:db.workspace_global_context.previewContextChange] [F:db.workspace_threads.rebuildThreadContext] [F:db.workspace.requireSector] [F:db.workspace.requireThread] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked] [F:db.workspace.globalContextUsageFrom] [F:db.workspace.workspaceRow] [F:db.file_jobs.visible] [F:db.events.KeySchema]', () => {
  let pool: Pool, app: FastifyInstance
  const scope = { tenantId: 'TEST file promotion tenant', projectId: null }
  const token = 'TEST file promotion execution credential'
  const ownerToken = 'TEST file promotion owner credential'
  let nonce = 0
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_file_provenance'), max: 5 })
    vi.stubEnv('KARDATA_MCP_TOKEN', token)
    vi.stubEnv('KARDATA_GCS_BUCKET', '')
    vi.stubEnv('KARDATA_ARCHIVE_DIR', mkdtempSync(join(tmpdir(), 'kardata-file-provenance-')))
    await registerApiKey(pool, { keyId: 'TEST provenance key', keyHash: hashKey(token), scope, role: 'operator' })
    await registerApiKey(pool, { keyId: 'TEST provenance owner key', keyHash: hashKey(ownerToken), scope, role: 'approver' })
    app = buildApp({ pool, auth: true })
  })
  afterAll(async () => { await app?.close(); await pool?.end(); vi.unstubAllEnvs() })
  async function fixture() {
    const sectorId = (await createSector(pool, { name: 'TEST Australian plumbing sector', topic: 'Australian plumbing SMEs', scope })).sectorId
    await projectNewEvents(pool)
    const research = (await ensureResearchSession(pool, sectorId, scope)).id
    await projectNewEvents(pool)
    const document = await ingestSectorDocument(pool, { sectorId, filename: 'TEST unapproved evidence.md', contentBase64: Buffer.from(FILE_TEXT).toString('base64'), scope })
    return { sectorId, research, document }
  }
  async function call(thread: string, name: string, args: unknown, denied = false) {
    const response = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, 'x-kardata-thread': thread, 'x-kardata-execution': createHmac('sha256', token).update(thread).digest('hex') }, payload: { jsonrpc: '2.0', id: ++nonce, method: 'tools/call', params: { name, arguments: args } } })
    expect(response.statusCode).toBe(200)
    const result = response.json().result as { isError?: boolean; content: Array<{ text: string }> }
    if (denied) { expect(result.isError).toBe(true); return { error: true, text: result.content[0]?.text } }
    expect(result.isError, result.content[0]?.text).not.toBe(true)
    return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
  }
  it('requires owner review when a research parent reads an unapproved file then promotes its text without fileRef', async () => {
    const { sectorId, research, document } = await fixture()
    const read = await call(research, 'db.read_sector_document', { sectorId, documentId: document.id })
    expect(read.text).toBe(FILE_TEXT)
    const current = await readGlobalContext(pool, sectorId, scope)
    const proposal = await call(research, 'db.propose_global_context', { baseVersion: current.version, sections: { ...current.sections, findings: read.text }, idempotencyKey: 'TEST derived finding' })
    expect(proposal.state).toBe('pending')
    expect((await readGlobalContext(pool, sectorId, scope)).sections.findings).not.toContain(FILE_TEXT)
  })
  it('does not include hidden file-derived text in subsequently assembled global references', async () => {
    const { sectorId, research, document } = await fixture()
    const read = await call(research, 'db.read_sector_document', { sectorId, documentId: document.id })
    const current = await readGlobalContext(pool, sectorId, scope)
    const proposal = await call(research, 'db.propose_global_context', { baseVersion: current.version, sections: { ...current.sections, findings: read.text }, idempotencyKey: 'TEST hidden derived finding' })
    const approved = await app.inject({ method: 'POST', url: `/v1/sectors/${sectorId}/global-context/proposals/${proposal.id}/decision`, headers: { authorization: `Bearer ${ownerToken}` }, payload: { approve: true } })
    expect(approved.statusCode).toBe(200)
    expect((await readGlobalContext(pool, sectorId, scope)).sections.findings).toContain(FILE_TEXT)
    await setFileVisibility(pool, sectorId, document.id, true, scope)
    await expect(workspaceReferences(pool, sectorId, scope)).rejects.toBeInstanceOf(ContextFileBlocked)
    const reread = await call(research, 'db.get_global_context', {}, true)
    expect(JSON.stringify(reread)).not.toContain(FILE_TEXT)
  })
  it('does not reuse a durable local summary derived from a subsequently hidden file', async () => {
    const { sectorId, research, document } = await fixture()
    const read = await call(research, 'db.read_sector_document', { sectorId, documentId: document.id })
    const local = await readThreadContext(pool, research, scope)
    // Same durable save seam used by the production automatic-summary callback.
    await saveThreadContext(pool, research, { version: local.version, summary: read.text as string, coveredSeq: 0 }, scope)
    await setFileVisibility(pool, sectorId, document.id, true, scope)
    await expect(localContextMessages(pool, research, scope)).rejects.toBeInstanceOf(ContextFileBlocked)
    expect((await readThreadContext(pool, research, scope)).summary).toBe(FILE_TEXT)
    expect((await readThreadContext(pool, research, scope)).contextBlocked).toContain('Reveal')
  })
  it('tracks only returned query units and pins them for owner review and stale visibility checks', async () => {
    const { sectorId, research } = await fixture()
    const document = await ingestSectorDocument(pool, { sectorId, filename: 'TEST multi-unit evidence.md', contentBase64: Buffer.from('TEST first unit '.repeat(220) + '\n\n' + 'TEST second unit '.repeat(220)).toString('base64'), scope })
    const result = await call(research, 'db.query_document', { sectorId, documentId: document.id, mode: 'chunks', ords: [1] })
    expect(result.units).toEqual([expect.objectContaining({ ord: 1 })])
    const current = await readGlobalContext(pool, sectorId, scope)
    const proposal = await call(research, 'db.propose_global_context', { baseVersion: current.version, sections: { ...current.sections, findings: 'TEST finding derived from selected source units' }, idempotencyKey: 'TEST selected unit finding' })
    expect(proposal).toMatchObject({ state: 'pending', sourceRefs: [{ readSectorId: sectorId, fileId: document.id, hash: document.sha256, filename: document.filename, ords: [1] }] })
    const preview = await app.inject({ method: 'GET', url: `/v1/sectors/${sectorId}/global-context/proposals/${proposal.id}`, headers: { authorization: `Bearer ${ownerToken}` } })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().data.sources).toEqual([expect.objectContaining({ units: [expect.objectContaining({ ord: 1 })] })])
    await setFileVisibility(pool, sectorId, document.id, true, scope)
    const approve = await app.inject({ method: 'POST', url: `/v1/sectors/${sectorId}/global-context/proposals/${proposal.id}/decision`, headers: { authorization: `Bearer ${ownerToken}` }, payload: { approve: true } })
    expect(approve.statusCode).toBe(409)
    expect((await readGlobalContext(pool, sectorId, scope)).sections.findings).toBe('')
  })
  it('snapshots parent brief exposures once and routes derived child findings to the owner', async () => {
    const { sectorId, research, document } = await fixture()
    await call(research, 'db.read_sector_document', { sectorId, documentId: document.id })
    const childId = `TEST-child-${++nonce}`
    const child = `agent:${childId}`
    await appendEvent(pool, { idempotencyKey: childId, partition: `session:${research}`, type: 't.subagent.launched', payload: { sessionId: research, parentSessionId: research, childId, name: 'TEST source-aware child', canDelegate: false } })
    await projectNewEvents(pool)
    await beginThreadTurn(pool, child, 'TEST inherited operation')
    await inheritThreadFileRefs(pool, child, scope)
    await finishSteering(pool, child, 'TEST inherited operation')
    const later = await ingestSectorDocument(pool, { sectorId, filename: 'TEST later parent-only file.md', contentBase64: Buffer.from('TEST later parent-only source').toString('base64'), scope })
    await call(research, 'db.read_sector_document', { sectorId, documentId: later.id })
    expect((await threadFileRefs(pool, child, scope)).map((ref) => ref.fileId)).toEqual([document.id])
    const current = await readGlobalContext(pool, sectorId, scope)
    const proposal = await call(child, 'db.propose_global_context', { baseVersion: current.version, sections: { ...current.sections, findings: 'TEST derived child finding' }, idempotencyKey: 'TEST child derived finding' })
    expect(proposal.state).toBe('pending')
    const denied = await call(research, 'db.commit_child_context', { proposalId: proposal.id }, true)
    expect(denied.text).toContain('owner approval')
  })
  it('parks changed file versions instead of rebinding old context to new bytes', async () => {
    const { sectorId, research, document } = await fixture()
    await call(research, 'db.read_sector_document', { sectorId, documentId: document.id })
    await pool.query('UPDATE sector_documents SET sha256=$2 WHERE id=$1', [document.id, 'TEST changed source version hash'])
    await expect(localContextMessages(pool, research, scope)).rejects.toBeInstanceOf(ContextFileBlocked)
    expect((await threadFileRefs(pool, research, scope))[0]?.hash).toBe(document.sha256)
  })
  it('requires explicit approver rebuild, preserves original operation metadata and excludes old agent history', async () => {
    const { research } = await fixture()
    await appendEvent(pool, { idempotencyKey: `TEST legacy transcript ${research}`, partition: `session:${research}`, type: 't.message.appended', payload: { threadKey: research, kind: 'text', message: { role: 'agent', text: FILE_TEXT } } })
    await projectNewEvents(pool)
    await pool.query(`INSERT INTO thread_context(thread_key,summary) VALUES($1,$2) ON CONFLICT(thread_key) DO UPDATE SET summary=$2,summary_file_refs=NULL`, [research, FILE_TEXT])
    const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 }
    await saveTurnContinuation(pool, research, { user: 'TEST retain original task', runKey: 'TEST original durable operation', messages: [{ role: 'assistant', text: FILE_TEXT }], sources: [{ url: 'https://example.com', key: 'TEST original archive key', hash: 'TEST original hash' }], meta: { round: 2, usage, toolCalls: 1, elapsedMs: 123 } })
    const previous = await readTurnContinuation(pool, research)
    const local = await readThreadContext(pool, research, scope)
    expect(local.contextBlocked).toContain('legacy')
    const path = `/v1/threads/${encodeURIComponent(research)}/context/rebuild`
    const payload = { version: local.version, summary: 'TEST independent owner recap: preserve task and unresolved questions', independent: true }
    expect((await app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${ownerToken}` }, payload: { ...payload, version: 99 } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${ownerToken}` }, payload: { ...payload, summary: ' ' } })).statusCode).toBe(400)
    const lease = await beginThreadTurn(pool, research, 'TEST active operation')
    expect((await app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${ownerToken}` }, payload })).statusCode).toBe(409)
    await finishSteering(pool, research, 'TEST active operation', lease)
    const rebuilt = await app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${ownerToken}` }, payload })
    expect(rebuilt.statusCode).toBe(200)
    const saved = await readTurnContinuation(pool, research)
    expect(saved).toMatchObject({ user: previous!.user, runKey: previous!.runKey, sources: previous!.sources, meta: previous!.meta })
    expect(saved?.messages).toEqual([expect.objectContaining({ text: payload.summary })])
    expect((await localContextMessages(pool, research, scope)).messages.map((message) => message.text).join('\n')).not.toContain(FILE_TEXT)
    expect(JSON.stringify(await getThread(pool, research))).toContain(FILE_TEXT)
    expect(JSON.stringify(await call(research, 'db.get_thread', { threadKey: research }))).not.toContain(FILE_TEXT)
    expect(JSON.stringify(await call(research, 'db.read_outbox', { threadKey: research, afterSeq: 0 }))).not.toContain(FILE_TEXT)
    expect(await call(research, 'db.get_local_context', {})).not.toHaveProperty('task')
  })
  it('cannot rebuild away source lineage beneath an unresolved mutation receipt', async () => {
    const { sectorId, research, document } = await fixture()
    await call(research, 'db.read_sector_document', { sectorId, documentId: document.id })
    const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 }
    await saveTurnContinuation(pool, research, { user: 'TEST unresolved task', runKey: 'TEST unresolved operation', messages: [{ role: 'assistant', text: FILE_TEXT }], sources: [], meta: { round: 1, usage, toolCalls: 1, elapsedMs: 11, blockedOperations: [{ operationId: 'TEST original mutation', authorityId: 'TEST authority', reason: 'TEST result lost', call: { id: 'TEST call', name: 'db.propose_global_context', args: { findings: FILE_TEXT } } }] } })
    await setFileVisibility(pool, sectorId, document.id, true, scope)
    const previous = await readTurnContinuation(pool, research)
    const local = await readThreadContext(pool, research, scope)
    const response = await app.inject({ method: 'POST', url: `/v1/threads/${encodeURIComponent(research)}/context/rebuild`, headers: { authorization: `Bearer ${ownerToken}` }, payload: { version: local.version, summary: 'TEST replacement cannot authorize original hidden arguments', independent: true } })
    expect(response.statusCode).toBe(409)
    expect(await readTurnContinuation(pool, research)).toEqual(previous)
    expect((await threadFileRefs(pool, research, scope))[0]?.hash).toBe(document.sha256)
  })

  it('records generated-file exposures and rechecks hidden visibility instead of replaying cached artifact bytes', async () => {
    const { sectorId, research } = await fixture()
    const artifact = await createArtifact(pool, { sessionId: research, name: 'TEST generated knowledge.md', content: FILE_TEXT, scope })
    const state: { cached?: RecordedToolCall } = {}
    const deps = { log: () => undefined, findRecorded: async () => state.cached, record: async (event: { idempotencyKey: string; partition: string; type: string; payload: Record<string, unknown> }) => { await appendEvent(pool, event) }, artifacts: { db: pool, target: resolveArchiveTarget() } }
    const input = { sessionId: research, idempotencyKey: `TEST generated read ${research}`, call: { id: 'TEST artifact call', name: 'artifact.read', args: { artifactId: artifact.artifactId } } }
    state.cached = await executeToolCall(input, deps)
    expect(state.cached.result).toMatchObject({ isError: false, content: FILE_TEXT })
    expect((await threadFileRefs(pool, research, scope))[0]).toMatchObject({ fileId: artifact.artifactId, readSectorId: sectorId, ords: [0] })
    await setFileVisibility(pool, sectorId, artifact.artifactId, true, scope)
    const blocked = await executeToolCall(input, deps)
    expect(blocked.result.isError).toBe(true)
    expect(blocked.result.content).not.toContain(FILE_TEXT)
  })
  it('imports verified file bytes and units into the target library with independent visibility and provenance', async () => {
    const source = await createSession(pool, 'TEST Karbot source files', scope)
    const { sectorId, research } = await fixture()
    const other = await fixture()
    const artifact = await createArtifact(pool, { sessionId: source.id, name: 'TEST imported knowledge.md', content: FILE_TEXT, scope })
    for (const target of [research, other.research]) {
      const imported = await app.inject({ method: 'POST', url: `/v1/sessions/${target}/artifacts/references`, headers: { authorization: `Bearer ${token}` }, payload: { artifactId: artifact.artifactId, fromScope: { kind: 'session', id: source.id } } })
      expect(imported.statusCode).toBe(201)
      expect(imported.json().data).toMatchObject({ indexed: true, referencedFrom: { kind: 'session', id: source.id } })
    }
    const file = (await listSectorLibrary(pool, sectorId, scope)).find((entry) => entry.id === artifact.artifactId)!
    expect(file.status).toBe('indexed'); expect(file.documentId).toBeTruthy()
    const read = await call(research, 'db.read_sector_document', { sectorId, documentId: file.documentId })
    expect(read.text).toBe(FILE_TEXT)
    expect((await threadFileRefs(pool, research, scope))[0]).toMatchObject({ fileId: artifact.artifactId, readSectorId: sectorId, ords: [0] })
    await setFileVisibility(pool, other.sectorId, artifact.artifactId, true, scope)
    await expect(localContextMessages(pool, research, scope)).resolves.toBeDefined()
    await setFileVisibility(pool, sectorId, artifact.artifactId, true, scope)
    await expect(localContextMessages(pool, research, scope)).rejects.toBeInstanceOf(ContextFileBlocked)
    expect((await listSectorLibrary(pool, other.sectorId, scope)).find((entry) => entry.id === artifact.artifactId)?.hidden).toBe(true)
  })
  it('bounds hung archive imports and does not publish a phantom destination reference', async () => {
    const source = await createSession(pool, 'TEST import timeout source', scope)
    const { sectorId, research } = await fixture()
    const artifact = await createArtifact(pool, { sessionId: source.id, name: 'TEST delayed import.md', content: FILE_TEXT, scope })
    let aborted = false
    const blockedArchive: ArchiveTarget = { write: async () => { throw new Error('TEST no writes expected') }, list: async () => [], read: async (_key, _cap, signal) => new Promise((_resolve, reject) => { signal?.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true }) }) }
    await expect(referenceArtifact(pool, { artifactId: artifact.artifactId, fromScope: { kind: 'session', id: source.id }, toSessionId: research, scope }, blockedArchive, 100)).rejects.toMatchObject({ code: 'artifact_import_timeout' })
    expect(aborted).toBe(true)
    expect((await listSectorLibrary(pool, sectorId, scope)).some((entry) => entry.id === artifact.artifactId)).toBe(false)
    expect(await findEventByKey(pool, `artifact-referenced:${research}:${artifact.artifactId}`)).toBeUndefined()
  })

})
