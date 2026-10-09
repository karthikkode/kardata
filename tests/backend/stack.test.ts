// Unit tests for deployment/scripts/stack-lib.mjs: the verdict logic
// behind `npm run stack:*`. No docker, no network, no git.
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
