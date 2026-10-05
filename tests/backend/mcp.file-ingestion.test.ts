// Unit transport/orchestration doubles. No live DB, provider or Temporal claim.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachSectorDocument, FileIngestionUnavailable } from '../../backend/src/file-ingestion.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import { type McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { testPdf } from './pdf-fixtures.js'
import type { ArchiveTarget } from '../../backend/src/archive/targets.js'
import { buildApp } from '../../backend/src/app.js'
import type { RunsGateway } from '../../backend/src/temporal/runs-gateway.js'

const fixture = vi.hoisted(() => ({ state: 'queued', status: 'processing', units: 0, errorCode: null as string | null, create: vi.fn(), read: vi.fn(), fail: vi.fn(), list: vi.fn(), count: vi.fn(), ingest: vi.fn(), thread: vi.fn() }))
vi.mock('../../backend/src/db/index.js', async (original) => {
  const actual = await original<typeof import('../../backend/src/db/index.js')>()
  return { ...actual, createFileProcessingJob: fixture.create, readFileProcessingJob: fixture.read, failFileProcessingJob: fixture.fail, listSectorDocuments: fixture.list, countDocumentUnits: fixture.count, ingestSectorDocument: fixture.ingest, requireThread: fixture.thread }
})
vi.mock('../../backend/src/projector.js', async (original) => ({ ...await original<typeof import('../../backend/src/projector.js')>(), projectNewEvents: vi.fn(async () => undefined) }))
const fileId = 'sdoc-' + 'a'.repeat(48), jobId = 'fjob-' + 'a'.repeat(48)
const document = () => ({ id: fileId, sectorId: 'TEST sector', filename: 'TEST retained.pdf', mediaType: 'application/pdf', chars: fixture.status === 'indexed' ? 99 : 0, sha256: 'a'.repeat(64), createdAt: '2026-10-01T00:00:00Z', status: fixture.status, unitCount: fixture.units })
const job = () => ({ jobId, state: fixture.state, revision: 0, totalImages: fixture.state === 'complete' ? 0 : null, completedImages: 0, failedImages: 0, uncertainImages: 0, errorCode: fixture.errorCode, retryRequiresApproval: fixture.errorCode === 'dispatch_outcome_unknown' })
const upload = { sectorId: 'TEST sector', filename: 'TEST retained.pdf', contentBase64: testPdf(true).toString('base64') }
const archive: ArchiveTarget = { write: vi.fn(async () => undefined), read: vi.fn(async () => undefined), list: vi.fn(async () => []) }
function context(): McpToolContext {
  return { pool: { query: vi.fn(async () => { throw new Error('TEST unexpected database access') }), connect: vi.fn(async () => { throw new Error('TEST unexpected transaction') }) }, scope: undefined, role: 'operator', keyId: 'TEST key' }
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.state = 'queued'; fixture.status = 'processing'; fixture.units = 0; fixture.errorCode = null
  fixture.create.mockImplementation(async () => ({ document: document(), job: job() }))
  fixture.read.mockImplementation(async () => job())
  fixture.list.mockImplementation(async () => [document()])
  fixture.count.mockImplementation(async () => fixture.units)
  fixture.ingest.mockResolvedValue({ id: 'TEST legacy file', status: 'indexed' })
  fixture.fail.mockImplementation(async (_db, _job, code: string) => { fixture.state = 'failed'; fixture.status = 'failed'; fixture.errorCode = code })
  fixture.thread.mockImplementation(async () => ({ thread: { key: 'agent:TEST actual child', kind: 'subagent' }, session: { id: 'TEST research parent', sectorId: 'TEST sector' } }))
})
describe('MCP full-PDF attachment capability', () => {
  it('fails PDF attachment before any database/archive mutation when its runner is missing', async () => {
    const ctx = context()
    await expect(invokeTool('db.attach_sector_document', ctx, upload)).rejects.toMatchObject({ wireCode: 'unconfigured' })
    expect(ctx.pool.query).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled(); expect(fixture.ingest).not.toHaveBeenCalled(); expect(archive.write).not.toHaveBeenCalled()
  })
  it('fails PDF attachment before effects when its archive capability is missing', async () => {
    const ctx = { ...context(), fileProcessor: { startFileProcessing: vi.fn(async () => undefined) } }
    await expect(invokeTool('db.attach_sector_document', ctx, upload)).rejects.toMatchObject({ wireCode: 'unconfigured' })
    expect(fixture.create).not.toHaveBeenCalled(); expect(ctx.fileProcessor.startFileProcessing).not.toHaveBeenCalled()
  })
  it('does not bypass PDF admission by labeling PDF bytes as a markdown file', async () => {
    await expect(invokeTool('db.attach_sector_document', context(), { ...upload, filename: 'TEST deceptive.md' })).rejects.toMatchObject({ wireCode: 'unconfigured' })
    expect(fixture.ingest).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled()
  })
  it('rejects empty-decoded and oversized PDF content before any file effect', async () => {
    const ctx = { ...context(), archive, fileProcessor: { startFileProcessing: vi.fn(async () => undefined) } }
    for (const contentBase64 of ['!!!', Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')]) await expect(invokeTool('db.attach_sector_document', ctx, { ...upload, contentBase64 })).rejects.toMatchObject({ code: 'db_contract' })
    expect(fixture.create).not.toHaveBeenCalled(); expect(fixture.ingest).not.toHaveBeenCalled(); expect(ctx.fileProcessor.startFileProcessing).not.toHaveBeenCalled()
  })
  it('queues the shared semantic operation and returns honest progress without inline legacy/provider extraction', async () => {
    const startFileProcessing = vi.fn(async () => undefined), ctx = { ...context(), archive, fileProcessor: { startFileProcessing } }
    const result = await invokeTool('db.attach_sector_document', ctx, upload)
    expect(result).toMatchObject({ id: fileId, status: 'processing', unitCount: 0, processing: { jobId, state: 'queued', totalImages: null } })
    expect(startFileProcessing).toHaveBeenCalledExactlyOnceWith(jobId, 0)
    expect(fixture.ingest).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('archiveKey')
  })
  it('uses only the validated execution thread as provenance and refuses a bound child foreign sector', async () => {
    const ctx = { ...context(), executionThread: 'agent:TEST actual child', archive, fileProcessor: { startFileProcessing: vi.fn(async () => undefined) } }
    await invokeTool('db.attach_sector_document', ctx, { ...upload, sourceThread: 'TEST forged owner', owner: true })
    expect(fixture.create).toHaveBeenCalledWith(ctx.pool, expect.objectContaining({ sourceThread: ctx.executionThread, sectorId: upload.sectorId }))
    fixture.create.mockClear()
    await expect(invokeTool('db.attach_sector_document', ctx, { ...upload, sectorId: 'TEST foreign sector' })).rejects.toMatchObject({ code: 'permission_denied' })
    expect(fixture.create).not.toHaveBeenCalled()
  })
  it('keeps role and grant authority before file effects', async () => {
    const ctx = { ...context(), archive, fileProcessor: { startFileProcessing: vi.fn(async () => undefined) } }
    await expect(invokeTool('db.attach_sector_document', { ...ctx, role: 'viewer' }, upload)).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(invokeTool('db.attach_sector_document', ctx, upload, { allow: new Set(['db.list_sectors']) })).rejects.toMatchObject({ code: 'permission_denied' })
    expect(fixture.create).not.toHaveBeenCalled()
  })
  it('keeps non-PDF legacy attachment behavior and needs no new runner capability', async () => {
    const ctx = context(), text = { ...upload, filename: 'TEST notes.md', contentBase64: Buffer.from('TEST text').toString('base64') }
    expect(await invokeTool('db.attach_sector_document', ctx, text)).toMatchObject({ status: 'indexed' })
    expect(fixture.ingest).toHaveBeenCalledOnce(); expect(fixture.create).not.toHaveBeenCalled()
  })
})
describe('shared attachment current-state response', () => {
  it('uses the identical processing contract through actual HTTP and MCP transports', async () => {
    const ctx = context(), startFileProcessing = vi.fn(async () => undefined)
    const app = buildApp({ pool: ctx.pool, runs: { startFileProcessing } as unknown as RunsGateway, archiveTarget: archive, auth: false, rateLimitPerMin: 0 })
    try {
      const http = await app.inject({ method: 'POST', url: '/v1/sectors/TEST%20sector/documents', payload: { filename: upload.filename, contentBase64: upload.contentBase64 } })
      expect(http.statusCode).toBe(201)
      const rpc = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'db.attach_sector_document', arguments: upload } } })
      expect(rpc.statusCode).toBe(200)
      expect(JSON.parse(rpc.json().result.content[0].text)).toEqual(http.json().data)
      expect(http.json().data).toMatchObject({ status: 'processing', processing: { state: 'queued' } })
      expect(fixture.ingest).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('keeps concurrent admissions pinned to the same durable job/revision without inline extraction', async () => {
    const ctx = context(), startFileProcessing = vi.fn(async () => undefined)
    const results = await Promise.all(Array.from({ length: 6 }, () => invokeTool('db.attach_sector_document', { ...ctx, archive, fileProcessor: { startFileProcessing } }, upload)))
    expect(results.every((result) => (result as { id: string }).id === fileId)).toBe(true)
    expect(startFileProcessing.mock.calls).toEqual(Array.from({ length: 6 }, () => [jobId, 0]))
    expect(fixture.ingest).not.toHaveBeenCalled()
  })
  it('returns stored failed status after dispatch failure instead of its initial processing snapshot', async () => {
    const ctx = context(), fileProcessor = { startFileProcessing: vi.fn(async () => { throw new Error('TEST dispatch failure body') }) }
    const result = await attachSectorDocument(ctx.pool, { ...upload, archive, fileProcessor })
    expect(result).toMatchObject({ status: 'failed', unitCount: 0, processing: { state: 'failed', errorCode: 'dispatch_outcome_unknown', retryRequiresApproval: true } })
    expect(fixture.fail).toHaveBeenCalledWith(ctx.pool, jobId, 'dispatch_outcome_unknown', 0, undefined)
  })
  it('reports fast completion using actual stored units and skips redispatch of completed work', async () => {
    fixture.state = 'complete'; fixture.status = 'indexed'; fixture.units = 7
    const ctx = context(), fileProcessor = { startFileProcessing: vi.fn(async () => undefined) }
    expect(await attachSectorDocument(ctx.pool, { ...upload, archive, fileProcessor })).toMatchObject({ status: 'indexed', unitCount: 7, chars: 99, processing: { state: 'complete' } })
    expect(fileProcessor.startFileProcessing).not.toHaveBeenCalled()
  })
  it('checks capabilities and malformed/overbudget input before job creation', async () => {
    const ctx = context()
    await expect(attachSectorDocument(ctx.pool, { ...upload, archive })).rejects.toBeInstanceOf(FileIngestionUnavailable)
    await expect(attachSectorDocument(ctx.pool, { ...upload, filename: '' })).rejects.toMatchObject({ code: 'db_contract' })
    await expect(attachSectorDocument(ctx.pool, { ...upload, contentBase64: 'A'.repeat(12 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'db_contract' })
    expect(fixture.create).not.toHaveBeenCalled()
  })
})
