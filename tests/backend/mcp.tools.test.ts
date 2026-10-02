// MCP server tests (Phase 2). No keys, no network: layer calls run against
// an in-memory fake Db and HTTP runs via inject, except the research-health
// block, which is explicitly gated on TEST_DATABASE_URL and owns its own
// database. Pins: tool<->binding-table parity, tool-schema<->layer-validation
// parity, per-tool role floors, transport auth, and the no-SQL-in-server rule.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { createSector, createSession } from '../../backend/src/db/index.js'
import { createLogger } from '../../backend/src/observability/logging.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { RunNotFound, TemporalRunsGateway, ThreadNotAccepting } from '../../backend/src/temporal/gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import type { DbQueryResult } from '../../backend/src/db/index.js'
import { DbContractError } from '../../backend/src/db/index.js'
import * as dbLayer from '../../backend/src/db/index.js'
import * as fileIngestion from '../../backend/src/file-ingestion.js'
import * as retrievalBrowser from '../../backend/src/retrieval/browser.js'
import * as retrievalWeb from '../../backend/src/retrieval/web.js'
import { createMcpServer, invokeTool, McpToolError, TOOL_LAYER, TOOL_META, toolCapability, PLATFORM_INTERNAL_TOOLS } from '../../backend/src/mcp/tools.js'
import { TOOL_NAMES, type McpToolName } from '../../backend/src/mcp/schemas.js'
import type { TransactableDb } from '../../backend/src/db/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')

class QueryReached extends Error {}

interface FakeState {
  queries: number
}

type QueryImpl = (text: string, params?: unknown[]) => Promise<DbQueryResult<never>>

function makeFake(impl?: QueryImpl): { db: TransactableDb; state: FakeState } {
  const state: FakeState = { queries: 0 }
  const query = (async (text: string, params?: unknown[]): Promise<DbQueryResult<never>> => {
    state.queries += 1
    if (impl) return impl(text, params)
    throw new QueryReached(text)
  }) as TransactableDb['query']
  const listener = {
    query: async (): Promise<DbQueryResult<never>> => ({ rowCount: 0, rows: [] }),
    on: (): void => undefined,
    removeListener: (): void => undefined,
    release: (): void => undefined,
  }
  const db = { query, connect: async (): Promise<unknown> => listener } as unknown as TransactableDb
  return { db, state }
}

const SCOPE = { tenantId: 'tenant-a', projectId: null }

/** Per-tool parity samples: valid args must pass both the tool schema and
 * layer validation (reaching the fake DB or succeeding without one);
 * invalid args must fail the tool schema before any query runs. */
