import { describe, expect, it } from 'vitest'
import * as barrel from './index.js'

describe('barrel', () => {
  it('loads', () => {
    expect(barrel).toBeDefined()
  })
})
