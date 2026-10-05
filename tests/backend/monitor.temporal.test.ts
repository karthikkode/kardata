import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1' && !!TEST_DATABASE_URL

describe.skipIf(!ENABLED)('karbotMonitor timer workflow [F:backend.workflow.monitor.karbotMonitor] [F:backend.workflow.monitor.monitorStopSignal] [F:backend.activity.monitor.monitorTickActivity] [F:backend.activity.monitor.finishMonitorActivity]', () => {
  it('fires repeated ticks, then stops on signal', async () => {
    const [{ Client }, { connectClient, connectWorker }, { createLaneWorker }, { msToTs }] = await Promise.all([
      import('@temporalio/client'), import('../../backend/src/temporal/connection.js'),
      import('../../backend/src/temporal/worker.js'), import('@temporalio/common'),
    ])
    const connection = await connectClient(), native = await connectWorker()
    const namespace = 'test-monitor-' + randomUUID()
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client = new Client({ connection, namespace })
    const queue = 'kardata-test-monitor-' + randomUUID()
    const ticks: string[] = []
    const worker = await createLaneWorker({
      lane: 'turn', connection: native, namespace, taskQueue: queue,
      workflowsPath: join(import.meta.dirname, '../../backend/src/temporal/workflows/turn-bundle.ts'),
      activities: {
        monitorTickActivity: async (input: { monitorId: string }) => { ticks.push(input.monitorId); return { ticked: true } },
        finishMonitorActivity: async () => ({ finished: true }),
      },
    })
    const running = worker.run()
    void running.catch(() => undefined)
    try {
      const monitorId = randomUUID()
      const handle = await client.workflow.start('karbotMonitor', {
        workflowId: `karbot-monitor-${monitorId}`, taskQueue: queue,
        args: [{ monitorId, everyMs: 300, untilMs: Date.now() + 3600000 }],
      })
      await vi.waitFor(() => expect(ticks.length).toBeGreaterThanOrEqual(3), { timeout: 20000 })
      expect(ticks.every((tick) => tick === monitorId)).toBe(true)
      await handle.signal('monitorStop')
      await expect(handle.result()).resolves.toBe('stopped')
    } finally {
      worker.shutdown()
      await running
      await native.close()
      await connection.close()
    }
  }, 60000)

  it('stops automatically at until', async () => {
    const [{ Client }, { connectClient, connectWorker }, { createLaneWorker }, { msToTs }] = await Promise.all([
      import('@temporalio/client'), import('../../backend/src/temporal/connection.js'),
      import('../../backend/src/temporal/worker.js'), import('@temporalio/common'),
    ])
    const connection = await connectClient(), native = await connectWorker()
    const namespace = 'test-monitor-until-' + randomUUID()
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client = new Client({ connection, namespace })
    const queue = 'kardata-test-monitor-until-' + randomUUID()
    let finished = 0
    const worker = await createLaneWorker({
      lane: 'turn', connection: native, namespace, taskQueue: queue,
      workflowsPath: join(import.meta.dirname, '../../backend/src/temporal/workflows/turn-bundle.ts'),
      activities: {
        monitorTickActivity: async () => ({ ticked: true }),
        finishMonitorActivity: async () => { finished++; return { finished: true } },
      },
    })
    const running = worker.run()
    void running.catch(() => undefined)
    try {
      const handle = await client.workflow.start('karbotMonitor', {
        workflowId: `karbot-monitor-${randomUUID()}`, taskQueue: queue,
        args: [{ monitorId: randomUUID(), everyMs: 100, untilMs: Date.now() + 250 }],
      })
      await expect(handle.result()).resolves.toBe('until')
      expect(finished).toBe(1)
    } finally {
      worker.shutdown()
      await running
      await native.close()
      await connection.close()
    }
  }, 60000)
})
