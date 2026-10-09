// Pure unit tests for the reconciliation supervisors: idempotent starts,
// already-started acceptance, and failure propagation. No Temporal server:
// the client module is mocked, error classes stay real.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import {
  ensureExecutionReconciliation,
  ensureFileAdmissionReconciliation,
} from '../../backend/src/temporal/reconciliation-start.js'

const temporal = vi.hoisted(() => ({ connect: vi.fn(), start: vi.fn(), close: vi.fn() }))
vi.mock('@temporalio/client', async (original) => {
  const mod = await original<typeof import('@temporalio/client')>()
  return {
    ...mod,
    Connection: {
      ...mod.Connection,
      connect: temporal.connect,
    },
    Client: class FakeClient {
      workflow = { start: temporal.start }
      constructor(public readonly opts: unknown) {}
    },
  }
})
vi.mock('../../backend/src/temporal/connection.js', () => ({
  temporalAddress: () => 'localhost:7233',
  temporalNamespace: () => 'unit-test',
}))

afterEach(() => { vi.clearAllMocks() })

function connection() {
  return { withDeadline: async (_deadline: number, work: () => Promise<unknown>) => work(), close: temporal.close }
}

describe('reconciliation supervisors', () => {
  it('starts the execution supervisor on the research lane', async () => {
    temporal.connect.mockResolvedValueOnce(connection())
    temporal.start.mockResolvedValueOnce({ workflowId: 'kardata-execution-reconciliation-v1' })
    await ensureExecutionReconciliation()
    expect(temporal.connect).toHaveBeenCalledWith({ address: 'localhost:7233', connectTimeout: '5s' })
    expect(temporal.start).toHaveBeenCalledWith('executionReconciliation', {
      workflowId: 'kardata-execution-reconciliation-v1',
      taskQueue: 'kardata-research-v1',
      args: [{}],
    })
    expect(temporal.close).toHaveBeenCalledOnce()
  })
  it('starts the file-admission supervisor under its own id and type', async () => {
    temporal.connect.mockResolvedValueOnce(connection())
    temporal.start.mockResolvedValueOnce({ workflowId: 'kardata-file-admission-reconciliation-v1' })
    await ensureFileAdmissionReconciliation()
    expect(temporal.start).toHaveBeenCalledWith('fileAdmissionReconciliation', {
      workflowId: 'kardata-file-admission-reconciliation-v1',
      taskQueue: 'kardata-research-v1',
      args: [{}],
    })
    expect(temporal.close).toHaveBeenCalledOnce()
  })
  it('treats an already-running supervisor as success', async () => {
    temporal.connect.mockResolvedValue(connection())
    temporal.start.mockRejectedValue(new WorkflowExecutionAlreadyStartedError('exists', 'kardata-execution-reconciliation-v1', 'run-1'))
    await ensureExecutionReconciliation()
    await ensureFileAdmissionReconciliation()
    expect(temporal.close).toHaveBeenCalledTimes(2)
  })
  it('rethrows other start failures and still closes the connection', async () => {
    temporal.connect.mockResolvedValueOnce(connection())
    const failure = new Error('namespace unknown')
    temporal.start.mockRejectedValueOnce(failure)
    await expect(ensureExecutionReconciliation()).rejects.toBe(failure)
    expect(temporal.close).toHaveBeenCalledOnce()
    temporal.connect.mockResolvedValueOnce(connection())
    temporal.start.mockRejectedValueOnce(failure)
    await expect(ensureFileAdmissionReconciliation()).rejects.toBe(failure)
    expect(temporal.close).toHaveBeenCalledTimes(2)
  })
})
