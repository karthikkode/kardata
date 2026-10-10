// P8-B2 live proof: up on worktree A → down → up on worktree B shares one
// pilot-DB identity (same UI key, worker token, RO password; A's sector
// visible on B). Gated: needs two PRE-BUILT worktrees (backend/dist +
// frontend present, e.g. `git worktree add` + `npm ci` + backend build)
// and free pilot ports. Skips without KARDATA_PILOT_AB=/path/A:/path/B.
// Pre-build each worktree with `npm ci` plus every workspace build
// (backend AND agents: backend/dist imports @kardata/agents).
// Run with node 22 (KARDATA_NODE22 or PATH). Cleans up: pilot down on B
// plus DROP of the shared kardata_pilot database — never run alongside
// a real pilot run (the up port guard fails fast if one is up).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAIR = process.env['KARDATA_PILOT_AB'] ?? ''
const [DIR_A, DIR_B] = PAIR.split(':')
const NODE = process.env['KARDATA_NODE22'] ?? 'node'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BACKEND = 'http://127.0.0.1:3201'

function stack(worktree: string, sub: 'up' | 'down'): void {
  try {
    execFileSync(NODE, ['deployment/scripts/stack.mjs', 'pilot', sub, '--worktree', worktree], {
      cwd: ROOT,
      timeout: 600_000,
      stdio: 'pipe',
      env: { ...process.env, PATH: `${process.env['PATH'] ?? ''}` },
    })
  } catch (error) {
    const out = String((error as { stderr?: unknown }).stderr ?? (error as Error).message)
    throw new Error(`stack pilot ${sub} ${worktree} failed: ${out.slice(-800)}`)
  }
}

function secret(key: string): string {
  const text = readFileSync(join(ROOT, 'var', 'pilot', 'secrets.env'), 'utf8')
  const line = text.split('\n').find((l) => l.startsWith(`${key}=`))
  if (!line) throw new Error(`shared secrets file is missing ${key}`)
  return line.slice(key.length + 1).trim()
}

async function api(path: string, key: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${key}` },
  })
}

describe('pilot A→B shared secrets (live)', () => {
  it.skipIf(!DIR_A || !DIR_B)('up A → down → up B keeps one identity', async () => {
    for (const dir of [DIR_A, DIR_B]) {
      if (!existsSync(join(dir, 'backend', 'dist', 'server.js'))) throw new Error(`worktree not built: ${dir}`)
    }
    const { Pool } = await import('pg')
    const guard = new Pool({ connectionString: 'postgresql://kardata:kardata-dev@127.0.0.1:5433/kardata' })
    try {
      const exists = await guard.query('SELECT 1 FROM pg_database WHERE datname = $1', ['kardata_pilot'])
      if (exists.rows[0]) throw new Error('refusing live A→B: kardata_pilot already exists (a pilot run owns it)')
    } finally {
      await guard.end()
    }
    // Past the guard, kardata_pilot did not exist: we own it on every
    // path, including a crashed up (which creates the DB before dying).
    try {
      stack(DIR_A, 'up')
      const uiKey = secret('KARDATA_UI_KEY')
      const workerToken = secret('KARDATA_MCP_TOKEN')
      try {
        const created = await api('/v1/sectors', uiKey, {
          method: 'POST',
          // The UI-only gate needs the UI origin + client header, like the UI sends.
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:25174', 'X-Kardata-Client': 'ui' },
          body: JSON.stringify({ name: 'ab-sector', topic: 'shared-secrets probe' }),
        })
        expect(created.status).toBe(201)
      } finally {
        stack(DIR_A, 'down')
      }

      stack(DIR_B, 'up')
      try {
        // UI key authenticates on B and A's sector is visible (same pilot DB).
        const list = await api('/v1/sectors', uiKey)
        expect(list.status).toBe(200)
        const names = ((await list.json()) as { data: { name: string }[] }).data.map((s) => s.name)
        expect(names).toContain('ab-sector')
        // Worker token is accepted on /mcp.
        const mcp = await api('/mcp', workerToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        })
        expect(mcp.status).toBe(200)
        // RO role logs in with the shared password.
        const ro = new Pool({
          connectionString: `postgresql://kardata_pilot_ro:${encodeURIComponent(secret('KARDATA_PILOT_RO_PASSWORD'))}@127.0.0.1:5433/kardata_pilot`,
        })
        try {
          await expect(ro.query('SELECT 1')).resolves.toBeTruthy()
        } finally {
          await ro.end()
        }
      } finally {
        stack(DIR_B, 'down')
      }
    } finally {
      for (const dir of [DIR_A, DIR_B]) {
        try {
          stack(dir, 'down')
        } catch {
          // best-effort: procs may never have started
        }
      }
      const server = new Pool({ connectionString: 'postgresql://kardata:kardata-dev@127.0.0.1:5433/kardata' })
      try {
        await server.query('DROP DATABASE IF EXISTS "kardata_pilot" WITH (FORCE)')
      } finally {
        await server.end()
      }
    }
  }, 900_000)
})
