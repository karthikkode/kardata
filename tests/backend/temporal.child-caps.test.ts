// Delegation caps (P4.2): in-flight and queued maxima resolve from the
// environment with the plan defaults; invalid values fail fast naming
// the variable. Pure unit: no Temporal, no DB.
import { describe, expect, it } from 'vitest'
import { childCapsFromEnv } from '../../backend/src/temporal/runs-gateway.js'

describe('delegation caps from env', () => {
  it('defaults to 50 in flight and 2000 queued', () => {
    expect(childCapsFromEnv({})).toEqual({ maxInFlight: 50, maxQueued: 2000 })
    expect(childCapsFromEnv({ KARDATA_MAX_CHILDREN_IN_FLIGHT: '', KARDATA_MAX_CHILDREN_QUEUED: '' })).toEqual({ maxInFlight: 50, maxQueued: 2000 })
  })

  it('honors both variables', () => {
    expect(childCapsFromEnv({ KARDATA_MAX_CHILDREN_IN_FLIGHT: '8', KARDATA_MAX_CHILDREN_QUEUED: '100' })).toEqual({ maxInFlight: 8, maxQueued: 100 })
  })

  it('rejects non-positive integers naming the variable', () => {
    for (const raw of ['0', '-2', '1.5', 'many']) {
      expect(() => childCapsFromEnv({ KARDATA_MAX_CHILDREN_IN_FLIGHT: raw })).toThrow('KARDATA_MAX_CHILDREN_IN_FLIGHT must be a positive integer')
      expect(() => childCapsFromEnv({ KARDATA_MAX_CHILDREN_QUEUED: raw })).toThrow('KARDATA_MAX_CHILDREN_QUEUED must be a positive integer')
    }
  })
})
