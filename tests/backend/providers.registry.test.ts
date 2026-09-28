import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EFFORT,
  defaultModelFor,
  findModel,
  isKnownEffort,
  isKnownModel,
  modelsFor,
} from '../../backend/src/providers/registry.js'

describe('verified Meta capability profiles', () => {
  it('lists Contributor first and no other provider', () => {
    const models = modelsFor('meta')
    expect(models.map((entry) => entry.model)).toEqual([
      'muse-spark-1.3-contributor', 'muse-spark-1.3',
      'muse-spark-1.2', 'muse-spark-1.2-contributor', 'muse-spark-1.1',
    ])
    expect(models.every((entry) => entry.provider === 'meta' && entry.displayName === entry.model)).toBe(true)
    expect(findModel('deepseek', 'deepseek-chat')).toBeUndefined()
  })

  it('defaults to Contributor with high effort', () => {
    expect(defaultModelFor('meta', {})).toBe('muse-spark-1.3-contributor')
    expect(DEFAULT_EFFORT).toBe('high')
    expect(defaultModelFor('meta', { KARDATA_META_MODEL: 'muse-spark-1.3' })).toBe('muse-spark-1.3')
    expect(defaultModelFor('meta', { KARDATA_META_MODEL: '  ' })).toBe('muse-spark-1.3-contributor')
  })

  it('keeps only verified effort and wire metadata', () => {
    expect(findModel('meta', 'muse-spark-1.3-contributor')?.mode).toBe('responses')
    expect(findModel('meta', 'muse-spark-1.3-contributor')?.efforts).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(findModel('meta', 'muse-spark-1.2-contributor')?.reasoning).toBe('none')
    expect(findModel('meta', 'sam-3.1')).toBeUndefined()
    expect(isKnownEffort('meta', 'muse-spark-1.3-contributor', 'high')).toBe(true)
    expect(isKnownEffort('meta', 'muse-spark-1.3-contributor', 'ultra')).toBe(false)
  })

  it('does not treat an unverified configured id as supported', () => {
    expect(isKnownModel('meta', 'muse-spark-1.3')).toBe(true)
    expect(isKnownModel('meta', 'future-model', { KARDATA_META_MODEL: 'future-model' })).toBe(false)
    expect(isKnownModel('deepseek', 'deepseek-chat')).toBe(false)
  })
})
