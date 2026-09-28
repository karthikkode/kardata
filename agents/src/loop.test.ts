import { describe, expect, it } from 'vitest'
import {
  createRun,
  IllegalTransitionError,
  isLegalTransition,
  RUN_STATES,
  transition,
  type RunState,
} from './loop.js'

const ALL_EDGES: Array<[RunState, RunState]> = [
  ['IDLE', 'RUNNING'],
  ['RUNNING', 'PAUSED'],
  ['RUNNING', 'CANCELLING'],
  ['RUNNING', 'FINISHED'],
  ['RUNNING', 'ERROR'],
  ['PAUSED', 'RUNNING'],
  ['PAUSED', 'CANCELLING'],
  ['PAUSED', 'ERROR'],
  ['CANCELLING', 'FINISHED'],
  ['CANCELLING', 'ERROR'],
]

describe('run transitions', () => {
  it('allows exactly the legal edges', () => {
    for (const from of RUN_STATES) {
      for (const to of RUN_STATES) {
        const expected = ALL_EDGES.some(([edgeFrom, edgeTo]) => edgeFrom === from && edgeTo === to)
        expect(isLegalTransition(from, to)).toBe(expected)
      }
    }
  })

  it('applies legal transitions', () => {
    for (const [from, to] of ALL_EDGES) {
      const run = createRun()
      run.state = from
      transition(run, to)
      expect(run.state).toBe(to)
    }
  })

  it('rejects illegal transitions with a typed error', () => {
    const run = createRun()
    expect(() => transition(run, 'FINISHED')).toThrow(IllegalTransitionError)
    expect(() => transition(run, 'PAUSED')).toThrow(IllegalTransitionError)
    try {
      transition(run, 'FINISHED')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError)
      expect((error as IllegalTransitionError).from).toBe('IDLE')
      expect((error as IllegalTransitionError).to).toBe('FINISHED')
    }
    expect(run.state).toBe('IDLE')
  })

  it('treats FINISHED and ERROR as terminal', () => {
    for (const terminal of ['FINISHED', 'ERROR'] as const) {
      const run = createRun()
      run.state = terminal
      for (const to of RUN_STATES) {
        expect(() => transition(run, to)).toThrow(IllegalTransitionError)
      }
    }
  })

  it('walks a full pause-resume-finish lifecycle', () => {
    const run = createRun()
    transition(run, 'RUNNING')
    transition(run, 'PAUSED')
    transition(run, 'RUNNING')
    transition(run, 'FINISHED')
    expect(run.state).toBe('FINISHED')
  })

  it('walks a cancel lifecycle from running and from paused', () => {
    const direct = createRun()
    transition(direct, 'RUNNING')
    transition(direct, 'CANCELLING')
    transition(direct, 'FINISHED')
    const fromPause = createRun()
    transition(fromPause, 'RUNNING')
    transition(fromPause, 'PAUSED')
    transition(fromPause, 'CANCELLING')
    transition(fromPause, 'FINISHED')
    expect(direct.state).toBe('FINISHED')
    expect(fromPause.state).toBe('FINISHED')
  })
})
