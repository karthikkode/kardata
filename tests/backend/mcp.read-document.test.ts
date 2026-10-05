// MCP document read-back: attaching a context document must let a worker
// quote its text back through the tool boundary. Live DB, gated on
// TEST_DATABASE_URL like the other sector suites.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, DbContractError, ingestSectorDocument } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import { McpToolError } from '../../backend/src/mcp/tools-types.js'
import { productMcpClient, sectorMcpClient } from '../../backend/src/temporal/activities/turn-palettes.js'
import type { TurnRunnerMcpClient } from '@kardata/agents'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

describe.skipIf(!ENABLED)('mcp document read-back [F:backend.activity.turn_palettes.productMcpClient] [F:backend.activity.turn_palettes.sectorMcpClient] [F:backend.activity.tools.SENSITIVE_TOOLS] [F:backend.activity.turn_palettes.PRODUCT_TOOLS] [F:db.index.createSector] [F:db.index.ingestSectorDocument] [F:db.index.DbContractError] [F:db.sectors.createSector] [F:db.errors.DbContractError] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.company_ledger.LedgerQualification] [F:db.company_ledger.RecordProblemInput] [F:db.company_ledger.UpsertCompanyInput] [F:db.workspace.ContextFileRef] [F:db.context_files.agentHistoryBoundary] [F:db.context_files.assertThreadFileContext] [F:db.context_files.mergeFileRefs] [F:db.context_files.recordThreadFileExposure] [F:db.context_files.validateFileRefs] [F:db.document_units.listDocumentUnitOrdinals] [F:db.errors.WorkspaceError] [F:db.sessions.deleteSession] [F:db.events.findLaunchParentWorkflowId] [F:db.sessions.renameSession] [F:db.index.CompanyStage] [F:db.index.Db] [F:db.index.LedgerQualification] [F:db.index.RecordProblemInput] [F:db.index.SectorStartError] [F:db.index.SectorState] [F:db.index.SectorSweepRunner] [F:db.index.SectorTransitionError] [F:db.index.StoredEvent] [F:db.index.ThreadMessenger] [F:db.index.TransactableDb] [F:db.index.UpsertCompanyInput] [F:db.index.cancelThreadRun] [F:db.index.deleteSession] [F:db.index.findLaunchParentWorkflowId] [F:db.index.pauseSectorSweep] [F:db.index.pauseThreadRun] [F:db.index.readSectorThread] [F:db.index.renameSession] [F:db.index.resumeSectorSweep] [F:db.index.resumeThreadRun] [F:db.index.sendThreadMessage] [F:db.index.startSectorResearch] [F:db.index.steerThread] [F:db.index.subscribeOutbox] [F:db.sectors.CompanyStage] [F:db.sectors.SectorState] [F:db.threads.cancelThreadRun] [F:db.threads.pauseThreadRun] [F:db.threads.readSectorThread] [F:db.threads.resumeThreadRun] [F:db.threads.sendThreadMessage] [F:db.threads.steerThread] [F:db.workspace.PartialContextSections] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.workspace_global_context.assertGlobalFileContext] [F:db.workspace.listSectorSessions] [F:db.workspace.requireSector] [F:db.workspace.requireThread] [F:db.sessions.sessionKind] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked] [F:db.workspace.workspaceRow] [F:db.file_jobs.visible]', () => {
  let pool: Pool
  const sectorId = 'sec-readback'
  const scope = { tenantId: 'tenant-readback', projectId: null }
  const text = '# Speciality Foods\n\nQuotable line: free chilled delivery over forty pounds.'
  let documentId = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_mcp_read_document')
    pool = new Pool({ connectionString: url })
    await createSector(pool, { name: 'Readback sector', topic: 'quoting documents', scope, sectorId })
    await projectNewEvents(pool)
    const attached = await ingestSectorDocument(pool, {
      sectorId,
      filename: 'speciality-foods-context.md',
      contentBase64: Buffer.from(text).toString('base64'),
      scope,
    })
    documentId = attached.id
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
  })

  it('returns the exact attached text through the tool dispatch as a viewer', async () => {
    const result = (await invokeTool(
      'db.read_sector_document',
      { pool, scope, role: 'viewer', keyId: 'readback-key' },
      { sectorId, documentId },
    )) as { id: string; filename: string; status: string; chars: number; text: string }
    expect(result.id).toBe(documentId)
    expect(result.filename).toBe('speciality-foods-context.md')
    expect(result.status).toBe('indexed')
    expect(result.chars).toBe(text.length)
    expect(result.text).toBe(text)
  })

  it('rejects unknown documents and sectors at the layer contract', async () => {
    await expect(
      invokeTool(
        'db.read_sector_document',
        { pool, scope, role: 'viewer', keyId: 'readback-key' },
        { sectorId, documentId: 'sdoc-missing' },
      ),
    ).rejects.toBeInstanceOf(DbContractError)
    await expect(
      invokeTool(
        'db.read_sector_document',
        { pool, scope, role: 'viewer', keyId: 'readback-key' },
        { sectorId: 'sec-missing', documentId },
      ),
    ).rejects.toBeInstanceOf(DbContractError)
  })

  it('rejects a missing document id before any query runs', async () => {
    const failure = await invokeTool(
      'db.read_sector_document',
      { pool, scope, role: 'viewer', keyId: 'readback-key' },
      { sectorId },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(McpToolError)
    expect((failure as McpToolError).code).toBe('validation_failed')
  })

  it('stays advertised to both Karbot and sector workers', async () => {
    const upstream: TurnRunnerMcpClient = {
      listTools: async () => [
        { name: 'db.list_sector_documents', description: 'd', parameters: { type: 'object' } },
        { name: 'db.read_sector_document', description: 'd', parameters: { type: 'object' } },
      ],
      callTool: async () => ({ content: '{}' }),
    }
    const karbot = await productMcpClient(upstream).listTools()
    const sector = await sectorMcpClient(upstream).listTools()
    expect(karbot.map((tool) => tool.name)).toContain('db.read_sector_document')
    expect(sector.map((tool) => tool.name)).toContain('db.read_sector_document')
  })
})
