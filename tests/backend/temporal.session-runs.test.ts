import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowNotFoundError, type Connection } from '@temporalio/client'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import type { TransactableDb } from '../../backend/src/db/index.js'

const fixture = vi.hoisted(() => ({ describe: vi.fn(), list: vi.fn(), headers: vi.fn() }))
vi.mock('@temporalio/client', async (original) => ({ ...await original<typeof import('@temporalio/client')>(), Client: class { workflow = { list: fixture.list, getHandle: (id: string) => ({ describe: () => fixture.describe(id) }) } } }))
vi.mock('../../backend/src/db/index.js', async (original) => ({ ...await original<typeof import('../../backend/src/db/index.js')>(), listThreadHeaders: fixture.headers }))
afterEach(() => vi.resetAllMocks())
const at = '2026-10-01T00:00:00.000Z'
const descriptionFor = (type: string) => ({ type, status: { name: 'RUNNING' }, startTime: new Date(at) })
const header = (key: string, status = 'RUNNING') => ({ key, sessionId: 'TEST session', kind: key.startsWith('agent:') ? 'subagent' : 'session', status, acceptingSteer: true, queueDepth: 0, updatedAt: at, messages: [] })

describe('session run-directory bounded discovery', () => {
  it('describes only recorded session/child identities instead of scanning an unrelated fleet', async () => {
    fixture.list.mockImplementation(() => { throw new Error('Unrelated fleet must not be enumerated for a session') })
    fixture.headers.mockResolvedValue([header('TEST session'), header('agent:TEST child', 'PAUSED')])
    fixture.describe.mockImplementation(async (id) => {
      if (id === 'TEST session') throw new WorkflowNotFoundError('No legacy self-scoped run', id, undefined)
      return descriptionFor(id === 'TEST child' ? 'subagentRun' : 'sessionRun')
    })
    const runs = await new TemporalRunsGateway({} as TransactableDb, {} as Connection).listRuns('TEST session')
    expect(fixture.list).not.toHaveBeenCalled()
    expect(fixture.describe.mock.calls.flat()).toEqual(['session-run-TEST session', 'TEST session', 'TEST child'])
    expect(runs).toEqual([
      expect.objectContaining({ id: 'session-run-TEST session', sessionId: 'TEST session' }),
      expect.objectContaining({ id: 'TEST child', sessionId: 'TEST session', threadKey: 'agent:TEST child', state: 'PAUSED' }),
    ])
  })
  it('preserves an explicitly requested legacy self-scoped research run', async () => {
    fixture.headers.mockResolvedValue([])
    fixture.describe.mockImplementation(async (id) => {
      if (id.startsWith('session-run-')) throw new WorkflowNotFoundError('No session run', id, undefined)
      return descriptionFor('researchRun')
    })
    expect(await new TemporalRunsGateway({} as TransactableDb, {} as Connection).listRuns('TEST legacy research')).toEqual([
      expect.objectContaining({ id: 'TEST legacy research', sessionId: 'TEST legacy research', threadKey: 'research:TEST legacy research' }),
    ])
  })
})
