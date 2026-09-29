// Per-lane activity timeout and retry policy. B2.3. Every activity sets a
// heartbeatTimeout (missed beats retry within the window, never at
// Start-To-Close) plus Start-To-Close and Schedule-To-Close bounds, and every
// cancellable activity races Context.current().cancelled so cancellation
// propagates instead of orphaning tools. Values are starting points; B5.6
// tunes them from soak numbers.
import type { Duration } from '@temporalio/common'
import type { Lane } from './lanes.js'

// Short-form durations only ('20s', not '20s'): the SDK types
// Duration from the `ms` package, whose long-form strings fail the type
// check even though the runtime parser accepts them.
export interface LaneTimeouts {
  heartbeatTimeout: Duration
  startToCloseTimeout: Duration
  scheduleToCloseTimeout: Duration
  retry: {
    maximumAttempts: number
    initialInterval: Duration
    backoffCoefficient: number
  }
}

const TABLE: Record<Lane, LaneTimeouts> = {
  // Agentic turns: long windows, patient retry. The 60 s attempt budget
  // fit interactive chat, but a fan-out turn (10 delegations plus live
  // provider rounds at 26–85 s each) runs minutes: the pilot proved it
  // when a timed-out turn retried and launched 10 duplicate subagents
  // (20 children for an "exactly 10" order). Start-to-close now covers a
  // full research turn; dead workers still surface via the 20 s heartbeat
  // timeout. Crash-duplication of side-effecting tools remains possible
  // (rare, not systematic) until turn-level tool idempotency lands.
  // The heartbeat timeout must stay far above the activity beat cadence
  // (5 s): with interval == timeout the first beat loses to worker-start
  // lag and timer slack. 20 s leaves 15 s of slack per beat.
  turn: {
    heartbeatTimeout: '20s',
    startToCloseTimeout: '15m',
    scheduleToCloseTimeout: '20m',
    retry: { maximumAttempts: 3, initialInterval: '1s', backoffCoefficient: 2 },
  },
  // Tool calls (provider-bound): long single attempts, patient retries.
  tool: {
    heartbeatTimeout: '10s',
    startToCloseTimeout: '10m',
    scheduleToCloseTimeout: '15m',
    retry: { maximumAttempts: 5, initialInterval: '2s', backoffCoefficient: 2 },
  },
  // Research stages: longest bounds, few attempts.
  research: {
    heartbeatTimeout: '30s',
    startToCloseTimeout: '1h',
    scheduleToCloseTimeout: '65m',
    retry: { maximumAttempts: 5, initialInterval: '5s', backoffCoefficient: 2 },
  },
  // Sweeper: short and frequent.
  sweep: {
    heartbeatTimeout: '5s',
    startToCloseTimeout: '2m',
    scheduleToCloseTimeout: '5m',
    retry: { maximumAttempts: 3, initialInterval: '1s', backoffCoefficient: 2 },
  },
}

export function laneTimeouts(lane: Lane): LaneTimeouts {
  return TABLE[lane]
}

/** Drop-in options for proxyActivities<typeof activities>(...). */
export function activityOptions(lane: Lane): LaneTimeouts {
  return laneTimeouts(lane)
}
