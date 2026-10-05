// Connectivity detector behind honest 503s on Temporal cuts (F8's product
// half). Pure unit: no DB, no Temporal. Untagged: runs-gateway top-level
// exports are not registry surfaces (only workflows/activities are).
import { describe, expect, it } from 'vitest'
import { isTemporalConnectivity } from '../../backend/src/temporal/runs-gateway.js'
import { RunNotFound, TemporalUnavailableError } from '../../backend/src/temporal/runs-types.js'

const nest = (depth: number, leaf: unknown): unknown => {
  let current: unknown = leaf
  for (let index = 0; index < depth; index += 1) current = { cause: current }
  return current
}

const cases: Array<{ name: string; error: unknown; want: boolean }> = [
  { name: 'grpc code 14', error: { code: 14 }, want: true },
  { name: 'UNAVAILABLE code', error: { code: 'UNAVAILABLE' }, want: true },
  { name: 'ECONNREFUSED code', error: { code: 'ECONNREFUSED' }, want: true },
  { name: 'refused message', error: new Error('Connection refused'), want: true },
  { name: 'tonic transport message', error: new Error('tonic transport error: broken pipe'), want: true },
  { name: 'marker one cause deep', error: nest(1, { code: 'ECONNREFUSED' }), want: true },
  { name: 'marker four causes deep', error: nest(4, { code: 'ENOTFOUND' }), want: true },
  { name: 'marker five causes deep is too far', error: nest(5, { code: 'ENOTFOUND' }), want: false },
  { name: 'plain error', error: new Error('boom'), want: false },
  { name: 'bug stays a bug', error: new TypeError('x is not a function'), want: false },
  { name: 'domain error', error: new RunNotFound('nope'), want: false },
  { name: 'domain code', error: { code: 'not_found' }, want: false },
  { name: 'deadline exceeded is slowness, not a cut', error: { code: 4 }, want: false },
  { name: 'null', error: null, want: false },
  { name: 'bare string', error: 'UNAVAILABLE', want: false },
]

describe('isTemporalConnectivity', () => {
  for (const { name, error, want } of cases) {
    it(name, () => {
      expect(isTemporalConnectivity(error)).toBe(want)
    })
  }
})

describe('TemporalUnavailableError', () => {
  it('carries its cause', () => {
    const inner = new Error('refused')
    const error = new TemporalUnavailableError('Temporal is unreachable; retry the command shortly.', { cause: inner })
    expect(error).toBeInstanceOf(Error)
    expect(error.cause).toBe(inner)
  })
})