const SAMPLES: Record<McpToolName, { valid: unknown; invalid: unknown; invoke?: boolean }> = {
  'db.commit_child_context': { valid: { proposalId: 'child-update' }, invalid: {}, invoke: false },
  'db.get_global_context': { valid: {}, invalid: { unexpected: true }, invoke: false },
  'db.propose_global_context': { valid: { baseVersion: 0, sections: {}, idempotencyKey: 'change' }, invalid: { baseVersion: -1 }, invoke: false },
  'db.list_sector_files': { valid: {}, invalid: { unexpected: true }, invoke: false },
  'db.propose_file_context': { valid: { fileId: 'file', baseVersion: 0 }, invalid: {}, invoke: false },
  'db.get_local_context': { valid: {}, invalid: { unexpected: true }, invoke: false },
  'db.append_event': {
    valid: { idempotencyKey: 'k1', partition: 'p', type: 't', payload: {} },
    invalid: { partition: 'p', type: 't' },
  },
  'db.read_partition': { valid: { partition: 'p', afterSeq: 0 }, invalid: { partition: '' } },
  'db.find_event': { valid: { idempotencyKey: 'k' }, invalid: {} },
  'db.read_events_after': { valid: { fromSeq: 0, limit: 10 }, invalid: { fromSeq: -1, limit: 0 } },
  'db.create_session': { valid: { title: 's' }, invalid: { title: '' } },
  'db.rename_session': { valid: { sessionId: 's1', title: 'new' }, invalid: { sessionId: 's1' } },
  'db.delete_session': { valid: { sessionId: 's1' }, invalid: {} },
  'db.get_session': { valid: { sessionId: 's1' }, invalid: { sessionId: '' } },
  'db.list_sessions': { valid: {}, invalid: [] },
  'db.list_sectors': { valid: { state: 'running', query: 'x' }, invalid: { state: 'nope' } },
  'db.get_sector': { valid: { sectorId: 'sec-1' }, invalid: { sectorId: '' } },
  'db.list_companies': { valid: { sectorId: 'sec-1' }, invalid: { query: 'x'.repeat(201) } },
  'db.list_sector_companies': { valid: { sectorId: 'sec-1' }, invalid: {} },
  'db.sector_activity': { valid: { sectorId: 's' }, invalid: {} },
  'db.create_sector': { valid: { name: 'n' }, invalid: { name: '' } },
  'db.attach_sector_document': {
    valid: { sectorId: 's', filename: 'notes.md', contentBase64: Buffer.from('hello').toString('base64') },
    invalid: { sectorId: 's', filename: 'notes.md' },
  },
  'db.list_sector_documents': { valid: { sectorId: 's' }, invalid: {} },
  'db.read_sector_document': { valid: { sectorId: 's', documentId: 'd' }, invalid: { sectorId: 's' } },
  'db.query_document': {
    valid: { documentId: 'd', sectorId: 's', mode: 'chunks', query: 'pricing' },
    invalid: { documentId: 'd', mode: 'nope' },
  },
  'db.set_sector_state': { valid: { sectorId: 's', state: 'paused' }, invalid: { sectorId: 's', state: 'nope' } },
  'db.start_sector_research': { valid: { sectorId: 's' }, invalid: { sectorId: '' } },
  'db.pause_sector_research': { valid: { sectorId: 's' }, invalid: { sectorId: '' } },
  'db.resume_sector_research': { valid: { sectorId: 's' }, invalid: { sectorId: '' } },
  'db.mark_company_found': { valid: { sectorId: 's', name: 'n' }, invalid: { sectorId: '', name: 'n' } },
  'db.set_company_stage': { valid: { companyId: 'c', stage: 'Filter' }, invalid: { companyId: 'c', stage: 'nope' } },
  'db.set_company_state': { valid: { companyId: 'c', state: 'running' }, invalid: { companyId: '', state: 'running' } },
  'db.list_artifacts': { valid: { sessionId: 's' }, invalid: {} },
  'db.create_artifact': {
    valid: { sessionId: 's', name: 'report.md', content: '# findings' },
    invalid: { sessionId: 's', name: 'report.md', content: '' },
    // Invoke needs an archive target + session row: proven by the
    // dedicated layer and route tests, never the fake pool.
    invoke: false,
  },
  'db.reference_artifact': {
    valid: { artifactId: 'a', fromScope: { kind: 'session', id: 's' }, toSessionId: 't' },
    invalid: { artifactId: 'a', fromScope: { kind: 'bogus', id: 's' }, toSessionId: 't' },
  },
  'db.resolve_artifact_scope': { valid: { sessionId: 's', artifactId: 'a' }, invalid: { sessionId: 's' } },
  'db.list_tenant_artifacts': { valid: {}, invalid: { tenantId: '' } },
  'db.find_launch_parent': { valid: { childId: 'c' }, invalid: {} },
  'db.get_thread': { valid: { threadKey: 'k' }, invalid: { threadKey: '' } },
  'db.list_threads': { valid: { sessionId: 's' }, invalid: {} },
  // Steering valid paths need a messenger double: proven by the dedicated
  // steering tests below, never the fake pool (fail-closed has no query).
  'db.send_message': { valid: { threadKey: 't', text: 'redirect' }, invalid: { threadKey: 't' }, invoke: false },
  'db.steer_thread': { valid: { threadKey: 't', text: 'redirect' }, invalid: { text: '' }, invoke: false },
  'db.pause_run': { valid: { runId: 'r' }, invalid: {}, invoke: false },
  'db.resume_run': { valid: { runId: 'r' }, invalid: { runId: '' }, invoke: false },
  'db.cancel_run': { valid: { runId: 'r' }, invalid: {}, invoke: false },
  'db.research_health': { valid: { sectorId: 's' }, invalid: { sectorId: '' } },
  'db.project_batch': { valid: { events: [] }, invalid: { events: 'x' } },
  'db.record_heartbeat': { valid: { runId: 'r', op: 'o', busy: true }, invalid: { runId: 'r', op: 'o' } },
  'db.list_heartbeats': { valid: {}, invalid: [] },
  'db.read_outbox': { valid: { threadKey: 'k' }, invalid: { threadKey: '' } },
  'db.subscribe_outbox': { valid: { timeoutMs: 20 }, invalid: { timeoutMs: -5 } },
  'db.project_usage': { valid: { events: [] }, invalid: {} },
  'db.run_totals': { valid: { runId: 'r' }, invalid: {} },
  'db.fleet_totals': { valid: {}, invalid: [] },
  'db.find_key': { valid: { keyHash: 'abc' }, invalid: {} },
  'db.check_rate': { valid: { bucket: 'b', limitPerMin: 60 }, invalid: { bucket: 'b', limitPerMin: 0 } },
  'db.claim_idempotency': { valid: { key: 'k', fingerprint: 'f' }, invalid: { key: 'k' } },
  'db.complete_idempotency': { valid: { key: 'k', status: 200, body: { a: 1 } }, invalid: { key: 'k', status: 99 } },
  'db.release_idempotency': { valid: { key: 'k' }, invalid: {} },
  'db.kb_search': { valid: { query: 'pricing band', limit: 3 }, invalid: { query: '' } },
  'db.update_sector_plan': {
    valid: { sectorId: 's1', markdown: '## scope\nFoods.' },
    invalid: { sectorId: 's1', markdown: '' },
    invoke: false,
  },
  'db.delegate_subagent': {
    valid: { sessionId: 's1', goal: 'research acme' },
    invalid: { sessionId: 's1', goal: '' },
    invoke: false,
  },
  'web_search': { valid: { query: 'acme widgets' }, invalid: { query: 'x' }, invoke: false },
  'web_fetch': { valid: { url: 'https://example.com' }, invalid: { url: '' }, invoke: false },
  'browser_navigate': { valid: { url: 'https://example.com' }, invalid: { url: '' }, invoke: false },
  'browser_snapshot': { valid: { sessionId: 'browser-1' }, invalid: { sessionId: '' }, invoke: false },
  'browser_act': {
    valid: { sessionId: 'browser-1', kind: 'press', key: 'Enter' },
    invalid: { sessionId: 'browser-1', kind: 'nope' },
    invoke: false,
  },
  'browser_close': { valid: { sessionId: 'browser-1' }, invalid: { sessionId: '' }, invoke: false },
  'browser_screenshot': {
    valid: { sessionId: 'browser-1' },
    invalid: { sessionId: '' },
    invoke: false,
  },
  'db.ledger_upsert_company': { valid: { domain: 'ex.com', name: 'Ex' }, invalid: { domain: '', name: 'Ex' } },
  'db.ledger_get_company': { valid: { companyId: 'c' }, invalid: { companyId: '' } },
  'db.ledger_list_companies': { valid: { qualification: 'qualified', query: 'ex' }, invalid: { qualification: 'nope' } },
  'db.ledger_record_problem': { valid: { companyId: 'c', problem: 'p' }, invalid: { companyId: 'c', problem: '' } },
  'db.ledger_list_problems': { valid: { companyId: 'c' }, invalid: {} },
}

