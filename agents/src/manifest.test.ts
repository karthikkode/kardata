import { describe, expect, it } from 'vitest'
import { validateManifest, type Manifest } from './manifest.js'

const valid: Manifest = {
  pins: [
    {
      donor: 'pi',
      repo: 'https://github.com/earendil-works/pi',
      sha: 'a'.repeat(40),
      license: 'MIT',
      licensePath: 'LICENSE',
      taken: [{ path: 'packages/ai/src/types.ts', kind: 'pattern' }],
    },
  ],
}

describe('validateManifest', () => {
  it('accepts a complete pin', () => {
    expect(validateManifest(valid)).toEqual([])
  })

  it('accepts an empty pin list', () => {
    expect(validateManifest({ pins: [] })).toEqual([])
  })

  it('rejects missing SHA, license, and taken entries', () => {
    const errors = validateManifest({
      pins: [
        {
          donor: 'x',
          repo: 'https://example.com/x',
          sha: 'short',
          license: '',
          licensePath: '',
          taken: [],
        },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((error) => error.includes('.sha'))).toBe(true)
    expect(errors.some((error) => error.includes('.license'))).toBe(true)
    expect(errors.some((error) => error.includes('.taken'))).toBe(true)
  })

  it('rejects bad taken kinds', () => {
    const errors = validateManifest({
      pins: [
        {
          donor: 'x',
          repo: 'https://example.com/x',
          sha: 'b'.repeat(40),
          license: 'MIT',
          licensePath: 'LICENSE',
          taken: [{ path: 'a.ts', kind: 'copy' as 'pattern' }],
        },
      ],
    })
    expect(errors.some((error) => error.includes('.kind'))).toBe(true)
  })
})
