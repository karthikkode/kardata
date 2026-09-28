// Stall detection (B5.3). Chaos matrix over the pure sweeper core: an
// injected stall of each of the 5 kinds is detected within its threshold
// and carries a recorded response; sub-threshold runs stay silent; runs
// that never beat are findings (never silent); B2.6 stage-loops surface
// with suspend responses. The live-DB section proves the heartbeat
// store round trip and the recorded `t.stall.response` rows.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { appendEvent, readPartition } from '../../backend/src/db/index.js'
import { listHeartbeats, recordHeartbeat } from '../../backend/src/db/index.js'
import {
  stalledTurnsFor,
  sweepStalls,
  type RunObservation,
} from '../../backend/src/observability/stalls.js'
import {
  STALL_RESPONSE_EVENT,
  stallResponseEvent,
} from '../../backend/src/temporal/activities/stalls.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()
const NOW = 1_000_000

function observation(overrides: Partial<RunObservation> = {}): RunObservation {
  return {
    id: `run-${STAMP}-x`,
    busy: false,
    budgetUsedRatio: 0.1,
    contextUsedRatio: 0.1,
    maxStalledTurns: 3,
    messageCount: 2,
    prevMessageCount: 1,
    prevStalledTurns: 0,
    ...overrides,
  }
}

