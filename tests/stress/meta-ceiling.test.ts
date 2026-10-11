// Phase 8 B7 / F9: Meta ceiling benchmark. A ladder of concurrent
// realistic chat calls (2→32, ~1k in / 200 out tokens, 40 calls or
// 2× concurrency per rung, 60 s gaps) against live Meta measures
// latency and finds the max sustainable concurrency at a 2% error
// budget with p95 ≤ 2× the concurrency-2 baseline. A ~10k-input rung
// pair at the highest passing concurrencies follows. The winning rung
// × 0.75 headroom (25% reserved for owner prod use) lands in
// var/pilot/meta-ceiling.json, which the 1000-subagent tier reads to
// decide full run vs graceful skip. Gated: only KARDATA_LIVE_META=1
// spends vendor money (run once, prod idle, at an owner-picked time).
// The decision logic is unit-tested ungated below; the live ladder
// runs only under the gate.
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
const LADDER = [2, 4, 8, 16, 24, 32]
const ERROR_BUDGET = 0.02
const HEADROOM = 0.75
const P95_BASELINE_MULTIPLE = 2
const RUNG_GAP_MS = 60_000

export function callsForRung(concurrency: number): number {
  return Math.max(40, 2 * concurrency)
}

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
  /** ~10k-input rungs at the highest passing concurrencies (F9 pair). */
  largeRungs?: CeilingRung[]
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
    concurrency: 2,
    calls: 40,
    errors: 0,
    p50Ms: 1000,
    p95Ms: 2000,
    meanTokens: 1200,
    ...partial,
  })

  it('takes the last in-budget rung times headroom', () => {
    const rungs = [rung({ concurrency: 2 }), rung({ concurrency: 4 }), rung({ concurrency: 8, errors: 4 })]
    expect(decideCeiling(rungs)).toBe(Math.floor(4 * HEADROOM))
  })

  it('breaks above the 2% error budget', () => {
    expect(decideCeiling([rung({ concurrency: 2 }), rung({ concurrency: 4, errors: 1 })])).toBe(Math.floor(2 * HEADROOM))
    expect(callsForRung(2)).toBe(40)
    expect(callsForRung(32)).toBe(64)
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
    // ~70 tokens: ×15 ≈ 1k input, ×150 ≈ 10k input (F9 turn sizes).
    const filler =
      'The Sydney trades sector spans plumbing, electrical, carpentry, roofing, and HVAC contractors across ' +
      'metropolitan and regional New South Wales, serving residential renovations, commercial fit-outs, and ' +
      'infrastructure maintenance with licensed crews, fixed quotes, and compliance paperwork. '
    const brief = (repeats: number): ProviderRequest => ({
      systemPrompt: 'Summarize the sector brief below in under 150 words. Reply with the summary only.',
      messages: [{ role: 'user', text: filler.repeat(repeats) }],
      tools: [],
      toolChoice: { mode: 'auto' },
      maxOutputTokens: 200,
    })
    const runRung = async (request: ProviderRequest, concurrency: number): Promise<CeilingRung> => {
      const total = callsForRung(concurrency)
      const latencies: number[] = []
      let errors = 0
      let tokens = 0
      for (let done = 0; done < total; done += concurrency) {
        const width = Math.min(concurrency, total - done)
        await Promise.all(
          Array.from({ length: width }, async () => {
            const start = Date.now()
            try {
              const response = await adapter.chat(request)
              latencies.push(Date.now() - start)
              tokens += response.usage.inputTokens + response.usage.outputTokens
            } catch {
              errors += 1
            }
          }),
        )
      }
      latencies.sort((a, b) => a - b)
      return {
        concurrency,
        calls: total,
        errors,
        p50Ms: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
        p95Ms: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
        meanTokens: latencies.length === 0 ? 0 : Math.round(tokens / latencies.length),
      }
    }
    const sleep = async (ms: number): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
    const overBudget = (rung: CeilingRung): boolean => rung.calls === 0 || rung.errors / rung.calls > ERROR_BUDGET
    const rungs: CeilingRung[] = []
    for (const [index, concurrency] of LADDER.entries()) {
      const rung = await runRung(brief(15), concurrency)
      rungs.push(rung)
      console.log(`[meta-ceiling] rung c=${concurrency} calls=${rung.calls} errors=${rung.errors} p50=${rung.p50Ms} p95=${rung.p95Ms} meanTokens=${rung.meanTokens}`)
      if (overBudget(rung)) break
      if (index < LADDER.length - 1) await sleep(RUNG_GAP_MS)
    }
    const passing = rungs.filter((rung) => !overBudget(rung)).map((rung) => rung.concurrency)
    const largeRungs: CeilingRung[] = []
    for (const concurrency of passing.slice(-3)) {
      await sleep(RUNG_GAP_MS)
      const rung = await runRung(brief(150), concurrency)
      largeRungs.push(rung)
      console.log(`[meta-ceiling] large c=${concurrency} calls=${rung.calls} errors=${rung.errors} p50=${rung.p50Ms} p95=${rung.p95Ms} meanTokens=${rung.meanTokens}`)
    }
    const ceiling: MetaCeiling = {
      measuredAt: new Date().toISOString(),
      model,
      errorBudget: ERROR_BUDGET,
      headroom: HEADROOM,
      rungs,
      largeRungs: largeRungs.length > 0 ? largeRungs : undefined,
      maxSustainable: decideCeiling(rungs),
    }
    const file = ceilingPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(ceiling, null, 2))
    expect(ceiling.maxSustainable).toBeGreaterThan(0)
  }, 1_800_000)
})
