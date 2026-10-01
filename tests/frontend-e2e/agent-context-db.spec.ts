// UI -> production HTTP -> real Temporal -> scripted provider -> real MCP/DB.
// One prestarted test-owned session isolates its task queue; no Meta claim.
import { expect, test } from '@playwright/test'

test.use({ video: 'on', actionTimeout: 10_000 })
test('general Karbot reads own local and authorized sector context through real agent tools', async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL || process.env.KARDATA_TEMPORAL_TEST !== '1', 'needs isolated Postgres and real Temporal gate')
  test.setTimeout(120_000)
  const [{ Pool }, { randomUUID }, { join }, { mkdtempSync }, { tmpdir }, { ensureTestDb }, { buildApp }, db, { projectNewEvents }, connectivity, { TemporalRunsGateway }, { createLaneWorker }, activities, { Client }] = await Promise.all([
    import('pg'), import('node:crypto'), import('node:path'), import('node:fs'), import('node:os'), import('../backend/db-helper.js'),
    import('../../backend/src/app.js'), import('../../backend/src/db/index.js'), import('../../backend/src/projector.js'),
    import('../../backend/src/temporal/connection.js'), import('../../backend/src/temporal/gateway.js'), import('../../backend/src/temporal/worker.js'),
    import('../../backend/src/temporal/activities/turn.js'), import('@temporalio/client'),
  ])
  const { hashKey } = await import('../../backend/src/auth/keys.js')
  const original = new Map(['DATABASE_URL','KARDATA_PROVIDER','KARDATA_MCP_URL','KARDATA_MCP_TOKEN','KARDATA_WORKER_TOKEN','KARDATA_ARCHIVE_DIR'].map((name) => [name, process.env[name]]))
  const url = await ensureTestDb('kardata_test_browser_context')
  const pool = new Pool({ connectionString: url })
  const token = 'e2e-test-key', scope = { tenantId: 'TEST browser context', projectId: null }
  process.env.DATABASE_URL = url; process.env.KARDATA_PROVIDER = 'fake'
  process.env.KARDATA_MCP_TOKEN = token; process.env.KARDATA_WORKER_TOKEN = token
  process.env.KARDATA_ARCHIVE_DIR = mkdtempSync(join(tmpdir(), 'kardata-browser-context-'))
  const [{ Runtime }, { createWorkerLogger }] = await Promise.all([import('@temporalio/worker'), import('../../backend/src/observability/logging.js')])
  Runtime.install({ logger: createWorkerLogger() })
  const connection = await connectivity.connectWorker(), clientConnection = await connectivity.connectClient()
  const client = new Client({ connection: clientConnection, namespace: connectivity.temporalNamespace() })
  const app = buildApp({ pool, runs: new TemporalRunsGateway(pool, clientConnection), auth: true, corsOrigins: ['http://127.0.0.1:5174'] })
  let worker: Awaited<ReturnType<typeof createLaneWorker>> | undefined, run: Promise<void> | undefined
  const toolReturns: unknown[] = []
  app.addHook('onSend', async (request, _reply, payload) => {
    const body = request.body as { method?: string; params?: { name?: string } } | undefined
    if (request.url === '/mcp' && body?.method === 'tools/call' && typeof payload === 'string') toolReturns.push({ name: body.params?.name, response: JSON.parse(payload) })
    return payload
  })
  let owned: ReturnType<typeof client.workflow.getHandle> | undefined
  const httpStatus: Array<{ path: string; status: number }> = []
  let streamRequests = 0
  page.on('request', (request) => {
    if (/\/v1\/threads\/[^/]+\/events$/.test(new URL(request.url()).pathname)) streamRequests += 1
  })
  page.on('response', (response) => { const path = new URL(response.url()).pathname; if (path.startsWith('/v1/')) httpStatus.push({ path, status: response.status() }) })
  try {
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['TEST browser agent', hashKey(token), scope.tenantId, 'operator'])
    const sectorId = `sec-${randomUUID()}`
    await db.createSector(pool, { sectorId, name: 'TEST authorized shared sector', topic: 'TEST approved public scope', scope })
    const session = await db.createSession(pool, 'TEST general context reader', scope)
    await projectNewEvents(pool)
    await db.saveThreadContext(pool, session.id, { version: 0, notes: 'TEST independent local notes' }, scope)
    const backendUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    process.env.KARDATA_MCP_URL = `${backendUrl}/mcp`
    const queue = `kardata-test-browser-context-${randomUUID()}`
    worker = await createLaneWorker({ lane: 'turn', connection, namespace: connectivity.temporalNamespace(), taskQueue: queue,
      workflowsPath: join(import.meta.dirname, '../../backend/src/temporal/workflows/turn-bundle.ts'),
      activities: { appendEventActivity: activities.appendEventActivity, karbotTurnActivity: activities.karbotTurnActivity } })
    run = worker.run()
    // Observe now to avoid an unhandled rejection; the original is awaited in cleanup.
    void run.catch(() => undefined)
    // This exact UUID workflow is the only workflow owned or cancelled by the test.
    owned = await client.workflow.start('sessionRun', { workflowId: `session-run-${session.id}`, taskQueue: queue, args: [{ sessionId: session.id, fakeSteps: [
      { text: '', toolCalls: [{ id: 'TEST local read', name: 'db.get_local_context', args: {} }, { id: 'TEST sector read', name: 'db.get_global_context', args: { sectorId } }] },
      { text: 'TEST context tools completed successfully' },
    ] }] })
    await page.route('**/v1/**', async (route) => {
      const target = new URL(route.request().url())
      await route.continue({ url: `${backendUrl}${target.pathname}${target.search}` })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open chat' }).click()
    const chat = page.getByRole('complementary', { name: 'Assistant chat' })
    await chat.getByRole('textbox', { name: 'Message the agent' }).fill('TEST inspect my local context and the authorized sector')
    await chat.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(chat.getByText('TEST context tools completed successfully', { exact: true })).toBeVisible({ timeout: 30_000 })
    // A streamed answer is not yet the durable terminal message.
    await expect(chat.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(chat.getByRole('button', { name: 'Stop reply', exact: true })).toHaveCount(0)
    await projectNewEvents(pool)
    const transcript = await db.getThread(pool, session.id)
    const toolRows = transcript?.messages.filter((message) => message.kind === 'tool') ?? []
    expect(toolRows).toHaveLength(2)
    expect(toolRows.map((message) => message.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'db.get_local_context', state: 'done' }), expect.objectContaining({ name: 'db.get_global_context', state: 'done' }),
    ]))
    expect(JSON.stringify(toolReturns)).toContain('TEST independent local notes')
    expect(JSON.stringify(toolReturns)).toContain('TEST approved public scope')
    await expect(chat.getByRole('button', { name: 'Send message', exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/visual/agent-context-real-tools.png', animations: 'disabled' })

    // Disrupt only the inventoried LISTEN lease in this UUID-isolated DB.
    // No workflow/provider/data is killed, and the browser drives reconnect.
    await chat.getByRole('textbox', { name: 'Message the agent' }).fill('TEST unsent draft survives connection recovery')
    const listeners = await pool.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = 'LISTEN kardata_outbox' AND state = 'idle' AND pid <> pg_backend_pid()",
    )
    expect(listeners.rows).toHaveLength(1)
    const requestsBeforeDisconnect = streamRequests
    const terminated = await pool.query<{ stopped: boolean }>('SELECT pg_terminate_backend($1) AS stopped', [listeners.rows[0]?.pid])
    expect(terminated.rows[0]?.stopped).toBe(true)
    await expect.poll(() => streamRequests, { timeout: 10_000 }).toBeGreaterThan(requestsBeforeDisconnect)
    await expect.poll(async () => (await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND query = 'LISTEN kardata_outbox' AND state = 'idle'",
    )).rows[0]?.count).toBe('1')
    await expect(chat.getByRole('textbox', { name: 'Message the agent' })).toHaveValue('TEST unsent draft survives connection recovery')
    await expect(chat.getByText('TEST context tools completed successfully', { exact: true })).toHaveCount(1)
    await expect(chat.getByRole('button', { name: 'Send message', exact: true })).toBeVisible()
    await expect(chat.getByRole('button', { name: 'Stop reply', exact: true })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/visual/agent-context-db-reconnected.png', animations: 'disabled' })
  } catch (error) {
    console.error(JSON.stringify({ testHttpStatus: httpStatus }))
    if (!page.isClosed()) await page.screenshot({ path: 'test-results/visual/agent-context-failure.png', animations: 'disabled' })
    throw error
  } finally {
    // A closed browser must not prevent cancellation/connection cleanup.
    try { if (!page.isClosed()) await page.goto('about:blank') } finally {
      try { if (owned) { await owned.signal('runCancel'); await owned.result() } } finally {
        worker?.shutdown()
        try { await run } finally {
          try { await app.close() } finally {
            await clientConnection.close(); await connection.close(); await pool.end()
            await db.workerPoolFromEnv().end()
            for (const [name, value] of original) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
          }
        }
      }
    }
  }
})
