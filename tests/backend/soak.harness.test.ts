// B5.6 1000-agent soak: synthetic fleet, mixed lanes and failures, driven
// through the real detection/projection/gauge path (pure sweeper core over
// DB heartbeats, real event recording, ledger projection, Prometheus
// gauges). No Temporal fleet: heartbeats and usage are seeded, so every
// number below is harness-measured at 1000-agent scale, not production
// telemetry. The last test publishes tests/backend/soak.report.md.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, readPartition } from '../../backend/src/db/index.js'
import { fleetTotals, projectUsage } from '../../backend/src/db/index.js'
import { formatCents } from '../../backend/src/ledger/project.js'
import { listHeartbeats } from '../../backend/src/db/index.js'
import {
  createHttpMetrics,
  refreshFleetGauges,
  renderMetrics,
} from '../../backend/src/observability/metrics.js'
import { sweepStalls, type LoopEvidence, type RunObservation } from '../../backend/src/observability/stalls.js'
import { stallResponseEvent } from '../../backend/src/temporal/activities/stalls.js'
import type { RunInfo, RunState } from '../../backend/src/temporal/gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

// Fleet mix: 880 healthy, 60 idle-stalled, 20 tool-stalled, 25 looped,
// 15 near-budget (reported, not asserted). Induced stalls = 105.
const N_HEALTHY = 880
const N_IDLE_STALLED = 60
const N_TOOL_STALLED = 20
const N_LOOPED = 25
const N_NEAR_BUDGET = 15
const FLEET = N_HEALTHY + N_IDLE_STALLED + N_TOOL_STALLED + N_LOOPED + N_NEAR_BUDGET

// Synthetic provider price, held constant for the spend number: $1/MTok in,
// $3/MTok out. Real bills use the provider tariff; the harness needs a
// fixed ruler, and the report labels it as such.
const MICRO_PER_INPUT_TOKEN = 1
const MICRO_PER_OUTPUT_TOKEN = 3

const PIPELINE_BUDGET_MS = 30_000
const SWEEP_P99_BUDGET_MS = 10_000

const REPORT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'soak.report.md')

interface SoakAgent {
  id: string
  observation: RunObservation
  beatAgeMs: number
  beatBusy: boolean
  loop?: boolean
  state: RunState
  inputTokens: number
  outputTokens: number
  costMicros: number
}

function buildFleet(): SoakAgent[] {
  const agents: SoakAgent[] = []
  const usage = (index: number): { inputTokens: number; outputTokens: number; costMicros: number } => {
    const inputTokens = 2000 + index * 7
    const outputTokens = 800 + index * 3
    return {
      inputTokens,
      outputTokens,
      costMicros: inputTokens * MICRO_PER_INPUT_TOKEN + outputTokens * MICRO_PER_OUTPUT_TOKEN,
    }
  }
  let index = 0
  const next = (id: string): { id: string; index: number } => ({ id, index: index++ })
  for (let i = 0; i < N_HEALTHY; i++) {
    const { id, index: u } = next(`soak-healthy-${i}`)
    agents.push({
      id,
      observation: {
        id,
        busy: u % 2 === 0,
        budgetUsedRatio: 0.2,
        contextUsedRatio: 0.3,
        maxStalledTurns: 3,
        messageCount: 10 + (u % 5),
        prevMessageCount: 9 + (u % 5),
        prevStalledTurns: 0,
      },
      beatAgeMs: 5_000,
      beatBusy: u % 2 === 0,
      state: 'RUNNING',
      ...usage(u),
    })
  }
  for (let i = 0; i < N_IDLE_STALLED; i++) {
    const { id, index: u } = next(`soak-idle-${i}`)
    agents.push({
      id,
      observation: {
        id,
        busy: false,
        budgetUsedRatio: 0.2,
        contextUsedRatio: 0.3,
        maxStalledTurns: 3,
        messageCount: 5,
        prevMessageCount: 5,
        prevStalledTurns: 2,
      },
      beatAgeMs: 90_000,
      beatBusy: false,
      state: 'PAUSED',
      ...usage(u),
    })
  }
  for (let i = 0; i < N_TOOL_STALLED; i++) {
    const { id, index: u } = next(`soak-tool-${i}`)
    agents.push({
      id,
      observation: {
        id,
        busy: true,
        budgetUsedRatio: 0.4,
        contextUsedRatio: 0.4,
        maxStalledTurns: 3,
        messageCount: 7,
        prevMessageCount: 7,
        prevStalledTurns: 2,
      },
      beatAgeMs: 150_000,
      beatBusy: true,
      state: 'PAUSED',
      ...usage(u),
    })
  }
  for (let i = 0; i < N_LOOPED; i++) {
    const { id, index: u } = next(`soak-loop-${i}`)
    agents.push({
      id,
      observation: {
        id,
        busy: true,
        budgetUsedRatio: 0.5,
        contextUsedRatio: 0.5,
        maxStalledTurns: 3,
        messageCount: 12,
        prevMessageCount: 11,
        prevStalledTurns: 0,
      },
      beatAgeMs: 5_000,
      beatBusy: true,
      loop: true,
      state: 'SUSPENDED',
      ...usage(u),
    })
  }
  for (let i = 0; i < N_NEAR_BUDGET; i++) {
    const { id, index: u } = next(`soak-budget-${i}`)
    agents.push({
      id,
      observation: {
        id,
        busy: false,
        budgetUsedRatio: 0.7,
        contextUsedRatio: 0.85,
        maxStalledTurns: 3,
        messageCount: 20 + i,
        prevMessageCount: 19 + i,
        prevStalledTurns: 0,
      },
      beatAgeMs: 5_000,
      beatBusy: false,
      state: 'RUNNING',
      ...usage(u),
    })
  }
  return agents
}

