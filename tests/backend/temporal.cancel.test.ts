// runCancel signal mapping. A closed workflow describes fine but rejects
// the signal with WorkflowNotFoundError; the mapping reports it gone so
// session delete (and run cancel) proceeds instead of 500ing. No Temporal
// server: the handle is a stub.
import { WorkflowNotFoundError } from '@temporalio/client'
import { describe, expect, it } from 'vitest'
import { RunNotFound } from '../../backend/src/temporal/runs-types.js'
import { signalRunCancel } from '../../backend/src/temporal/runs-helpers.js'

describe('signalRunCancel', () => {
  it('maps a closed handle to RunNotFound', async () => {
    const handle = {
      signal: async () => {
        throw new WorkflowNotFoundError('already completed', 'session-run-s-1', undefined)
      },
    }
    await expect(signalRunCancel(handle, 'session-run-s-1')).rejects.toThrow(RunNotFound)
  })

  it('passes unrelated errors through', async () => {
    const failure = new Error('connection reset')
    const handle = {
      signal: async () => {
        throw failure
      },
    }
    await expect(signalRunCancel(handle, 'session-run-s-1')).rejects.toBe(failure)
  })

  it('resolves when the signal lands', async () => {
    let signalled = 0
    const handle = {
      signal: async () => {
        signalled += 1
      },
    }
    await signalRunCancel(handle, 'session-run-s-1')
    expect(signalled).toBe(1)
  })
})
