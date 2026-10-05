import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn(), migrate: vi.fn(), clientOptions: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('pg', () => ({ Client: class {
  constructor(options: unknown) { mocks.clientOptions(options) }
  query = mocks.query
  connect = mocks.connect
  end = mocks.end
} }))
vi.mock('../../backend/src/db/migrate.js', async (original) => ({
  ...await original<typeof import('../../backend/src/db/migrate.js')>(), migrate: mocks.migrate,
}))
vi.mock('../../backend/src/observability/logging.js', async (original) => ({
  ...await original<typeof import('../../backend/src/observability/logging.js')>(),
  createLogger: () => ({ info: mocks.info, error: mocks.error }),
}))
vi.stubEnv('TEST_DATABASE_URL', 'postgresql://test:test@localhost/kardata_test')
const { ensureTestDb, templateIdentity, prepareTestTemplate } = await import('./db-helper.js')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KARDATA_TEST_DB_RUN_ID', '')
  mocks.query.mockReset().mockResolvedValue({ rows: [] })
})

describe('template admission and fallback', () => {
  it('direct callers without a run identity retain fresh migration setup', async () => {
    const first = await ensureTestDb('kardata_test_direct')
    const second = await ensureTestDb('kardata_test_direct')
    expect(new URL(first).pathname).not.toBe(new URL(second).pathname)
    expect(mocks.migrate).toHaveBeenCalledTimes(2)
    expect(mocks.clientOptions).toHaveBeenCalledWith(expect.objectContaining({ connectionTimeoutMillis: 10000, statement_timeout: 300000 }))
    expect(mocks.query).toHaveBeenCalledWith("SET lock_timeout = '30s'")
    expect(mocks.info.mock.calls.map(([entry]) => entry.event)).toEqual(['db.test-database.create.start', 'db.test-database.create.done', 'db.test-database.create.start', 'db.test-database.create.done'])
    expect(mocks.query.mock.calls.every(([sql]) => !String(sql).includes('TEMPLATE'))).toBe(true)
  })
  it.each([
    undefined,
    { owned: false, datallowconn: false, datistemplate: false },
    { owned: true, datallowconn: true, datistemplate: false },
    { owned: true, datallowconn: false, datistemplate: true },
    { owned: true, datallowconn: false, datistemplate: false, marker: 'wrong' },
  ])('rejects an unvalidated source before CREATE DATABASE: %j', async (row) => {
    vi.stubEnv('KARDATA_TEST_DB_RUN_ID', 'a'.repeat(32))
    mocks.query.mockResolvedValue({ rows: row ? [row] : [] })
    await expect(ensureTestDb('kardata_test_guard')).rejects.toThrow(/template/)
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).startsWith('CREATE DATABASE'))).toBe(false)
    expect(mocks.migrate).not.toHaveBeenCalled()
    expect(mocks.end).toHaveBeenCalledOnce()
  })
  it('does not publish readiness after migration failure; closes the lock session', async () => {
    mocks.migrate.mockRejectedValueOnce(new Error('fixture migration failure'))
    await expect(prepareTestTemplate('b'.repeat(32))).rejects.toThrow('fixture migration failure')
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).startsWith('COMMENT ON DATABASE'))).toBe(false)
    expect(mocks.end).toHaveBeenCalledOnce()
    expect(mocks.query.mock.calls[0]?.[0]).toBe("SET lock_timeout = '30s'")
    expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'db.test-template.prepare.start', migrationCount: 24 }))
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'db.test-template.prepare.error', code: 'Error' }))
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('fixture migration failure')
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('postgresql')
  })
  it('rejects changed migration identity without creating a clone', async () => {
    vi.stubEnv('KARDATA_TEST_DB_RUN_ID', 'c'.repeat(32))
    const identity = templateIdentity('c'.repeat(32))
    mocks.query.mockResolvedValue({ rows: [{ owned: true, datallowconn: false, datistemplate: false, marker: identity.marker + 'changed' }] })
    await expect(ensureTestDb('kardata_test_changed')).rejects.toThrow(/identity/)
    expect(mocks.query).toHaveBeenCalledTimes(2)
  })
})
