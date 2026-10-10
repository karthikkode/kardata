// Phase 8 B7: Meta ceiling benchmark. A ladder of concurrent minimal
// chat calls (4→128) against live Meta measures latency/tokens and
// finds the max sustainable subagent count at a 5% error budget. The
// winning rung × 0.75 headroom lands in var/pilot/meta-ceiling.json,
// which the 1000-subagent tier reads to decide full run vs graceful
// skip. Gated: only KARDATA_LIVE_META=1 spends vendor money (run
// once after acceptance, prod idle, at an owner-picked time). The
// decision logic is unit-tested ungated below; the live ladder runs
// only under the gate.
//
// NOTE: the plan names tests/stress/meta-ceiling.ts; the runner only
// picks up *.test.ts (explicit non-matching paths are filtered out),
// so the benchmark lives here under its runnable name.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MetaAdapter, type MetaMode } from '../../agents/src/meta.js'
import type { ProviderRequest } from '../../agents/src/providers.js'
import { parseEnvFile } from '../../deployment/scripts/stack-lib.mjs'

const LIVE = process.env['KARDATA_LIVE_META'] === '1'
const LADDER = [4, 8, 16, 32, 64, 128]
const CALLS_PER_RUNG = 24
const ERROR_BUDGET = 0.05
const HEADROOM = 0.75
const P95_BASELINE_MULTIPLE = 3

export interface CeilingRung {
  concurrency: number
  calls: number
  errors: number
  p50Ms: number
  p95Ms: number
  meanTokens: number
}

export interface MetaCeiling {
  measuredAt: string
  model: string
  errorBudget: number
  headroom: number
  rungs: CeilingRung[]
  maxSustainable: number
}

export function decideCeiling(rungs: CeilingRung[], errorBudget = ERROR_BUDGET, headroom = HEADROOM): number {
  if (rungs.length === 0) return 0
  const baselineP95 = rungs[0]!.p95Ms
  let lastGood = 0
  for (const rung of rungs) {
    const rate = rung.calls === 0 ? 1 : rung.errors / rung.calls
    if (rate > errorBudget) break
    if (baselineP95 > 0 && rung.p95Ms > P95_BASELINE_MULTIPLE * baselineP95) break
    lastGood = rung.concurrency
  }
  return Math.floor(lastGood * headroom)
}

export function ceilingPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'var', 'pilot', 'meta-ceiling.json')
}

describe('meta ceiling decision (ungated pin)', () => {
  const rung = (partial: Partial<CeilingRung>): CeilingRung => ({
    concurrency: 4,
    calls: 24,
    errors: 0,
    p50Ms: 1000,
    p95Ms: 2000,
    meanTokens: 40,
    ...partial,
  })

  it('takes the last in-budget rung times headroom', () => {
    const rungs = [rung({ concurrency: 4 }), rung({ concurrency: 8 }), rung({ concurrency: 16, errors: 2 })]
    expect(decideCeiling(rungs)).toBe(Math.floor(8 * HEADROOM))
  })

  it('stops at latency explosion even with zero errors', () => {
    const rungs = [rung({ concurrency: 4, p95Ms: 2000 }), rung({ concurrency: 8, p95Ms: 7000 })]
    expect(decideCeiling(rungs)).toBe(Math.floor(4 * HEADROOM))
  })

  it('returns 0 when even the first rung is over budget', () => {
    expect(decideCeiling([rung({ errors: 24 })])).toBe(0)
    expect(decideCeiling([])).toBe(0)
  })

  it('round-trips the ceiling file', () => {
    const ceiling: MetaCeiling = {
      measuredAt: '2026-10-10T00:00:00.000Z',
      model: 'TEST-model',
      errorBudget: ERROR_BUDGET,
      headroom: HEADROOM,
      rungs: [rung({})],
      maxSustainable: 3,
    }
    const text = JSON.stringify(ceiling)
    const parsed = JSON.parse(text) as MetaCeiling
    expect(parsed.maxSustainable).toBe(3)
    expect(parsed.rungs).toHaveLength(1)
  })
})

describe.skipIf(!LIVE)('meta ceiling ladder (live Meta spend)', () => {
  it('measures the ladder and writes the ceiling file', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const env = parseEnvFile(readFileSync(join(root, 'agents', '.env'), 'utf8'))
    const apiKey = env['KARDATA_META_KEY']
    const model = env['KARDATA_META_MODEL']
    if (!apiKey || !model) throw new Error('ceiling needs KARDATA_META_KEY + KARDATA_META_MODEL in agents/.env')
    const adapter = new MetaAdapter({ apiKey, model, mode: (env['KARDATA_META_MODE'] as MetaMode | undefined) ?? 'chat' })
    const request: ProviderRequest = {
      systemPrompt: 'Reply with exactly: ok',
      messages: [{ role: 'user', text: 'ok?' }],
      tools: [],
      toolChoice: { mode: 'auto' },
      maxOutputTokens: 16,
    }
    const rungs: CeilingRung[] = []
    for (const concurrency of LADDER) {
      const latencies: number[] = []
      let errors = 0
      let tokens = 0
      for (let wave = 0; wave < CALLS_PER_RUNG / concurrency; wave++) {
        const calls = Array.from({ length: concurrency }, async () => {
          const start = Date.now()
          try {
            const response = await adapter.chat(request)
            latencies.push(Date.now() - start)
            tokens += response.usage.inputTokens + response.usage.outputTokens
          } catch {
            errors += 1
          }
        })
        await Promise.all(calls)
      }
      latencies.sort((a, b) => a - b)
      const rung: CeilingRung = {
        concurrency,
        calls: CALLS_PER_RUNG,
        errors,
        p50Ms: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
        p95Ms: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
        meanTokens: latencies.length === 0 ? 0 : Math.round(tokens / latencies.length),
      }
      rungs.push(rung)
      if (errors / CALLS_PER_RUNG > ERROR_BUDGET) break
    }
    const ceiling: MetaCeiling = {
      measuredAt: new Date().toISOString(),
      model,
      errorBudget: ERROR_BUDGET,
      headroom: HEADROOM,
      rungs,
      maxSustainable: decideCeiling(rungs),
    }
    const file = ceilingPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(ceiling, null, 2))
    expect(ceiling.maxSustainable).toBeGreaterThan(0)
  }, 1_800_000)
})
