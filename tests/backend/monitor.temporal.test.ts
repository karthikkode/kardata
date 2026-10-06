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

  it('returns stopped when a tick reports the row stopped', async () => {
    const [{ Client }, { connectClient, connectWorker }, { createLaneWorker }, { msToTs }] = await Promise.all([
      import('@temporalio/client'), import('../../backend/src/temporal/connection.js'),
      import('../../backend/src/temporal/worker.js'), import('@temporalio/common'),
    ])
    const connection = await connectClient(), native = await connectWorker()
    const namespace = 'test-monitor-rowstop-' + randomUUID()
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client = new Client({ connection, namespace })
    const queue = 'kardata-test-monitor-rowstop-' + randomUUID()
    let ticks = 0
    const worker = await createLaneWorker({
      lane: 'turn', connection: native, namespace, taskQueue: queue,
      workflowsPath: join(import.meta.dirname, '../../backend/src/temporal/workflows/turn-bundle.ts'),
      activities: {
        monitorTickActivity: async () => { ticks++; return { ticked: false, skipped: 'stopped' } },
        finishMonitorActivity: async () => ({ finished: true }),
      },
    })
    const running = worker.run()
    void running.catch(() => undefined)
    try {
      const handle = await client.workflow.start('karbotMonitor', {
        workflowId: `karbot-monitor-${randomUUID()}`, taskQueue: queue,
        args: [{ monitorId: randomUUID(), everyMs: 100, untilMs: Date.now() + 3600000 }],
      })
      // Without the return-on-stopped the run ignores the skip and ticks
      // dead until untilMs: cap the wait so the regression fails in
      // seconds, not at the suite timeout.
      const result = await Promise.race([handle.result(), new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 15000))])
      expect(result).toBe('stopped')
      expect(ticks).toBe(1)
    } finally {
      worker.shutdown()
      await running
      await native.close()
      await connection.close()
    }
  }, 60000)

  it('honors a stop landing on the final tick instead of continuing as new', async () => {
    const [{ Client }, { connectClient, connectWorker }, { createLaneWorker }, { msToTs }] = await Promise.all([
      import('@temporalio/client'), import('../../backend/src/temporal/connection.js'),
      import('../../backend/src/temporal/worker.js'), import('@temporalio/common'),
    ])
    const connection = await connectClient(), native = await connectWorker()
    const namespace = 'test-monitor-prestop-' + randomUUID()
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client = new Client({ connection, namespace })
    const queue = 'kardata-test-monitor-prestop-' + randomUUID()
    let ticks = 0
    let releaseFinalTick!: () => void
    const finalTickGate = new Promise<void>((resolve) => { releaseFinalTick = resolve })
    const worker = await createLaneWorker({
      lane: 'turn', connection: native, namespace, taskQueue: queue,
      workflowsPath: join(import.meta.dirname, '../../backend/src/temporal/workflows/turn-bundle.ts'),
      activities: {
        monitorTickActivity: async () => {
          ticks++
          // Hold the 100th (final) tick open so the stop deterministically
          // lands between the last in-loop check and CAN.
          if (ticks === 100) await finalTickGate
          return { ticked: true }
        },
        finishMonitorActivity: async () => ({ finished: true }),
      },
    })
    const running = worker.run()
    void running.catch(() => undefined)
    try {
      const handle = await client.workflow.start('karbotMonitor', {
        workflowId: `karbot-monitor-${randomUUID()}`, taskQueue: queue,
        args: [{ monitorId: randomUUID(), everyMs: 1, untilMs: Date.now() + 3600000 }],
      })
      await vi.waitFor(() => expect(ticks).toBe(100), { timeout: 30000 })
      await handle.signal('monitorStop')
      releaseFinalTick()
      const result = await Promise.race([handle.result(), new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 20000))])
      expect(result).toBe('stopped')
      // A lost stop continues as new and keeps ticking past 100.
      expect(ticks).toBe(100)
    } finally {
      worker.shutdown()
      await running
      await native.close()
      await connection.close()
    }
  }, 90000)
})
