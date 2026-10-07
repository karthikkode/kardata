// Pure unit tests for file admission: owner inspection branches and the
// repair page state machine. No database, no Temporal server.
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { MockActivityEnvironment } from '@temporalio/testing'
import { WorkflowNotFoundError } from '@temporalio/client'
import { defaultPayloadConverter } from '@temporalio/common'
import {
  fileAdmissionPageActivity,
  inspectFileAdmissionOwner,
  reconcileFileAdmissionPage,
} from '../../backend/src/temporal/activities/file-admission.js'

const db = vi.hoisted(() => ({
  pool: {},
  project: vi.fn(),
  candidates: vi.fn(),
  boundary: vi.fn(),
  pause: vi.fn(),
  mark: vi.fn(),
  fail: vi.fn(),
}))
vi.mock('../../backend/src/projector.js', () => ({ projectNewEvents: db.project }))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  workerPoolFromEnv: () => db.pool,
  listFileAdmissionCandidates: db.candidates,
  readFileJobBoundary: db.boundary,
  pauseFileProcessingJob: db.pause,
  markFileProcessingDispatchOutcome: db.mark,
  failFileProcessingJob: db.fail,
}))
const net = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), startFileProcessing: vi.fn() }))
vi.mock('../../backend/src/temporal/connection.js', () => ({
  connectClient: net.connect,
  temporalNamespace: () => 'unit-test',
}))
vi.mock('../../backend/src/temporal/runs-gateway.js', () => ({
  TemporalRunsGateway: class FakeGateway {
    constructor(public readonly pool: unknown, public readonly connection: unknown) {}
    startFileProcessing = net.startFileProcessing
  },
}))
vi.mock('@temporalio/client', async (original) => {
  const mod = await original<typeof import('@temporalio/client')>()
  return {
    ...mod,
    Client: class FakeClient {
      options: { namespace: string }
      constructor(public readonly opts: { connection: unknown; namespace: string }) {
        this.options = { namespace: opts.namespace }
      }
      get connection(): { handles: Record<string, unknown> } {
        return (this.opts as unknown as { connection: { handles: Record<string, unknown> } }).connection
      }
      workflow = {
        getHandle: (workflowId: string) => ((this.opts as unknown as { connection: { handles: Record<string, unknown> } }).connection.handles[workflowId] ?? { describe: async () => { throw new Error(`unexpected handle ${workflowId}`) } }),
      }
    },
  }
})

afterEach(() => { vi.clearAllMocks() })

function job(overrides: Record<string, unknown> = {}) {
  return {
    jobId: randomUUID(), revision: 0, dispatchNonce: randomUUID(),
    dispatchState: 'unreserved', state: 'queued', ...overrides,
  } as never
}

function ownerClient(describe: () => Promise<unknown>, history: () => Promise<unknown>, namespace = 'unit-test') {
  const connection: Record<string, unknown> = {
    namespace,
    withDeadline: async (_deadline: number, work: () => Promise<unknown>) => work(),
    workflowService: { getWorkflowExecutionHistory: history },
    handles: {} as Record<string, unknown>,
  }
  return { connection, options: { namespace }, workflow: { getHandle: (_id: string) => ({ describe }) } }
}

function startedHistory(input: unknown) {
  return {
    history: {
      events: [
        { workflowExecutionStartedEventAttributes: { input: { payloads: [defaultPayloadConverter.toPayload(input)] } } },
      ],
    },
  }
}