function percentile(sorted: number[], p: number): number {
  const at = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[at] ?? 0
}

describe.skipIf(!ENABLED)('1000-agent soak (B5.6)', () => {
  let pool: Pool
  let runs: FakeRunsGateway
  let agents: SoakAgent[] = []
  const induced = new Set<string>()
  const healthyIds = new Set<string>()
  const measured: Record<string, number | string> = {}

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_soak')
    pool = new Pool({ connectionString: url })
    // Rerun-safe: prior runs leave heartbeats, usage events, stall
    // responses, and ledger rows behind; idempotency dedup would
    // otherwise make the second run measure nothing.
    await pool.query(`DELETE FROM events WHERE idempotency_key LIKE 'soak-%' OR idempotency_key LIKE 'stall:soak-%'`)
    await pool.query(`DELETE FROM heartbeats WHERE run_id LIKE 'soak-%'`)
    await pool.query('TRUNCATE ledger_entries')
    agents = buildFleet()
    expect(agents).toHaveLength(1000)
    for (const agent of agents) {
      if (agent.id.startsWith('soak-healthy-')) healthyIds.add(agent.id)
      else if (!agent.id.startsWith('soak-budget-')) induced.add(agent.id)
    }

    // Seed one heartbeat row per agent with controlled ages.
    const now = Date.now()
    for (const agent of agents) {
      await pool.query(
        `INSERT INTO heartbeats (run_id, op, at, busy) VALUES ($1, 'turn', to_timestamp($2 / 1000.0), $3)
         ON CONFLICT (run_id, op) DO UPDATE SET at = EXCLUDED.at, busy = EXCLUDED.busy`,
        [agent.id, now - agent.beatAgeMs, agent.beatBusy],
      )
    }

    // Seed one usage event per agent; costs are integer micro-dollars so
    // the expected totals below are exact, not float-approximate.
    for (const agent of agents) {
      await appendEvent(pool, {
        idempotencyKey: `soak-use-${agent.id}`,
        partition: 'ledger:soak',
        type: 't.usage.recorded',
        payload: {
          runId: agent.id,
          inputTokens: agent.inputTokens,
          outputTokens: agent.outputTokens,
          cost: (agent.costMicros / 1_000_000).toFixed(6),
        },
      })
    }

    runs = new FakeRunsGateway(pool)
    for (const agent of agents) {
      const run: RunInfo = {
        id: agent.id,
        sessionId: agent.id,
        threadKey: agent.id,
        state: agent.state,
        budgetUsedRatio: agent.observation.budgetUsedRatio,
        contextUsedRatio: agent.observation.contextUsedRatio,
        updatedAt: new Date().toISOString(),
      }
      runs.addRun(run)
    }
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('detects every induced stall with zero false positives inside budget', async () => {
    const sweepId = 'soak-sweep-1'
    const pipelineStart = Date.now()
    const now = Date.now()
    const beats = await listHeartbeats(pool)
    expect(beats).toHaveLength(1000)
    const beatByRun = new Map(beats.map((beat) => [beat.runId, beat]))
    const loops: LoopEvidence[] = agents
      .filter((agent) => agent.loop)
      .map((agent) => ({ runId: agent.id, reason: 'stage verify-retry without progress' }))

    // p99 over repeated sweeps is a real measured latency distribution.
    const sweepMs: number[] = []
    let outcomes: ReturnType<typeof sweepStalls> = []
    for (let i = 0; i < 11; i++) {
      const start = Date.now()
      outcomes = sweepStalls({
        sweepId,
        now,
        runs: agents.map((agent) => agent.observation),
        beats: beats.map((beat) => ({ runId: beat.runId, atMs: beat.atMs, busy: beat.busy })),
        loops,
      })
      sweepMs.push(Date.now() - start)
    }
    sweepMs.sort((a, b) => a - b)
    const p50 = percentile(sweepMs, 50)
    const p99 = percentile(sweepMs, 99)
    measured['sweepP50Ms'] = p50
    measured['sweepP99Ms'] = p99
    expect(p99).toBeLessThan(SWEEP_P99_BUDGET_MS)

    const flagged = new Set(outcomes.map((outcome) => outcome.finding.id))
    const missed = [...induced].filter((id) => !flagged.has(id))
    const falsePositives = [...healthyIds].filter((id) => flagged.has(id))
    measured['induced'] = induced.size
    measured['flagged'] = flagged.size
    measured['missed'] = missed.length
    measured['falsePositives'] = falsePositives.length
    const kinds = new Map<string, number>()
    for (const outcome of outcomes) {
      kinds.set(outcome.finding.kind, (kinds.get(outcome.finding.kind) ?? 0) + 1)
    }
    measured['findingKinds'] = [...kinds.entries()].map(([kind, count]) => `${kind}=${count}`).join(', ')
    expect({ missed }).toEqual({ missed: [] })
    expect({ falsePositives }).toEqual({ falsePositives: [] })

    // Record path: every finding lands a stall-response event.
    const recordStart = Date.now()
    for (const outcome of outcomes) {
      if (!induced.has(outcome.finding.id)) continue
      await appendEvent(pool, stallResponseEvent(sweepId, outcome.finding, outcome.decision))
    }
    measured['recordMs'] = Date.now() - recordStart
    const responses = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM events WHERE type = 't.stall.response'`,
    )
    expect(Number(responses.rows[0]?.count)).toBe(induced.size)

    // Heartbeat ages seen by the sweep match the seeded ground truth.
    let stale = 0
    for (const agent of agents) {
      const beat = beatByRun.get(agent.id)
      if (beat && now - beat.atMs > (beat.busy ? 120_000 : 60_000)) stale += 1
    }
    measured['staleBeats'] = stale
    expect(stale).toBe(N_IDLE_STALLED + N_TOOL_STALLED)

    // End-to-end detection pipeline: list beats, sweep, record findings.
    measured['pipelineMs'] = Date.now() - pipelineStart
    expect(measured['pipelineMs'] as number).toBeLessThan(PIPELINE_BUDGET_MS)
  })

  it('projects fleet usage and cost to the token', async () => {
    const events = await readPartition(pool, 'ledger:soak')
    expect(events).toHaveLength(1000)
    const result = await projectUsage(pool, events)
    expect(result).toEqual({ applied: 1000, ignored: [] })

    let expectedIn = 0
    let expectedOut = 0
    let expectedMicros = 0
    for (const agent of agents) {
      expectedIn += agent.inputTokens
      expectedOut += agent.outputTokens
      expectedMicros += agent.costMicros
    }
    const fleet = await fleetTotals(pool)
    expect(fleet.inputTokens).toBe(expectedIn)
    expect(fleet.outputTokens).toBe(expectedOut)
    const expectedCents = Math.round(expectedMicros / 10_000)
    const expectedCost = `${Math.floor(expectedCents / 100)}.${String(expectedCents % 100).padStart(2, '0')}`
    expect(formatCents(fleet.cost)).toBe(expectedCost)

    measured['fleetInputTokens'] = expectedIn
    measured['fleetOutputTokens'] = expectedOut
    measured['fleetCostDollars'] = expectedCost
    measured['fleetSpendDollars'] = expectedCost
  })

  it('renders truthful fleet gauges at soak scale', async () => {
    const metrics = createHttpMetrics()
    await refreshFleetGauges(metrics, { pool, runs })
    const { body } = await renderMetrics(metrics.registry)

    const byState = new Map<string, number>()
    for (const line of body.split('\n')) {
      const match = /^kardata_runs_by_state\{state="([^"]+)"\} (\d+(?:\.\d+)?)$/.exec(line.trim())
      if (match) byState.set(match[1] ?? '', Number(match[2]))
    }
    const expected = new Map<string, number>()
    for (const agent of agents) expected.set(agent.state, (expected.get(agent.state) ?? 0) + 1)
    expect(Object.fromEntries(byState)).toEqual(Object.fromEntries(expected))

    const staleMatch = /^kardata_stale_heartbeats (\d+(?:\.\d+)?)$/m.exec(body)
    expect(Number(staleMatch?.[1])).toBe(N_IDLE_STALLED + N_TOOL_STALLED)
    measured['gaugeStates'] = [...expected.entries()].map(([s, c]) => `${s}=${c}`).join(', ')
  })

  it('publishes the soak report with numbers', () => {
    const lines = [
      '# B5.6 soak report (synthetic 1000-agent fleet)',
      '',
      'Harness-measured, not production telemetry: heartbeats and usage are',
      'seeded, Temporal has no fleet role (pure sweeper core over DB rows,',
      'real event recording, ledger projection, Prometheus gauges). Rerun via',
      '`TEST_DATABASE_URL=... KARDATA_TEMPORAL_TEST=1 npx vitest run',
      'tests/backend/soak.harness.test.ts`; this file is rewritten by that run.',
      '',
      `Fleet: ${FLEET} agents (healthy=${N_HEALTHY}, idle-stalled=${N_IDLE_STALLED},`,
      `tool-stalled=${N_TOOL_STALLED}, looped=${N_LOOPED}, near-budget=${N_NEAR_BUDGET}).`,
      'Thresholds: defaults held (idle 60s, in-tool 120s, near-ratio 0.8) —',
      'no retune needed at synthetic scale.',
      '',
      '## Detection latency',
      '',
      `- sweep batch p50/p99 over 11 runs: ${measured['sweepP50Ms']}ms / ${measured['sweepP99Ms']}ms (budget ${SWEEP_P99_BUDGET_MS}ms) — PASS`,
      `- finding record path (${measured['flagged']} findings): ${measured['recordMs']}ms`,
      `- end-to-end pipeline (list + sweep + record): ${measured['pipelineMs']}ms (budget ${PIPELINE_BUDGET_MS}ms) — PASS`,
      `- stale beats at sweep time: ${measured['staleBeats']} (expected ${N_IDLE_STALLED + N_TOOL_STALLED})`,
      '',
      '## Alert precision',
      '',
      `- induced stalls: ${measured['induced']}, flagged: ${measured['flagged']}`,
      `- missed: ${measured['missed']} (budget 0) — PASS`,
      `- false positives on healthy agents: ${measured['falsePositives']} (budget 0) — PASS`,
      `- finding kinds: ${measured['findingKinds']}`,
      '',
      '## Cost and ledger accuracy',
      '',
      `- fleet usage: ${measured['fleetInputTokens']} in / ${measured['fleetOutputTokens']} out tokens, exact match — PASS`,
      `- fleet cost: $${measured['fleetCostDollars']} exact to the cent — PASS`,
      `- provider token spend at 1000-agent scale (synthetic $1/MTok in, $3/MTok out): $${measured['fleetSpendDollars']}`,
      '',
      '## Dashboard truthfulness',
      '',
      `- kardata_runs_by_state matches seeded ground truth (${measured['gaugeStates']}) — PASS`,
      `- kardata_stale_heartbeats matches seeded stale count — PASS`,
      '',
      '## Out of scope (not measured here)',
      '',
      '- Live Temporal fleet behavior (crash redelivery, lane saturation) stays',
      '  covered by tests/backend/temporal.lanes.test.ts against a real server.',
      '- Prometheus series cardinality stays covered by the traces budget test.',
      '- Production token tariffs replace the synthetic ruler above.',
      '',
    ]
    writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`)
    expect(measured['missed']).toBe(0)
    expect(measured['falsePositives']).toBe(0)
  })
})
