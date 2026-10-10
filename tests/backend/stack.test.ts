// Unit tests for deployment/scripts/stack-lib.mjs: the verdict logic
// behind `npm run stack:*`. No docker, no network, no git.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertDeletablePath,
  countRepoTools,
  fleetVerdict,
  formatVerdict,
  freshnessVerdict,
  ownedTestProcs,
  parityVerdict,
  parseEnvFile,
  PILOT_RO_ROLE,
  pilotConfig,
  pilotRoStatements,
  pilotWorkerCount,
  parseSuperviseArgs,
  PROD_PORTS,
  RESOURCE_PROFILES,
  STAGING_PORTS,
  portsDisjointVerdict,
} from '../../deployment/scripts/stack-lib.mjs'

describe('parseEnvFile', () => {
  it('parses KEY=value, skips blanks/comments, strips quotes', () => {
    const parsed = parseEnvFile('# comment\n\nPORT=13001\nKEY="quoted value"\nSINGLE=\'s\'\nBAD LINE\n')
    expect(parsed).toEqual({ PORT: '13001', KEY: 'quoted value', SINGLE: 's' })
  })
})

describe('countRepoTools', () => {
  it('counts only entries inside the TOOL_SCHEMAS block', () => {
    const text = [
      "const OTHER = {",
      "  'not-a-tool': 1,",
      '}',
      'export const TOOL_SCHEMAS = {',
      "  'db.a': z.object({}).strict(),",
      "  'db.b': z.object({",
      '    nested: true,',
      '  }).strict(),',
      '}',
      "  'after-block': 2,",
    ].join('\n')
    expect(countRepoTools(text)).toBe(2)
  })

  it('throws when the block is missing', () => {
    expect(() => countRepoTools('export const X = {}')).toThrow('TOOL_SCHEMAS')
  })
})

describe('fleetVerdict', () => {
  it('passes with exactly one fleet', () => {
    expect(fleetVerdict({ hostWorkers: [], composeWorkerRunning: true }).level).toBe('pass')
    expect(fleetVerdict({ hostWorkers: [{ pid: '1', user: 'k', cmd: 'dev-worker' }], composeWorkerRunning: false }).level).toBe('pass')
  })

  it('fails on a duplicate fleet with kill fixes (sudo for root)', () => {
    const verdict = fleetVerdict({
      hostWorkers: [{ pid: '79961', user: 'root', cmd: 'node backend/dist/temporal/dev-worker.js' }],
      composeWorkerRunning: true,
    })
    expect(verdict.level).toBe('fail')
    expect(verdict.fix[0]).toMatch(/^sudo kill 79961/)
  })

  it('fails on two host workers even with compose down', () => {
    const verdict = fleetVerdict({
      hostWorkers: [
        { pid: '1', user: 'k', cmd: 'dev-worker' },
        { pid: '2', user: 'k', cmd: 'dev-worker' },
      ],
      composeWorkerRunning: false,
    })
    expect(verdict.level).toBe('fail')
    expect(verdict.detail).toContain('2 host workers')
    expect(verdict.fix[0]).toMatch(/^kill 2/)
  })

  it('warns when nothing polls', () => {
    const verdict = fleetVerdict({ hostWorkers: [], composeWorkerRunning: false })
    expect(verdict.level).toBe('warn')
    expect(verdict.fix[0]).toContain('stack:worker:compose')
  })
})

describe('freshnessVerdict', () => {
  it('passes when the image label matches HEAD', () => {
    expect(freshnessVerdict({ service: 'worker', labelSha: 'abc', headSha: 'abc', headSubject: 'x' }).level).toBe('pass')
  })

  it('fails on SHA mismatch with a deploy fix', () => {
    const verdict = freshnessVerdict({ service: 'backend', labelSha: 'aaa111', headSha: 'bbb222', headSubject: 'new' })
    expect(verdict.level).toBe('fail')
    expect(verdict.detail).toContain('aaa111')
    expect(verdict.fix[0]).toContain('stack:deploy')
  })

  it('warns on pre-label images instead of failing', () => {
    expect(freshnessVerdict({ service: 'worker', labelSha: null, headSha: 'abc', headSubject: '' }).level).toBe('warn')
    expect(freshnessVerdict({ service: 'worker', labelSha: 'unknown', headSha: 'abc', headSubject: '' }).level).toBe('warn')
  })
})

describe('parityVerdict', () => {
  it('passes on exact count match, fails on drift, warns when unchecked', () => {
    expect(parityVerdict({ served: 74, repo: 74 }).level).toBe('pass')
    expect(parityVerdict({ served: 55, repo: 74 }).level).toBe('fail')
    expect(parityVerdict({ served: null, repo: 74 }).level).toBe('warn')
  })

  it('fails as unreachable, not count drift, on the -1 sentinel', () => {
    const verdict = parityVerdict({ served: -1, repo: 74 })
    expect(verdict.level).toBe('fail')
    expect(verdict.detail).toContain('unreachable')
    expect(verdict.fix[0]).toContain('stack:status')
  })
})

