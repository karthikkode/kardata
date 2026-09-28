import { Client as WorkflowClient } from '@temporalio/client'
import { Context } from '@temporalio/activity'
import { Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectClient, connectWorker, temporalAddress, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { allLaneConfigs, laneConfig } from '../../backend/src/temporal/lanes.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import type { NativeConnection } from '@temporalio/worker'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const WORKFLOWS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'temporal', 'probe-workflows.ts')

interface Attempt {
  worker: string
  attempt: number
  done: boolean
}

const attempts: Attempt[] = []

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(100)
  }
}

/**
 * Crash-emulation activity. Attempt 1 heartbeats twice then goes silent
 * forever (the server-side signature of a dead worker: heartbeats stop).
 * Any later attempt — the redelivery — completes immediately.
 */
function makeRendezvous(label: string, gate: Promise<void>) {
  return async function rendezvous(): Promise<string> {
    const attempt = Context.current().info.attempt
    const record: Attempt = { worker: label, attempt, done: false }
    attempts.push(record)
    if (attempt === 1) {
      Context.current().heartbeat('beat-1')
      await sleep(200)
      Context.current().heartbeat('beat-2')
      await gate
      record.done = true
      return `${label}-late`
    }
    record.done = true
    return `${label}-recovered`
  }
}

function makeQuick(label: string) {
  return async function quick(): Promise<string> {
    const attempt = Context.current().info.attempt
    attempts.push({ worker: label, attempt, done: true })
    return 'quick-ok'
  }
}

function makeBlocking(label: string, gate: Promise<void>) {
  return async function blocking(): Promise<string> {
    const attempt = Context.current().info.attempt
    attempts.push({ worker: label, attempt, done: false })
    await gate
    const record = attempts[attempts.length - 1]
    if (record) record.done = true
    return 'blocking-ok'
  }
}

describe('lane topology (B2.1)', () => {
  it('names one versioned queue per lane with sane concurrency', () => {
    const configs = allLaneConfigs()
    expect(configs).toHaveLength(4)
    const queues = configs.map((config) => config.taskQueue)
    expect(new Set(queues).size).toBe(4)
    for (const config of configs) {
      expect(config.taskQueue).toMatch(/^kardata-(turn|tool|research|sweep)-v1$/)
      expect(config.maxConcurrentWorkflowTaskExecutions).toBeGreaterThan(0)
      expect(config.maxConcurrentActivityTaskExecutions).toBeGreaterThan(0)
    }
    expect(laneConfig('sweep').maxConcurrentActivityTaskExecutions).toBeLessThan(
      laneConfig('tool').maxConcurrentActivityTaskExecutions,
    )
  })

  it('temporal address defaults locally and honors the environment', () => {
    const previous = process.env['TEMPORAL_ADDRESS']
    delete process.env['TEMPORAL_ADDRESS']
    expect(temporalAddress()).toBe('localhost:7233')
    process.env['TEMPORAL_ADDRESS'] = 'temporal:7233'
    expect(temporalAddress()).toBe('temporal:7233')
    if (previous === undefined) delete process.env['TEMPORAL_ADDRESS']
    else process.env['TEMPORAL_ADDRESS'] = previous
    expect(temporalNamespace()).toBe(process.env['TEMPORAL_NAMESPACE'] ?? 'default')
  })
})

describe.skipIf(!ENABLED)('worker fleet against Temporal (B2.1)', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let counter = 0

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
  }, 60_000)

  afterAll(async () => {
    await connection.close()
  })

  function uniqueQueue(lane: string): string {
    counter += 1
    return `kardata-test-${lane}-${Date.now()}-${counter}`
  }

  async function startWorker(
    lane: 'turn' | 'tool',
    taskQueue: string,
    activities: Record<string, () => Promise<string>>,
  ): Promise<{ worker: Worker; run: Promise<void> }> {
    const worker = await createLaneWorker({
      lane,
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities,
      taskQueue,
    })
    const run = worker.run()
    run.catch(() => undefined)
    return { worker, run }
  }

  it('an abandoned attempt is redelivered after the heartbeat timeout (crash path)', async () => {
    attempts.length = 0
    const gate = deferred()
    const taskQueue = uniqueQueue('tool')
    const lane = await startWorker('tool', taskQueue, { rendezvous: makeRendezvous('A', gate.promise) })

    const workflowId = `crash-proof-${Date.now()}`
    await client.workflow.start('blockingWorkflow', {
      taskQueue,
      workflowId,
      args: [],
    })
    await waitFor(() => attempts.length >= 1, 30_000, 'attempt 1 to start on worker A')

    // Worker A stops polling with the attempt stuck silent inside it. The
    // server fires the heartbeat timeout and reschedules: the crash path.
    lane.worker.shutdown()
    const laneB = await startWorker('tool', taskQueue, { rendezvous: makeRendezvous('B', gate.promise) })

    const handle = client.workflow.getHandle(workflowId)
    const result = await handle.result()
    expect(result).toBe('B-recovered')
    expect(attempts.some((attempt) => attempt.worker === 'A' && attempt.attempt === 1)).toBe(true)
    expect(attempts.some((attempt) => attempt.worker === 'B' && attempt.attempt >= 2 && attempt.done)).toBe(true)

    gate.release()
    laneB.worker.shutdown()
    await Promise.all([lane.run, laneB.run])
  }, 120_000)

  it('a saturated tool lane leaves the turn lane unaffected', async () => {
    attempts.length = 0
    const gate = deferred()
    const toolQueue = uniqueQueue('tool')
    const turnQueue = uniqueQueue('turn')
    const tool = await startWorker('tool', toolQueue, { rendezvous: makeBlocking('tool', gate.promise) })
    const turn = await startWorker('turn', turnQueue, { quick: makeQuick('turn') })

    const blockingId = `saturated-${Date.now()}`
    await client.workflow.start('blockingWorkflow', { taskQueue: toolQueue, workflowId: blockingId, args: [] })
    await waitFor(() => attempts.length >= 1, 30_000, 'tool attempt to start')

    const quickId = `quick-${Date.now()}`
    await client.workflow.start('quickWorkflow', { taskQueue: turnQueue, workflowId: quickId, args: [] })
    const quickResult = await client.workflow.getHandle(quickId).result()
    expect(quickResult).toBe('quick-ok')

    gate.release()
    expect(await client.workflow.getHandle(blockingId).result()).toBe('blocking-ok')
    tool.worker.shutdown()
    turn.worker.shutdown()
    await Promise.all([tool.run, turn.run])
  }, 120_000)
})
