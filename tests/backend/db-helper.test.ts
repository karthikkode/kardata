import { describe, expect, it, vi } from 'vitest'

vi.mock('pg', () => ({ Client: vi.fn() }))
vi.mock('../../backend/src/db/migrate.js', () => ({ migrate: vi.fn() }))
const { derivedUrl } = await import('./db-helper.js')

describe('isolated database names', () => {
  it.each(['postgres', 'kardata', 'kardata_test', 'kardata_test_x; DROP DATABASE kardata', 'kardata_test_"x', 'kardata_test_' + 'x'.repeat(64)])('rejects unsafe or shared name %s before connecting', (name) => {
    expect(() => derivedUrl(name)).toThrow(/isolated test database/)
  })
})
