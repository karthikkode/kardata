import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({ lines: [] as Array<Record<string,unknown>>, list: vi.fn(),append: vi.fn() }))
vi.mock('@temporalio/activity',() => ({ Context: { current: () => ({ info: { workflowExecution: { workflowId: 'TEST-supervisor' },attempt: 2 } }) } }))
vi.mock('../../backend/src/db/index.js',() => ({ listHeartbeats: fixtures.list,appendEvent: fixtures.append,workerPoolFromEnv: () => ({}) }))
vi.mock('../../backend/src/observability/logging.js',async (original) => {
  const actual = await original<typeof import('../../backend/src/observability/logging.js')>()
  return { ...actual,createLogger: (context: Parameters<typeof actual.createLogger>[0]) => actual.createLogger(context,{ write: (line: string) => fixtures.lines.push(JSON.parse(line) as Record<string,unknown>) }) }
})
import { stallSweepActivity } from '../../backend/src/temporal/activities/stalls.js'

describe('legacy stall activity observable boundaries',() => {
  beforeEach(() => { fixtures.lines.length = 0; fixtures.list.mockReset(); fixtures.append.mockReset() })
  it('records decisions and correlated start/done without treating a decision as executed recovery',async () => {
    fixtures.list.mockResolvedValue([])
    fixtures.append.mockResolvedValue({ seq: 1,duplicate: false })
    const decisions = await stallSweepActivity({ sweepId: 'TEST sweep',runs: [{ id: 'session-run-TEST-run',busy: false,budgetUsedRatio: 0,contextUsedRatio: 0,maxStalledTurns: 3,messageCount: 0,prevMessageCount: 0,prevStalledTurns: 0 }] })
    expect(decisions).toHaveLength(1)
    expect(fixtures.append).toHaveBeenCalledOnce()
    expect(fixtures.lines.filter((line) => line.event === 'stall.sweep.start' || line.event === 'stall.sweep.done')).toEqual([
      expect.objectContaining({ event: 'stall.sweep.start',run_id: 'TEST-supervisor',attempt: 2 }),
      expect.objectContaining({ event: 'stall.sweep.done',run_id: 'TEST-supervisor',attempt: 2,outcome: 'ok' }),
    ])
  })
  it('logs coded database failure and rethrows without sensitive error text',async () => {
    const error = Object.assign(new Error('TEST fake api_key=private execution content'),{ code: 'db_disconnected' })
    fixtures.list.mockRejectedValue(error)
    await expect(stallSweepActivity({ sweepId: 'TEST failure',runs: [] })).rejects.toBe(error)
    expect(fixtures.lines).toEqual([
      expect.objectContaining({ event: 'stall.sweep.start' }),
      expect.objectContaining({ event: 'stall.sweep.error',code: 'db_disconnected',outcome: 'error',run_id: 'TEST-supervisor' }),
    ])
    expect(JSON.stringify(fixtures.lines)).not.toContain('private execution content')
    expect(fixtures.append).not.toHaveBeenCalled()
  })
})
