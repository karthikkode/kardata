// Queued-child controls for the delegation parent. A waiting child has no
// workflow yet, so pause/resume/cancel ride a parent signal instead of
// child signals; steers ride pending thread instructions (gateway path),
// never this signal. State lives in the parent's memory and CAN carry,
// so a crashed worker resumes the exact pause set. Determinism: ids and
// actions arrive in signal payloads; no clocks, no random ids.
import { defineSignal, log } from '@temporalio/workflow'

export interface ChildControlRequest {
  childId: string
  action: 'pause' | 'resume' | 'cancel'
}

export const parentChildControlSignal = defineSignal<[ChildControlRequest]>('parentChildControl')

export interface ChildControlState {
  waiting: Array<{ childId: string }>
  paused: Set<string>
  isRunning(childId: string): boolean
  forwardToChild(childId: string, signals: Array<'childPause' | 'childResume' | 'childCancel' | 'childFinish'>): Promise<void>
  completeCancelled(childId: string): Promise<void>
  noteState(childId: string, status: 'PAUSED' | 'QUEUED', acceptingSteer: boolean): Promise<void>
}

/** Applies one control: queued children resolve in the waiting list, a
 * control racing promotion forwards to the live child (which appends its
 * own state), and finished or unknown ids are ignored (the gateway
 * validated before signalling). */
export async function applyChildControl(state: ChildControlState, control: ChildControlRequest): Promise<void> {
  const at = state.waiting.findIndex((request) => request.childId === control.childId)
  if (control.action === 'pause') {
    if (at >= 0) {
      state.paused.add(control.childId)
      await state.noteState(control.childId, 'PAUSED', false)
    } else if (state.isRunning(control.childId)) {
      await state.forwardToChild(control.childId, ['childPause'])
    }
    log.info('child control applied', { action: 'pause', childId: control.childId, queued: at >= 0 })
    return
  }
  if (control.action === 'resume') {
    state.paused.delete(control.childId)
    if (at >= 0) await state.noteState(control.childId, 'QUEUED', true)
    else if (state.isRunning(control.childId)) await state.forwardToChild(control.childId, ['childResume'])
    log.info('child control applied', { action: 'resume', childId: control.childId, queued: at >= 0 })
    return
  }
  if (at >= 0) {
    state.waiting.splice(at, 1)
    state.paused.delete(control.childId)
    await state.completeCancelled(control.childId)
  } else if (state.isRunning(control.childId)) {
    await state.forwardToChild(control.childId, ['childCancel', 'childFinish'])
  }
  log.info('child control applied', { action: 'cancel', childId: control.childId, queued: at >= 0 })
}

/** Removes and returns the first unpaused waiter, preserving order. Empty
 * pause sets behave exactly like shift(), so old histories replay
 * identically without a version marker at the call site. */
export function shiftUnpaused<T extends { childId: string }>(waiting: T[], paused: Set<string>): T | undefined {
  const at = waiting.findIndex((request) => !paused.has(request.childId))
  if (at < 0) return undefined
  const [next] = waiting.splice(at, 1)
  return next
}
