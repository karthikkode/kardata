// Real activity/HTTP/Postgres/archive path with explicit scripted provider/MCP.
// No Meta request or company publication; fixtures never enter the pilot tenant.
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { MockActivityEnvironment } from '@temporalio/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { hydrateResearchSources, resolveArchiveTarget } from '../../backend/src/archive/targets.js'
import { createSession, readPartition, readTurnContinuation } from '../../backend/src/db/index.js'
import { karbotTurnActivity, type TurnOutcome } from '../../backend/src/temporal/activities/turn.js'
import { type KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('production turn source receipts [F:backend.activity.turn.karbotTurnActivity] [F:db.index.createSession] [F:db.index.readPartition] [F:db.workspace_threads.readTurnContinuation] [F:db.events.readPartition] [F:db.sessions.createSession] [F:db.context_files.assertThreadFileContext] [F:db.context_files.validateFileRefs] [F:db.document_units.listDocumentUnitOrdinals] [F:db.execution_epochs.readActiveExecutionIdentity] [F:db.index.Db] [F:db.workspace_threads.recordContextMeasurement]', () => {
  let pool: Pool, server: Server, endpoint: string
  const text = 'TEST Australian company evidence '.repeat(100)
  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_turn_source_receipts')
    vi.stubEnv('DATABASE_URL', url); vi.stubEnv('KARDATA_PROVIDER', 'fake')
    vi.stubEnv('KARDATA_ARCHIVE_DIR', mkdtempSync(join(tmpdir(), 'kardata-turn-sources-')))
    vi.stubEnv('KARDATA_GCS_BUCKET', '')
    pool = new Pool({ connectionString: url, max: 5 })
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      request.on('end', () => {
        const rpc = JSON.parse(body) as { id?: string | number; method: string; params?: { arguments?: { url?: string } } }
        const result = rpc.method === 'tools/list' ? { tools: [{ name: 'web_fetch', description: 'TEST fixture public fetch', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }] }
          : rpc.method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify({ url: rpc.params?.arguments?.url, text }) }] }
          : { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'TEST source fixture', version: '1' } }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('TEST fixture listener unavailable')
    endpoint = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await pool?.end(); vi.unstubAllEnvs() })
  it('stores refs before clearing continuation and returns only compact source identities', async () => {
    const session = await createSession(pool, 'TEST production source receipt')
    await projectNewEvents(pool)
    const environment = new MockActivityEnvironment()
    const outcome = await environment.run<[KarbotTurnInput], TurnOutcome, typeof karbotTurnActivity>(karbotTurnActivity, { sessionId: session.id, threadKey: session.id, runKey: 'TEST source operation', text: 'TEST fetch two fixture sources', mcpEndpoint: endpoint, mcpToken: 'TEST source fixture credential', toolAllow: ['web_fetch'], fakeSteps: [
      { text: '', toolCalls: [{ id: 'TEST-source-1', name: 'web_fetch', args: { url: 'https://company.example.test/' } }, { id: 'TEST-source-2', name: 'web_fetch', args: { url: 'https://company.example.test/about' } }] },
      { text: 'TEST source review complete.' },
    ] })
    expect(outcome.sourceRefs).toHaveLength(2)
    expect(outcome).not.toHaveProperty('sources')
    expect(JSON.stringify(outcome).length).toBeLessThan(2000)
    expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
    const records = (await readPartition(pool, `session:${session.id}`)).filter((event) => event.type === 't.turn.sources_archived')
    expect(records).toHaveLength(1)
    const receipt = records[0]!.payload as { sources: NonNullable<typeof outcome.sourceRefs>; attemptLease: string }
    expect(receipt.attemptLease).toMatch(/^[a-f0-9-]{36}$/)
    expect(receipt.sources).toEqual(outcome.sourceRefs)
    const hydrated = await hydrateResearchSources(resolveArchiveTarget(), session.id, { sourceRefs: receipt.sources })
    expect(hydrated.sources.map((source) => source.text)).toEqual([text, text])
  }, 20000)
})