describe('inspectFileAdmissionOwner [F:backend.activity.file_admission.inspectFileAdmissionOwner] [F:backend.activity.file_admission.reconcileFileAdmissionPage] [F:backend.activity.file_admission.fileAdmissionPageActivity]', () => {
  it('confirms a running owner with matching type and input', async () => {
    const j = job() as { jobId: string; revision: number; dispatchNonce: string }
    const client = ownerClient(
      async () => ({ type: 'fileProcessing', status: { name: 'RUNNING' }, runId: 'exec-1' }),
      async () => startedHistory({ jobId: j.jobId, revision: j.revision, dispatchNonce: j.dispatchNonce }),
    )
    await expect(inspectFileAdmissionOwner(client as never, j as never)).resolves.toEqual({ state: 'running', executionId: 'exec-1' })
  })
  it('reports a closed owner as closed', async () => {
    const j = job() as { jobId: string; revision: number; dispatchNonce: string }
    const client = ownerClient(
      async () => ({ type: 'fileProcessing', status: { name: 'COMPLETED' }, runId: 'exec-1' }),
      async () => startedHistory({ jobId: j.jobId, revision: j.revision, dispatchNonce: j.dispatchNonce }),
    )
    await expect(inspectFileAdmissionOwner(client as never, j as never)).resolves.toEqual({ state: 'closed', executionId: 'exec-1' })
  })
  it('calls a wrong-typed execution a mismatch without reading history', async () => {
    const history = vi.fn()
    const client = ownerClient(async () => ({ type: 'sessionRun', status: { name: 'RUNNING' }, runId: 'exec-1' }), history)
    await expect(inspectFileAdmissionOwner(client as never, job())).resolves.toEqual({ state: 'mismatch' })
    expect(history).not.toHaveBeenCalled()
  })
  it('calls an oversized history a mismatch', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1)
    const client = ownerClient(
      async () => ({ type: 'fileProcessing', status: { name: 'RUNNING' }, runId: 'exec-1' }),
      async () => ({ history: { events: [{ blob: big }] } }),
    )
    await expect(inspectFileAdmissionOwner(client as never, job())).resolves.toEqual({ state: 'mismatch' })
  })
  it('calls missing or mismatched start input a mismatch', async () => {
    const j = job() as { jobId: string; revision: number; dispatchNonce: string }
    const describe = async () => ({ type: 'fileProcessing', status: { name: 'RUNNING' }, runId: 'exec-1' })
    const noPayload = ownerClient(describe, async () => ({ history: { events: [{ workflowExecutionStartedEventAttributes: { input: { payloads: [] } } }] } }))
    await expect(inspectFileAdmissionOwner(noPayload as never, j as never)).resolves.toEqual({ state: 'mismatch' })
    const wrong = ownerClient(describe, async () => startedHistory({ jobId: j.jobId, revision: j.revision, dispatchNonce: randomUUID() }))
    await expect(inspectFileAdmissionOwner(wrong as never, j as never)).resolves.toEqual({ state: 'mismatch' })
    const noNonce = ownerClient(describe, async () => startedHistory({ jobId: j.jobId, revision: j.revision, dispatchNonce: j.dispatchNonce }))
    await expect(inspectFileAdmissionOwner(noNonce as never, { ...j, dispatchNonce: null } as never)).resolves.toEqual({ state: 'mismatch' })
  })
  it('maps not-found and gRPC NOT_FOUND to absent', async () => {
    const missing = ownerClient(async () => { throw new WorkflowNotFoundError('w', 'run', 'run') }, vi.fn())
    await expect(inspectFileAdmissionOwner(missing as never, job())).resolves.toEqual({ state: 'absent' })
    const grpc = ownerClient(async () => { throw Object.assign(new Error('not found'), { code: 5 }) }, vi.fn())
    await expect(inspectFileAdmissionOwner(grpc as never, job())).resolves.toEqual({ state: 'absent' })
  })
  it('maps any other describe failure to unavailable', async () => {
    const down = ownerClient(async () => { throw new Error('socket hung') }, vi.fn())
    await expect(inspectFileAdmissionOwner(down as never, job())).resolves.toEqual({ state: 'unavailable' })
  })
})

