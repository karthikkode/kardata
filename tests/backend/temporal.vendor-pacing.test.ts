// Turn-lane vendor pacing pin. Hermetic: the lane table is pure data.
// The pilot proved a 20-way concurrent research-turn fan-out saturates
// the live provider into mass provider_failed, while 2-way succeeds.
// Cap concurrent turn activities at the measured-safe width so the
// vendor never sees a storm; raise only with measured headroom.
import { describe, expect, it } from 'vitest'
import { laneConfig } from '../../backend/src/temporal/lanes.js'

describe('turn-lane vendor pacing', () => {
  it('caps concurrent turn activities at storm-safe width', () => {
    expect(laneConfig('turn').maxConcurrentActivityTaskExecutions).toBe(4)
  })

  it('leaves workflow tasks wide (cheap orchestration, not vendor calls)', () => {
    expect(laneConfig('turn').maxConcurrentWorkflowTaskExecutions).toBe(50)
  })
})
