// Unit tests for deployment/scripts/stack-lib.mjs: the verdict logic
// behind `npm run stack:*`. No docker, no network, no git.
import { describe, expect, it } from 'vitest'
import {
  countRepoTools,
  fleetVerdict,
  formatVerdict,
  freshnessVerdict,
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

describe('formatVerdict', () => {
  it('renders the tag, detail, and $ fix lines', () => {
    const text = formatVerdict('fleet', { level: 'fail', detail: 'dup', fix: ['sudo kill 1'] })
    expect(text).toContain('[FAIL] fleet: dup')
    expect(text).toContain('$ sudo kill 1')
  })
})