describe('reconcileFileAdmissionPage', () => {
  function pageSetup(cands: Array<{ jobId: string; revision: number }>) {
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue(cands)
    return { start: vi.fn(async () => undefined), heartbeat: vi.fn() }
  }
  it('defers while the projector lags', async () => {
    db.project.mockResolvedValue({ caughtUp: false })
    const start = vi.fn()
    await expect(reconcileFileAdmissionPage(db.pool as never, 'cursor-1', async () => ({ state: 'absent' as const }), start)).resolves.toMatchObject({ cursor: 'cursor-1', inspected: 0, deferred: true })
    expect(start).not.toHaveBeenCalled()
  })
  it('parks hidden work without dispatching', async () => {
    const j = job()
    const { start } = pageSetup([{ jobId: (j as { jobId: string }).jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: j, hidden: true })
    const result = await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'absent' as const }), start)
    expect(result).toMatchObject({ inspected: 1, parked: 1, started: 0 })
    expect(db.pause).toHaveBeenCalledWith(db.pool, (j as { jobId: string }).jobId, 'file_hidden', 0)
    expect(start).not.toHaveBeenCalled()
  })
  it('confirms a running owner and recovers without dispatching', async () => {
    const j = job() as { jobId: string; revision: number; dispatchNonce: string }
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue([{ jobId: j.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: j, hidden: false })
    const start = vi.fn()
    const result = await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'running' as const, executionId: 'exec-9' }), start)
    expect(result).toMatchObject({ inspected: 1, recovered: 1, started: 0 })
    expect(db.mark).toHaveBeenCalledWith(db.pool, expect.objectContaining({ jobId: j.jobId, outcome: 'confirmed', executionId: 'exec-9' }))
    expect(start).not.toHaveBeenCalled()
  })
  it('leaves an unavailable owner alone while unreserved or confirmed', async () => {
    const j = job() as { jobId: string; revision: number }
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue([{ jobId: j.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: j, hidden: false })
    const start = vi.fn()
    const result = await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'unavailable' as const }), start)
    expect(result).toMatchObject({ inspected: 1, parked: 0, started: 0 })
    expect(start).not.toHaveBeenCalled()
    expect(db.fail).not.toHaveBeenCalled()
  })
  it('parks a closed owner as failed', async () => {
    const j = job() as { jobId: string; revision: number }
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue([{ jobId: j.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: j, hidden: false })
    const start = vi.fn()
    const result = await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'closed' as const, executionId: 'exec-1' }), start)
    expect(result).toMatchObject({ inspected: 1, parked: 1 })
    expect(db.fail).toHaveBeenCalledWith(db.pool, j.jobId, 'file_owner_closed', 0)
  })
  it('dispatches an absent unreserved queued owner', async () => {
    const j = job() as { jobId: string; revision: number }
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue([{ jobId: j.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: j, hidden: false })
    const start = vi.fn(async () => undefined)
    const result = await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'absent' as const }), start)
    expect(result).toMatchObject({ inspected: 1, started: 1, parked: 0 })
    expect(start).toHaveBeenCalledWith(j.jobId, 0)
  })
  it('parks for owner review when the dispatch outcome is unknown', async () => {
    const j = job() as { jobId: string; revision: number }
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue([{ jobId: j.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: j, hidden: false })
    const start = vi.fn(async () => { throw new Error('rpc cut') })
    const result = await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'absent' as const }), start)
    expect(result).toMatchObject({ inspected: 1, started: 0, parked: 1 })
    expect(db.fail).toHaveBeenCalledWith(db.pool, j.jobId, 'dispatch_outcome_unknown', 0)
  })
  it('marks a reserved but ownerless dispatch uncertain, or fails it without a nonce', async () => {
    const reserved = job({ dispatchState: 'reserved' }) as { jobId: string; revision: number; dispatchNonce: string }
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue([{ jobId: reserved.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: reserved, hidden: false })
    const start = vi.fn()
    const result = await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'mismatch' as const }), start)
    expect(result).toMatchObject({ parked: 1 })
    expect(db.mark).toHaveBeenCalledWith(db.pool, expect.objectContaining({ jobId: reserved.jobId, outcome: 'uncertain' }))
    const bare = job({ dispatchState: 'reserved', dispatchNonce: null }) as { jobId: string; revision: number }
    db.candidates.mockResolvedValue([{ jobId: bare.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: bare, hidden: false })
    await reconcileFileAdmissionPage(db.pool as never, '', async () => ({ state: 'mismatch' as const }), start)
    expect(db.fail).toHaveBeenCalledWith(db.pool, bare.jobId, 'dispatch_outcome_unknown', 0)
    expect(start).not.toHaveBeenCalled()
  })
  it('advances the cursor only on a full page', async () => {
    const j = job() as { jobId: string; revision: number }
    db.project.mockResolvedValue({ caughtUp: true })
    db.boundary.mockResolvedValue({ job: j, hidden: false })
    db.candidates.mockResolvedValue([{ jobId: j.jobId, revision: 0 }])
    const short = await reconcileFileAdmissionPage(db.pool as never, 'c0', async () => ({ state: 'unavailable' as const }), vi.fn())
    expect(short.cursor).toBe('')
    db.candidates.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ jobId: `job-${i}`, revision: 0 })))
    const full = await reconcileFileAdmissionPage(db.pool as never, 'c0', async () => ({ state: 'unavailable' as const }), vi.fn())
    expect(full.cursor).toBe('job-99')
    expect(full.inspected).toBe(100)
  })
})

describe('fileAdmissionPageActivity', () => {
  it('dispatches an absent queued owner through the gateway and closes its connection', async () => {
    const j = job() as { jobId: string; revision: number }
    db.project.mockResolvedValue({ caughtUp: true })
    db.candidates.mockResolvedValue([{ jobId: j.jobId, revision: 0 }])
    db.boundary.mockResolvedValue({ job: j, hidden: false })
    const { fileProcessingWorkflowId } = await import('../../backend/src/db/index.js')
    const connection = {
      withDeadline: async (_d: number, work: () => Promise<unknown>) => work(),
      workflowService: { getWorkflowExecutionHistory: vi.fn() },
      handles: {
        [fileProcessingWorkflowId(j.jobId, 0)]: { describe: async () => { throw new WorkflowNotFoundError('w', 'run', 'run') } },
      } as Record<string, unknown>,
      close: net.close,
    }
    net.connect.mockResolvedValueOnce(connection)
    net.startFileProcessing.mockResolvedValueOnce(undefined)
    const result = await new MockActivityEnvironment().run(fileAdmissionPageActivity, '')
    expect(result).toMatchObject({ inspected: 1, started: 1 })
    expect(net.startFileProcessing).toHaveBeenCalledWith(j.jobId, 0)
    expect(net.close).toHaveBeenCalledOnce()
  })
})