describe('ownedTestProcs', () => {
  const ROOT = '/home/karthik/projects/kardata_app'
  const ME = 'karthik'

  it('kills own-user repo vite on the owned test ports', () => {
    const { kill, notes } = ownedTestProcs(
      [
        { pid: '83218', user: 'karthik', cwd: ROOT, cmd: 'sh -c vite --port 15173 --host 127.0.0.1 --strictPort' },
        { pid: '83219', user: 'karthik', cwd: ROOT, cmd: `node ${ROOT}/node_modules/.bin/vite --port 15174 --host 127.0.0.1 --strictPort` },
      ],
      { repoRoot: ROOT, user: ME },
    )
    expect(kill.map((p) => p.pid)).toEqual(['83218', '83219'])
    expect(notes).toEqual([])
  })

  it('kills own-user playwright workers under the repo', () => {
    const { kill } = ownedTestProcs(
      [{ pid: '90001', user: 'karthik', cwd: ROOT, cmd: `node ${ROOT}/node_modules/playwright-core/lib/worker.js` }],
      { repoRoot: ROOT, user: ME },
    )
    expect(kill.map((p) => p.pid)).toEqual(['90001'])
  })

  it('never touches the owner dev server, foreign checkouts, or other users', () => {
    const { kill, notes } = ownedTestProcs(
      [
        { pid: '100', user: 'karthik', cwd: ROOT, cmd: `node ${ROOT}/node_modules/.bin/vite --port 5174` },
        { pid: '101', user: 'karthik', cwd: '/tmp/other', cmd: 'node /tmp/other/node_modules/.bin/vite --port 15173' },
        { pid: '102', user: 'root', cwd: ROOT, cmd: `node ${ROOT}/node_modules/.bin/vite --port 15173` },
      ],
      { repoRoot: ROOT, user: ME },
    )
    expect(kill).toEqual([])
    expect(notes.join('\n')).toContain('102')
  })

  it('notes browser leftovers with a kill hint instead of killing them', () => {
    const { kill, notes } = ownedTestProcs(
      [{ pid: '91000', user: 'karthik', cwd: ROOT, cmd: 'chrome-headless-shell --disable-gpu --headless' }],
      { repoRoot: ROOT, user: ME },
    )
    expect(kill).toEqual([])
    expect(notes.join('\n')).toMatch(/kill 91000/)
  })
})

describe('assertDeletablePath', () => {
  const ROOT = '/home/karthik/projects/kardata_app'

  it('refuses the pilot archive and anything inside it', () => {
    expect(() => assertDeletablePath('var/pilot/archive', { repoRoot: ROOT })).toThrow('refuses to delete')
    expect(() => assertDeletablePath('var/pilot/archive/run-1', { repoRoot: ROOT })).toThrow('refuses to delete')
  })

  it('refuses ancestors of the archive', () => {
    expect(() => assertDeletablePath('var/pilot', { repoRoot: ROOT })).toThrow('refuses to delete')
    expect(() => assertDeletablePath('var', { repoRoot: ROOT })).toThrow('refuses to delete')
    expect(() => assertDeletablePath('.', { repoRoot: ROOT })).toThrow('refuses to delete')
    expect(() => assertDeletablePath(ROOT, { repoRoot: ROOT })).toThrow('refuses to delete')
  })

  it('resolves `..` before deciding', () => {
    expect(() => assertDeletablePath('var/pilot/archive/../../..', { repoRoot: ROOT })).toThrow('refuses to delete')
    expect(() => assertDeletablePath('var/pilot/worktrees/../archive', { repoRoot: ROOT })).toThrow('refuses to delete')
    expect(() => assertDeletablePath('var/pilot/archive/../worktrees/rc1', { repoRoot: ROOT })).not.toThrow()
  })

  it('allows siblings and unrelated paths', () => {
    expect(() => assertDeletablePath('var/pilot/worktrees/rc1', { repoRoot: ROOT })).not.toThrow()
    expect(() => assertDeletablePath('/tmp/kardata-live', { repoRoot: ROOT })).not.toThrow()
  })
})

describe('formatVerdict', () => {
  it('renders the tag, detail, and $ fix lines', () => {
    const text = formatVerdict('fleet', { level: 'fail', detail: 'dup', fix: ['sudo kill 1'] })
    expect(text).toContain('[FAIL] fleet: dup')
    expect(text).toContain('$ sudo kill 1')
  })
})

