// Per-lane timeout table pins (B2.3). Pure unit test: no Temporal server,
// no database. Exact production values are pinned so a drift fails loudly,
// and the ordering invariant (heartbeat < start-to-close < schedule-to-close)
// is checked per lane so a missed-beat redelivery always fires strictly
// inside the attempt budget.
import { describe, expect, it } from 'vitest'
import { LANES } from '../../backend/src/temporal/lanes.js'
import { activityOptions, laneTimeouts } from '../../backend/src/temporal/timeouts.js'
import { TURN_HEARTBEAT_MS } from '../../backend/src/temporal/activities/turn-prompts.js'

function toMs(value: string | number): number {
  if (typeof value === 'number') return value
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|seconds?|minutes?|hours?)$/.exec(value.trim())
  if (!match) throw new Error(`unparseable duration: ${value}`)
  const amount = Number(match[1])
  const unit = match[2] as string
  if (unit === 'ms') return amount
  if (unit === 's' || unit.startsWith('second')) return amount * 1_000
  if (unit === 'm' || unit.startsWith('minute')) return amount * 60_000
  return amount * 3_600_000
}

describe('timeout table (B2.3)', () => {
  it('covers every lane', () => {
    for (const lane of LANES) {
      expect(() => laneTimeouts(lane)).not.toThrow()
    }
  })

  it('pins exact production values', () => {
    expect(laneTimeouts('turn')).toEqual({
      heartbeatTimeout: '20s',
      startToCloseTimeout: '15m',
      scheduleToCloseTimeout: '20m',
      retry: { maximumAttempts: 3, initialInterval: '1s', backoffCoefficient: 2 },
    })
    expect(laneTimeouts('tool')).toEqual({
      heartbeatTimeout: '10s',
      startToCloseTimeout: '10m',
      scheduleToCloseTimeout: '15m',
      retry: { maximumAttempts: 5, initialInterval: '2s', backoffCoefficient: 2 },
    })
    expect(laneTimeouts('research')).toEqual({
      heartbeatTimeout: '30s',
      startToCloseTimeout: '1h',
      scheduleToCloseTimeout: '65m',
      retry: { maximumAttempts: 5, initialInterval: '5s', backoffCoefficient: 2 },
    })
    expect(laneTimeouts('sweep')).toEqual({
      heartbeatTimeout: '5s',
      startToCloseTimeout: '2m',
      scheduleToCloseTimeout: '5m',
      retry: { maximumAttempts: 3, initialInterval: '1s', backoffCoefficient: 2 },
    })
  })

  it('orders heartbeat < start-to-close < schedule-to-close per lane', () => {
    for (const lane of LANES) {
      const timeouts = laneTimeouts(lane)
      const heartbeat = toMs(timeouts.heartbeatTimeout)
      const startToClose = toMs(timeouts.startToCloseTimeout)
      const scheduleToClose = toMs(timeouts.scheduleToCloseTimeout)
      expect(heartbeat, `${lane}.heartbeatTimeout`).toBeGreaterThan(0)
      expect(startToClose, `${lane}.startToCloseTimeout`).toBeGreaterThan(heartbeat)
      expect(scheduleToClose, `${lane}.scheduleToCloseTimeout`).toBeGreaterThan(startToClose)
      expect(timeouts.retry.maximumAttempts).toBeGreaterThanOrEqual(1)
      expect(timeouts.retry.backoffCoefficient).toBeGreaterThanOrEqual(1)
    }
  })

  it('research tolerates the longest stalls; turn is the tightest', () => {
    const turn = laneTimeouts('turn')
    const research = laneTimeouts('research')
    expect(toMs(research.heartbeatTimeout)).toBeGreaterThan(toMs(turn.heartbeatTimeout))
    expect(toMs(research.startToCloseTimeout)).toBeGreaterThan(toMs(turn.startToCloseTimeout))
  })

  it('turn heartbeat timeout leaves slack over the activity beat cadence', () => {
    // Interval == timeout loses every multi-round turn to dispatch lag:
    // the first beat lands past the deadline, the server retries a healthy
    // attempt, and the run wedges on error (live incident 2026-09-26).
    // Keep at least 3x margin on both sides of this coupling.
    expect(toMs(laneTimeouts('turn').heartbeatTimeout)).toBeGreaterThanOrEqual(3 * TURN_HEARTBEAT_MS)
  })

  it('activityOptions is the same table the workflow proxies with', () => {
    for (const lane of LANES) {
      expect(activityOptions(lane)).toEqual(laneTimeouts(lane))
    }
  })
})
