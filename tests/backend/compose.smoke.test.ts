import { describe, expect, it } from 'vitest'

// Reachability smoke for the compose platform (B0.4). Gated: runs only with
// KARDATA_COMPOSE=1 while the stack from deployment/compose.yaml is up.
// Otherwise it skips explicitly — CI and staging set the flag.
const ENABLED = process.env['KARDATA_COMPOSE'] === '1'

const TARGETS = [
  { name: 'backend', url: process.env['KARDATA_BACKEND_URL'] ?? 'http://localhost:3001/healthz', expectStatus: 200 },
  { name: 'temporal-ui', url: process.env['KARDATA_TEMPORAL_URL'] ?? 'http://localhost:8080', expectStatus: 200 },
  { name: 'grafana', url: process.env['KARDATA_GRAFANA_URL'] ?? 'http://localhost:3000/api/health', expectStatus: 200 },
  { name: 'prometheus', url: process.env['KARDATA_PROM_URL'] ?? 'http://localhost:9090/-/healthy', expectStatus: 200 },
  { name: 'loki', url: process.env['KARDATA_LOKI_URL'] ?? 'http://localhost:3100/ready', expectStatus: 200 },
]

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// Cold stacks need settle time (Loki ring join, Temporal schema setup), so
// probes poll bounded instead of single-shotting a cold boot.
async function probe(url: string): Promise<number> {
  const deadline = Date.now() + 90_000
  let lastStatus = 0
  while (Date.now() < deadline) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      lastStatus = response.status
      if (lastStatus >= 200 && lastStatus < 500) return lastStatus
    } catch {
      lastStatus = 0
    } finally {
      clearTimeout(timer)
    }
    await sleep(3_000)
  }
  return lastStatus
}

describe.skipIf(!ENABLED)('compose platform (B0.4)', () => {
  for (const target of TARGETS) {
    it(`${target.name} answers ${target.expectStatus} at ${target.url}`, async () => {
      expect(await probe(target.url)).toBe(target.expectStatus)
    })
  }

  it('backend health envelope carries build sha', async () => {
    const url = process.env['KARDATA_BACKEND_URL'] ?? 'http://localhost:3001/healthz'
    const response = await fetch(url)
    expect(await response.json()).toEqual({
      ok: true,
      data: { status: 'ok', buildSha: expect.any(String), uptimeSecs: expect.any(Number) },
    })
  })
})

if (!ENABLED) {
  it('notes the compose gate', () => {
    expect(ENABLED).toBe(false)
  })
}
