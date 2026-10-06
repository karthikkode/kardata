// Child-process lane worker for the F4/F5 SIGKILL drills. Plain .mjs on
// backend dist (no TS loader in the fault env): the parent SIGKILLs this
// process mid-turn, then spawns a replacement on the same task queue.
// Scripted provider (round 1 delegates, round 2 hangs on attempt 1) plus
// the REAL in-process /mcp (app.inject, open mode) over the real DB:
// retries carry stable (run,round,index) operationIds, so the parent can
// prove the server executed the delegate once and replayed the recorded
// child on retry. A second worker serves the turn queue in the drill
// namespace so delegateParent and the child run without touching owner
// turns (f16 needs no delegation and skips it).
import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import process, { env } from 'node:process'
import { setTimeout } from 'node:timers'
import { Pool } from 'pg'
import { Context } from '@temporalio/activity'
import { StreamableMcpClient } from '@kardata/agents'
import { persistExecutionRecord, resolveArchiveTarget } from '../../backend/dist/archive/targets.js'
import { appendEventActivity, executeKarbotTurn, karbotTurnActivity } from '../../backend/dist/temporal/activities/turn.js'
import { createRoundRecorder } from '../../backend/dist/temporal/activities/turn-rounds.js'
import { PRODUCT_TOOLS, productMcpClient } from '../../backend/dist/temporal/activities/turn-palettes.js'
import { buildApp } from '../../backend/dist/app.js'
import { connectWorker, temporalNamespace } from '../../backend/dist/temporal/connection.js'
import { TemporalRunsGateway } from '../../backend/dist/temporal/runs-gateway.js'
import { createLaneWorker } from '../../backend/dist/temporal/worker.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUN_WORKFLOWS_PATH = join(ROOT, 'backend', 'src', 'temporal', 'workflows', 'run.ts')
const TURN_BUNDLE_PATH = join(ROOT, 'backend', 'src', 'temporal', 'workflows', 'turn-bundle.ts')

// F16 caps this process with RLIMIT_FSIZE: writes fail EFBIG instead of
// killing the worker, so the drill proves honest handling, not a crash.
process.on('SIGXFSZ', () => {})

function required(name) {
  const value = env[name]
  if (!value) throw new Error(`TEST kill-worker: missing env ${name}`)
  return value
}

function zeroUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Real MCP over the in-process app: the same routes, receipt path and
// delegateSubagent production turns use, minus the network. Open mode
// (approver role); the execution binding still verifies against the
// shared worker token, and the Karbot palette rides the grant header.
function makeMcp(app, token, threadKey) {
  const signature = createHmac('sha256', token).update(threadKey).digest('hex')
  const transport = new StreamableMcpClient({
    endpoint: 'http://fault-mcp.invalid/mcp',
    token,
    execution: { threadKey, signature },
    grant: [...PRODUCT_TOOLS],
    timeoutMs: 300_000,
    fetchFn: async (_url, init) => {
      const response = await app.inject({ method: 'POST', url: '/mcp', headers: init.headers, payload: init.body })
      return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, text: async () => response.body }
    },
  })
  return productMcpClient(transport)
}

// One adapter per activity attempt (resolveTurnAdapter runs per execution),
// so the round counter resets on retry while the attempt selects the
// round-2 behavior: hang on attempt 1 (the kill window), succeed after.
function scriptedAdapter(toolCall) {
  let round = 0
  const attempt = Context.current().info.attempt
  return {
    providerName: 'TEST-kill',
    chat: async () => ({ text: 'TEST unexpected chat', reasoning: '', toolCalls: [], usage: zeroUsage(), completion: 'complete' }),
    async *chatStream() {
      round += 1
      if (round === 1) {
        if (!toolCall) {
          yield { kind: 'text_delta', text: 'TEST f16 reply' }
          yield { kind: 'done', usage: zeroUsage(), completion: 'complete' }
          return
        }
        yield { kind: 'text_delta', text: 'TEST round one' }
        yield { kind: 'toolcall_start', index: 0, key: toolCall.id }
        yield { kind: 'toolcall_delta', index: 0, textAppend: JSON.stringify(toolCall.args) }
        yield { kind: 'toolcall_end', index: 0, call: toolCall }
        yield { kind: 'done', usage: zeroUsage(), completion: 'complete' }
        return
      }
      if (attempt === 1) {
        await new Promise(() => undefined)
        yield { kind: 'text_delta', text: '' }
        return
      }
      yield { kind: 'text_delta', text: 'TEST round two done' }
      yield { kind: 'done', usage: zeroUsage(), completion: 'complete' }
    },
  }
}