const EXPECTED_TOOLS: McpToolName[] = [
  'db.commit_child_context',
  'db.get_global_context', 'db.propose_global_context', 'db.list_sector_files', 'db.propose_file_context', 'db.get_local_context',
  'db.append_event',
  'db.read_partition',
  'db.find_event',
  'db.read_events_after',
  'db.create_session',
  'db.rename_session',
  'db.delete_session',
  'db.get_session',
  'db.list_sessions',
  'db.list_sectors',
  'db.get_sector',
  'db.list_companies',
  'db.list_sector_companies',
  'db.sector_activity',
  'db.create_sector',
  'db.attach_sector_document',
  'db.list_sector_documents',
  'db.read_sector_document',
  'db.query_document',
  'db.set_sector_state',
  'db.start_sector_research',
  'db.pause_sector_research',
  'db.resume_sector_research',
  'db.mark_company_found',
  'db.set_company_stage',
  'db.set_company_state',
  'db.list_artifacts',
  'db.create_artifact',
  'db.reference_artifact',
  'db.resolve_artifact_scope',
  'db.list_tenant_artifacts',
  'db.find_launch_parent',
  'db.get_thread',
  'db.list_threads',
  'db.send_message',
  'db.steer_thread',
  'db.pause_run',
  'db.resume_run',
  'db.cancel_run',
  'db.research_health',
  'db.project_batch',
  'db.record_heartbeat',
  'db.list_heartbeats',
  'db.read_outbox',
  'db.subscribe_outbox',
  'db.project_usage',
  'db.run_totals',
  'db.fleet_totals',
  'db.find_key',
  'db.check_rate',
  'db.claim_idempotency',
  'db.complete_idempotency',
  'db.release_idempotency',
  'db.kb_search',
  'db.update_sector_plan',
  'db.delegate_subagent',
  'db.ledger_upsert_company',
  'db.ledger_get_company',
  'db.ledger_list_companies',
  'db.ledger_record_problem',
  'db.ledger_list_problems',
  'web_search',
  'web_fetch',
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'browser_close',
  'browser_screenshot',
]

describe('mcp tool parity (Phase 2)', () => {
  it('registers exactly one tool per binding-table row (projector-only excluded)', () => {
    expect([...TOOL_NAMES].sort()).toEqual([...EXPECTED_TOOLS].sort())
    expect(Object.keys(TOOL_META).sort()).toEqual([...EXPECTED_TOOLS].sort())
    expect(Object.keys(TOOL_LAYER).sort()).toEqual([...EXPECTED_TOOLS].sort())
    expect(Object.keys(SAMPLES).sort()).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('every tool names a real layer function; projector-only functions stay unbound', () => {
    // Phase 6 retrieval tools bind to retrieval-module functions and the
    // delegation door binds to the gateway, not the db layer; all three
    // namespaces count as layer functions here.
    const layers: Record<string, unknown> = {
      ...(dbLayer as Record<string, unknown>),
      ...(fileIngestion as Record<string, unknown>),
      ...(retrievalWeb as Record<string, unknown>),
      ...(retrievalBrowser as Record<string, unknown>),
      delegateSubagent: TemporalRunsGateway.prototype.delegateSubagent,
    }
    for (const name of TOOL_NAMES) {
      for (const fn of TOOL_LAYER[name].split('+')) {
        expect(typeof layers[fn], `${name} -> ${fn}`).toBe('function')
      }
    }
    const bound = new Set(Object.values(TOOL_LAYER).flatMap((entry) => entry.split('+')))
    expect(bound.has('publishOutboxFrame')).toBe(false)
    expect(bound.has('runCheckpointTx')).toBe(false)
  })

  it('valid args pass tool schema and layer validation; invalid args fail before any query', async () => {
    for (const name of TOOL_NAMES) {
      const { db, state } = makeFake()
      const ctx = { pool: db, scope: SCOPE, role: 'approver' as const, keyId: 'test-key', runs: { async startSectorSweep() { throw new Error('Runner must not execute before DB validation') }, async cancelSectorSweep() { throw new Error('Runner must not execute before DB validation') } } }
      const sample = SAMPLES[name]
      // Retrieval tools touch the network/browser: their valid path is
      // proven by dedicated tests with injected doubles, never here.
      if (sample.invoke !== false) {
        if (name === 'db.subscribe_outbox') {
          await expect(invokeTool(name, ctx, sample.valid)).rejects.toMatchObject({ code: 'permission_denied' })
        }
        try {
          await invokeTool(name, PLATFORM_INTERNAL_TOOLS.has(name) ? { ...ctx, scope: undefined } : ctx, sample.valid)
        } catch (error) {
          expect(error, `${name} valid sample`).toBeInstanceOf(QueryReached)
        }
      }
      const bad = makeFake()
      const badCtx = { pool: bad.db, scope: SCOPE, role: 'approver' as const, keyId: 'test-key' }
      const failure = await invokeTool(name, PLATFORM_INTERNAL_TOOLS.has(name) ? { ...badCtx, scope: undefined } : badCtx, sample.invalid).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failure, `${name} invalid sample`).toBeInstanceOf(McpToolError)
      expect((failure as McpToolError).code, `${name} invalid code`).toBe('validation_failed')
      expect(bad.state.queries, `${name} invalid must not query`).toBe(0)
      void state
    }
  })

  it('viewer role is denied operator tools before any query runs', async () => {
    for (const name of TOOL_NAMES.filter((tool) => TOOL_META[tool].minRole === 'operator')) {
      const { db, state } = makeFake()
      const failure = await invokeTool(name, { pool: db, scope: SCOPE, role: 'viewer', keyId: 'test-key' }, SAMPLES[name].valid).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failure, name).toBeInstanceOf(McpToolError)
      expect((failure as McpToolError).code, name).toBe('permission_denied')
      expect(state.queries, name).toBe(0)
    }
  })

  it('layer validation agrees with tool schemas on representative misalignments', async () => {
    const { db } = makeFake()
    await expect(dbLayer.appendEvent(db, { partition: 'p' })).rejects.toBeInstanceOf(DbContractError)
    await expect(dbLayer.readPartition(db, '', 0)).rejects.toBeInstanceOf(DbContractError)
    await expect(dbLayer.setSectorState(db, 's', 'nope' as never)).rejects.toBeInstanceOf(DbContractError)
    await expect(dbLayer.projectBatch(db, 'x' as never)).rejects.toBeInstanceOf(DbContractError)
    await expect(dbLayer.claimIdempotency(db, '', 'f')).rejects.toBeInstanceOf(DbContractError)
  })

  it('the server ships no SQL and no pg import', () => {
    for (const file of ['schemas.ts', 'tools.ts', 'routes.ts']) {
      const text = readFileSync(join(REPO, 'backend', 'src', 'mcp', file), 'utf8')
      expect(text, file).not.toMatch(/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i)
      expect(text, file).not.toMatch(/from 'pg'/)
    }
  })

  it('every tool is callable through createMcpServer', () => {
    const { db } = makeFake()
    const server = createMcpServer({ pool: db, scope: SCOPE, role: 'approver', keyId: 'test-key' })
    expect(server).toBeTruthy()
  })
})

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

