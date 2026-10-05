// Worker MCP credential self-check: a rotated-but-not-recreated token must
// fail loudly at boot, never as cryptic per-turn 403s. Hermetic.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkWorkerMcpAuth } from '../../backend/src/temporal/activities/worker-mcp-auth.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

const SECRET = 'token-that-must-never-appear-in-output'

function stubFetch(status: number) {
  return async () => ({ ok: status >= 200 && status < 300, status })
}

describe('worker mcp auth self-check', () => {
  it('passes when the credential resolves', async () => {
    const result = await checkWorkerMcpAuth({
      mcpEndpoint: 'http://backend:3001/mcp',
      mcpToken: SECRET,
      fetchFn: stubFetch(200),
    })
    expect(result).toEqual({ ok: true })
  })

  it('names the recreate remediation on 403 without leaking the token', async () => {
    const result = await checkWorkerMcpAuth({
      mcpEndpoint: 'http://backend:3001/mcp',
      mcpToken: SECRET,
      fetchFn: stubFetch(403),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('403')
    expect(result.reason).toContain('--force-recreate worker')
    expect(result.reason).not.toContain(SECRET)
  })

  it('reports other statuses and unreachable hosts distinctly', async () => {
    const bad = await checkWorkerMcpAuth({
      mcpEndpoint: 'http://backend:3001/mcp',
      mcpToken: SECRET,
      fetchFn: stubFetch(500),
    })
    expect(bad.ok).toBe(false)
    const down = await checkWorkerMcpAuth({
      mcpEndpoint: 'http://backend:3001/mcp',
      mcpToken: SECRET,
      fetchFn: async () => {
        throw new Error('connect refused')
      },
    })
    expect(down.ok).toBe(false)
    if (!bad.ok && !down.ok) {
      expect(bad.reason).toContain('500')
      expect(down.reason).toContain('unreachable')
      expect(bad.reason).not.toContain(SECRET)
      expect(down.reason).not.toContain(SECRET)
    }
  })

  it('flags missing configuration instead of probing', async () => {
    vi.stubEnv('KARDATA_MCP_URL', '')
    vi.stubEnv('KARDATA_MCP_TOKEN', '')
    let called = false
    const result = await checkWorkerMcpAuth({
      mcpEndpoint: undefined,
      mcpToken: undefined,
      fetchFn: async () => {
        called = true
        return { ok: true, status: 200 }
      },
    })
    expect(called).toBe(false)
    expect(result.ok).toBe(false)
  })
})
