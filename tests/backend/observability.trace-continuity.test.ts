// Trace continuity end to end (P3.2.6). One sessionRun started under a
// fixed trace id: the turn activity observes it, a scripted turn's
// provider rounds carry it, the worker's /mcp callback continues it
// server-side (via app.inject, no network), and the activity's DB event
// stores it with client system. The HTTP ingress leg (traceparent →
// trace_id) is proven in observability.traces.test.ts; this file proves
// the Temporal spine: client → workflow → activity → provider/MCP/DB.
import { dirname, join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { FakeProvider, StreamableMcpClient, createClosedMcpClient } from '@kardata/agents'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, findEventByKey } from '../../backend/src/db/index.js'
import { createLogger } from '../../backend/src/observability/logging.js'
import {
  activeTraceId,
  activityLogFields,
  ambientTraceparent,
  ensureTemporalTracing,
  temporalClientInterceptors,
  withTraceContext,
} from '../../backend/src/observability/temporal-tracing.js'
import { executeKarbotTurn } from '../../backend/src/temporal/activities/turn.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1' && !!TEST_DATABASE_URL
const WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'temporal', 'workflows', 'turn-bundle.ts')
const TRACE_ID = 'd'.repeat(32)

describe.skipIf(!ENABLED)('trace continuity across Temporal, provider, MCP and DB (P3.2.6) [F:backend.activity.turn.appendEventActivity] [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.executeKarbotTurn] [F:backend.workflow.run.sessionRun] [F:backend.activity.turn_prompts.CONTEXT_PROPOSAL_NUDGE] [F:backend.activity.turn_prompts.CONTEXT_REWRITE_PREAMBLE] [F:backend.activity.turn.ResearchPausedError] [F:backend.workflow.inbox_queue.normalizeQueueItem] [F:backend.workflow.inbox_queue.queueItemsQuery] [F:backend.workflow.inbox_queue.queueRemoveUpdate] [F:backend.workflow.inbox_queue.queueReorderUpdate] [F:backend.workflow.resumable_turn.resumableTurn] [F:backend.workflow.run.DEFAULT_IDLE_TIMEOUT_MS] [F:backend.workflow.run.cancelSignal] [F:backend.workflow.run.pauseSignal] [F:backend.workflow.run.resumeSignal] [F:backend.workflow.run.sendSignal] [F:backend.workflow.run.skillSignal] [F:backend.workflow.run.stateQuery] [F:backend.workflow.run.steerSignal] [F:backend.activity.turn.sleep] [F:backend.workflow.inbox_queue.registerQueueHandlers] [F:db.index.appendEvent] [F:db.index.findEventByKey] [F:db.events.appendEvent] [F:db.events.findEventByKey] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.context_files.assertThreadFileContext] [F:db.context_files.validateFileRefs] [F:db.document_units.listDocumentUnitOrdinals] [F:db.errors.WorkspaceError] [F:db.sessions.SessionModelSelection] [F:db.execution_epochs.readActiveExecutionIdentity] [F:db.index.Db] [F:db.index.SessionModelSelection] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.workspace_threads.recordContextMeasurement] [F:db.errors.Id] [F:db.errors.checked] [F:db.file_jobs.visible] [F:db.events.KeySchema]', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let worker: Worker
  let run: Promise<void>
  let taskQueue = ''
  let pool: Pool
  let app: FastifyInstance
  const httpLines: string[] = []
  const probe = { activityTrace: undefined as string | undefined, rounds: [] as Array<Record<string, unknown>>, runKey: '' }
  let savedProvider: string | undefined

  beforeAll(async () => {
    ensureTemporalTracing()
    savedProvider = process.env['KARDATA_PROVIDER']
    process.env['KARDATA_PROVIDER'] = 'fake'
    connection = await connectWorker()
    client = new WorkflowClient({
      connection: await connectClient(),
      interceptors: { workflow: temporalClientInterceptors() },
    })
    taskQueue = `kardata-test-trace-${Date.now()}`
    const connectionString = await ensureTestDb('kardata_test_trace_continuity')
    pool = new Pool({ connectionString })
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split('\n')) {
          if (line.trim()) httpLines.push(line)
        }
        callback()
      },
    })
    app = buildApp({ pool, logger: createLogger({ op: 'trace-test' }, stream) })
    worker = await createLaneWorker({
      lane: 'turn',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: {
        appendEventActivity: async () => undefined,
        karbotTurnActivity: async (input: { sessionId: string; threadKey: string; runKey: string; text: string }) => {
          probe.activityTrace = activeTraceId()
          probe.runKey = input.runKey
          const lines: Array<Record<string, unknown>> = []
          await executeKarbotTurn(
            { sessionId: input.sessionId, threadKey: input.threadKey, runKey: input.runKey, text: input.text, fakeSteps: [{ text: 'traced reply' }] },
            {
              loadSessionModel: async () => undefined,
              loadHistory: async () => [],
              resolveTurnAdapter: () => new FakeProvider([{ text: 'traced reply' }]),
              mcp: createClosedMcpClient('trace probe runs tool-less'),
              publishDelta: async () => {},
              publishReasoning: async () => {},
              publishTool: async () => {},
              // Production spread (turn.ts): the activity join keys ride
              // every round line, so rounds join the trace in Loki.
              log: (fields) => {
                lines.push({ ...activityLogFields({ threadKey: input.threadKey, sessionId: input.sessionId }), ...fields })
              },
            },
          )
          probe.rounds = lines.filter((line) => line['op'] === 'provider.round')
          const mcp = new StreamableMcpClient({
            endpoint: 'http://trace-probe.invalid/mcp',
            token: 'trace-probe-token',
            traceparent: ambientTraceparent,
            fetchFn: async (_url, init) => {
              const response = await app.inject({ method: 'POST', url: '/mcp', headers: init.headers, payload: init.body })
              return {
                ok: response.statusCode >= 200 && response.statusCode < 300,
                status: response.statusCode,
                text: async () => response.body,
              }
            },
          })
          await mcp.listTools()
          await appendEvent(pool, { idempotencyKey: `trace-probe-${input.runKey}`, partition: 'trace:probe', type: 't.trace.probe' })
          return { reply: 'TEST traced reply', toolCalls: [] }
        },
      },
      taskQueue,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker?.shutdown()
    await run?.catch(() => undefined)
    await app?.close().catch(() => undefined)
    await pool?.end().catch(() => undefined)
    await connection?.close().catch(() => undefined)
    if (savedProvider === undefined) delete process.env['KARDATA_PROVIDER']
    else process.env['KARDATA_PROVIDER'] = savedProvider
  })

  async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  it('carries one trace id from workflow start to DB event', async () => {
    const handle = await withTraceContext(TRACE_ID, () =>
      client.workflow.start('sessionRun', {
        taskQueue,
        workflowId: `TEST-trace-session-${Date.now()}`,
        args: [{ sessionId: 'TEST-trace-session', idleTimeoutMs: 600_000 }],
      }),
    )
    try {
      await handle.signal('runSend', 'trace me')
      await waitFor(() => probe.rounds.length >= 1, 'scripted turn completes')
      // Workflow-start → activity leg: the interceptor-propagated trace.
      expect(probe.activityTrace).toBe(TRACE_ID)
      // Provider-round leg: every round line joins the trace.
      expect(probe.rounds.length).toBeGreaterThanOrEqual(1)
      for (const round of probe.rounds) {
        expect(round['trace_id']).toBe(TRACE_ID)
      }
      // MCP-callback leg: the server continued our traceparent.
      const mcpStarts = httpLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line['event'] === 'http.request.start' && line['method'] === 'POST' && line['trace_id'] === TRACE_ID)
      expect(mcpStarts.length).toBeGreaterThanOrEqual(1)
      // DB leg: the activity's event stores the trace with client system.
      const stored = await findEventByKey(pool, `trace-probe-${probe.runKey}`)
      expect(stored?.traceId).toBe(TRACE_ID)
      expect(stored?.client).toBe('system')
    } finally {
      await handle.terminate().catch(() => undefined)
    }
  }, 120_000)
})