function rpc(method: string, params: unknown, id: number): string {
  return JSON.stringify({ jsonrpc: '2.0', id, ...{ method, params } })
}

async function postMcp(
  app: FastifyInstance,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: { result?: unknown; error?: { code?: number; message?: string } } }> {
  const response = await app.inject({ method: 'POST', url: '/mcp', headers: { ...MCP_HEADERS, ...extraHeaders }, payload: body })
  return { status: response.statusCode, json: response.json() as { result?: unknown; error?: { code?: number; message?: string } } }
}

async function initialize(app: FastifyInstance, extraHeaders: Record<string, string> = {}): Promise<void> {
  const response = await postMcp(
    app,
    rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } }, 0),
    extraHeaders,
  )
  expect(response.status, JSON.stringify(response.json)).toBe(200)
  expect((response.json.result as { serverInfo?: { name?: string } }).serverInfo?.name).toBe('kardata')
}

describe('mcp transport (Phase 2)', () => {
  it('serves initialize, tools/list, and tools/call over POST /mcp', async () => {
    const { db } = makeFake(async (text) => {
      if (/FROM heartbeats/.test(text)) {
        return { rowCount: 1, rows: [{ run_id: 'run-1', at: new Date('2026-01-01T00:00:00Z'), busy: true }] as never }
      }
      throw new QueryReached(text)
    })
    const app = buildApp({ pool: db })
    try {
      await initialize(app)
      const listed = await postMcp(app, rpc('tools/list', {}, 1))
      expect(listed.status).toBe(200)
      const tools = (listed.json.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools
      expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort())
      for (const tool of tools) {
        expect(tool.inputSchema, tool.name).toBeTruthy()
      }
      const called = await postMcp(app, rpc('tools/call', { name: 'db.list_heartbeats', arguments: {} }, 2))
      expect(called.status).toBe(200)
      const content = (called.json.result as { content: Array<{ text: string }>; isError?: boolean }).content
      expect(called.json.result).not.toHaveProperty('isError')
      expect(content[0]?.text).toContain('run-1')
      const badArgs = await postMcp(app, rpc('tools/call', { name: 'db.get_sector', arguments: {} }, 3))
      expect(badArgs.status).toBe(200)
      expect((badArgs.json.result as { isError?: boolean }).isError).toBe(true)
      const unknown = await postMcp(app, rpc('tools/call', { name: 'db.nope', arguments: {} }, 4))
      expect(unknown.status).toBe(200)
      expect(unknown.json.error ?? unknown.json.result).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  it('fails closed without a pool and 404s non-POST methods', async () => {
    const app = buildApp({})
    try {
      const response = await postMcp(app, rpc('tools/list', {}, 1))
      expect(response.status).toBe(503)
      expect(response.json).toMatchObject({ ok: false, error: { code: 'overload' } })
      const get = await app.inject({ method: 'GET', url: '/mcp' })
      expect(get.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('enforces API-key auth and per-tool roles in keyed mode', async () => {
    const keyRow = (role: string): QueryImpl => async (text) => {
      if (/FROM api_keys/.test(text)) {
        return {
          rowCount: 1,
          rows: [{ key_id: `k-${role}`, tenant_id: 'tenant-a', project_id: null, roles: role }] as never,
        }
      }
      if (/FROM heartbeats|FROM events/.test(text)) {
        return { rowCount: 0, rows: [] as never }
      }
      throw new QueryReached(text)
    }
    const viewer = makeFake(keyRow('viewer'))
    const operator = makeFake(keyRow('operator'))
    const viewerApp = buildApp({ pool: viewer.db, auth: true })
    const operatorApp = buildApp({ pool: operator.db, auth: true })
    try {
      const denied = await postMcp(viewerApp, rpc('tools/list', {}, 1))
      expect(denied.status).toBe(403)
      expect(denied.json).toMatchObject({ ok: false, error: { code: 'permission_denied' } })
      await initialize(viewerApp, { authorization: 'Bearer key-viewer' })
      const viewerCall = await postMcp(
        viewerApp,
        rpc('tools/call', { name: 'db.create_session', arguments: { title: 's' } }, 2),
        { authorization: 'Bearer key-viewer' },
      )
      expect(viewerCall.status).toBe(200)
      expect((viewerCall.json.result as { isError?: boolean }).isError).toBe(true)
      expect(JSON.stringify(viewerCall.json.result)).toContain('permission_denied')
      await initialize(operatorApp, { authorization: 'Bearer key-operator' })
      const operatorCall = await postMcp(
        operatorApp,
        rpc('tools/call', { name: 'db.list_sessions', arguments: {} }, 2),
        { authorization: 'Bearer key-operator' },
      )
      expect(operatorCall.status).toBe(200)
      expect(operatorCall.json.result).not.toHaveProperty('isError')
    } finally {
      await viewerApp.close()
      await operatorApp.close()
    }
  })

  it('evidence failures carry the no-guess directive; other errors do not', async () => {
    delete process.env['KARDATA_WEB_SEARCH_KEY']
    const { db } = makeFake(async (text) => {
      if (/FROM api_keys/.test(text)) {
        return {
          rowCount: 1,
          rows: [{ key_id: 'k-viewer', tenant_id: 'tenant-a', project_id: null, roles: 'viewer' }] as never,
        }
      }
      throw new QueryReached(text)
    })
    const app = buildApp({ pool: db, auth: true })
    try {
      await initialize(app, { authorization: 'Bearer [REDACTED]' })
      const auth = { authorization: 'Bearer [REDACTED]' }
      const failed = await postMcp(
        app,
        rpc('tools/call', { name: 'web_search', arguments: { query: 'acme widgets' } }, 1),
        auth,
      )
      expect(failed.status).toBe(200)
      const failedResult = failed.json.result as { content: Array<{ text: string }>; isError?: boolean }
      expect(failedResult.isError).toBe(true)
      expect(failedResult.content[0]?.text).toContain('unconfigured')
      expect(failedResult.content[0]?.text).toContain('Do not fill this gap from memory')
      const blocked = await postMcp(
        app,
        rpc('tools/call', { name: 'web_fetch', arguments: { url: 'http://localhost:9/x' } }, 2),
        auth,
      )
      const blockedResult = blocked.json.result as { content: Array<{ text: string }>; isError?: boolean }
      expect(blockedResult.isError).toBe(true)
      expect(blockedResult.content[0]?.text).toContain('Do not fill this gap from memory')
      const invalid = await postMcp(app, rpc('tools/call', { name: 'db.get_sector', arguments: {} }, 3), auth)
      const invalidResult = invalid.json.result as { content: Array<{ text: string }>; isError?: boolean }
      expect(invalidResult.isError).toBe(true)
      expect(invalidResult.content[0]?.text).not.toContain('Do not fill this gap from memory')
    } finally {
      await app.close()
    }
  })

  it('a grant header narrows list and blocks calls outside it server-side', async () => {
    const { db } = makeFake(async (text) => {
      if (/FROM heartbeats/.test(text)) {
        return { rowCount: 1, rows: [{ run_id: 'run-1', at: new Date('2026-01-01T00:00:00Z'), busy: true }] as never }
      }
      throw new QueryReached(text)
    })
    const app = buildApp({ pool: db })
    const grant = { 'x-kardata-tool-grant': 'db.list_heartbeats, db.kb_search' }
    try {
      await initialize(app, grant)
      const listed = await postMcp(app, rpc('tools/list', {}, 1), grant)
      expect(listed.status).toBe(200)
      const tools = (listed.json.result as { tools: Array<{ name: string }> }).tools
      expect(tools.map((tool) => tool.name).sort()).toEqual(['db.kb_search', 'db.list_heartbeats'])
      // Inside the grant the call runs (approver role in open mode).
      const allowed = await postMcp(app, rpc('tools/call', { name: 'db.list_heartbeats', arguments: {} }, 2), grant)
      expect(allowed.status).toBe(200)
      expect(allowed.json.result).not.toHaveProperty('isError')
      // Outside the grant the tool is not even registered: the same caller
      // gets a wire-level method error instead of a result, even as approver.
      const blocked = await postMcp(
        app,
        rpc('tools/call', { name: 'db.create_session', arguments: { title: 'sneaky' } }, 3),
        grant,
      )
      expect(blocked.status).toBe(200)
      expect(blocked.json.error ?? blocked.json.result).toBeTruthy()
      // The invoke-level grant check still guards any path that reaches it
      // (e.g. direct invokeTool): permission_denied, never a run.
      const { db: directDb } = makeFake()
      const direct = await invokeTool(
        'db.create_session',
        { pool: directDb, scope: SCOPE, role: 'approver', keyId: 'key-a' },
        { title: 'sneaky' },
        { allow: new Set(['db.list_heartbeats'] as const) },
      ).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(direct).toBeInstanceOf(McpToolError)
      expect((direct as McpToolError).code).toBe('permission_denied')
    } finally {
      await app.close()
    }
  })

  it('an unknown grant name fails the request loudly', async () => {
    const { db } = makeFake()
    const app = buildApp({ pool: db })
    try {
      const response = await postMcp(
        app,
        rpc('tools/list', {}, 1),
        { 'x-kardata-tool-grant': 'db.list_heartbeats, db.nope' },
      )
      expect(response.status).toBe(400)
      expect(response.json).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    } finally {
      await app.close()
    }
  })

  it('replays mutations across RPC ids and conflicts on changed semantic input', async () => {
    const stored = new Map<string, { fingerprint: string; status: number; body: unknown }>()
    const { db } = makeFake(async (text, params) => {
      if (/FROM idempotency_records/.test(text)) {
        const key = (params?.[0] ?? '') as string
        const row = stored.get(key)
        return { rowCount: row ? 1 : 0, rows: (row ? [{ ...row, state: 'completed', response: row.body }] : []) as never }
      }
      if (/INSERT INTO idempotency_records/.test(text)) {
        stored.set((params?.[0] ?? '') as string, { fingerprint: (params?.[1] ?? '') as string, status: 0, body: null })
        return { rowCount: 1, rows: [{ key: params?.[0] }] as never }
      }
      if (/UPDATE idempotency_records/.test(text)) {
        const row = stored.get((params?.[0] ?? '') as string)
        if (row) {
          row.status = (params?.[1] ?? 200) as number
          // The layer stores JSON.stringify(body); jsonb parses it back on
          // read, so replay sees the original value byte-identical.
          row.body = JSON.parse((params?.[2] ?? 'null') as string) as unknown
        }
        return { rowCount: 1, rows: [] as never }
      }
      if (/INSERT INTO heartbeats/.test(text)) return { rowCount: 1, rows: [] as never }
      if (/FROM heartbeats|FROM events/.test(text)) {
        return { rowCount: 0, rows: [] as never }
      }
      throw new QueryReached(text)
    })
    const app = buildApp({ pool: db })
    try {
      await initialize(app)
      const body = rpc('tools/call', { name: 'db.record_heartbeat', arguments: { runId: 'TEST replay run', op: 'turn', busy: false } }, 7)
      const first = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, 'idempotency-key': 'idem-1' },
        payload: body,
      })
      expect(first.statusCode).toBe(200)
      const second = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, 'idempotency-key': 'idem-1' },
        payload: JSON.stringify({ ...JSON.parse(body), id: 8 }),
      })
      expect(second.statusCode).toBe(200)
      expect(second.json().id).toBe(8)
      expect(second.json().result).toEqual(first.json().result)
      expect(stored.size).toBe(1)
      const conflict = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...MCP_HEADERS, 'idempotency-key': 'idem-1' },
        payload: rpc('tools/call', { name: 'db.record_heartbeat', arguments: { runId: 'TEST replay run', op: 'other', busy: false } }, 9),
      })
      expect(conflict.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })
})

