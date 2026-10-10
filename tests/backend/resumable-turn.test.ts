// Pure park mapping for resumable turns: failure type (+patch flags) to
// park kind, and park kind to the visible message name. The workflow
// calls patched() only for the matching type (short-circuit), so new
// patch markers land only on the affected path.
import { describe, expect, it, vi } from 'vitest'
import { parkKindFor, parkMessageName } from '../../backend/src/temporal/workflows/resumable-turn.js'

describe('parkKindFor [F:backend.workflow.resumable_turn.parkKindFor]', () => {
  it('parks provider exhaustion when the patch is active', () => {
    expect(parkKindFor('ProviderExhausted', { parkPause: false, hasPatch: () => true })).toBe('provider')
  })
  it('rethrows provider exhaustion without the patch (old histories)', () => {
    expect(parkKindFor('ProviderExhausted', { parkPause: false, hasPatch: () => false })).toBeUndefined()
  })
  it('keeps the existing research/operation/context mappings', () => {
    expect(parkKindFor('ResearchPaused', { parkPause: true, hasPatch: () => false })).toBe('pause')
    expect(parkKindFor('ResearchPaused', { parkPause: false, hasPatch: () => false })).toBeUndefined()
    expect(parkKindFor('OperationBlocked', { parkPause: false, hasPatch: (id) => id === 'operation-recovery-v1' })).toBe('operation')
    expect(parkKindFor('ContextBlocked', { parkPause: false, hasPatch: (id) => id === 'context-recovery-v1' })).toBe('context')
    expect(parkKindFor('SomethingElse', { parkPause: true, hasPatch: () => true })).toBeUndefined()
    expect(parkKindFor(undefined, { parkPause: true, hasPatch: () => true })).toBeUndefined()
  })
  it('checks patches only for the matching type', () => {
    const hasPatch = vi.fn(() => true)
    parkKindFor('OperationBlocked', { parkPause: false, hasPatch })
    expect(hasPatch).toHaveBeenCalledTimes(1)
    expect(hasPatch).toHaveBeenCalledWith('operation-recovery-v1')
  })
})

describe('parkMessageName [F:backend.workflow.resumable_turn.parkMessageName]', () => {
  it('names each park kind for the visible message', () => {
    expect(parkMessageName('operation')).toBe('operation.recovery')
    expect(parkMessageName('provider')).toBe('provider.outage')
    expect(parkMessageName('context')).toBe('context.compaction')
    expect(parkMessageName('pause')).toBe('context.compaction')
  })
})
