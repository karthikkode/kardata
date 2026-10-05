// Pool budgets (connection-management plan, slices 2+4): env overrides
// with code defaults plus the factory monopoly (no direct `new Pool`
// outside the layer). No database needed. Env is saved and restored per
// test so cases stay order-independent.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../../backend/src/observability/logging.js'
import {
  DbContractError,
  DEFAULT_POOL_BUDGET,
  serverPoolBudget,
  validatePoolBudget,
  workerPoolBudget,
  workerPoolFromEnv,
} from '../../backend/src/db/index.js'

const VARS = [
  'KARDATA_DB_POOL_SERVER',
  'KARDATA_DB_POOL_WORKER',
  'KARDATA_PG_STATEMENT_TIMEOUT_MS',
  'DATABASE_URL',
]

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(VARS.map((name) => [name, process.env[name]]))
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const name of VARS) {
    const value = snapshot[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

describe('pool budgets [F:db.index.DbContractError] [F:db.index.validatePoolBudget] [F:db.index.DEFAULT_POOL_BUDGET] [F:db.index.serverPoolBudget] [F:db.index.workerPoolBudget] [F:db.index.workerPoolFromEnv] [F:db.errors.DbContractError] [F:db.pool.validatePoolBudget] [F:db.pool.DEFAULT_POOL_BUDGET] [F:db.pool.serverPoolBudget] [F:db.pool.workerPoolBudget] [F:db.pool.workerPoolFromEnv]', () => {
  const snapshot = snapshotEnv()
  afterEach(() => restoreEnv(snapshot))

  it('defaults to the code budgets when env is unset', () => {
    for (const name of VARS) delete process.env[name]
    expect(serverPoolBudget()).toMatchObject({ max: DEFAULT_POOL_BUDGET.max })
    expect(workerPoolBudget()).toMatchObject({ max: 5 })
    expect(serverPoolBudget().statementTimeoutMs).toBe(DEFAULT_POOL_BUDGET.statementTimeoutMs)
  })

  it('honors env overrides', () => {
    process.env['KARDATA_DB_POOL_SERVER'] = '25'
    process.env['KARDATA_DB_POOL_WORKER'] = '3'
    process.env['KARDATA_PG_STATEMENT_TIMEOUT_MS'] = '5000'
    expect(serverPoolBudget()).toMatchObject({ max: 25, statementTimeoutMs: 5000 })
    expect(workerPoolBudget()).toMatchObject({ max: 3, statementTimeoutMs: 5000 })
  })

  it('rejects invalid env fast instead of running small', () => {
    process.env['KARDATA_DB_POOL_SERVER'] = 'lots'
    expect(() => serverPoolBudget()).toThrow(DbContractError)
    process.env['KARDATA_DB_POOL_SERVER'] = '0'
    expect(() => serverPoolBudget()).toThrow(DbContractError)
    process.env['KARDATA_DB_POOL_WORKER'] = '-2'
    expect(() => workerPoolBudget()).toThrow(DbContractError)
  })

  it('skips validation with a warning when Postgres is unreachable', async () => {
    const logLines: string[] = []
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split('\n')) {
          if (line.trim()) logLines.push(line)
        }
        callback()
      },
    })
    const logger = createLogger({ op: 'test' }, logStream)
    await expect(
      validatePoolBudget('postgresql://u:p@127.0.0.1:1/kardata_nope', 10, 'KARDATA_DB_POOL_SERVER', logger),
    ).resolves.toBeUndefined()
    expect(logLines).toHaveLength(1)
    expect(JSON.parse(logLines[0] as string)).toMatchObject({ op: 'db.pool.validate', env: 'KARDATA_DB_POOL_SERVER' })
  })

  it('builds pools only through the factory', () => {
    // Mirrors the `pg` lint ban at the construction level: backend/src
    // outside db/ must never call `new Pool(` (tests keep their own).
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts') && !path.includes(`${join('src', 'db')}/`)) {
          if (/new Pool\(/.test(readFileSync(path, 'utf8'))) offenders.push(path)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  it('caches one worker pool per connection string', () => {
    process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db-a'
    const first = workerPoolFromEnv()
    const second = workerPoolFromEnv()
    expect(second).toBe(first)
    expect(first.options.max).toBe(5)
    void first.end()
  })
})