describe('portsDisjointVerdict', () => {
  it('passes on the committed staging/prod port maps', () => {
    expect(portsDisjointVerdict({}).level).toBe('pass')
    expect(new Set([...STAGING_PORTS, ...PROD_PORTS]).size).toBe(STAGING_PORTS.length + PROD_PORTS.length)
  })

  it('fails naming the colliding port', () => {
    const verdict = portsDisjointVerdict({ staging: [5432], prod: [5432] })
    expect(verdict.level).toBe('fail')
    expect(verdict.detail).toContain('5432')
  })
})

describe('RESOURCE_PROFILES', () => {
  it('keeps staging lean and prod favored', () => {
    expect(RESOURCE_PROFILES.lean.workerReplicas).toBe(1)
    expect(RESOURCE_PROFILES.full.workerReplicas).toBeGreaterThan(RESOURCE_PROFILES.lean.workerReplicas)
    expect(RESOURCE_PROFILES.full.dbPoolServer).toBeGreaterThan(RESOURCE_PROFILES.lean.dbPoolServer)
  })
})

describe('pilotConfig', () => {
  it('pins the pilot wiring (B3)', () => {
    const cfg = pilotConfig()
    expect(cfg).toMatchObject({
      dbName: 'kardata_pilot',
      namespace: 'kardata-pilot',
      backendPort: 3201,
      uiPort: 25174,
      uiOrigin: 'http://localhost:25174',
      tenant: 'tenant-pilot',
      uiOnly: '1',
    })
    expect(cfg.databaseUrl).toContain('/kardata_pilot')
    expect(cfg.backendUrl).toBe('http://127.0.0.1:3201')
    expect(cfg.mcpUrl).toBe('http://127.0.0.1:3201/mcp')
    expect(cfg.corsOrigins).toContain('http://localhost:25174')
    expect(cfg.corsOrigins).toContain('http://127.0.0.1:25174')
  })

  it('takes r0 scratch dbName/namespace overrides (defaults unchanged)', () => {
    const cfg = pilotConfig({ dbName: 'kardata_pilot_r0', namespace: 'kardata-pilot-r0' })
    expect(cfg.dbName).toBe('kardata_pilot_r0')
    expect(cfg.namespace).toBe('kardata-pilot-r0')
    expect(cfg.databaseUrl).toContain('/kardata_pilot_r0')
    expect(cfg.backendUrl).toBe('http://127.0.0.1:3201')
    expect(pilotConfig().dbName).toBe('kardata_pilot')
  })
})

describe('pilot startup (static)', () => {
  const STACK = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deployment', 'scripts', 'stack.mjs'),
    'utf8',
  )
  const section = STACK.slice(STACK.indexOf('async function cmdPilotUp'), STACK.indexOf('const commands = {'))

  it('never terminates workflows (B3: pilot runs are kept for Phase 9)', () => {
    expect(section.length).toBeGreaterThan(1000)
    expect(section).toContain('cmdPilotDown')
    expect(section).not.toMatch(/\b(terminateWorkflow|cancelWorkflow|deleteWorkflow|requestCancel)\b/)
  })

  it('plumbs KARDATA_PILOT_DB_NAME/NAMESPACE into up + status (r0 scratch)', () => {
    expect(STACK).toContain('KARDATA_PILOT_DB_NAME')
    expect(STACK).toContain('KARDATA_PILOT_NAMESPACE')
    expect(STACK).toContain('pilotConfig(pilotEnvOverrides())')
    expect(STACK).toContain('is not identifier-safe')
  })
})

describe('pilotRoStatements', () => {
  const statements = pilotRoStatements({ owner: 'kardata', password: 'TEST-pw', database: 'kardata_pilot' })
  const text = statements.join('\n')

  it('creates the role idempotently and grants connect + select only', () => {
    expect(PILOT_RO_ROLE).toBe('kardata_pilot_ro')
    expect(text).toContain('IF NOT EXISTS')
    // Every run re-asserts the shared password: the role outlives any
    // one database, so a ghost keeps a stale secret otherwise (P8-B2).
    expect(text).toContain('ALTER ROLE "kardata_pilot_ro" WITH PASSWORD')
    expect(text).toContain('GRANT CONNECT')
    expect(text).toContain('GRANT SELECT ON ALL TABLES')
    expect(text).toContain('ALTER DEFAULT PRIVILEGES')
    expect(text).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|TRUNCATE|ALL PRIVILEGES|CREATE)/)
  })

  it('requires owner, password and database, and quotes identifiers', () => {
    expect(() => pilotRoStatements({ owner: '', password: 'x', database: 'd' })).toThrow('owner, password, database')
    const quoted = pilotRoStatements({ role: 'we"ird', owner: 'kardata', password: "p'w", database: 'd' }).join('\n')
    expect(quoted).toContain('"we""ird"')
    expect(quoted).toContain("'p''w'")
  })
})

