// A16 subagent pause controls: the owner pauses one child mid-run or
// between turns; resume continues from the kept checkpoint. Gateway and
// route layers accept the child run id; the workflow tests live in
// workflows.subagent-pause.test.ts (separate file: the client mock here
// would break its live worker).
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isThreadPaused, setThreadPaused } from '../../backend/src/db/index.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import type { TransactableDb } from '../../backend/src/db/index.js'
import type { Connection } from '@temporalio/client'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const fixture = vi.hoisted(() => ({ describe: vi.fn(), signal: vi.fn() }))
vi.mock('@temporalio/client', async (original) => ({ ...await original<typeof import('@temporalio/client')>(), Client: class { workflow = { getHandle: (id: string) => ({ describe: () => fixture.describe(id), signal: (...args: unknown[]) => fixture.signal(id, ...args) }) } } }))
afterEach(() => vi.resetAllMocks())

describe.skipIf(!TEST_DATABASE_URL)('subagent pause controls (A16) [F:db.workspace_threads.isThreadPaused] [F:db.workspace_threads.setThreadPaused]', () => {
  let pool: Pool
  let runs: FakeRunsGateway
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_pause'), max: 5 })
    runs = new FakeRunsGateway(pool)
  })
  afterAll(async () => { await pool?.end() })

  it('tracks the owner pause flag per thread', async () => {
    expect(await isThreadPaused(pool, 'agent:TEST pause-flag')).toBe(false)
    await setThreadPaused(pool, 'agent:TEST pause-flag', true)
    expect(await isThreadPaused(pool, 'agent:TEST pause-flag')).toBe(true)
    await setThreadPaused(pool, 'agent:TEST pause-flag', false)
    expect(await isThreadPaused(pool, 'agent:TEST pause-flag')).toBe(false)
  })

  it('gateway pause and resume accept a running subagent run', async () => {
    fixture.describe.mockResolvedValue({ type: 'subagentRun', status: { name: 'RUNNING' } })
    const gateway = new TemporalRunsGateway(pool as TransactableDb, {} as Connection)
    await gateway.pauseRun('TEST-child-1')
    expect(fixture.signal).toHaveBeenCalledWith('TEST-child-1', 'childPause')
    expect(await isThreadPaused(pool, 'agent:TEST-child-1')).toBe(true)
    await gateway.resumeRun('TEST-child-1')
    expect(fixture.signal).toHaveBeenCalledWith('TEST-child-1', 'childResume')
    expect(await isThreadPaused(pool, 'agent:TEST-child-1')).toBe(false)
  })

  it('gateway pause and resume clear the flag on a companyResearch run', async () => {
    fixture.describe.mockResolvedValue({ type: 'companyResearch', status: { name: 'RUNNING' } })
    const gateway = new TemporalRunsGateway(pool as TransactableDb, {} as Connection)
    await gateway.pauseRun('TEST-company-1')
    expect(fixture.signal).toHaveBeenCalledWith('TEST-company-1', 'childPause')
    expect(await isThreadPaused(pool, 'agent:TEST-company-1')).toBe(true)
    await gateway.resumeRun('TEST-company-1')
    expect(fixture.signal).toHaveBeenCalledWith('TEST-company-1', 'childResume')
    expect(await isThreadPaused(pool, 'agent:TEST-company-1')).toBe(false)
  })

  it('fake gateway mirrors the subagent pause path', async () => {
    runs.addRun({ id: 'TEST-child-2', sessionId: 'TEST session', threadKey: 'agent:TEST-child-2', state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: new Date().toISOString() }, 'subagentRun')
    await runs.pauseRun('TEST-child-2')
    expect(runs.signals.at(-1)).toMatchObject({ workflowId: 'TEST-child-2', signal: 'childPause' })
    expect(await isThreadPaused(pool, 'agent:TEST-child-2')).toBe(true)
    await runs.resumeRun('TEST-child-2')
    expect(runs.signals.at(-1)).toMatchObject({ workflowId: 'TEST-child-2', signal: 'childResume' })
    expect(await isThreadPaused(pool, 'agent:TEST-child-2')).toBe(false)
  })
})
