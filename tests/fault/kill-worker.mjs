// Child-process lane worker for the F4/F5 SIGKILL drills. Plain .mjs on
// backend dist (no TS loader in the fault env): the parent SIGKILLs this
// process mid-turn, then spawns a replacement on the same task queue.
// Scripted provider (round 1 tool call, round 2 hangs on attempt 1) plus a
// file-backed idempotent mock MCP: the effects file survives the kill, so
// the parent can prove exactly-once effects across the worker death.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { env } from 'node:process'
import { setTimeout } from 'node:timers'
import { Pool } from 'pg'
import { Context } from '@temporalio/activity'
import { appendEventActivity, executeKarbotTurn } from '../../backend/dist/temporal/activities/turn.js'
import { createRoundRecorder } from '../../backend/dist/temporal/activities/turn-rounds.js'
import { connectWorker, temporalNamespace } from '../../backend/dist/temporal/connection.js'
import { createLaneWorker } from '../../backend/dist/temporal/worker.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUN_WORKFLOWS_PATH = join(ROOT, 'backend', 'src', 'temporal', 'workflows', 'run.ts')

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

// File-backed idempotent receiver: simulates the real /mcp server, whose
// seen-set lives server-side and survives worker death (F12 proves the
// server; F4/F5 prove the turn sends stable keys across attempts).
function makeMcp(effectsFile, markerFile, toolName) {
  return {
    async listTools() {
      return [{ name: toolName, description: `TEST ${toolName}`, parameters: { type: 'object', properties: {} } }]
    },
    async callTool(name, args, operationId) {
      appendFileSync(effectsFile, `call ${name} ${operationId ?? 'none'} ${JSON.stringify(args)}\n`)
      const seen = existsSync(effectsFile) ? readFileSync(effectsFile, 'utf8') : ''
      if (operationId && seen.includes(`effect ${operationId}\n`)) {
        return { content: `TEST deduped ${name}` }
      }
      appendFileSync(effectsFile, `effect ${operationId ?? 'none'}\n`)
      if (markerFile) writeFileSync(markerFile, 'delegated\n')
      return { content: `TEST ${name} done` }
    },
  }
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
  if (script !== 'f4' && script !== 'f5') throw new Error(`TEST kill-worker: bad FAULT_SCRIPT ${script}`)
  const effectsFile = required('FAULT_EFFECTS')
  const markerFile = script === 'f5' ? required('FAULT_MARKER') : ''
  const databaseUrl = required('DATABASE_URL')
  env['TEMPORAL_ADDRESS'] = env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'

  const toolName = script === 'f5' ? 'TEST_delegate' : 'TEST_effect'
  const toolCall = {
    id: 'TEST-call-0',
    name: toolName,
    args: script === 'f5' ? { goal: 'TEST child' } : { note: 'TEST x' },
  }
  const mcp = makeMcp(effectsFile, markerFile, toolName)
  const pool = new Pool({ connectionString: databaseUrl })
  const connection = await connectWorker()
  const worker = await createLaneWorker({
    lane: 'turn',
    connection,
    namespace: temporalNamespace(),
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
  await worker.run()
}

await main()