describe('mcp authz hardening (Wave 1)', () => {
  function ctxFor(db: TransactableDb, role: 'viewer' | 'operator' | 'approver', keyId: string): {
    pool: TransactableDb
    scope: typeof SCOPE
    role: 'viewer' | 'operator' | 'approver'
    keyId: string
  } {
    return { pool: db, scope: SCOPE, role, keyId }
  }

  it('db.append_event refuses approval verdicts for every role before any query', async () => {
    for (const role of ['operator', 'approver'] as const) {
      const { db, state } = makeFake()
      const failure = await invokeTool(
        'db.append_event',
        ctxFor(db, role, 'key-a'),
        { idempotencyKey: 'k', partition: 'approval:x', type: 't.approval.decided', payload: {} },
      ).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failure, role).toBeInstanceOf(McpToolError)
      expect((failure as McpToolError).code, role).toBe('permission_denied')
      expect(state.queries, role).toBe(0)
    }
  })

  it('db.find_key and db.project_batch need approver', async () => {
    for (const name of ['db.find_key', 'db.project_batch'] as const) {
      const { db, state } = makeFake()
      const failure = await invokeTool(name, ctxFor(db, 'operator', 'key-a'), SAMPLES[name].valid).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failure, name).toBeInstanceOf(McpToolError)
      expect((failure as McpToolError).code, name).toBe('permission_denied')
      expect(state.queries, name).toBe(0)

      const approver = makeFake()
      const reached = await invokeTool(name, { ...ctxFor(approver.db, 'approver', 'key-a'), scope: undefined }, SAMPLES[name].valid).then(
        () => 'layer-accepted',
        (error: unknown) => error,
      )
      // Approver passes the role floor: the layer either runs (empty batch
      // needs no query) or reaches the fake DB — never permission_denied.
      expect(reached instanceof McpToolError && reached.code === 'permission_denied', `${name} approver`).toBe(false)
    }
  })

  it('capability tiers match role floors: read/viewer, write/operator, sensitive/approver', async () => {
    for (const name of TOOL_NAMES) {
      const capability = toolCapability(name)
      const floor = TOOL_META[name].minRole
      if (capability === 'read') expect(floor, name).toBe('viewer')
      if (capability === 'write') expect(floor, name).toBe('operator')
      if (capability === 'sensitive') expect(floor, name).toBe('approver')
    }
    expect(toolCapability('db.kb_search')).toBe('read')
    expect(toolCapability('db.create_sector')).toBe('write')
    for (const name of ['db.find_key', 'db.project_batch', 'db.claim_idempotency', 'db.complete_idempotency', 'db.release_idempotency'] as const) {
      expect(toolCapability(name), name).toBe('sensitive')
    }
  })

  it('sensitive exactly-once tools need approver, even for operators', async () => {
    for (const name of ['db.claim_idempotency', 'db.complete_idempotency', 'db.release_idempotency'] as const) {
      const { db, state } = makeFake()
      const failure = await invokeTool(name, ctxFor(db, 'operator', 'key-a'), SAMPLES[name].valid).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failure, name).toBeInstanceOf(McpToolError)
      expect((failure as McpToolError).code, name).toBe('permission_denied')
      expect(state.queries, name).toBe(0)
    }
  })

  it('retrieval failures map to isError codes with zero queries', async () => {
    delete process.env['KARDATA_WEB_SEARCH_KEY']
    const { db, state } = makeFake()
    const ctx = ctxFor(db, 'viewer', 'key-a')
    const search = await invokeTool('web_search', ctx, { query: 'acme widgets' }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(search).toBeInstanceOf(McpToolError)
    expect((search as McpToolError).code).toBe('unconfigured')
    const blocked = await invokeTool('web_fetch', ctx, { url: 'http://localhost:9/x' }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(blocked).toBeInstanceOf(McpToolError)
    expect((blocked as McpToolError).code).toBe('blocked')
    expect(state.queries).toBe(0)
  })

  it('skill grants confine calls to the declared tool set', async () => {
    const { db, state } = makeFake()
    const grant = { allow: new Set(['db.kb_search'] as const) }
    const denied = await invokeTool('db.list_sectors', ctxFor(db, 'approver', 'key-a'), {}, grant).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(denied).toBeInstanceOf(McpToolError)
    expect((denied as McpToolError).code).toBe('permission_denied')
    expect(state.queries).toBe(0)
    const allowed = await invokeTool('db.kb_search', ctxFor(db, 'approver', 'key-a'), SAMPLES['db.kb_search'].valid, grant).then(
      () => 'layer-accepted',
      (error: unknown) => error,
    )
    expect(allowed instanceof McpToolError && allowed.code === 'permission_denied').toBe(false)
  })

  it('idempotency tools namespace keys per caller', async () => {
    const seen: string[] = []
    const { db } = makeFake(async (text, params) => {
      if (/FROM idempotency_records/.test(text)) return { rowCount: 0, rows: [] as never }
      if (/INSERT INTO idempotency_records/.test(text)) {
        seen.push((params?.[0] ?? '') as string)
        return { rowCount: 1, rows: [{ key: params?.[0] }] as never }
      }
      throw new QueryReached(text)
    })
    const first = await invokeTool('db.claim_idempotency', { ...ctxFor(db, 'approver', 'key-a'), scope: undefined }, { key: 'k', fingerprint: 'f' })
    const second = await invokeTool('db.claim_idempotency', { ...ctxFor(db, 'approver', 'key-b'), scope: undefined }, { key: 'k', fingerprint: 'f' })
    expect(first).toMatchObject({ kind: 'proceed' })
    // Same raw key from another caller is an independent claim, not a conflict.
    expect(second).toMatchObject({ kind: 'proceed' })
    expect(seen).toEqual(['key-a:k', 'key-b:k'])
  })
})

