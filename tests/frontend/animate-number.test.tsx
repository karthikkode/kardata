import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { animate, motionState } = vi.hoisted(() => {
  const motionState = { reduceMotion: false }
  const animate = vi.fn((_from: number, _to: number, options: { onUpdate: (value: number) => void }) => {
    options.onUpdate(2005)
    return { stop: vi.fn() }
  })
  return { animate, motionState }
})

vi.mock('motion/react', () => ({
  animate: (...args: unknown[]) =>
    (animate as (...call: unknown[]) => unknown)(...args),
  useReducedMotion: () => motionState.reduceMotion,
}))

import { useAnimatedNumber } from '@/lib/animate-number'

function Probe({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useAnimatedNumber(ref, value)
  return <span ref={ref} data-testid="number" />
}

describe('useAnimatedNumber', () => {
  it('counts from zero to the final value over the slow duration', () => {
    motionState.reduceMotion = false
    render(<Probe value={2005} />)
    expect(animate).toHaveBeenCalledWith(0, 2005, expect.objectContaining({ duration: 0.24 }))
    expect(screen.getByTestId('number')).toHaveTextContent('2,005')
  })

  it('shows the final value instantly under reduced motion', () => {
    motionState.reduceMotion = true
    animate.mockClear()
    render(<Probe value={412} />)
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByTestId('number')).toHaveTextContent('412')
  })
})
