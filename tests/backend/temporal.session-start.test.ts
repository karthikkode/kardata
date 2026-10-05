// Session signal-with-start builder. Pure unit proof: first send to a
// session thread must address the sessionRun workflow on the turn lane
// with the runSend/runSteer signal and a { sessionId } start payload.
// No Temporal server, no network.
import { describe, expect, it } from 'vitest'
import {
  buildSessionSignalStart,
  SESSION_PREFIX,
  SESSION_WORKFLOW_TYPE,
} from '../../backend/src/temporal/runs-gateway.js'
import { laneConfig } from '../../backend/src/temporal/lanes.js'

describe('buildSessionSignalStart', () => {
  it('starts runSend on the session workflow with the session payload', () => {
    const start = buildSessionSignalStart('s-1', 'hello', 'runSend')
    expect(start.workflowType).toBe(SESSION_WORKFLOW_TYPE)
    expect(start.workflowType).toBe('sessionRun')
    expect(start.workflowId).toBe(`${SESSION_PREFIX}s-1`)
    expect(start.taskQueue).toBe(laneConfig('turn').taskQueue)
    expect(start.signal).toBe('runSend')
    expect(start.signalArgs).toEqual(['hello'])
    expect(start.args).toEqual([{ sessionId: 's-1' }])
  })

  it('starts runSteer with the same addressing', () => {
    const start = buildSessionSignalStart('s-9', 'redirect', 'runSteer')
    expect(start.workflowId).toBe(`${SESSION_PREFIX}s-9`)
    expect(start.signal).toBe('runSteer')
    expect(start.signalArgs).toEqual(['redirect'])
    expect(start.args).toEqual([{ sessionId: 's-9' }])
  })
})