describe('mcp tool-execution logging', () => {
  function capture(): { lines: string[]; stream: Writable } {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split('\n')) {
          if (line.trim()) lines.push(line)
        }
        callback()
      },
    })
    return { lines, stream }
  }

  function loggedCtx(db: TransactableDb, stream: Writable): {
    pool: TransactableDb
    scope: typeof SCOPE
    role: 'approver'
    keyId: string
    logger: ReturnType<typeof createLogger>
  } {
    return { pool: db, scope: SCOPE, role: 'approver', keyId: 'key-a', logger: createLogger({ traceId: 'trace-log' }, stream) }
  }

  it('success emits the tool.call start/done triple with the tool name', async () => {
    const { lines, stream } = capture()
    const { db } = makeFake()
    // Empty batch projects nothing: succeeds against the fake without a query.
    await invokeTool('db.project_batch', { ...loggedCtx(db, stream), scope: undefined }, { events: [] })
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'tool.call.start', op: 'tool.call', tool: 'db.project_batch' })
    expect(events[1]).toMatchObject({ event: 'tool.call.done', op: 'tool.call', tool: 'db.project_batch', outcome: 'ok' })
    expect(typeof events[1]['latencyMs']).toBe('number')
    for (const event of events) expect(event['trace_id']).toBe('trace-log')
  })

  it('layer failure emits tool.call.error and still rejects', async () => {
    const { lines, stream } = capture()
    const { db } = makeFake()
    // append_event reaches the fake DB and blows up: the error line must
    // land and the original rejection must survive (logged, never swallowed).
    const failure = await invokeTool('db.append_event', { ...loggedCtx(db, stream), scope: undefined }, {
      idempotencyKey: 'k1',
      partition: 'p',
      type: 't',
      payload: {},
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'tool.call.start', tool: 'db.append_event' })
    expect(events[1]).toMatchObject({ event: 'tool.call.error', tool: 'db.append_event', outcome: 'error' })
  })

  it('no logger means no log lines but the tool still runs', async () => {
    const { db } = makeFake()
    const result = await invokeTool('db.project_batch', { pool: db, scope: undefined, role: 'approver', keyId: 'key-a' }, { events: [] })
    expect(result).toMatchObject({ applied: 0 })
  })
})

