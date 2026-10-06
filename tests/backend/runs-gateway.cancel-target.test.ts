import { describe, expect, it } from 'vitest'
import { cancelThreadTarget } from '../../backend/src/temporal/runs-helpers.js'

describe('cancelThreadTarget', () => {
  it('aims session runs at their session thread', () => {
    expect(cancelThreadTarget('session-run-abc', 'sessionRun')).toEqual({ threadKey: 'abc', partition: 'session:abc' })
  })

  it('aims child runs at their agent thread', () => {
    expect(cancelThreadTarget('child-1', 'subagentRun')).toEqual({ threadKey: 'agent:child-1', partition: 'child:child-1' })
    expect(cancelThreadTarget('child-2', 'companyResearch')).toEqual({ threadKey: 'agent:child-2', partition: 'child:child-2' })
  })
})
