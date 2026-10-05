// [F:frontend.hook.useWorkspace] [F:frontend.src.components.ChatPanel]
import { describe, expect, it } from 'vitest'
import { isFreshTerminalStatus, isTerminalThreadStatus } from '@/data/api/live'

describe('terminal thread status', () => {
  it('treats FINISHED, ERROR and STOPPED as terminal', () => {
    expect(isTerminalThreadStatus('FINISHED')).toBe(true)
    expect(isTerminalThreadStatus('ERROR')).toBe(true)
    expect(isTerminalThreadStatus('STOPPED')).toBe(true)
  })

  it('ignores running, queued, paused and unknown statuses', () => {
    expect(isTerminalThreadStatus('RUNNING')).toBe(false)
    expect(isTerminalThreadStatus('QUEUED')).toBe(false)
    expect(isTerminalThreadStatus('PAUSED')).toBe(false)
    expect(isTerminalThreadStatus('CANCELLING')).toBe(false)
    expect(isTerminalThreadStatus(undefined)).toBe(false)
  })

  it('requires the terminal status to be newer than the send basis', () => {
    expect(isFreshTerminalStatus('ERROR', 9, 5)).toBe(true)
    expect(isFreshTerminalStatus('ERROR', 5, 5)).toBe(false)
    expect(isFreshTerminalStatus('ERROR', 3, 5)).toBe(false)
    expect(isFreshTerminalStatus('ERROR', undefined, 0)).toBe(false)
    expect(isFreshTerminalStatus('RUNNING', 9, 5)).toBe(false)
  })
})