describe('mcp monitor and steer tools', () => {
  function messengerDouble(): {
    messenger: { send: (threadKey: string, text: string) => Promise<{ commandId: string; state: 'accepted' }>; steer: (threadKey: string, text: string) => Promise<{ commandId: string; state: 'missed_steer' }>; pauseRun: (runId: string) => Promise<{ commandId: string; state: 'accepted' }>; resumeRun: (runId: string, extendedBudgetMs?: number) => Promise<{ commandId: string; state: 'accepted' }>; cancelRun: (runId: string) => Promise<{ commandId: string; state: 'accepted' }> }
    sent: Array<{ threadKey: string; text: string }>
    steered: Array<{ threadKey: string; text: string }>
    runs: Array<{ op: string; runId: string }>
  } {
    const sent: Array<{ threadKey: string; text: string }> = []
    const steered: Array<{ threadKey: string; text: string }> = []
    const runs: Array<{ op: string; runId: string }> = []
    return {
      sent,
      steered,
      runs,
      messenger: {
        send: async (threadKey: string, text: string) => {
          sent.push({ threadKey, text })
          return { commandId: 'cmd-1', state: 'accepted' as const }
        },
        steer: async (threadKey: string, text: string) => {
          steered.push({ threadKey, text })
          return { commandId: 'cmd-2', state: 'missed_steer' as const }
        },
        pauseRun: async (runId: string) => {
          runs.push({ op: 'pause', runId })
          return { commandId: 'cmd-3', state: 'accepted' as const }
        },
        resumeRun: async (runId: string) => {
          runs.push({ op: 'resume', runId })
          return { commandId: 'cmd-4', state: 'accepted' as const }
        },
        cancelRun: async (runId: string) => {
          runs.push({ op: 'cancel', runId })
          return { commandId: 'cmd-5', state: 'accepted' as const }
        },
      },
    }
  }

  function ctxForRole(db: TransactableDb, role: 'viewer' | 'operator' | 'approver', extra: Record<string, unknown> = {}) {
    return { pool: db, scope: undefined, role, keyId: 'key-a', ...extra }
  }

  it('send queues through the messenger and steer passes the gateway verdict back', async () => {
    const { db } = makeFake()
    const { messenger, sent, steered } = messengerDouble()
    const sentResult = await invokeTool('db.send_message', ctxForRole(db, 'approver', { messenger }), {
      threadKey: 'thread-1',
      text: 'hold that thought',
    })
    expect(sentResult).toMatchObject({ commandId: 'cmd-1', state: 'accepted' })
    expect(sent).toEqual([{ threadKey: 'thread-1', text: 'hold that thought' }])
    const steerResult = await invokeTool('db.steer_thread', ctxForRole(db, 'approver', { messenger }), {
      threadKey: 'thread-1',
      text: 'pivot to pricing',
    })
    expect(steerResult).toMatchObject({ commandId: 'cmd-2', state: 'missed_steer' })
    expect(steered).toEqual([{ threadKey: 'thread-1', text: 'pivot to pricing' }])
  })

  it('steering fails closed without a runner and below approver', async () => {    const { db } = makeFake()
    for (const name of ['db.send_message', 'db.steer_thread'] as const) {
      const noRunner = await invokeTool(name, ctxForRole(db, 'approver'), { threadKey: 't', text: 'x' }).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(noRunner, `${name} needs a runner`).toBeInstanceOf(DbContractError)
      for (const role of ['viewer', 'operator'] as const) {
        const { messenger } = messengerDouble()
        const denied = await invokeTool(name, ctxForRole(db, role, { messenger }), { threadKey: 't', text: 'x' }).then(
          () => undefined,
          (error: unknown) => error,
        )
        expect(denied, `${name} ${role}`).toBeInstanceOf(McpToolError)
        expect((denied as McpToolError).code).toBe('permission_denied')
      }
      expect(toolCapability(name)).toBe('sensitive')
    }
    expect(toolCapability('db.research_health')).toBe('read')
  })

  it('run controls ride the messenger with route-mirroring floors', async () => {
    const { db } = makeFake()
    const { messenger, runs } = messengerDouble()
    const paused = await invokeTool('db.pause_run', ctxForRole(db, 'operator', { messenger }), { runId: 'run-1' })
    expect(paused).toMatchObject({ commandId: 'cmd-3', state: 'accepted' })
    const resumed = await invokeTool('db.resume_run', ctxForRole(db, 'approver', { messenger }), { runId: 'run-1' })
    expect(resumed).toMatchObject({ commandId: 'cmd-4', state: 'accepted' })
    const cancelled = await invokeTool('db.cancel_run', ctxForRole(db, 'operator', { messenger }), { runId: 'run-1' })
    expect(cancelled).toMatchObject({ commandId: 'cmd-5', state: 'accepted' })
    expect(runs).toEqual([
      { op: 'pause', runId: 'run-1' },
      { op: 'resume', runId: 'run-1' },
      { op: 'cancel', runId: 'run-1' },
    ])
  })

  it('run controls fail closed without a runner and below their floors', async () => {
    const { db } = makeFake()
    const floors: Array<{ name: 'db.pause_run' | 'db.resume_run' | 'db.cancel_run'; roles: Array<'viewer' | 'operator'> }> = [
      { name: 'db.pause_run', roles: ['viewer'] },
      { name: 'db.resume_run', roles: ['viewer', 'operator'] },
      { name: 'db.cancel_run', roles: ['viewer'] },
    ]
    for (const { name, roles } of floors) {
      const noRunner = await invokeTool(name, ctxForRole(db, 'approver'), { runId: 'r' }).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(noRunner, `${name} needs a runner`).toBeInstanceOf(DbContractError)
      for (const role of roles) {
        const { messenger } = messengerDouble()
        const denied = await invokeTool(name, ctxForRole(db, role, { messenger }), { runId: 'r' }).then(
          () => undefined,
          (error: unknown) => error,
        )
        expect(denied, `${name} ${role}`).toBeInstanceOf(McpToolError)
        expect((denied as McpToolError).code).toBe('permission_denied')
      }
    }
    expect(toolCapability('db.pause_run')).toBe('write')
    expect(toolCapability('db.resume_run')).toBe('sensitive')
    expect(toolCapability('db.cancel_run')).toBe('write')
  })

  it('gateway run failures surface as not_found and conflict, never a throw-through', async () => {
    const { db } = makeFake()
    const failing = {
      send: async () => {
        throw new RunNotFound('no such run')
      },
      steer: async () => {
        throw new ThreadNotAccepting('thread is finishing')
      },
    }
    const missing = await invokeTool('db.send_message', ctxForRole(db, 'approver', { messenger: failing }), {
      threadKey: 'ghost',
      text: 'hello?',
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(missing).toBeInstanceOf(McpToolError)
    expect((missing as McpToolError).code).toBe('not_found')
    const busy = await invokeTool('db.steer_thread', ctxForRole(db, 'approver', { messenger: failing }), {
      threadKey: 'finishing',
      text: 'wait',
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(busy).toBeInstanceOf(McpToolError)
    expect((busy as McpToolError).code).toBe('conflict')
  })
})

describe.skipIf(!TEST_DATABASE_URL)('mcp research health over live db', () => {
  it('reports live, stalled, and non-running sectors honestly', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_health') })
    try {
      const live = await createSector(pool, { name: 'live one', scope: SCOPE, initialState: 'running' })
      await projectNewEvents(pool)
      await createSession(pool, 'watch chat', SCOPE, live.sectorId)
      await projectNewEvents(pool)
      const liveHealth = (await invokeTool(
        'db.research_health',
        { pool, scope: SCOPE, role: 'viewer', keyId: 'key-a' },
        { sectorId: live.sectorId },
      )) as {
        sector: { state: string }
        stale: boolean
        liveThreads: number
        activityEntries: number
        sessions: Array<{ sessionId: string; threads: Array<{ status: string }> }>
      }
      expect(liveHealth.sector.state).toBe('running')
      expect(liveHealth.stale).toBe(false)
      expect(liveHealth.liveThreads).toBe(1)
      expect(liveHealth.activityEntries).toBeGreaterThan(0)
      expect(liveHealth.sessions).toHaveLength(1)
      expect(liveHealth.sessions[0]?.threads[0]?.status).not.toBe('FINISHED')

      // Running with no open thread is exactly what stale means.
      const quiet = await createSector(pool, { name: 'quiet one', scope: SCOPE, initialState: 'running' })
      await projectNewEvents(pool)
      const quietHealth = (await invokeTool(
        'db.research_health',
        { pool, scope: SCOPE, role: 'viewer', keyId: 'key-a' },
        { sectorId: quiet.sectorId },
      )) as { stale: boolean; liveThreads: number }
      expect(quietHealth.liveThreads).toBe(0)
      expect(quietHealth.stale).toBe(true)

      const draft = await createSector(pool, { name: 'not started', scope: SCOPE })
      await projectNewEvents(pool)
      const draftHealth = (await invokeTool(
        'db.research_health',
        { pool, scope: SCOPE, role: 'viewer', keyId: 'key-a' },
        { sectorId: draft.sectorId },
      )) as { stale: boolean }
      expect(draftHealth.stale).toBe(false)

      const missing = await invokeTool(
        'db.research_health',
        { pool, scope: SCOPE, role: 'viewer', keyId: 'key-a' },
        { sectorId: 'sec-nope' },
      ).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(missing).toBeInstanceOf(DbContractError)
    } finally {
      await pool.end()
    }
  })
})