async function main() {
  const taskQueue = required('FAULT_TASK_QUEUE')
  const script = required('FAULT_SCRIPT')
  if (script !== 'f4' && script !== 'f5' && script !== 'f16') throw new Error(`TEST kill-worker: bad FAULT_SCRIPT ${script}`)
  const markerFile = script === 'f5' ? required('FAULT_MARKER') : ''
  const databaseUrl = required('DATABASE_URL')
  const mcpToken = env['FAULT_MCP_TOKEN'] ?? 'TEST-unused-f16-token'
  env['TEMPORAL_ADDRESS'] = env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'
  env['KARDATA_ARCHIVE_DIR'] = required('FAULT_ARCHIVE_DIR')
  env['KARDATA_MCP_TOKEN'] = mcpToken
  env['KARDATA_PROVIDER'] = 'fake'

  const archive = resolveArchiveTarget()
  const pool = new Pool({ connectionString: databaseUrl })
  const app = buildApp({ pool, runs: new TemporalRunsGateway(pool) })
  const connection = await connectWorker()
  const namespace = temporalNamespace()
  const worker = await createLaneWorker({
    lane: 'turn',
    connection,
    namespace,
    workflowsPath: RUN_WORKFLOWS_PATH,
    taskQueue,
    activities: {
      appendEventActivity,
      karbotTurnActivity: async (input) => {
        const context = Context.current()
        let settled = false
        const beating = (async () => {
          while (!settled) {
            try { context.heartbeat({ at: Date.now() }) } catch { break }
            await sleep(5000)
          }
        })()
        try {
          const toolCall = script === 'f16' ? null : {
            id: 'TEST-call-0',
            name: 'db.delegate_subagent',
            args: { sessionId: input.sessionId, goal: script === 'f4' ? 'TEST F4 effect child' : 'TEST F5 child' },
          }
          const mcp = makeMcp(app, mcpToken, input.threadKey)
          // The marker means the delegate RESPONSE was observed, so the
          // server already committed intent + result: the retry replays.
          const rawCallTool = mcp.callTool.bind(mcp)
          mcp.callTool = async (name, args, operationId) => {
            const outcome = await rawCallTool(name, args, operationId)
            if (markerFile) writeFileSync(markerFile, 'delegated\n')
            return outcome
          }
          const recorder = createRoundRecorder(pool, `session:${input.sessionId}`, () => undefined)
          return await executeKarbotTurn(input, {
            loadSessionModel: async () => undefined,
            loadHistory: async () => [],
            resolveTurnAdapter: () => scriptedAdapter(toolCall),
            mcp,
            publishDelta: async () => {},
            publishReasoning: async () => {},
            publishTool: async () => {},
            log: () => {},
            persistExecution: async (_round, _kind, record) => {
              await persistExecutionRecord(archive, input.sessionId, record)
            },
            attempt: context.info.attempt,
            recordRound: (fields) => recorder.recordRound(fields),
            recordToolCall: (fields) => recorder.recordToolCall(fields),
          })
        } finally {
          settled = true
          await beating
        }
      },
    },
  })
  if (script === 'f16') {
    await worker.run()
    return
  }
  // Turn-queue worker in the drill namespace: serves the drill's
  // delegateParent accept plus the launched child's first turn, so the
  // drill never borrows (or blocks on) an owner-facing worker.
  const turnWorker = await createLaneWorker({
    lane: 'turn',
    connection,
    namespace,
    workflowsPath: TURN_BUNDLE_PATH,
    activities: { appendEventActivity, karbotTurnActivity },
  })
  await Promise.all([worker.run(), turnWorker.run()])
}

await main()