describe('stall detection (B5.3)', () => {
  it('detects all 5 stall kinds with a recorded response each', () => {
    const outcomes = sweepStalls({
      sweepId: `sweep-${STAMP}`,
      now: NOW,
      runs: [
        // Stale beat well past the idle threshold.
        observation({ id: `run-${STAMP}-stale` }),
        observation({
          id: `run-${STAMP}-repeat`,
          lastRepeatVerdict: 'blocked',
        }),
        observation({
          id: `run-${STAMP}-stuck`,
          messageCount: 5,
          prevMessageCount: 5,
          prevStalledTurns: 2,
        }),
        observation({ id: `run-${STAMP}-budget`, budgetUsedRatio: 0.85 }),
        observation({ id: `run-${STAMP}-context`, contextUsedRatio: 0.9 }),
      ],
      beats: [
        { runId: `run-${STAMP}-stale`, atMs: NOW - 120_000, busy: false },
        { runId: `run-${STAMP}-repeat`, atMs: NOW - 1_000, busy: false },
        { runId: `run-${STAMP}-stuck`, atMs: NOW - 1_000, busy: false },
        { runId: `run-${STAMP}-budget`, atMs: NOW - 1_000, busy: false },
        { runId: `run-${STAMP}-context`, atMs: NOW - 1_000, busy: false },
      ],
      loops: [],
    })
    const byId = new Map(outcomes.map((outcome) => [outcome.finding.id, outcome]))
    expect(byId.get(`run-${STAMP}-stale`)).toMatchObject({
      finding: { kind: 'missing-heartbeat' },
      decision: { response: 'suspend' },
    })
    expect(byId.get(`run-${STAMP}-repeat`)).toMatchObject({
      finding: { kind: 'repeated-calls' },
      decision: { response: 'retry' },
    })
    expect(byId.get(`run-${STAMP}-stuck`)).toMatchObject({
      finding: { kind: 'no-progress' },
      decision: { response: 'suspend' },
    })
    expect(byId.get(`run-${STAMP}-budget`)).toMatchObject({
      finding: { kind: 'budget-near' },
      decision: { response: 'alert' },
    })
    expect(byId.get(`run-${STAMP}-context`)).toMatchObject({
      finding: { kind: 'context-near' },
      decision: { response: 'alert' },
    })
    for (const outcome of outcomes) {
      expect(outcome.decision.reason.length).toBeGreaterThan(0)
      expect(outcome.decision.at).toBe(NOW)
    }
  })

  it('stays silent under every threshold', () => {
    const outcomes = sweepStalls({
      sweepId: `sweep-${STAMP}-quiet`,
      now: NOW,
      runs: [
        observation({
          id: `run-${STAMP}-quiet`,
          lastRepeatVerdict: 'warn',
          budgetUsedRatio: 0.79,
          contextUsedRatio: 0.5,
          messageCount: 4,
          prevMessageCount: 4,
          prevStalledTurns: 1,
        }),
      ],
      beats: [{ runId: `run-${STAMP}-quiet`, atMs: NOW - 59_999, busy: false }],
      loops: [],
    })
    expect(outcomes).toEqual([])
  })

  it('treats a run that never beat as a finding, never silence', () => {
    const outcomes = sweepStalls({
      sweepId: `sweep-${STAMP}-absent`,
      now: NOW,
      runs: [observation({ id: `run-${STAMP}-ghost` })],
      beats: [],
      loops: [],
    })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      finding: { id: `run-${STAMP}-ghost`, kind: 'missing-heartbeat' },
      decision: { response: 'suspend' },
    })
  })

  it('surfaces stage-loops as no-progress with suspend responses', () => {
    const outcomes = sweepStalls({
      sweepId: `sweep-${STAMP}-loop`,
      now: NOW,
      runs: [observation({ id: `run-${STAMP}-loopy` })],
      beats: [{ runId: `run-${STAMP}-loopy`, atMs: NOW - 500, busy: false }],
      loops: [{ runId: `run-${STAMP}-loopy`, reason: 'revisiting stage 2 with identical findings' }],
    })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      finding: { kind: 'no-progress', detail: expect.stringContaining('revisiting stage 2') },
      decision: { response: 'suspend' },
    })
  })

  it('counts stalled turns with startup silence for brand-new runs', () => {
    expect(stalledTurnsFor({ messageCount: 3, prevMessageCount: 1, prevStalledTurns: 4 })).toBe(0)
    expect(stalledTurnsFor({ messageCount: 0, prevMessageCount: 0, prevStalledTurns: 0 })).toBe(0)
    expect(stalledTurnsFor({ messageCount: 2, prevMessageCount: 2, prevStalledTurns: 1 })).toBe(2)
  })

  it('keys response events for dedup across retries', () => {
    const finding = { id: 'session-run-s1', kind: 'no-progress' as const, detail: 'stuck' }
    const decision = {
      id: 'session-run-s1',
      kind: 'no-progress' as const,
      response: 'suspend' as const,
      reason: 'r',
      at: NOW,
    }
    const event = stallResponseEvent(`sweep-${STAMP}`, finding, decision)
    expect(event.type).toBe(STALL_RESPONSE_EVENT)
    expect(event.idempotencyKey).toBe(`stall:sweep-${STAMP}:session-run-s1:no-progress`)
    expect(event.partition).toBe('session:s1')
    expect(event.payload).toMatchObject({ runId: 'session-run-s1', response: 'suspend' })

    const adhoc = stallResponseEvent(
      `sweep-${STAMP}`,
      { id: 'research-run-r1', kind: 'budget-near', detail: 'd' },
      { ...decision, id: 'research-run-r1', kind: 'budget-near', response: 'alert' },
    )
    expect(adhoc.partition).toBe('run:research-run-r1')
  })

  describe.skipIf(!ENABLED)('against Postgres', () => {
    it('round-trips heartbeats and records responses with dedup', async () => {
      const url = await ensureTestDb('kardata_test_stalls')
      const pool = new Pool({ connectionString: url })
      try {
        const runId = `run-${STAMP}-live`
        await recordHeartbeat(pool, runId, 'turn', true)
        // Throttled twin write: still one row, still busy.
        await recordHeartbeat(pool, runId, 'turn', false)
        const beats = await listHeartbeats(pool)
        const beat = beats.find((row) => row.runId === runId)
        expect(beat?.busy).toBe(true)
        expect(Date.now() - (beat?.atMs ?? 0)).toBeLessThan(30_000)

        const outcomes = sweepStalls({
          sweepId: `sweep-${STAMP}-live`,
          now: Date.now(),
          runs: [observation({ id: runId })],
          beats: beats.map((row) => ({ runId: row.runId, atMs: row.atMs, busy: row.busy })),
          loops: [],
        })
        // Fresh beat: the live run stays silent.
        expect(outcomes).toEqual([])

        // A stale run (missing-heartbeat) plus a hot run near budget
        // records exactly one row per finding, even across a duplicate
        // append (retry dedup).
        const stale = sweepStalls({
          sweepId: `sweep-${STAMP}-live2`,
          now: Date.now(),
          runs: [
            observation({ id: `${runId}-stale` }),
            observation({ id: `${runId}-hot`, budgetUsedRatio: 0.95 }),
          ],
          beats: [
            { runId: `${runId}-stale`, atMs: Date.now() - 600_000, busy: false },
            { runId: `${runId}-hot`, atMs: Date.now(), busy: false },
          ],
          loops: [],
        })
        expect(stale.map((outcome) => outcome.finding.kind).sort()).toEqual([
          'budget-near',
          'missing-heartbeat',
        ])
        for (const outcome of stale) {
          const event = stallResponseEvent(`sweep-${STAMP}-live2`, outcome.finding, outcome.decision)
          const first = await appendEvent(pool, event)
          expect(first.duplicate).toBe(false)
          const retry = await appendEvent(pool, event)
          expect(retry.duplicate).toBe(true)
        }
        const staleRows = await readPartition(pool, `run:${runId}-stale`)
        expect(staleRows.filter((row) => row.type === STALL_RESPONSE_EVENT)).toHaveLength(1)
        const hotRows = await readPartition(pool, `run:${runId}-hot`)
        expect(hotRows.filter((row) => row.type === STALL_RESPONSE_EVENT)).toHaveLength(1)
      } finally {
        await pool.end()
      }
    }, 120_000)
  })
})
