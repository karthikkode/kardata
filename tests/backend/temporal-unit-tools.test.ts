// Pure unit tests for plan/task tool calls: ledger snapshot round-trip and
// the artifact.read owner gate. No database, no archive disk.
import { createHash } from 'node:crypto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { CorruptArtifactError } from '../../backend/src/artifacts/pipeline.js'
import { executeToolCall, type ToolCallDeps, type ToolCallInput } from '../../backend/src/temporal/activities/tools.js'

const store = vi.hoisted(() => ({ serve: vi.fn(), resolve: vi.fn(), session: vi.fn(), exposure: vi.fn(), append: vi.fn(), find: vi.fn() }))
vi.mock('../../backend/src/artifacts/pipeline.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/artifacts/pipeline.js')>()),
  serveArtifact: store.serve,
}))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  resolveArtifactScope: store.resolve,
  getSession: store.session,
  appendEvent: store.append,
  findEventByKey: store.find,
}))
vi.mock('../../backend/src/db/context-files.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/context-files.js')>()),
  recordThreadFileExposure: store.exposure,
}))

afterEach(() => { vi.clearAllMocks() })

function memoryDeps(): ToolCallDeps & { logs: unknown[]; records: unknown[] } {
  const logs: unknown[] = []
  const records: unknown[] = []
  return {
    logs,
    records,
    log: (fields) => logs.push(fields),
    findRecorded: async () => undefined,
    record: async (event) => { records.push(event) },
  }
}

function input(overrides: Partial<ToolCallInput> = {}): ToolCallInput {
  return { sessionId: 's-tools', idempotencyKey: `tools:${Math.random()}`, call: { id: 'call-1', name: 'plan.list', args: {} }, ...overrides }
}

describe('tool ledger snapshots [F:backend.activity.tools.executeToolCall] [F:backend.activity.tools.TOOL_APPROVAL_EVENT] [F:backend.activity.tools.TOOL_EXECUTED_EVENT] [F:backend.activity.tools.TOOL_TIMEOUT_EVENT] [F:backend.activity.tools.DEFAULT_TOOL_TIMEOUT_MS] [F:backend.activity.tools.SENSITIVE_TOOLS]', () => {
  it('rehydrates a task snapshot and returns it unchanged on reads', async () => {
    const tasks = {
      checkpoints: [{ note: 'n1' }],
      clarifications: [{ question: 'q1' }],
      blockers: [{ reason: 'b1' }],
      submissions: [{ summary: 's1', detail: 'd1' }],
      failures: [{ reason: 'f1' }],
    }
    const outcome = await executeToolCall(input({ tasks }), memoryDeps())
    expect(outcome.tasks).toEqual(tasks)
    // Copies, not aliases: mutating the input afterwards cannot move the outcome.
    tasks.checkpoints.push({ note: 'late' })
    expect(outcome.tasks.checkpoints).toHaveLength(1)
  })
  it('starts empty ledgers from absent or malformed snapshots', async () => {
    const empty = await executeToolCall(input(), memoryDeps())
    expect(empty.tasks).toEqual({ checkpoints: [], clarifications: [], blockers: [], submissions: [], failures: [] })
    const malformed = await executeToolCall(input({ tasks: { checkpoints: 'nope' } as never }), memoryDeps())
    expect(malformed.tasks.checkpoints).toEqual([])
  })
})

describe('artifact.read owner gate', () => {
  function artifactDeps() {
    return { ...memoryDeps(), artifacts: { db: {} as never, target: {} as never } }
  }
  it('rejects an empty artifact id without touching the archive', async () => {
    const outcome = await executeToolCall(input({ call: { id: 'c', name: 'artifact.read', args: { artifactId: '  ' } } }), artifactDeps())
    expect(outcome.result).toMatchObject({ isError: true, content: 'artifactId must be a non-empty string' })
    expect(store.resolve).not.toHaveBeenCalled()
    expect(store.serve).not.toHaveBeenCalled()
  })
  it('answers unknown artifacts without serving', async () => {
    store.resolve.mockResolvedValueOnce(null)
    const outcome = await executeToolCall(input({ call: { id: 'c', name: 'artifact.read', args: { artifactId: 'ghost' } } }), artifactDeps())
    expect(outcome.result).toMatchObject({ isError: true, content: "unknown artifact 'ghost'" })
    expect(store.serve).not.toHaveBeenCalled()
  })
  it('serves through the owner gate and records the exposure', async () => {
    store.resolve.mockResolvedValueOnce({ scope: { tenantId: 't1', projectId: null } })
    store.serve.mockImplementationOnce(async (_target: unknown, _scope: unknown, _id: string, ops: { log: () => void; findEvent: (key: string) => Promise<unknown>; record: (event: unknown) => Promise<void> }) => {
      ops.log()
      await ops.findEvent('k')
      await ops.record({ type: 'served' })
      return { body: 'file-bytes' }
    })
    store.find.mockResolvedValueOnce(null)
    store.append.mockResolvedValueOnce({ seq: 1 })
    store.session.mockResolvedValueOnce({ sectorId: 'sec-1' })
    const d = artifactDeps()
    const outcome = await executeToolCall(input({ call: { id: 'c', name: 'artifact.read', args: { artifactId: 'art-1' } } }), d)
    expect(outcome.result).toMatchObject({ isError: false, content: 'file-bytes' })
    expect(store.append).toHaveBeenCalledWith({}, { type: 'served' })
    expect(store.exposure).toHaveBeenCalledWith({}, 's-tools', 'sec-1', 'art-1', undefined, undefined, createHash('sha256').update('file-bytes').digest('hex'))
    expect(outcome.result.toolName).toBe('artifact.read')
  })
  it('answers corrupt archives as tool errors', async () => {
    store.resolve.mockResolvedValueOnce({ scope: { tenantId: 't1', projectId: null } })
    store.serve.mockRejectedValueOnce(new CorruptArtifactError('checksum mismatch'))
    const outcome = await executeToolCall(input({ call: { id: 'c', name: 'artifact.read', args: { artifactId: 'art-1' } } }), artifactDeps())
    expect(outcome.result).toMatchObject({ isError: true, content: 'checksum mismatch' })
  })
  it('surfaces unexpected serve failures as tool errors', async () => {
    store.resolve.mockResolvedValueOnce({ scope: { tenantId: 't1', projectId: null } })
    store.serve.mockRejectedValueOnce(new Error('disk gone'))
    const outcome = await executeToolCall(input({ call: { id: 'c', name: 'artifact.read', args: { artifactId: 'art-1' } } }), artifactDeps())
    expect(outcome.result).toMatchObject({ isError: true, content: expect.stringContaining('disk gone') })
  })
})