describe('pilotWorkerCount', () => {
  it('defaults to 4 workers like staging/prod', () => {
    expect(pilotWorkerCount(['up', '--worktree', '/tmp/x'])).toBe(4)
  })
  it('takes --workers N', () => {
    expect(pilotWorkerCount(['up', '--worktree', '/tmp/x', '--workers', '8'])).toBe(8)
    expect(pilotWorkerCount(['up', '--worktree', '/tmp/x', '--workers', '1'])).toBe(1)
  })
  it('rejects non-positive integers', () => {
    for (const bad of ['0', '-2', '1.5', 'many']) {
      expect(() => pilotWorkerCount(['up', '--worktree', '/tmp/x', '--workers', bad])).toThrow('--workers must be a positive integer')
    }
    expect(() => pilotWorkerCount(['up', '--worktree', '/tmp/x', '--workers'])).toThrow('--workers must be a positive integer')
  })
})

describe('parseSuperviseArgs', () => {
  it('parses --log/--max-bytes/--keep with a 32MB x 3 default', () => {
    expect(parseSuperviseArgs(['--log', '/tmp/x.log', '--', 'node', 'a.js'])).toEqual({
      logPath: '/tmp/x.log',
      maxBytes: 33554432,
      keep: 3,
      cmd: 'node',
      cmdArgs: ['a.js'],
    })
    expect(parseSuperviseArgs(['--log', 'l', '--max-bytes', '100', '--keep', '2', '--', 'x'])).toMatchObject({ maxBytes: 100, keep: 2, cmd: 'x', cmdArgs: [] })
  })
  it('rejects a missing log, separator, command, or non-positive sizes', () => {
    expect(() => parseSuperviseArgs(['--', 'x'])).toThrow('--log')
    expect(() => parseSuperviseArgs(['--log', 'l'])).toThrow('--')
    expect(() => parseSuperviseArgs(['--log', 'l', '--'])).toThrow('command')
    expect(() => parseSuperviseArgs(['--log', 'l', '--max-bytes', '0', '--', 'x'])).toThrow('--max-bytes')
    expect(() => parseSuperviseArgs(['--log', 'l', '--keep', 'many', '--', 'x'])).toThrow('--keep')
  })
})

describe('__supervise (capped log rotation)', () => {
  const stackMjs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deployment', 'scripts', 'stack.mjs')
  const runSupervised = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [stackMjs, '__supervise', ...args], { timeout: 20000 }, (error, stdout, stderr) => {
        resolve({ code: error && 'code' in error ? (error.code as number) : 0, stdout, stderr })
      })
    })

  it('rotates a flooding child into bounded files and propagates its exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'supervise-'))
    const log = join(dir, 't.log')
    const flood = `for (let i = 0; i < 40; i++) console.log('L' + String(i).padStart(2, '0') + 'x'.repeat(97)); process.exitCode = 3`
    const { code } = await runSupervised(['--log', log, '--max-bytes', '200', '--keep', '2', '--', process.execPath, '-e', flood])
    expect(code).toBe(3)
    expect(readdirSync(dir).sort()).toEqual(['t.log', 't.log.1', 't.log.2'])
    const lines = Array.from({ length: 40 }, (_, i) => `L${String(i).padStart(2, '0')}${'x'.repeat(97)}\n`).join('')
    const kept = ['t.log.2', 't.log.1', 't.log'].map((name) => readFileSync(join(dir, name), 'utf8')).join('')
    expect(kept.length).toBeLessThan(lines.length)
    expect(kept.length).toBeLessThanOrEqual(3 * 200)
    expect(kept).toBe(lines.slice(-kept.length))
  }, 30000)

  it('forwards SIGTERM to the child so down/stop reap both', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'supervise-'))
    const token = `supervise-term-child-${Date.now()}`
    const { spawn } = await import('node:child_process')
    const sup = spawn(process.execPath, [stackMjs, '__supervise', '--log', join(dir, 's.log'), '--', process.execPath, '-e', `void '${token}'; setInterval(() => {}, 500)`], { stdio: 'ignore' })
    const childAlive = () =>
      readdirSync('/proc').some((name) => {
        if (!/^\d+$/.test(name)) return false
        try {
          return readFileSync(`/proc/${name}/cmdline`, 'utf8').includes(token)
        } catch {
          return false
        }
      })
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(childAlive()).toBe(true)
      sup.kill('SIGTERM')
      const exited = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 8000)
        sup.on('exit', () => {
          clearTimeout(timer)
          resolve(true)
        })
      })
      expect(exited).toBe(true)
      expect(childAlive()).toBe(false)
    } finally {
      if (sup.exitCode === null) sup.kill('SIGKILL')
      for (const name of readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue
        try {
          if (readFileSync(`/proc/${name}/cmdline`, 'utf8').includes(token)) process.kill(Number(name), 'SIGKILL')
        } catch {
          // Raced out from under us: already what we want.
        }
      }
    }
  }, 30000)
})
