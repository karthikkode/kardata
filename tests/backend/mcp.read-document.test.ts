// MCP document read-back: attaching a context document must let a worker
// quote its text back through the tool boundary. Live DB, gated on
// TEST_DATABASE_URL like the other sector suites.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, DbContractError, ingestSectorDocument } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { invokeTool, McpToolError } from '../../backend/src/mcp/tools.js'
import { productMcpClient, sectorMcpClient } from '../../backend/src/temporal/activities/turn-palettes.js'
import type { TurnRunnerMcpClient } from '@kardata/agents'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

describe.skipIf(!ENABLED)('mcp document read-back', () => {
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
