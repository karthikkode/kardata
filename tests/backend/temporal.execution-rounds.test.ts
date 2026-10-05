// Scripted-turn invariant (P3.5): provider calls = execution_rounds rows
// and tool calls = tool_calls rows, over the real activity, real
// Postgres and a fake provider. No Meta request; fixtures never enter
// the pilot tenant.
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { MockActivityEnvironment } from '@temporalio/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { appendEvent, createSession } from '../../backend/src/db/index.js'
import { karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import type { KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

// Temporal tier: the activity boundary is the system under test, driven
// through the SDK mock harness with a scripted provider.
const temporalTier = process.env['KARDATA_TEMPORAL_TEST'] === '1'

describe.skipIf(!TEST_DATABASE_URL || !temporalTier)('execution rounds invariant over scripted turns [F:db.execution_rounds.appendProviderRoundEvent] [F:db.execution_rounds.appendToolCallEvent] [F:db.execution_rounds.projectProviderRound] [F:db.execution_rounds.projectToolCall] [F:backend.activity.turn_rounds.createRoundRecorder] [F:backend.activity.turn_rounds.roundOutcomeFor] [F:backend.activity.turn_rounds.stashToolRef] [F:backend.activity.turn_rounds.turnKindForRun]', () => {
  let pool: Pool, server: Server, endpoint: string
  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_execution_rounds')
    vi.stubEnv('DATABASE_URL', url); vi.stubEnv('KARDATA_PROVIDER', 'fake')
    vi.stubEnv('KARDATA_ARCHIVE_DIR', mkdtempSync(join(tmpdir(), 'kardata-test-rounds-')))
    vi.stubEnv('KARDATA_GCS_BUCKET', '')
    pool = new Pool({ connectionString: url, max: 5 })
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      request.on('end', () => {
        const rpc = JSON.parse(body) as { id?: string | number; method: string; params?: { arguments?: { url?: string } } }
        const result = rpc.method === 'tools/list' ? { tools: [{ name: 'web_fetch', description: 'TEST fixture fetch', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }] }
          : rpc.method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify({ url: rpc.params?.arguments?.url, text: 'TEST fixture evidence' }) }] }
          : { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'TEST rounds fixture', version: '1' } }
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

  it('records one round row per provider call and one tool row per tool call', async () => {
    const session = await createSession(pool, 'TEST rounds invariant')
    await projectNewEvents(pool)
    const environment = new MockActivityEnvironment()
    const base = { sessionId: session.id, mcpEndpoint: endpoint, mcpToken: 'TEST rounds fixture credential', toolAllow: ['web_fetch'] }
    await environment.run(karbotTurnActivity, { ...base, threadKey: session.id, runKey: 'TEST rounds turn one', text: 'TEST fetch two', fakeSteps: [
      { text: '', toolCalls: [{ id: 'TEST-r1-a', name: 'web_fetch', args: { url: 'https://a.example.test/' } }, { id: 'TEST-r1-b', name: 'web_fetch', args: { url: 'https://b.example.test/' } }], usage: { inputTokens: 10, outputTokens: 5 } },
      { text: 'TEST done one.', usage: { inputTokens: 20, outputTokens: 6 } },
    ] } satisfies KarbotTurnInput)
    await environment.run(karbotTurnActivity, { ...base, threadKey: session.id, runKey: 'TEST rounds turn two', text: 'TEST fetch two more', fakeSteps: [
      { text: '', toolCalls: [{ id: 'TEST-r2-a', name: 'web_fetch', args: { url: 'https://c.example.test/' } }], usage: { inputTokens: 30, outputTokens: 7 } },
      { text: '', toolCalls: [{ id: 'TEST-r2-b', name: 'web_fetch', args: { url: 'https://d.example.test/' } }], usage: { inputTokens: 40, outputTokens: 8 } },
      { text: 'TEST done two.', usage: { inputTokens: 50, outputTokens: 9 } },
    ] } satisfies KarbotTurnInput)
    const childId = randomUUID()
    await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${session.id}`, type: 't.subagent.launched', payload: { sessionId: session.id, childId, name: 'TEST round child', goal: 'TEST goal', parentSessionId: session.id, parentWorkflowId: 'unknown' } })
    await projectNewEvents(pool)
    await environment.run(karbotTurnActivity, { ...base, threadKey: `agent:${childId}`, runKey: 'TEST rounds child turn', text: 'TEST child turn', toolAllow: [], fakeSteps: [
      { text: 'TEST child done.', usage: { inputTokens: 7, outputTokens: 3 } },
    ] } satisfies KarbotTurnInput)
    await projectNewEvents(pool)

    // 6 provider calls, 4 tool calls: exact invariant, zero missing.
    const rounds = await pool.query<{ id: number; run_id: string; thread_key: string; session_id: string | null; sector_id: string | null; parent_thread_key: string | null; kind: string; round: number; attempt: number; model: string; provider: string; input_tokens: number; output_tokens: number; cached_tokens: number; outcome: string; error_code: string | null; request_ref: string | null; response_ref: string | null }>(
      'SELECT * FROM execution_rounds ORDER BY id')
    expect(rounds.rows).toHaveLength(6)
    const tools = await pool.query<{ id: number; round_id: number | null; thread_key: string; tool: string; args_hash: string; args_ref: string | null; result_ref: string | null; outcome: string; latency_ms: number | null }>(
      'SELECT * FROM tool_calls ORDER BY id')
    expect(tools.rows).toHaveLength(4)

    // Kinds and attribution follow identity, never model output.
    expect(rounds.rows.map((row) => row.kind).sort()).toEqual(['chat', 'chat', 'chat', 'chat', 'chat', 'subagent'])
    expect(rounds.rows.filter((row) => row.kind === 'subagent')).toHaveLength(1)
    expect(rounds.rows.find((row) => row.kind === 'subagent')).toMatchObject({ thread_key: `agent:${childId}`, parent_thread_key: session.id, round: 1 })
    expect(rounds.rows.filter((row) => row.kind === 'chat').every((row) => row.parent_thread_key === null)).toBe(true)
    expect(new Set(rounds.rows.map((row) => row.sector_id))).toEqual(new Set([null]))

    // Every row is a complete ok round on attempt 1 of the fake provider.
    for (const row of rounds.rows) {
      expect(row).toMatchObject({ attempt: 1, model: 'unknown', provider: 'fake', outcome: 'ok', error_code: null })
      expect(row.request_ref).toMatch(/^execution-records\//)
      expect(row.response_ref).toMatch(/^execution-records\//)
    }
    expect(rounds.rows.reduce((sum, row) => sum + row.input_tokens, 0)).toBe(157)
    expect(rounds.rows.reduce((sum, row) => sum + row.output_tokens, 0)).toBe(38)
    expect(rounds.rows.find((row) => row.run_id === 'TEST rounds turn one' && row.round === 1)).toMatchObject({ input_tokens: 10, output_tokens: 5 })

    // Every tool row links to its round; refs point at the tool-result record.
    expect(tools.rows.every((row) => row.round_id !== null)).toBe(true)
    expect(tools.rows.every((row) => row.tool === 'web_fetch' && row.outcome === 'ok')).toBe(true)
    expect(tools.rows.every((row) => row.result_ref !== null && row.args_ref === null)).toBe(true)
    const linked = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tool_calls t JOIN execution_rounds r ON r.id = t.round_id WHERE t.thread_key = r.thread_key AND r.started_at <= t.at`)
    expect(linked.rows[0]?.n).toBe(4)

    // The execution journal carries the same rounds as content records.
    const journal = await pool.query<{ kind: string; n: number }>(
      `SELECT payload->>'kind' AS kind, count(*)::int AS n FROM events WHERE type = 't.execution.recorded' GROUP BY 1 ORDER BY 1`)
    expect(Object.fromEntries(journal.rows.map((row) => [row.kind, row.n]))).toEqual({ request: 6, response: 6, 'tool-result': 4 })
  }, 60000)
})
