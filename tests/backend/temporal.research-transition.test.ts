import { CancelledFailure, WorkflowFailedError } from '@temporalio/client'
import { describe, expect, it, vi } from 'vitest'
import { ensureApprovedCoordinator, type ApprovedCoordinatorHandle } from '../../backend/src/temporal/runs-gateway.js'

function handle(paused: boolean, planVersion = 1): ApprovedCoordinatorHandle {
  return { workflowId: 'TEST coordinator', query: async () => ({ paused, planVersion }), signal: vi.fn(), cancel: vi.fn(), result: async () => 'cancelled' }
}
describe('approved research execution transition', () => {
  it('resumes the same version without replacing its workflow', async () => {
    const current = handle(true)
    const start = vi.fn()
    await ensureApprovedCoordinator(current, 1, start)
    expect(current.signal).toHaveBeenCalledWith('coordinatorResume')
    expect(current.cancel).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })
  it('waits for a paused old execution to close before starting the revision', async () => {
    const current = handle(true)
    const order: string[] = []
    current.cancel = async () => { order.push('cancel') }
    current.result = async () => { order.push('closed'); throw new WorkflowFailedError('TEST cancelled', new CancelledFailure('TEST cancelled'), 'CANCEL_REQUESTED') }
    await ensureApprovedCoordinator(current, 2, async () => { order.push('start') })
    expect(order).toEqual(['cancel', 'closed', 'start'])
  })
  it('denies replacement while the old execution is still working', async () => {
    const current = handle(false), start = vi.fn()
    await expect(ensureApprovedCoordinator(current, 2, start)).rejects.toThrow(/still stopping/)
    expect(current.cancel).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })
  it('does not launch a revision when closure is uncertain or failed', async () => {
    const current = handle(true), start = vi.fn()
    current.result = () => new Promise(() => undefined)
    await expect(ensureApprovedCoordinator(current, 2, start, 10)).rejects.toThrow(/has not stopped/)
    expect(start).not.toHaveBeenCalled()
    const failure = new Error('TEST unexpected closure failure')
    current.result = async () => { throw failure }
    await expect(ensureApprovedCoordinator(current, 2, start)).rejects.toBe(failure)
    expect(start).not.toHaveBeenCalled()
  })
})
